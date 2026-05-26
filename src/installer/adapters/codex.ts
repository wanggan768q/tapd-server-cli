import { homedir } from 'node:os';
import { join } from 'node:path';

import { parse as parseToml, stringify as stringifyToml } from '@iarna/toml';

import {
  buildTapdEntry,
  entriesEqual,
  type ClientAdapter,
  type TapdServerEntry,
} from '../adapter.js';
import { backupAndWrite, readIfExists } from '../io.js';

/**
 * Codex 适配器。
 * 配置文件：~/.codex/config.toml
 * Tapd 条目位置：[mcp_servers.tapd] 节
 *
 * 注意：@iarna/toml 解析后是普通 JS 对象；stringify 重新生成会丢失原文件
 * 注释（这是所有 TOML 库的通病）。已在 design.md 标注。
 */

interface CodexConfig {
  mcp_servers?: Record<string, unknown>;
  [key: string]: unknown;
}

const PATH_FN = () => join(homedir(), '.codex', 'config.toml');

function parseEntry(raw: unknown): TapdServerEntry | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.command !== 'string' || !Array.isArray(r.args)) return undefined;
  const env: Record<string, string> = {};
  if (r.env && typeof r.env === 'object') {
    for (const [k, v] of Object.entries(r.env as Record<string, unknown>)) {
      if (typeof v === 'string') env[k] = v;
    }
  }
  return {
    type: 'stdio',
    command: r.command,
    args: r.args.map(String),
    env,
  };
}

export const codexAdapter: ClientAdapter = {
  key: 'codex',
  displayName: 'Codex',
  configPath: PATH_FN,
  async read() {
    const raw = await readIfExists(this.configPath());
    if (!raw) return undefined;
    return parseToml(raw) as CodexConfig;
  },
  merge(existing, tapdEnv) {
    const next: CodexConfig = (existing as CodexConfig | undefined) ?? {};
    const entry = buildTapdEntry(tapdEnv);
    const mcp = (next.mcp_servers as Record<string, unknown> | undefined) ?? {};
    return {
      ...next,
      mcp_servers: {
        ...mcp,
        tapd: {
          command: entry.command,
          args: entry.args,
          env: entry.env,
        },
      },
    };
  },
  async write(config) {
    // @iarna/toml stringify 要求 JsonMap；上层我们写入的都是 plain object
    const text = stringifyToml(config as Parameters<typeof stringifyToml>[0]);
    await backupAndWrite(this.configPath(), text);
  },
  isUpToDate(existing, tapdEnv) {
    const cfg = existing as CodexConfig | undefined;
    const cur = parseEntry(cfg?.mcp_servers?.tapd);
    if (!cur) return false;
    return entriesEqual(cur, buildTapdEntry(tapdEnv));
  },
  describeCurrent(existing) {
    const cfg = existing as CodexConfig | undefined;
    const cur = parseEntry(cfg?.mcp_servers?.tapd);
    if (!cur) return undefined;
    return `command=${cur.command} args=${cur.args.join(' ')} env_keys=${Object.keys(cur.env).join(',')}`;
  },
  describeNext(tapdEnv) {
    const next = buildTapdEntry(tapdEnv);
    return `command=${next.command} args=${next.args.join(' ')} env_keys=${Object.keys(next.env).join(',')}`;
  },
};
