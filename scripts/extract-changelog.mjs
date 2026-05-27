#!/usr/bin/env node
/**
 * 从 CHANGELOG.md 提取指定版本的 release notes 段。
 *
 * 用法：
 *   node scripts/extract-changelog.mjs <version> [--out <path>]
 *
 *   <version>      要提取的版本号(如 0.2.0)
 *   --out <path>   把抽取结果写入指定文件;省略则打印到 stdout
 *
 * 行为:
 *   - CHANGELOG.md 不存在 → exit 1,stderr 给提示
 *   - [<version>] 段不存在或正文为空 → exit 1,stderr 给提示
 *   - 成功 → exit 0,正文写到 stdout 或 --out 指定文件
 *
 * 这个脚本被两处共用:
 *   - 本地 scripts/publish.mjs 的 extractChangelogSection(import 同款逻辑)
 *   - .github/workflows/release.yml 的 "Extract release notes" step
 *
 * 抽取规则:
 *   - 起点:首个匹配 `^##\s+\[<version>\](\s|$)` 的行
 *   - 终点:之后第一个 `^##\s` 行(下一个 `## ` 标题)
 *   - 过滤:抽取范围内 reference-style link 行(形如 `[0.2.0]: https://...`)被剔除
 *   - trim 首尾空行
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

/**
 * 主抽取函数。返回 { headingLine, body } 或 null。
 * 公开给 publish.mjs 复用,避免重复实现。
 */
export function extractChangelogSection(version, repoRoot = REPO_ROOT) {
  const path = join(repoRoot, 'CHANGELOG.md');
  if (!existsSync(path)) return null;
  const text = readFileSync(path, 'utf8');
  const lines = text.split(/\r?\n/);

  // 把版本号里的 . 转义,生成精确匹配的正则
  const headingRe = new RegExp(
    `^##\\s+\\[${version.replace(/\./g, '\\.')}\\](\\s|$)`,
  );

  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (headingRe.test(lines[i])) {
      startIdx = i;
      break;
    }
  }
  if (startIdx === -1) return null;

  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) {
      endIdx = i;
      break;
    }
  }

  const headingLine = lines[startIdx].trim();
  const bodyLines = lines.slice(startIdx + 1, endIdx).filter((l) => {
    return !/^\[[^\]]+\]:\s+https?:\/\//.test(l.trim());
  });
  const body = bodyLines.join('\n').replace(/^\s+|\s+$/g, '');

  if (body.length === 0) return null;
  return { headingLine, body };
}

// 当作为 CLI 调用时:解析参数 → 抽取 → 输出
// 注意:用 import.meta.url 与 process.argv[1] 的 file:// URL 严格比较;
// 被其它脚本 import 时,process.argv[1] 是父脚本入口,两者不会相等。
function pathToFileUrl(p) {
  if (!p) return undefined;
  // Windows 路径需要先正斜杠化再加 file:// 前缀
  const norm = p.replace(/\\/g, '/');
  return norm.startsWith('/') ? `file://${norm}` : `file:///${norm}`;
}
const isMain = process.argv[1] && import.meta.url === pathToFileUrl(process.argv[1]);

if (isMain) {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    process.stderr.write(
      'Usage: node scripts/extract-changelog.mjs <version> [--out <path>]\n',
    );
    process.exit(args.length === 0 ? 1 : 0);
  }

  const version = args[0];
  let outPath;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--out' && i + 1 < args.length) {
      outPath = args[++i];
    }
  }

  const path = join(REPO_ROOT, 'CHANGELOG.md');
  if (!existsSync(path)) {
    process.stderr.write(
      `error: CHANGELOG.md not found at ${path}.\n` +
        `Add a [${version}] section before tagging a release.\n`,
    );
    process.exit(1);
  }

  const section = extractChangelogSection(version);
  if (!section) {
    process.stderr.write(
      `error: CHANGELOG.md missing [${version}] section (or section body is empty).\n` +
        `Add a "## [${version}] - YYYY-MM-DD" heading with body before tagging.\n`,
    );
    process.exit(1);
  }

  const output = section.body + '\n';
  if (outPath) {
    writeFileSync(outPath, output, 'utf8');
    process.stderr.write(
      `extracted [${version}] release notes (${section.body.split('\n').length} lines) → ${outPath}\n`,
    );
  } else {
    process.stdout.write(output);
  }
  process.exit(0);
}
