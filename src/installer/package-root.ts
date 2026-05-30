/**
 * Resolve the npm package root directory.
 *
 * 当前仅给将来可能需要拿包根的地方留接口；v0.3.2 起本工具不再依赖该路径
 * 拷贝任何文件（user-scope commands 拷贝逻辑已移除）。
 *
 * 用 import.meta.url 推算（vs 依赖 process.cwd() 不稳）。
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
