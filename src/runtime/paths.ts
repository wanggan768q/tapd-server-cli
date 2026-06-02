import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * `~/.tapd/` 与 `<proj>/.tapd/` 路径的统一封装。
 *
 * 与 cookie 持久化路径 `~/.config/tapd-mcp/` 故意分开（design.md 决策 2）：
 *   - `~/.config/tapd-mcp/` 只装"凭据"（cookie / token）
 *   - `~/.tapd/`           装"skill 安装期配置 + 运行期缓存"
 * 这样 `uninstall --purge` 不需要在两套语义间做选择。
 *
 * 所有路径都允许通过 `homeOverride` / `cwdOverride` 注入，便于测试。
 */

export type Scope = 'user' | 'project';

export interface PathOverrides {
  /** 默认 `os.homedir()`。 */
  homeOverride?: string;
  /** 默认 `process.cwd()`，仅在 scope === 'project' 时使用。 */
  cwdOverride?: string;
}

export const TAPD_DIR_NAME = '.tapd';
export const TAPD_CONFIG_FILE = 'tapd.config.json';
export const TAPD_CACHE_FILE = 'cache.json';

/** 用户级 `~/.tapd/`。 */
export function userTapdDir(overrides: PathOverrides = {}): string {
  const home = overrides.homeOverride ?? homedir();
  return join(home, TAPD_DIR_NAME);
}

/** 项目级 `<proj>/.tapd/`。 */
export function projectTapdDir(overrides: PathOverrides = {}): string {
  const cwd = overrides.cwdOverride ?? process.cwd();
  return join(cwd, TAPD_DIR_NAME);
}

/** 根据 scope 选用 user / project 目录。 */
export function tapdDirForScope(scope: Scope, overrides: PathOverrides = {}): string {
  return scope === 'user' ? userTapdDir(overrides) : projectTapdDir(overrides);
}

/** `tapd.config.json` 的完整路径（按 scope）。 */
export function tapdConfigPath(scope: Scope, overrides: PathOverrides = {}): string {
  return join(tapdDirForScope(scope, overrides), TAPD_CONFIG_FILE);
}

/** `cache.json` 的完整路径（按 scope）。 */
export function cacheJsonPath(scope: Scope, overrides: PathOverrides = {}): string {
  return join(tapdDirForScope(scope, overrides), TAPD_CACHE_FILE);
}
