import { describe, expect, it } from 'vitest';

import { parseCli, UnknownClientError } from '../../src/cli.js';

function parseUninstall(argv: string[]) {
  const r = parseCli(argv);
  if (r.mode !== 'uninstall') throw new Error(`expected uninstall mode, got ${r.mode}`);
  return r;
}

describe('parseCli — uninstall variadic clients', () => {
  it('parses zero clients (interactive entry point)', () => {
    const r = parseUninstall(['uninstall']);
    expect(r.clients).toEqual([]);
    expect(r.dryRun).toBe(false);
    expect(r.purge).toBe(false);
  });

  it('parses single client', () => {
    const r = parseUninstall(['uninstall', 'claude-code']);
    expect(r.clients).toEqual(['claude-code']);
    expect(r.dryRun).toBe(false);
    expect(r.purge).toBe(false);
  });

  it('parses multiple clients in order', () => {
    const r = parseUninstall(['uninstall', 'claude-code', 'codex']);
    expect(r.clients).toEqual(['claude-code', 'codex']);
  });

  it('accepts --dry-run trailing the clients', () => {
    const r = parseUninstall(['uninstall', 'claude-code', 'codex', '--dry-run']);
    expect(r.clients).toEqual(['claude-code', 'codex']);
    expect(r.dryRun).toBe(true);
    expect(r.purge).toBe(false);
  });

  it('accepts --dry-run leading before the clients', () => {
    const r = parseUninstall(['uninstall', '--dry-run', 'claude-code', 'codex']);
    expect(r.clients).toEqual(['claude-code', 'codex']);
    expect(r.dryRun).toBe(true);
  });

  it('accepts --purge trailing the clients', () => {
    const r = parseUninstall(['uninstall', 'claude-code', '--purge']);
    expect(r.clients).toEqual(['claude-code']);
    expect(r.purge).toBe(true);
    expect(r.dryRun).toBe(false);
  });

  it('accepts --purge leading before the clients', () => {
    const r = parseUninstall(['uninstall', '--purge', 'claude-code']);
    expect(r.clients).toEqual(['claude-code']);
    expect(r.purge).toBe(true);
  });

  it('accepts --dry-run and --purge together', () => {
    const r = parseUninstall(['uninstall', 'claude-code', '--dry-run', '--purge']);
    expect(r.dryRun).toBe(true);
    expect(r.purge).toBe(true);
  });

  it('zero-arg uninstall + --purge still parses to interactive entry', () => {
    const r = parseUninstall(['uninstall', '--purge']);
    expect(r.clients).toEqual([]);
    expect(r.purge).toBe(true);
  });

  it('rejects unknown client tokens', () => {
    expect(() => parseUninstall(['uninstall', 'foo'])).toThrow(UnknownClientError);
    expect(() => parseUninstall(['uninstall', 'foo'])).toThrow(/未识别的客户端 "foo"/);
  });

  it('rejects unknown client among valid ones', () => {
    expect(() => parseUninstall(['uninstall', 'claude-code', 'bogus'])).toThrow(
      UnknownClientError,
    );
  });
});
