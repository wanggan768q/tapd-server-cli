import { describe, expect, it } from 'vitest';

import { parseCli } from '../../src/cli.js';

function parseUpdate(argv: string[]) {
  const r = parseCli(argv);
  if (r.mode !== 'update') throw new Error(`expected update mode, got ${r.mode}`);
  return r;
}

describe('parseCli — update subcommand', () => {
  it('parses bare update with json=false', () => {
    const r = parseUpdate(['update']);
    expect(r.json).toBe(false);
  });

  it('parses --json flag', () => {
    const r = parseUpdate(['update', '--json']);
    expect(r.json).toBe(true);
  });

  it('rejects extra args', () => {
    expect(() => parseCli(['update', 'foo'])).toThrow();
  });
});

// 注：server-mode 回归测试不放在这里——commander 在仅传顶层 option（如 `--token x`）
// 而无任何子命令时会 outputHelp（exitOverride 抛 CommanderError），这是
// `src/index.ts` 顶层 catch 已处理的路径（commander.helpDisplayed → exit 0）。
// 真正的 server-mode 路径由集成测试与 src/index.ts main() 覆盖。
