import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';

import type { Logger } from 'pino';

/**
 * Markdown / mdc 文件的 "managed block" 注入与移除。
 *
 * 用于：
 *   - Claude Code: ~/.claude/CLAUDE.md
 *   - Codex / OpenCode: AGENTS.md
 *   - 项目级版本同上
 *
 * Cursor 不走这条路（全文写 .mdc，见 cursor-mdc.ts）。
 *
 * Block 标记：
 *   <!-- BEGIN tapd-server-cli skills (auto-managed) -->
 *   ...块内内容（每次重生成）...
 *   <!-- END tapd-server-cli skills -->
 *
 * 设计要点：
 *   - 已有 block → 仅替换块内内容；保留块外原样（BOM / CRLF / 空行 / 顺序均不动）
 *   - 没有 block → 追加到文件末尾，前面隔一个空行
 *   - 文件不存在 → 创建只含 block 的新文件（不强加 trailing newline，写入端控制）
 *   - 块外含 `tapd` 提及 → 输出一次性 warning（一次注入只 warn 一次，调用方决定怎么用）
 *   - 原子写：tmp + rename
 *
 * `removeManagedBlock`：
 *   - 块存在 → 删除块及其前后多余空行（保留正常段落空行）
 *   - 块不存在 → noop
 *   - 删除后文件变空 → 删文件（避免留无内容空文件）
 *
 * 全部 API 使用 LF 内部表示；遇到 CRLF 文件会保留行尾风格。
 */

export const BEGIN_MARK = '<!-- BEGIN tapd-server-cli skills (auto-managed) -->';
export const END_MARK = '<!-- END tapd-server-cli skills -->';

const TAPD_MENTION_RE = /\btapd\b/i;

export interface InjectOptions {
  logger?: Logger;
}

export interface InjectResult {
  outcome: 'created' | 'inserted' | 'replaced' | 'unchanged';
  /** 是否检测到块外的 TAPD 文本提及（warning 已通过 logger 输出）。 */
  hadOutsideMention: boolean;
}

/** 检测文件中是否含 managed block。 */
export async function hasManagedBlock(filePath: string): Promise<boolean> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
  return raw.includes(BEGIN_MARK) && raw.includes(END_MARK);
}

/**
 * 注入 / 替换 managed block。
 *
 * blockBody 不应包含 BEGIN/END 标记本身——本函数会自动加。
 * blockBody 内部允许含任意 markdown（包括其它 HTML 注释）。
 */
export async function injectManagedBlock(
  filePath: string,
  blockBody: string,
  options: InjectOptions = {},
): Promise<InjectResult> {
  const block = `${BEGIN_MARK}\n${blockBody.replace(/\s+$/, '')}\n${END_MARK}`;

  let existing: string | undefined;
  try {
    existing = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    existing = undefined;
  }

  // 文件不存在 → 创建
  if (existing === undefined) {
    await fs.mkdir(dirname(filePath), { recursive: true });
    await atomicWrite(filePath, `${block}\n`);
    return { outcome: 'created', hadOutsideMention: false };
  }

  // 检测原始行尾风格
  const useCrlf = /\r\n/.test(existing);
  const eol = useCrlf ? '\r\n' : '\n';
  const renderedBlock = useCrlf ? block.replace(/\n/g, '\r\n') : block;

  const beginIdx = existing.indexOf(BEGIN_MARK);
  const endIdx = existing.indexOf(END_MARK);

  if (beginIdx >= 0 && endIdx > beginIdx) {
    // 已有 block → 仅替换块内（含标记）
    const before = existing.slice(0, beginIdx);
    const after = existing.slice(endIdx + END_MARK.length);
    const next = `${before}${renderedBlock}${after}`;

    if (next === existing) {
      return {
        outcome: 'unchanged',
        hadOutsideMention: detectOutsideMention(before, after, options.logger, filePath),
      };
    }

    await atomicWrite(filePath, next);
    return {
      outcome: 'replaced',
      hadOutsideMention: detectOutsideMention(before, after, options.logger, filePath),
    };
  }

  // 没有 block → 追加到末尾
  const trimmed = existing.replace(/[\s]+$/, '');
  const sep = trimmed.length > 0 ? `${eol}${eol}` : '';
  const next = `${trimmed}${sep}${renderedBlock}${eol}`;
  await atomicWrite(filePath, next);
  return {
    outcome: 'inserted',
    hadOutsideMention: detectOutsideMention(trimmed, '', options.logger, filePath),
  };
}

/**
 * 移除 managed block。返回 true 表示文件被改动；false 表示 noop。
 *
 * 删除后若文件变空（仅空白），整个文件 unlink。
 */
export async function removeManagedBlock(filePath: string): Promise<boolean> {
  let existing: string;
  try {
    existing = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }

  const beginIdx = existing.indexOf(BEGIN_MARK);
  const endIdx = existing.indexOf(END_MARK);
  if (beginIdx < 0 || endIdx <= beginIdx) return false;

  // 把 block 连同它前后紧贴的空行一起吃掉，但保留更外层的内容空行
  const useCrlf = /\r\n/.test(existing);
  const eol = useCrlf ? '\r\n' : '\n';
  const blockEndAbs = endIdx + END_MARK.length;

  // 向前扩张：吃掉 block 前的 1 段空行
  let cutStart = beginIdx;
  const beforeBlock = existing.slice(0, beginIdx);
  const trimmedBefore = beforeBlock.replace(/(?:\r?\n){1,2}\s*$/, '');
  cutStart = trimmedBefore.length;

  // 向后扩张：吃掉 block 后的 1 段空行
  let cutEnd = blockEndAbs;
  const afterBlock = existing.slice(blockEndAbs);
  const m = afterBlock.match(/^(?:\r?\n){1,2}/);
  if (m) cutEnd = blockEndAbs + m[0].length;

  const next = existing.slice(0, cutStart) + existing.slice(cutEnd);

  if (next.replace(/\s/g, '').length === 0) {
    // 只剩空白 → 删除文件
    await fs.unlink(filePath);
    return true;
  }

  // 保证文件以一个 eol 结尾（如果 trim 完没结尾）
  const final = next.endsWith(eol) ? next : `${next}${eol}`;
  await atomicWrite(filePath, final);
  return true;
}

function detectOutsideMention(
  before: string,
  after: string,
  logger: Logger | undefined,
  filePath: string,
): boolean {
  const has = TAPD_MENTION_RE.test(before) || TAPD_MENTION_RE.test(after);
  if (has) {
    logger?.warn(
      { msg: 'agents_md_outside_tapd_mention', path: filePath },
      'AGENTS.md / CLAUDE.md 块外检测到 TAPD 相关文本，建议手动清理重复',
    );
  }
  return has;
}

async function atomicWrite(filePath: string, body: string): Promise<void> {
  await fs.mkdir(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, body, 'utf8');
  await fs.rename(tmp, filePath);
}
