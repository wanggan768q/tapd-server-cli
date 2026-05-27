import { describe, expect, it } from 'vitest';

import { parseCli, UnknownClientError } from '../../src/cli.js';

function parseInstall(argv: string[]) {
  const r = parseCli(argv);
  if (r.mode !== 'install') throw new Error(`expected install mode, got ${r.mode}`);
  return r;
}

describe('parseCli — install variadic clients', () => {
  it('parses zero clients (interactive entry point)', () => {
    const r = parseInstall(['install']);
    expect(r.clients).toEqual([]);
    expect(r.dryRun).toBe(false);
  });

  it('parses single client (backward compatible)', () => {
    const r = parseInstall(['install', 'claude-code']);
    expect(r.clients).toEqual(['claude-code']);
    expect(r.dryRun).toBe(false);
  });

  it('parses multiple clients in order', () => {
    const r = parseInstall(['install', 'claude-code', 'codex']);
    expect(r.clients).toEqual(['claude-code', 'codex']);
  });

  it('accepts --dry-run trailing the clients', () => {
    const r = parseInstall(['install', 'claude-code', 'codex', '--dry-run']);
    expect(r.clients).toEqual(['claude-code', 'codex']);
    expect(r.dryRun).toBe(true);
  });

  it('accepts --dry-run leading before the clients', () => {
    const r = parseInstall(['install', '--dry-run', 'claude-code', 'codex']);
    expect(r.clients).toEqual(['claude-code', 'codex']);
    expect(r.dryRun).toBe(true);
  });

  it('rejects unknown client tokens', () => {
    expect(() => parseInstall(['install', 'foo'])).toThrow(UnknownClientError);
    expect(() => parseInstall(['install', 'foo'])).toThrow(/未识别的客户端 "foo"/);
  });

  it('rejects unknown client among valid ones', () => {
    expect(() => parseInstall(['install', 'claude-code', 'bogus'])).toThrow(
      UnknownClientError,
    );
    expect(() => parseInstall(['install', 'claude-code', 'bogus'])).toThrow(
      /未识别的客户端 "bogus"/,
    );
  });

  it('zero-arg install + --dry-run still parses to interactive entry', () => {
    const r = parseInstall(['install', '--dry-run']);
    expect(r.clients).toEqual([]);
    expect(r.dryRun).toBe(true);
  });
});
