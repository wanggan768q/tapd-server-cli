/**
 * Regression tests for v0.3.3 — `parseCli` 无参/无子命令时必须落到 `mode: 'server'`，
 * 而不是被 commander 当成 "no command matched" 输出 help 然后通过 `exitOverride`
 * 抛 `commander.helpDisplayed` 提前结束进程。
 *
 * 历史背景：
 *   v0.2.0 重构成多子命令 CLI 后，root command 没注册 default action。
 *   commander@12 在 `exitOverride()` + 多子命令但无 default action 的组合下，
 *   `parse([])` 会调用 `outputHelp()` 然后抛 helpDisplayed。
 *   后果：作为 MCP stdio server 跑（裸跑无参）时进程秒退，MCP 客户端
 *   报 `Failed to reconnect to <server>: -32000`，0.2.0 ~ 0.3.2 全部受影响。
 *
 * 修复：给 root 加 `.action(() => {})` default action（src/cli.ts），
 *   commander 匹配空 argv 时调到这个 noop，不再走 help 路径，
 *   parseCli 末尾顺利落到 `mode: 'server'`。
 */

import { describe, expect, it } from 'vitest';

import { parseCli } from '../../src/cli.js';

describe('parseCli — server mode (regression: v0.3.3 commander default action)', () => {
  it('argv=[]（裸跑作 MCP stdio server）必须返回 mode=server，不抛 helpDisplayed', () => {
    expect(() => parseCli([])).not.toThrow();
    const r = parseCli([]);
    expect(r.mode).toBe('server');
    if (r.mode === 'server') {
      expect(r.args.token).toBeUndefined();
      expect(r.args.apiBase).toBeUndefined();
      expect(r.args.httpPort).toBeUndefined();
    }
  });

  it('--token 单独传入：mode=server 且 token 透传到 args', () => {
    const r = parseCli(['--token', 'pat-xyz']);
    expect(r.mode).toBe('server');
    if (r.mode === 'server') {
      expect(r.args.token).toBe('pat-xyz');
    }
  });

  it('--api-base 单独传入：mode=server 且 apiBase 透传到 args', () => {
    const r = parseCli(['--api-base', 'https://example.test']);
    expect(r.mode).toBe('server');
    if (r.mode === 'server') {
      expect(r.args.apiBase).toBe('https://example.test');
    }
  });

  it('--http-port 单独传入：mode=server 且 httpPort 解析为数字', () => {
    const r = parseCli(['--http-port', '8081']);
    expect(r.mode).toBe('server');
    if (r.mode === 'server') {
      expect(r.args.httpPort).toBe(8081);
    }
  });

  it('多个 root option 同时传入：全部落入 server 模式 args', () => {
    const r = parseCli([
      '--token',
      't1',
      '--api-base',
      'https://b.test',
      '--http-port',
      '9000',
    ]);
    expect(r.mode).toBe('server');
    if (r.mode === 'server') {
      expect(r.args.token).toBe('t1');
      expect(r.args.apiBase).toBe('https://b.test');
      expect(r.args.httpPort).toBe(9000);
    }
  });

  it('install 子命令仍正常路由（不被 default action 吃掉）', () => {
    const r = parseCli(['install', 'claude-code']);
    expect(r.mode).toBe('install');
  });

  it('login 子命令仍正常路由（不被 default action 吃掉）', () => {
    const r = parseCli(['login']);
    expect(r.mode).toBe('login');
  });
});
