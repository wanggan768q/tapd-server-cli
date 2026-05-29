/**
 * Regression for v0.3.0：runtime/package-version.ts 是 server.ts 与
 * commands/update-handler.ts 共用的版本号来源；防止再次出现 v0.2.x 时代
 * "字面量 PACKAGE_VERSION='0.1.0' 与 package.json 漂移"的旧 bug。
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  readPackageVersion,
  __resetPackageVersionCacheForTest,
} from '../../src/runtime/package-version.js';

describe('readPackageVersion', () => {
  it('matches package.json version verbatim', () => {
    __resetPackageVersionCacheForTest();
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    expect(readPackageVersion()).toBe(pkg.version);
  });

  it('returns a non-empty semver-shaped string (defends against future drift to placeholder)', () => {
    __resetPackageVersionCacheForTest();
    const v = readPackageVersion();
    expect(v).toMatch(/^\d+\.\d+\.\d+/);
    expect(v).not.toBe('0.1.0'); // v0.3.0 起严禁退化回 hardcoded '0.1.0'
  });

  it('caches result (second call same reference)', () => {
    __resetPackageVersionCacheForTest();
    const a = readPackageVersion();
    const b = readPackageVersion();
    expect(a).toBe(b);
  });
});
