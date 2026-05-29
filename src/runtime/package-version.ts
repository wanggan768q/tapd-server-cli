/**
 * 单一来源读取本包 `package.json.version`，给 runtime/server.ts 与
 * commands/update-handler.ts 共用，避免 v0.3.0 删除 src/runtime/version.ts
 * 后再次出现"硬编码 VERSION 字面量与 package.json 漂移"的旧 bug。
 *
 * 实现：用 createRequire(import.meta.url) 解析包根 package.json，dist 与 src
 * 两种 layout 下都能定位到同一份 package.json：
 *   - 编译后：dist/runtime/package-version.js → ../../package.json
 *   - dev 跑 tsx：src/runtime/package-version.ts → ../../package.json
 *
 * 缓存读取结果：单进程内 package.json 不会变。
 */

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let cached: string | undefined;

/**
 * 读 package.json.version。失败时抛错——调用方应在启动早期调用，让进程
 * 立刻退出而不是带着错误版本号继续跑。
 */
export function readPackageVersion(): string {
  if (cached !== undefined) return cached;
  const require = createRequire(import.meta.url);
  // src/runtime/package-version.ts → 编译为 dist/runtime/package-version.js
  // dirname(filename) = .../dist/runtime  →  ../.. = 包根
  const here = dirname(fileURLToPath(import.meta.url));
  const pkgPath = join(here, '..', '..', 'package.json');
  const pkg = require(pkgPath) as { version?: unknown };
  if (typeof pkg.version !== 'string' || pkg.version.length === 0) {
    throw new Error(`无法从 ${pkgPath} 读取 version`);
  }
  cached = pkg.version;
  return pkg.version;
}

/**
 * 测试钩子：清空缓存（仅 vitest 等单测使用，生产路径不应调）。
 */
export function __resetPackageVersionCacheForTest(): void {
  cached = undefined;
}
