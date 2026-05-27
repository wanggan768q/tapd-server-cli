import { homedir } from 'node:os';
import { join } from 'node:path';

import { buildTapdEntry, entriesEqual, type ClientAdapter, type TapdServerEntry } from '../adapter.js';
import { backupAndWrite, readIfExists } from '../io.js';

/**
 * Claude Code 适配器。
 * 配置文件：~/.claude.json
 * Tapd 条目位置：mcpServers.tapd（用户级全局）
 *
 * D3 决策：不写 projects[<cwd>].mcpServers.tapd —— 那是 per-project 配置，
 * npm-installed 用户期望的是用户级全局生效。
 */

interface ClaudeConfig {
  mcpServers?: Record<string, unknown>;
  [key: string]: unknown;
}

const PATH_FN = () => join(homedir(), '.claude.json');

function parseEntry(raw: unknown): TapdServerEntry | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  if (
    typeof r.command !== 'string' ||
    !Array.isArray(r.args) ||
    !r.env ||
    typeof r.env !== 'object'
  ) {
    return undefined;
  }
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(r.env as Record<string, unknown>)) {
    if (typeof v === 'string') env[k] = v;
  }
  return {
    type: 'stdio',
    command: r.command,
    args: r.args.map(String),
    env,
  };
}

export const claudeCodeAdapter: ClientAdapter = {
  key: 'claude-code',
  displayName: 'Claude Code',
  configPath: PATH_FN,
  async read() {
    const raw = await readIfExists(this.configPath());
    if (!raw) return undefined;
    return JSON.parse(raw) as ClaudeConfig;
  },
  merge(existing, tapdEnv) {
    const next: ClaudeConfig = (existing as ClaudeConfig | undefined) ?? {};
    const entry = buildTapdEntry(tapdEnv);
    const mcp = (next.mcpServers as Record<string, unknown> | undefined) ?? {};
    return {
      ...next,
      mcpServers: { ...mcp, tapd: entry },
    };
  },
  async write(config) {
    const json = JSON.stringify(config, null, 2);
    await backupAndWrite(this.configPath(), json);
  },
  isUpToDate(existing, tapdEnv) {
    const cfg = existing as ClaudeConfig | undefined;
    const current = parseEntry(cfg?.mcpServers?.tapd);
    if (!current) return false;
    return entriesEqual(current, buildTapdEntry(tapdEnv));
  },
  describeCurrent(existing) {
    const cfg = existing as ClaudeConfig | undefined;
    const cur = parseEntry(cfg?.mcpServers?.tapd);
    if (!cur) return undefined;
    return `command=${cur.command} args=${cur.args.join(' ')} env_keys=${Object.keys(cur.env).join(',')}`;
  },
  describeNext(tapdEnv) {
    const next = buildTapdEntry(tapdEnv);
    return `command=${next.command} args=${next.args.join(' ')} env_keys=${Object.keys(next.env).join(',')}`;
  },
  hasTapdEntry(existing) {
    if (!existing || typeof existing !== 'object') return false;
    const cfg = existing as ClaudeConfig;
    const mcp = cfg.mcpServers;
    if (!mcp || typeof mcp !== 'object') return false;
    return mcp.tapd != null;
  },
  removeEntry(existing) {
    // 仅在 hasTapdEntry === true 时被调用;但仍做防御
    if (!existing || typeof existing !== 'object') return existing;
    const cfg = existing as ClaudeConfig;
    const mcp = cfg.mcpServers as Record<string, unknown> | undefined;
    if (!mcp || typeof mcp !== 'object') return { ...cfg };
    // 浅拷贝顶层 + 浅拷贝 mcpServers,删 tapd 键
    const nextMcp: Record<string, unknown> = { ...mcp };
    delete nextMcp.tapd;
    return { ...cfg, mcpServers: nextMcp };
  },
};
