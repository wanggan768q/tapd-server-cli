/**
 * Unit tests for user-scope-commands install/remove helpers.
 *
 * v0.3.0：plugin 体系撤回后，把 commands/*.md 拷到 ~/.claude/commands/tapd-server-cli/
 * 的承接路径。这些 helper 由 install-claude-code-user-scope-commands change 引入。
 *
 * 用 mkdtemp 隔离测试 home，避免污染真实 ~/.claude/。
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  installCommands,
  removeCommands,
} from '../../src/installer/user-scope-commands.js';

describe('installCommands', () => {
  let tempHome: string;
  let tempSrc: string;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'tapd-uscmd-home-'));
    tempSrc = mkdtempSync(join(tmpdir(), 'tapd-uscmd-src-'));
  });

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
    rmSync(tempSrc, { recursive: true, force: true });
  });

  it('copies all .md files from src to ~/.claude/commands/tapd-server-cli/', () => {
    writeFileSync(join(tempSrc, 'login.md'), '# login');
    writeFileSync(join(tempSrc, 'logout.md'), '# logout');
    writeFileSync(join(tempSrc, 'update.md'), '# update');

    const r = installCommands(tempHome, tempSrc);

    expect(r.installed.sort()).toEqual(['login.md', 'logout.md', 'update.md']);
    expect(r.failed).toEqual([]);
    expect(r.srcMissing).toBeUndefined();
    expect(r.mkdirError).toBeUndefined();

    const targetDir = join(tempHome, '.claude', 'commands', 'tapd-server-cli');
    expect(existsSync(join(targetDir, 'login.md'))).toBe(true);
    expect(readFileSync(join(targetDir, 'login.md'), 'utf8')).toBe('# login');
    expect(readFileSync(join(targetDir, 'logout.md'), 'utf8')).toBe('# logout');
    expect(readFileSync(join(targetDir, 'update.md'), 'utf8')).toBe('# update');
  });

  it('skips non-.md files', () => {
    writeFileSync(join(tempSrc, 'login.md'), '# login');
    writeFileSync(join(tempSrc, 'README.txt'), 'not md');

    const r = installCommands(tempHome, tempSrc);

    expect(r.installed).toEqual(['login.md']);
    const targetDir = join(tempHome, '.claude', 'commands', 'tapd-server-cli');
    expect(existsSync(join(targetDir, 'README.txt'))).toBe(false);
  });

  it('handles partial source (e.g. update.md missing) without erroring', () => {
    // 模拟 add-cli-subcommands-login-logout-update change 还没合入时的状态
    writeFileSync(join(tempSrc, 'login.md'), '# login');
    writeFileSync(join(tempSrc, 'logout.md'), '# logout');

    const r = installCommands(tempHome, tempSrc);

    expect(r.installed.sort()).toEqual(['login.md', 'logout.md']);
    expect(r.failed).toEqual([]);
  });

  it('returns srcMissing when commands source directory does not exist', () => {
    rmSync(tempSrc, { recursive: true, force: true });

    const r = installCommands(tempHome, tempSrc);

    expect(r.srcMissing).toBe(true);
    expect(r.installed).toEqual([]);
  });

  it('overwrites existing same-named file in target directory', () => {
    const targetDir = join(tempHome, '.claude', 'commands', 'tapd-server-cli');
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, 'login.md'), '# OLD content');

    writeFileSync(join(tempSrc, 'login.md'), '# NEW content');

    const r = installCommands(tempHome, tempSrc);

    expect(r.installed).toEqual(['login.md']);
    expect(readFileSync(join(targetDir, 'login.md'), 'utf8')).toBe('# NEW content');
  });

  it("preserves user's other files in target directory", () => {
    const targetDir = join(tempHome, '.claude', 'commands', 'tapd-server-cli');
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, 'my-custom.md'), '# my custom helper');

    writeFileSync(join(tempSrc, 'login.md'), '# login');
    const r = installCommands(tempHome, tempSrc);

    expect(r.installed).toEqual(['login.md']);
    expect(existsSync(join(targetDir, 'my-custom.md'))).toBe(true);
    expect(readFileSync(join(targetDir, 'my-custom.md'), 'utf8')).toBe('# my custom helper');
  });
});

describe('removeCommands', () => {
  let tempHome: string;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'tapd-uscmd-rm-'));
  });

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
  });

  it('removes the entire ~/.claude/commands/tapd-server-cli/ directory', () => {
    const targetDir = join(tempHome, '.claude', 'commands', 'tapd-server-cli');
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, 'login.md'), '# login');
    writeFileSync(join(targetDir, 'logout.md'), '# logout');

    const r = removeCommands(tempHome);

    expect(r.removed).toBe(true);
    expect(r.notPresent).toBeUndefined();
    expect(r.error).toBeUndefined();
    expect(existsSync(targetDir)).toBe(false);
  });

  it('returns notPresent: true when target directory does not exist', () => {
    const r = removeCommands(tempHome);

    expect(r.removed).toBe(false);
    expect(r.notPresent).toBe(true);
    expect(r.error).toBeUndefined();
  });

  it("removes user's custom files alongside tool-installed files (namespace is private)", () => {
    const targetDir = join(tempHome, '.claude', 'commands', 'tapd-server-cli');
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, 'login.md'), '# login');
    writeFileSync(join(targetDir, 'my-custom.md'), '# user-added');

    const r = removeCommands(tempHome);

    expect(r.removed).toBe(true);
    expect(existsSync(targetDir)).toBe(false);
  });

  it('does not touch sibling namespaces under ~/.claude/commands/', () => {
    const ourDir = join(tempHome, '.claude', 'commands', 'tapd-server-cli');
    const otherDir = join(tempHome, '.claude', 'commands', 'other-tool');
    mkdirSync(ourDir, { recursive: true });
    mkdirSync(otherDir, { recursive: true });
    writeFileSync(join(ourDir, 'login.md'), '# us');
    writeFileSync(join(otherDir, 'foo.md'), '# them');

    const r = removeCommands(tempHome);

    expect(r.removed).toBe(true);
    expect(existsSync(ourDir)).toBe(false);
    expect(existsSync(otherDir)).toBe(true);
    expect(readFileSync(join(otherDir, 'foo.md'), 'utf8')).toBe('# them');
  });
});
