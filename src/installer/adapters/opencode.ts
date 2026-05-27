import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  buildTapdEntry,
  entriesEqual,
  type ClientAdapter,
  type TapdServerEntry,
} from '../adapter.js';
import { backupAndWrite, readIfExists } from '../io.js';

/**
 * OpenCode 适配器。
 * 配置文件：~/.config/opencode/mcp.json
 * Tapd 条目位置：mcpServers.tapd
 */

interface OpenCodeConfig {
  mcpServers?: Record<string, unknown>;
  [key: string]: unknown;
}

const PATH_FN = () => join(homedir(), '.config', 'opencode', 'mcp.json');

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
  return { type: 'stdio', command: r.command, args: r.args.map(String), env };
}

export const opencodeAdapter: ClientAdapter = {
  key: 'opencode',
  displayName: 'OpenCode',
  configPath: PATH_FN,
  async read() {
    const raw = await readIfExists(this.configPath());
    if (!raw) return undefined;
    return JSON.parse(raw) as OpenCodeConfig;
  },
  merge(existing, tapdEnv) {
    const next: OpenCodeConfig = (existing as OpenCodeConfig | undefined) ?? {};
    const entry = buildTapdEntry(tapdEnv);
    const mcp = (next.mcpServers as Record<string, unknown> | undefined) ?? {};
    return { ...next, mcpServers: { ...mcp, tapd: entry } };
  },
  async write(config) {
    await backupAndWrite(this.configPath(), JSON.stringify(config, null, 2));
  },
  isUpToDate(existing, tapdEnv) {
    const cfg = existing as OpenCodeConfig | undefined;
    const cur = parseEntry(cfg?.mcpServers?.tapd);
    if (!cur) return false;
    return entriesEqual(cur, buildTapdEntry(tapdEnv));
  },
  describeCurrent(existing) {
    const cfg = existing as OpenCodeConfig | undefined;
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
    const cfg = existing as OpenCodeConfig;
    const mcp = cfg.mcpServers;
    if (!mcp || typeof mcp !== 'object') return false;
    return mcp.tapd != null;
  },
  removeEntry(existing) {
    if (!existing || typeof existing !== 'object') return existing;
    const cfg = existing as OpenCodeConfig;
    const mcp = cfg.mcpServers as Record<string, unknown> | undefined;
    if (!mcp || typeof mcp !== 'object') return { ...cfg };
    const nextMcp: Record<string, unknown> = { ...mcp };
    delete nextMcp.tapd;
    return { ...cfg, mcpServers: nextMcp };
  },
};
