/**
 * Skill 内容契约测试。
 *
 * 不验证 skill 是否"语义合理"——只验证文件结构 / 必含字段 / hard rules
 * 等可机器检查的契约。这些断言对应 spec mcp-skills.Requirement
 * 中各类"正文 MUST 包含 X"的条款。
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..', '..', 'src', 'skills');

function readSkill(name: string): string {
  return readFileSync(join(ROOT, `${name}.md.tmpl`), 'utf8');
}

function frontmatterOf(text: string): string {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  return m ? m[1]! : '';
}

const SHARED = ['tapd-overview', 'tapd-fields-reference', 'tapd-troubleshoot', 'tapd-safety-rules'];
const USER_SKILLS = [
  'tapd-my-work',
  'tapd-implement-story',
  'tapd-handle-bug',
  'tapd-log-time',
  'tapd-comment-and-mention',
  'tapd-from-git-commit',
];
const ALL_SKILLS = [...SHARED, ...USER_SKILLS];

describe('skill files exist (10 total)', () => {
  it('all 10 templates are on disk', () => {
    for (const s of ALL_SKILLS) {
      expect(existsSync(join(ROOT, `${s}.md.tmpl`)), s).toBe(true);
    }
  });

  it('no admin skills in this MVP', () => {
    const all = readdirSync(ROOT).filter((f) => f.endsWith('.md.tmpl'));
    expect(all.length).toBe(10);
    for (const adminSkill of [
      'tapd-iteration-planning',
      'tapd-iteration-review',
      'tapd-bug-dashboard',
      'tapd-create-task',
      'tapd-batch-assign',
      'tapd-release-management',
    ]) {
      expect(all).not.toContain(`${adminSkill}.md.tmpl`);
    }
  });

  it('no legacy plugin skills', () => {
    const all = readdirSync(ROOT).filter((f) => f.endsWith('.md.tmpl'));
    for (const legacy of [
      'tapd-server-cli-login',
      'tapd-server-cli-logout',
      'tapd-server-cli-update',
    ]) {
      expect(all).not.toContain(`${legacy}.md.tmpl`);
    }
  });
});

describe('frontmatter contract', () => {
  it.each(ALL_SKILLS)('%s has name + description in frontmatter', (s) => {
    const fm = frontmatterOf(readSkill(s));
    expect(fm).toMatch(new RegExp(`name:\\s*${s}`));
    expect(fm).toMatch(/description:\s*\|/);
  });

  it.each(ALL_SKILLS)('%s description is bilingual (EN + 中文)', (s) => {
    const fm = frontmatterOf(readSkill(s));
    expect(fm, `${s} missing English triggers`).toMatch(/English triggers:/);
    expect(fm, `${s} missing 中文触发`).toMatch(/中文触发：/);
  });
});

describe('tapd-safety-rules — hard rules', () => {
  const text = readSkill('tapd-safety-rules');

  it('contains HARD-RULE-1..5 markers', () => {
    for (const i of [1, 2, 3, 4, 5]) {
      expect(text).toContain(`HARD-RULE-${i}`);
    }
  });

  it('declares hard rules as non-overridable', () => {
    expect(text).toMatch(/non-negotiable|不可被项目|不可绕过|不可配置/);
  });

  it('HARD-RULE-1 forbids deletion', () => {
    expect(text).toMatch(/MUST NOT[\s\S]{0,200}delete/i);
    expect(text).toMatch(/tapd_\*_delete/);
  });

  it('HARD-RULE-2 forbids closing bugs', () => {
    expect(text).toMatch(/HARD-RULE-2/);
    expect(text).toMatch(/closed/);
    expect(text).toMatch(/resolved/);
    // 必须包含"禁止/不会/不要"之类否定语
    expect(text).toMatch(/MUST NOT|never|不会|���止|不可/i);
  });

  it('HARD-RULE-3 forbids non-admin task creation', () => {
    expect(text).toContain('tapd_tasks_create');
  });

  it('HARD-RULE-4 names comments as the only exception', () => {
    expect(text).toMatch(/comments?/i);
    expect(text).toMatch(/exception|exempt|免/i);
  });

  it('HARD-RULE-5 sets the bulk cap to 10', () => {
    expect(text).toMatch(/\b10\b/);
    expect(text).toMatch(/bulk|batch|批量/i);
  });
});

describe('tapd-fields-reference — only 5 core resources', () => {
  const text = readSkill('tapd-fields-reference');

  it('lists Story / Bug / Task / Timesheet / Comment headings', () => {
    expect(text).toMatch(/##\s+Story/);
    expect(text).toMatch(/##\s+Bug/);
    expect(text).toMatch(/##\s+Task/);
    expect(text).toMatch(/##\s+Timesheet/);
    expect(text).toMatch(/##\s+Comment/);
  });

  it('warns that closed is forbidden for non-admin', () => {
    expect(text).toMatch(/MUST NOT[\s\S]{0,200}closed/i);
  });

  it('mentions @-mention syntax [~user_name]', () => {
    expect(text).toContain('[~user_name]');
  });
});

describe('tapd-overview — entry-point essentials', () => {
  const text = readSkill('tapd-overview');

  it('explains $ME and points to cache.json', () => {
    expect(text).toContain('cache.json');
    expect(text).toMatch(/\$ME/);
  });

  it('routes to drill-down skills', () => {
    for (const s of USER_SKILLS) {
      expect(text, `overview should reference ${s}`).toContain(s);
    }
  });

  it('explains workspace selection rules', () => {
    expect(text).toMatch(/workspace/i);
    expect(text).toMatch(/multiple|多/i);
  });
});

describe('tapd-troubleshoot — auth handling', () => {
  const text = readSkill('tapd-troubleshoot');

  it('forbids retrying 401/403', () => {
    expect(text).toMatch(/DO NOT retry|不要重试|不要 retry|do not retry/i);
  });

  it('mentions npx tapd-server-cli login as cookie recovery', () => {
    expect(text).toContain('npx tapd-server-cli login');
  });
});

describe('tapd-my-work — default filters', () => {
  const text = readSkill('tapd-my-work');

  it('default owner = $ME', () => {
    expect(text).toMatch(/current_owner[\s\S]{0,40}\$ME|owner[\s\S]{0,40}\$ME/);
  });

  it('excludes completed states by default', () => {
    expect(text).toMatch(/resolved/);
    expect(text).toMatch(/closed/);
    expect(text).toMatch(/exclude|排除|不包含/i);
  });

  it('sorts in-progress first', () => {
    expect(text).toMatch(/in[-_ ]?progress/i);
    expect(text).toMatch(/first|前|top/i);
  });
});

describe('tapd-implement-story — read-only assessment', () => {
  const text = readSkill('tapd-implement-story');

  it('has multi-phase workflow', () => {
    expect(text).toMatch(/Phase 1/);
    expect(text).toMatch(/Phase 2/);
  });

  it('explicitly says no code edits', () => {
    expect(text).toMatch(/never.*code|不写代码|business[- ]level|业务/i);
  });

  it('lists 6 sufficiency dimensions', () => {
    // 不严格按字面 6 行；只要"六个维度"或表格里至少 6 行
    expect(text).toMatch(/business background|业务背景/i);
    expect(text).toMatch(/acceptance|验收/i);
    expect(text).toMatch(/edge case|边界|异常/i);
  });
});

describe('tapd-handle-bug — UE4 + evidence', () => {
  const text = readSkill('tapd-handle-bug');

  it('lists per-bug folder layout', () => {
    expect(text).toContain('./.tapd-bugs/');
    expect(text).toContain('stack/');
    expect(text).toContain('logs/');
  });

  it('describes attachment classification rules', () => {
    expect(text).toMatch(/\.log/);
    expect(text).toMatch(/\.dmp/);
    expect(text).toMatch(/\.zip/);
  });

  it('UNC path detection asks before pulling', () => {
    expect(text).toMatch(/UNC|\\\\10\.|\/\/10\./);
    expect(text).toMatch(/ask|询问|是否拉取/i);
  });

  it('preserves UE4Minidump but does NOT auto-cdb', () => {
    expect(text).toContain('UE4Minidump.dmp');
    expect(text).toMatch(/never auto|don.{0,3}t.{0,3}auto|never run cdb|不会自动跑/i);
    expect(text).toContain('UE4Minidump.parsed.txt');
  });

  it('extracts CrashGUID as fingerprint', () => {
    expect(text).toContain('CrashGUID');
  });

  it('only main log, not backup logs', () => {
    expect(text).toMatch(/backup/i);
    expect(text).toMatch(/skip|默认.*跳过|don.{0,3}t/i);
  });

  it('repair direction is logical, not code', () => {
    expect(text).toMatch(/never.*code|不会写代码|business|逻辑/i);
  });
});

describe('tapd-log-time — single-point write', () => {
  const text = readSkill('tapd-log-time');

  it('default owner = $ME, default date = today', () => {
    expect(text).toMatch(/\$ME/);
    expect(text).toMatch(/today|今天/i);
  });

  it('refuses bulk backfill', () => {
    expect(text).toMatch(/no batch|不做批量|批量补|backfill/i);
  });

  it('preview gate via HARD-RULE-4', () => {
    expect(text).toMatch(/HARD-RULE-4|preview|确认/i);
  });
});

describe('tapd-comment-and-mention — single comment + @', () => {
  const text = readSkill('tapd-comment-and-mention');

  it('translates @ to [~user_name] syntax', () => {
    expect(text).toContain('[~user_name]');
    expect(text).toContain('@张三');
  });

  it('uses knownUsers cache for lookup', () => {
    expect(text).toContain('knownUsers');
  });

  it('explicitly notes comments are HARD-RULE-4 exception', () => {
    expect(text).toMatch(/exception|HARD-RULE-4|免/i);
  });
});

describe('tapd-from-git-commit — only --story=/--bug=', () => {
  const text = readSkill('tapd-from-git-commit');

  it('parses --story= and --bug= only', () => {
    expect(text).toContain('--story=');
    expect(text).toContain('--bug=');
  });

  it('explicitly excludes #1234 / TAPD-1234', () => {
    expect(text).toMatch(/#1234[\s\S]{0,200}NOT|#1234[\s\S]{0,200}not|#1234[\s\S]{0,200}ignored/i);
    expect(text).toMatch(/TAPD-/);
  });

  it('shows preview with [a]/[s]/[n] choices', () => {
    expect(text).toMatch(/\[a\]/);
    expect(text).toMatch(/\[s\]/);
    expect(text).toMatch(/\[n\]/);
  });

  it('comment template uses [from commit] prefix', () => {
    expect(text).toContain('[from commit');
  });
});
