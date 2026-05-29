/**
 * User-scope commands install/remove —— 给 claude-code 客户端把 npm 包内
 * commands/*.md 拷到 ~/.claude/commands/tapd-server-cli/<name>.md，让 user-scope
 * slash 命令机制识别 /tapd-server-cli:<name>。
 *
 * 与 plugin 体系无关——后者已在 v0.3.0 删除。本文件是 v0.3.0 的承接路径
 * （install-claude-code-user-scope-commands change）。
 *
 * 失败 graceful：单个文件拷贝失败不抛、不中断 install 主流程；调用方按返回值
 * 决定 stdout/stderr 输出。
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';

const NAMESPACE = 'tapd-server-cli';

export interface InstallCommandsResult {
  installed: string[];
  skipped: string[];
  failed: { file: string; error: string }[];
  /** commands 源目录不存在时设；其它失败模式不设 */
  srcMissing?: boolean;
  /** target 目录 mkdir 失败时设；既无 installed 也无 failed 详细文件级 */
  mkdirError?: string;
}

export interface RemoveCommandsResult {
  removed: boolean;
  /** 目录不存在时为 true，其它失败为 false */
  notPresent?: boolean;
  error?: string;
}

/**
 * 把 `commandsSrc/*.md` 拷到 `${targetHome}/.claude/commands/tapd-server-cli/`。
 *
 * - target 目录不存在自动创建（mkdir -p）
 * - 拷贝行为是字节级覆盖（namespace 视为本工具私有；用户自加同名文件会被覆盖）
 * - 用户自加的非同名文件保留不删
 * - 单个文件拷贝失败不抛，记到 failed 列表
 *
 * @param targetHome 用户家目录（os.homedir() 或测试时的临时目录）
 * @param commandsSrc commands 源目录绝对路径（resolveCommandsSrc() 或测试 fixture）
 */
export function installCommands(
  targetHome: string,
  commandsSrc: string,
): InstallCommandsResult {
  const result: InstallCommandsResult = {
    installed: [],
    skipped: [],
    failed: [],
  };

  if (!existsSync(commandsSrc)) {
    result.srcMissing = true;
    return result;
  }

  const targetDir = join(targetHome, '.claude', 'commands', NAMESPACE);
  try {
    mkdirSync(targetDir, { recursive: true });
  } catch (err) {
    result.mkdirError = err instanceof Error ? err.message : String(err);
    return result;
  }

  let entries: string[];
  try {
    entries = readdirSync(commandsSrc).filter((name) => name.endsWith('.md'));
  } catch (err) {
    result.failed.push({
      file: commandsSrc,
      error: err instanceof Error ? err.message : String(err),
    });
    return result;
  }

  for (const name of entries) {
    const src = join(commandsSrc, name);
    const dest = join(targetDir, name);
    try {
      copyFileSync(src, dest);
      result.installed.push(name);
    } catch (err) {
      result.failed.push({
        file: name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

/**
 * 删除 `${targetHome}/.claude/commands/tapd-server-cli/` 整目录。
 *
 * - 递归删（含用户自加的同 namespace 下文件——namespace 视为本工具私有）
 * - 目录不存在时静默成功（notPresent: true）
 * - 删除失败不抛，记到 error 字段
 */
export function removeCommands(targetHome: string): RemoveCommandsResult {
  const targetDir = join(targetHome, '.claude', 'commands', NAMESPACE);

  if (!existsSync(targetDir)) {
    return { removed: false, notPresent: true };
  }

  try {
    rmSync(targetDir, { recursive: true, force: true });
    return { removed: true };
  } catch (err) {
    return {
      removed: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
