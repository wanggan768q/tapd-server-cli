/**
 * 交互式（muted）PAT 输入 + 非 tty 兜底。
 *
 * 出于安全考虑（D7）：
 *   - 不接受 --token CLI flag（在 cli.ts 层就不暴露）
 *   - tty 场景 → muted readline 提示输入，不回显字符
 *   - 非 tty 场景 → 从 TAPD_TOKEN env 取；env 也没有则报错退出
 */

import readline from 'node:readline';

export class TokenInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenInputError';
  }
}

export interface PromptOptions {
  /** 注入测试用 stdin（默认 process.stdin） */
  stdin?: NodeJS.ReadableStream & { isTTY?: boolean };
  /** 注入测试用 stdout（默认 process.stdout） */
  stdout?: NodeJS.WritableStream;
  /** 注入测试用 env（默认 process.env） */
  env?: NodeJS.ProcessEnv;
}

export async function promptToken(opts: PromptOptions = {}): Promise<{
  token: string;
  source: 'tty' | 'env';
}> {
  const stdin = opts.stdin ?? process.stdin;
  const stdout = opts.stdout ?? process.stdout;
  const env = opts.env ?? process.env;
  const isTTY = !!(stdin as { isTTY?: boolean }).isTTY;

  if (!isTTY) {
    const envValue = env.TAPD_TOKEN;
    if (envValue && envValue.length > 0) {
      stdout.write('从 TAPD_TOKEN 环境变量读取 PAT。\n');
      return { token: envValue.trim(), source: 'env' };
    }
    throw new TokenInputError(
      '在非 tty 环境下请通过 TAPD_TOKEN=<pat> tapd-server-cli install <client> 提供令牌。',
    );
  }

  // tty 路径：用 readline + muted output
  // 标准做法：拦截 _writeToOutput，输入字符不回显。
  const rl = readline.createInterface({
    input: stdin,
    output: stdout,
    terminal: true,
  });
  const rlInternal = rl as unknown as { _writeToOutput: (chunk: string) => void };
  const originalWrite = rlInternal._writeToOutput.bind(rl);
  let muted = false;
  rlInternal._writeToOutput = (chunk: string) => {
    if (muted) {
      // 把字符替换为空——不显示也不显示 *（避免暴露长度）
      return;
    }
    originalWrite(chunk);
  };

  try {
    const token = await new Promise<string>((resolve) => {
      stdout.write('TAPD 个人访问令牌（PAT）: ');
      muted = true;
      rl.question('', (answer) => resolve(answer));
    });
    muted = false;
    stdout.write('\n');
    const trimmed = token.trim();
    if (!trimmed) throw new TokenInputError('未输入 PAT，已取消');
    return { token: trimmed, source: 'tty' };
  } finally {
    rl.close();
  }
}
