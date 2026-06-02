#!/usr/bin/env node
/**
 * Skill 模板拷贝脚本。
 *
 * tsc 不会拷贝 .md.tmpl 文件（rootDir=src 仅出 .ts → .js / .d.ts）。
 * 这里手动把 src/skills/*.md.tmpl 同步到 dist/skills/，让 npm 包含模板。
 *
 * 设计要点：
 *   - 仅同步本目录文件（不递归子目录），避免误拷其它东西。
 *   - 写入前先 mkdir -p dist/skills/。
 *   - 输出每个拷贝的文件名 + 总数，便于在 CI 里 grep。
 *   - 拷贝失败立刻退出码非零（npm run build 链应该挂掉而不是静默继续）。
 */

import { mkdirSync, copyFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const srcDir = join(repoRoot, 'src', 'skills');
const distDir = join(repoRoot, 'dist', 'skills');

function main() {
  let entries;
  try {
    entries = readdirSync(srcDir);
  } catch (err) {
    console.error(`[copy-skills] cannot read ${srcDir}: ${err.message}`);
    process.exit(1);
  }

  const templates = entries.filter((name) => name.endsWith('.md.tmpl'));
  if (templates.length === 0) {
    console.error(`[copy-skills] no .md.tmpl files in ${srcDir}`);
    process.exit(1);
  }

  mkdirSync(distDir, { recursive: true });

  let copied = 0;
  for (const name of templates) {
    const from = join(srcDir, name);
    const to = join(distDir, name);
    const stat = statSync(from);
    if (!stat.isFile()) continue;
    copyFileSync(from, to);
    console.log(`[copy-skills] ${name}`);
    copied++;
  }

  console.log(`[copy-skills] copied ${copied} template(s) to ${distDir}`);
}

main();
