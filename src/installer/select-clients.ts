/**
 * 客户端选择层（D6）：把"决定要安装哪些客户端"从命令行解析与 install 编排里隔离。
 *
 * 调用方（src/index.ts）拿到 commander 解析出的 `parsedClients: string[]` 后调用
 * `resolveClients(parsedClients, opts)`，得到一个非空、已去重保序的 client key 列表，
 * 或者收到三类已分类的错误：
 *
 *   - NonInteractiveNoClientError：零参且 stdin/stdout 任一非 TTY → 报错指引（保护 CI）
 *   - NoClientsSelectedError      ：进交互后用户回车却未勾任何项 → 报错退出
 *   - UserCancelledError          ：用户在 checkbox 中 Ctrl-C 取消
 */

import type { ClientAdapter } from './adapter.js';

export class NonInteractiveNoClientError extends Error {
  readonly supported: readonly string[];
  readonly commandName: string;
  constructor(supported: readonly string[], commandName: string = 'install') {
    super(
      `非交互环境下必须显式指定客户端。支持的值:${supported.join(' / ')}`,
    );
    this.name = 'NonInteractiveNoClientError';
    this.supported = supported;
    this.commandName = commandName;
  }
}

export class NoClientsSelectedError extends Error {
  constructor() {
    super('未选择任何客户端，已退出');
    this.name = 'NoClientsSelectedError';
  }
}

export class UserCancelledError extends Error {
  constructor() {
    super('用户取消了客户端选择');
    this.name = 'UserCancelledError';
  }
}

export interface CheckboxChoice {
  /** 选项值（adapter.key） */
  readonly value: string;
  /** 显示名（adapter.displayName） */
  readonly name: string;
}

export interface PromptCheckboxFn {
  (args: { message: string; choices: readonly CheckboxChoice[] }): Promise<readonly string[]>;
}

export interface ResolveClientsOptions {
  /** 已知支持的 adapter 集合,用于渲染 checkbox 选项 */
  readonly adapters: readonly ClientAdapter[];
  /** stdin 是否为 TTY;默认读 process.stdin.isTTY */
  readonly isStdinTty?: boolean;
  /** stdout 是否为 TTY;默认读 process.stdout.isTTY */
  readonly isStdoutTty?: boolean;
  /** 注入的 prompt(默认 @inquirer/checkbox) */
  readonly prompt?: PromptCheckboxFn;
  /**
   * 交互式 prompt 的 message 文案;默认为 install 文案。
   * uninstall 路径传入"选择要卸载的 MCP 客户端..." 等对称文案。
   */
  readonly message?: string;
  /**
   * 当前子命令名(用于 NonInteractiveNoClientError 中渲染示例)。
   * 默认 'install',uninstall 路径传 'uninstall'。
   */
  readonly commandName?: string;
}

/**
 * Ctrl-C 取消的检测：@inquirer/* 在 SIGINT 下抛出名为 ExitPromptError 的错误，
 * 或者在更早版本里抛出带特定 message 的错误。统一规整为 UserCancelledError。
 */
function isInquirerCancellation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; message?: string };
  if (e.name === 'ExitPromptError') return true;
  // 旧版兜底：message 含 force closed / canceled by user
  if (typeof e.message === 'string') {
    const m = e.message.toLowerCase();
    if (m.includes('force closed') || m.includes('cancelled by user')) return true;
  }
  return false;
}

/** 默认 prompt：动态 import `@inquirer/checkbox`，避免在测试/非 TTY 路径无谓加载。 */
const defaultPrompt: PromptCheckboxFn = async ({ message, choices }) => {
  const mod = await import('@inquirer/checkbox');
  const checkbox = mod.default;
  const result = await checkbox({
    message,
    choices: choices.map((c) => ({ value: c.value, name: c.name })),
    // 'instructions' 默认即"空格选 / 回车确认 / a 全选 / i 反选"，保持默认。
  });
  return result;
};

/** 去重保序 */
function dedupePreserveOrder(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

/**
 * 决定本次 install 要处理的客户端列表。
 *
 * 行为矩阵（D3）：
 *   parsedClients.length ≥ 1                        → 直接返回（去重保序）
 *   parsedClients.length === 0 && stdin&stdout TTY  → 调用 prompt 选择
 *   parsedClients.length === 0 && 任一非 TTY        → 抛 NonInteractiveNoClientError
 */
export async function resolveClients(
  parsedClients: readonly string[],
  opts: ResolveClientsOptions,
): Promise<string[]> {
  if (parsedClients.length > 0) {
    return dedupePreserveOrder(parsedClients);
  }

  const isStdinTty =
    opts.isStdinTty ?? Boolean((process.stdin as { isTTY?: boolean }).isTTY);
  const isStdoutTty =
    opts.isStdoutTty ?? Boolean((process.stdout as { isTTY?: boolean }).isTTY);

  if (!isStdinTty || !isStdoutTty) {
    throw new NonInteractiveNoClientError(
      opts.adapters.map((a) => a.key),
      opts.commandName ?? 'install',
    );
  }

  const prompt = opts.prompt ?? defaultPrompt;
  const choices: CheckboxChoice[] = opts.adapters.map((a) => ({
    value: a.key,
    name: a.displayName,
  }));

  let selected: readonly string[];
  try {
    selected = await prompt({
      message: opts.message ?? '选择要安装到的 MCP 客户端(空格选择,回车确认)',
      choices,
    });
  } catch (err) {
    if (isInquirerCancellation(err)) {
      throw new UserCancelledError();
    }
    throw err;
  }

  if (selected.length === 0) {
    throw new NoClientsSelectedError();
  }

  return dedupePreserveOrder(selected);
}
