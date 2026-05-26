/**
 * Installer 抽象：每家 MCP 客户端实现 ClientAdapter 接口
 * （配置文件路径不同、格式 JSON/TOML 不同、merge 节路径不同）。
 *
 * 写入策略统一在 flow.ts 编排：read → merge → backup → atomic write。
 */

export interface ClientAdapter {
  /** install <client> 命令里的 key */
  readonly key: string;
  /** 用户可读名 */
  readonly displayName: string;
  /** 配置文件绝对路径 */
  configPath(): string;
  /** 读取并解析；文件不存在返回 undefined */
  read(): Promise<unknown | undefined>;
  /** 把 tapd 条目合并到现有配置；纯函数，不写文件 */
  merge(existing: unknown | undefined, tapdEnv: Record<string, string>): unknown;
  /** atomic 写回；写前备份 */
  write(config: unknown): Promise<void>;
  /** tapd 条目是否已经与预期完全一致（实现 idempotent no-op） */
  isUpToDate(existing: unknown | undefined, tapdEnv: Record<string, string>): boolean;
  /** 拿出当前 tapd 条目的摘要（用于 diff 提示），缺失返回 undefined */
  describeCurrent(existing: unknown | undefined): string | undefined;
  /** 拿出本次将写入的 tapd 条目摘要 */
  describeNext(tapdEnv: Record<string, string>): string;
}

/**
 * 各家客户端把 tapd 条目写成各自 schema。
 * 我们统一存放为标准化中间结构 TapdServerEntry，由各 adapter 序列化。
 */
export interface TapdServerEntry {
  type: 'stdio';
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** 标准入口：npx 安装的客户端拉起 server */
export function buildTapdEntry(tapdEnv: Record<string, string>): TapdServerEntry {
  return {
    type: 'stdio',
    command: 'npx',
    args: ['-y', 'tapd-server-cli'],
    env: tapdEnv,
  };
}

/**
 * 比较两个 TapdServerEntry 是否完全一致（command / args / env keys+values）。
 */
export function entriesEqual(a: TapdServerEntry, b: TapdServerEntry): boolean {
  if (a.command !== b.command) return false;
  if (a.args.length !== b.args.length) return false;
  for (let i = 0; i < a.args.length; i++) if (a.args[i] !== b.args[i]) return false;
  const ak = Object.keys(a.env).sort();
  const bk = Object.keys(b.env).sort();
  if (ak.length !== bk.length) return false;
  for (let i = 0; i < ak.length; i++) {
    if (ak[i] !== bk[i]) return false;
    if (a.env[ak[i]!] !== b.env[bk[i]!]) return false;
  }
  return true;
}
