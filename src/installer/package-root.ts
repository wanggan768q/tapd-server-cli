/**
 * Resolve the npm package root + commands source directory.
 *
 * `npx tapd-server-cli install claude-code` 跑在 dist/installer/...，npm 包根
 * 在 ../../node_modules/tapd-server-cli/，commands 源在包根下 commands/。
 *
 * 用 import.meta.url 推算（vs 依赖 process.cwd() 不稳）。测试时通过依赖注入
 * 把 commandsSrc 暴露成参数，避开 fs.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * npm 包根目录（package.json 所在）。
 *
 * Layout：dist/installer/package-root.js → 上溯 2 级到 dist/，再上 1 级到包根。
 * 编译后 dist 结构：dist/installer/package-root.js（与 src/installer/ 对称）。
 */
export function resolvePackageRoot(): string {
  const filename = fileURLToPath(import.meta.url);
  // src/installer/package-root.ts → 编译为 dist/installer/package-root.js
  // dirname(filename) = .../dist/installer
  // 上溯 2 级到 .../（包根）
  return join(dirname(filename), '..', '..');
}

/** commands 源目录绝对路径（npm 包根 / commands）。 */
export function resolveCommandsSrc(): string {
  return join(resolvePackageRoot(), 'commands');
}
