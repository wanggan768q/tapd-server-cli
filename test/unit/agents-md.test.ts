import { mkdtempSync, promises as fs, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BEGIN_MARK,
  END_MARK,
  hasManagedBlock,
  injectManagedBlock,
  removeManagedBlock,
} from '../../src/installer/agents-md.js';
import {
  removeCursorMdc,
  renderCursorMdc,
  writeCursorMdc,
} from '../../src/installer/cursor-mdc.js';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'tapd-agents-md-'));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('agents-md.injectManagedBlock', () => {
  it('creates a fresh file when target missing', async () => {
    const path = join(tmpRoot, 'new', 'AGENTS.md');
    const r = await injectManagedBlock(path, 'hello');
    expect(r.outcome).toBe('created');
    expect(r.hadOutsideMention).toBe(false);
    const got = await fs.readFile(path, 'utf8');
    expect(got).toContain(BEGIN_MARK);
    expect(got).toContain('hello');
    expect(got).toContain(END_MARK);
  });

  it('appends block when file exists without one', async () => {
    const path = join(tmpRoot, 'AGENTS.md');
    await fs.writeFile(path, '# My Project\n\nSome content.\n', 'utf8');
    const r = await injectManagedBlock(path, 'block content');
    expect(r.outcome).toBe('inserted');
    const got = await fs.readFile(path, 'utf8');
    // 块外内容保留
    expect(got).toContain('# My Project');
    expect(got).toContain('Some content.');
    // 块在末尾，前面有空行隔开
    expect(got).toMatch(/Some content\.\n\n<!-- BEGIN/);
  });

  it('replaces in-block content when block already present', async () => {
    const path = join(tmpRoot, 'AGENTS.md');
    const initial = `pre-content\n\n${BEGIN_MARK}\nold body\n${END_MARK}\n\npost-content\n`;
    await fs.writeFile(path, initial, 'utf8');

    const r = await injectManagedBlock(path, 'new body');
    expect(r.outcome).toBe('replaced');
    const got = await fs.readFile(path, 'utf8');
    expect(got).toContain('pre-content');
    expect(got).toContain('post-content');
    expect(got).toContain('new body');
    expect(got).not.toContain('old body');
  });

  it('idempotent: same body twice keeps file unchanged', async () => {
    const path = join(tmpRoot, 'AGENTS.md');
    await injectManagedBlock(path, 'stable body');
    const after1 = await fs.readFile(path, 'utf8');
    const r2 = await injectManagedBlock(path, 'stable body');
    expect(r2.outcome).toBe('unchanged');
    const after2 = await fs.readFile(path, 'utf8');
    expect(after2).toBe(after1);
  });

  it('preserves CRLF line endings when input file uses CRLF', async () => {
    const path = join(tmpRoot, 'AGENTS.md');
    await fs.writeFile(path, '# Title\r\n\r\nLine.\r\n', 'utf8');
    await injectManagedBlock(path, 'crlf body');
    const got = await fs.readFile(path, 'utf8');
    expect(got).toMatch(/\r\n/);
    // 块体内部行尾也是 CRLF
    expect(got).toContain(`${BEGIN_MARK}\r\ncrlf body\r\n${END_MARK}`);
  });

  it('preserves BOM at file head', async () => {
    const path = join(tmpRoot, 'AGENTS.md');
    await fs.writeFile(path, '﻿# Title\n', 'utf8');
    await injectManagedBlock(path, 'bom body');
    const got = await fs.readFile(path, 'utf8');
    expect(got.startsWith('﻿')).toBe(true);
  });

  it('warns once when TAPD mentioned outside block', async () => {
    const path = join(tmpRoot, 'AGENTS.md');
    await fs.writeFile(path, '## Tapd hand-rolled section\n\nWe use TAPD heavily.\n', 'utf8');

    const warn = vi.fn();
    const fakeLogger = { warn } as unknown as pino.Logger;
    const r = await injectManagedBlock(path, 'managed body', { logger: fakeLogger });
    expect(r.hadOutsideMention).toBe(true);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toMatchObject({
      msg: 'agents_md_outside_tapd_mention',
    });
  });

  it('does not warn when only the managed block contains tapd', async () => {
    const path = join(tmpRoot, 'AGENTS.md');
    await fs.writeFile(path, '# Pure repo\n\nNo such mention here.\n', 'utf8');
    const warn = vi.fn();
    const fakeLogger = { warn } as unknown as pino.Logger;
    await injectManagedBlock(path, 'tapd-related body', { logger: fakeLogger });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('agents-md.hasManagedBlock', () => {
  it('returns false when file missing', async () => {
    expect(await hasManagedBlock(join(tmpRoot, 'absent.md'))).toBe(false);
  });

  it('returns false when block absent', async () => {
    const path = join(tmpRoot, 'AGENTS.md');
    await fs.writeFile(path, 'plain content', 'utf8');
    expect(await hasManagedBlock(path)).toBe(false);
  });

  it('returns true when block present', async () => {
    const path = join(tmpRoot, 'AGENTS.md');
    await injectManagedBlock(path, 'x');
    expect(await hasManagedBlock(path)).toBe(true);
  });
});

describe('agents-md.removeManagedBlock', () => {
  it('returns false when file missing', async () => {
    expect(await removeManagedBlock(join(tmpRoot, 'absent.md'))).toBe(false);
  });

  it('returns false when block absent (noop)', async () => {
    const path = join(tmpRoot, 'AGENTS.md');
    await fs.writeFile(path, 'plain\n', 'utf8');
    expect(await removeManagedBlock(path)).toBe(false);
    expect(await fs.readFile(path, 'utf8')).toBe('plain\n');
  });

  it('removes block and surrounding blank lines, keeps surrounding content', async () => {
    const path = join(tmpRoot, 'AGENTS.md');
    await fs.writeFile(
      path,
      `# Title\n\nbefore content\n\n${BEGIN_MARK}\nbody\n${END_MARK}\n\nafter content\n`,
      'utf8',
    );
    const removed = await removeManagedBlock(path);
    expect(removed).toBe(true);
    const got = await fs.readFile(path, 'utf8');
    expect(got).toContain('before content');
    expect(got).toContain('after content');
    expect(got).not.toContain(BEGIN_MARK);
    expect(got).not.toContain('body');
  });

  it('deletes file if only block was inside', async () => {
    const path = join(tmpRoot, 'AGENTS.md');
    await injectManagedBlock(path, 'lonely');
    await removeManagedBlock(path);
    await expect(fs.access(path)).rejects.toThrow();
  });
});

describe('cursor-mdc', () => {
  it('renderCursorMdc emits frontmatter + body', () => {
    const out = renderCursorMdc({
      description: 'English triggers: x\n中文触发：y',
      body: '# Hello\n\nWorld',
    });
    expect(out.startsWith('---\n')).toBe(true);
    expect(out).toContain('description: |');
    expect(out).toContain('  English triggers: x');
    expect(out).toContain('  中文触发：y');
    expect(out).toContain('alwaysApply: false');
    expect(out).toContain('# Hello');
  });

  it('writeCursorMdc creates parent dir', async () => {
    const path = join(tmpRoot, '.cursor', 'rules', 'tapd.mdc');
    await writeCursorMdc(path, { description: 'd', body: 'b' });
    const got = await fs.readFile(path, 'utf8');
    expect(got).toContain('alwaysApply: false');
  });

  it('writeCursorMdc overwrites existing', async () => {
    const path = join(tmpRoot, 'tapd.mdc');
    await writeCursorMdc(path, { description: 'first', body: 'first body' });
    await writeCursorMdc(path, { description: 'second', body: 'second body' });
    const got = await fs.readFile(path, 'utf8');
    expect(got).toContain('second body');
    expect(got).not.toContain('first body');
  });

  it('removeCursorMdc returns true when deleted, false when missing', async () => {
    const path = join(tmpRoot, 'tapd.mdc');
    expect(await removeCursorMdc(path)).toBe(false);
    await writeCursorMdc(path, { description: 'd', body: 'b' });
    expect(await removeCursorMdc(path)).toBe(true);
    expect(await removeCursorMdc(path)).toBe(false);
  });
});
