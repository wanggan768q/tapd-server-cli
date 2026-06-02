import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * 各 MCP 客户端的"系统提示文件"路径解析。
 *
 * 管理 block 落点（design.md 决策 4 / spec "跨客户端落地"）：
 *   - Claude Code: SKILL.md 文件 + CLAUDE.md managed block
 *   - Codex / OpenCode: AGENTS.md managed block（内嵌 skill 全文）
 *   - Cursor: .cursor/rules/tapd.mdc 全文写
 */

export type ClientKey = 'claude-code' | 'codex' | 'cursor' | 'opencode';
export type Scope = 'user' | 'project';

export interface ClientPaths {
  /** 注入 managed block 的目标文件（CLAUDE.md / AGENTS.md / 或 .mdc）。 */
  rulesFile: string;
  /** 写 SKILL.md 文件的根目录（仅 Claude Code 用）。 */
  skillsDir?: string;
  /**
   * 该客户端是否走 "managed block 注入"（true）还是"全文写"（false，仅 Cursor）。
   */
  usesManagedBlock: boolean;
}

export interface ResolvePathsInput {
  client: ClientKey;
  scope: Scope;
  homeOverride?: string;
  cwdOverride?: string;
}

export function resolveClientPaths(input: ResolvePathsInput): ClientPaths {
  const home = input.homeOverride ?? homedir();
  const cwd = input.cwdOverride ?? process.cwd();

  switch (input.client) {
    case 'claude-code':
      if (input.scope === 'user') {
        return {
          rulesFile: join(home, '.claude', 'CLAUDE.md'),
          skillsDir: join(home, '.claude', 'skills'),
          usesManagedBlock: true,
        };
      }
      return {
        rulesFile: join(cwd, 'CLAUDE.md'),
        skillsDir: join(cwd, '.claude', 'skills'),
        usesManagedBlock: true,
      };

    case 'codex':
      return {
        rulesFile:
          input.scope === 'user'
            ? join(home, '.codex', 'AGENTS.md')
            : join(cwd, 'AGENTS.md'),
        usesManagedBlock: true,
      };

    case 'opencode':
      return {
        rulesFile:
          input.scope === 'user'
            ? join(home, '.config', 'opencode', 'AGENTS.md')
            : join(cwd, 'AGENTS.md'),
        usesManagedBlock: true,
      };

    case 'cursor':
      return {
        rulesFile:
          input.scope === 'user'
            ? join(home, '.cursor', 'rules', 'tapd.mdc')
            : join(cwd, '.cursor', 'rules', 'tapd.mdc'),
        usesManagedBlock: false,
      };
  }
}
