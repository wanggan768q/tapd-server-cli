import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Cursor `.cursor/rules/tapd.mdc` 全文写。
 *
 * 与 AGENTS.md 不同：Cursor `.mdc` 文件本身就是一个"独立 rule"，没有"块外内容"概念，
 * 所以这里直接全文覆写。
 *
 * `.mdc` frontmatter 形如：
 *   ---
 *   description: <双语触发词>
 *   alwaysApply: false
 *   ---
 *
 * `alwaysApply: false` 让 Cursor 仅按 description 的语义触发，不无脑塞进每个对话——
 * 与本 skill 体系的"按场景触发"语义对齐。
 *
 * 行为：
 *   - 文件不存在 → 创建（含父目录 mkdir -p）
 *   - 文件存在 → 直接覆写（用户改过的内容会丢，由 install-skills 的 hash 检测层负责询问）
 *   - 总是写 LF，不保留 CRLF（.mdc 是机器生成的，行尾风格不重要）
 *   - 原子写：tmp + rename
 *
 * 不做 hash 比较 / 用户改动检测——那是 install-skills 流程的职责，本模块仅负责写。
 */

export interface CursorMdcContent {
  /** description 字段（双语触发词内容）。会被原样塞进 frontmatter，不做转义。
   *  调用方 MUST 保证不含 `\n---\n` 之类破坏 frontmatter 的内容。 */
  description: string;
  /** 正文（frontmatter 之后），不需要 leading newline。 */
  body: string;
}

/** 拼出完整的 `.mdc` 文件内容（frontmatter + body）。 */
export function renderCursorMdc(content: CursorMdcContent): string {
  // 用 block-style 的 description 避免单行特殊字符引发 YAML 解析问题
  const fm = [
    '---',
    'description: |',
    indent(content.description.trim(), '  '),
    'alwaysApply: false',
    '---',
  ].join('\n');
  return `${fm}\n\n${content.body.replace(/^\s+/, '')}\n`;
}

/** 写 `.mdc` 文件（覆写）。 */
export async function writeCursorMdc(filePath: string, content: CursorMdcContent): Promise<void> {
  const body = renderCursorMdc(content);
  await fs.mkdir(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, body, 'utf8');
  await fs.rename(tmp, filePath);
}

/** 删除 `.mdc` 文件；不存在则 noop。返回是否实际删除了。 */
export async function removeCursorMdc(filePath: string): Promise<boolean> {
  try {
    await fs.unlink(filePath);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

function indent(text: string, prefix: string): string {
  return text
    .split('\n')
    .map((line) => (line.length > 0 ? `${prefix}${line}` : line))
    .join('\n');
}
