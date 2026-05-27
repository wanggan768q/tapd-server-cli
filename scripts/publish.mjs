#!/usr/bin/env node
/**
 * tapd-server-cli 本地交互式发版脚本。
 *
 * 用法：
 *   node scripts/publish.mjs           # 正常发版
 *   node scripts/publish.mjs --dry-run # 跑全部检查 + npm publish --dry-run，不真正上传
 *
 * 流程：
 *   1) 校验本地 git 干净、当前在 main 分支、与 origin/main 一致
 *   2) 读 package.json version，校验 tag 与版本号一致（若 tag 已存在）
 *   3) npm ci → typecheck → test → build
 *   4) 提示输入 npm OTP（6 位数字，从你的 Authenticator app 取）
 *   5) npm publish --access public --provenance --otp=<...>
 *   6) push tag 到 origin（让 GitHub Release 也建出来 —— 由 CI 触发或本地兜底）
 *
 * 安全：
 *   - OTP 通过 stdin muted 输入，不进 shell history、不出现在 ps / 进程列表里
 *   - 整个流程不会读、写任何持久化文件外的凭据
 *   - 不通过环境变量传 OTP（避免误粘）
 */

import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const DRY_RUN = process.argv.includes('--dry-run');

// -------- 输出工具（简单 ANSI 颜色，Windows 终端兼容）--------
const isTTY = process.stdout.isTTY === true;
const c = (code, s) => (isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);
const ok = (s) => console.log(c('32', `✔ ${s}`));
const info = (s) => console.log(c('36', `ℹ ${s}`));
const warn = (s) => console.log(c('33', `! ${s}`));
const fail = (s) => console.error(c('31', `✗ ${s}`));
const step = (s) => console.log(c('1', `\n──── ${s} ────`));

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: REPO_ROOT,
    stdio: opts.captureOutput ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    env: { ...process.env, ...(opts.env || {}) },
    shell: false,
  });
  if (r.status !== 0) {
    const stderr = r.stderr ? r.stderr.toString('utf8') : '';
    const stdout = r.stdout ? r.stdout.toString('utf8') : '';
    throw new Error(
      `命令失败 (exit ${r.status}): ${cmd} ${args.join(' ')}` +
        (stdout ? `\n--- stdout ---\n${stdout}` : '') +
        (stderr ? `\n--- stderr ---\n${stderr}` : ''),
    );
  }
  return r.stdout ? r.stdout.toString('utf8').trim() : '';
}

function tryRun(cmd, args) {
  return run(cmd, args, { captureOutput: true });
}

// -------- 交互式输入（muted OTP）--------
async function promptOtp() {
  if (!process.stdin.isTTY) {
    throw new Error(
      'OTP 需要交互式 tty 输入。请直接在你的终端里跑 `node scripts/publish.mjs`，不要 pipe / 重定向 stdin。',
    );
  }
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });
  const rlInternal = rl;
  const origWrite = rlInternal._writeToOutput?.bind(rl);
  let muted = false;
  if (origWrite) {
    rlInternal._writeToOutput = (chunk) => {
      if (!muted) origWrite(chunk);
    };
  }
  try {
    process.stdout.write('请输入 npm OTP（6 位数字，从你的 Authenticator app 取）: ');
    muted = true;
    const answer = await new Promise((r) => rl.question('', r));
    muted = false;
    process.stdout.write('\n');
    const trimmed = answer.trim();
    if (!/^\d{6}$/.test(trimmed)) {
      throw new Error(`OTP 格式不对：期望 6 位数字，收到 ${JSON.stringify(trimmed)}`);
    }
    return trimmed;
  } finally {
    rl.close();
  }
}

async function confirm(question) {
  if (!process.stdin.isTTY) return true; // 非交互默认通过
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await new Promise((r) => {
      rl.question(`${question} [y/N] `, (ans) => r(/^y(es)?$/i.test(ans.trim())));
    });
  } finally {
    rl.close();
  }
}

// -------- 阶段 --------
function readVersion() {
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
  return { name: pkg.name, version: pkg.version };
}

function checkGitClean() {
  step('1/6 检查 git 状态');
  const status = tryRun('git', ['status', '--porcelain']);
  if (status.length > 0) {
    fail('工作树不干净：');
    console.log(status);
    throw new Error('请先 commit / stash 所有改动再发版');
  }
  const branch = tryRun('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch !== 'main') {
    warn(`当前分支不是 main（实际：${branch}）`);
  }
  ok(`git 工作树干净（分支：${branch}）`);
}

function checkRemoteSync() {
  step('2/6 检查与 origin 同步');
  try {
    tryRun('git', ['fetch', '--quiet', 'origin']);
  } catch (e) {
    warn(`git fetch 失败，跳过远程同步检查：${e.message.split('\n')[0]}`);
    return;
  }
  const local = tryRun('git', ['rev-parse', 'HEAD']);
  let remote;
  try {
    remote = tryRun('git', ['rev-parse', 'origin/main']);
  } catch {
    warn('没有 origin/main 引用，跳过同步检查');
    return;
  }
  if (local !== remote) {
    throw new Error(
      `本地 HEAD (${local.slice(0, 7)}) 与 origin/main (${remote.slice(0, 7)}) 不一致。\n` +
        `请先 git push origin main 或 git pull --rebase 后再发版。`,
    );
  }
  ok(`HEAD ${local.slice(0, 7)} 与 origin/main 一致`);
}

function checkTag(version) {
  step('3/6 检查 tag 状态');
  const tagName = `v${version}`;
  let localExists = false;
  let remoteSha;
  try {
    tryRun('git', ['rev-parse', '--verify', `refs/tags/${tagName}`]);
    localExists = true;
  } catch {
    /* 不存在 */
  }
  try {
    const lsRemote = tryRun('git', ['ls-remote', '--tags', 'origin', tagName]);
    if (lsRemote) remoteSha = lsRemote.split(/\s+/)[0];
  } catch (e) {
    warn(`无法查询远程 tag：${e.message.split('\n')[0]}`);
  }
  if (localExists && remoteSha) {
    info(`tag ${tagName} 已存在（本地+远程）。如果之前的 npm publish 失败，可以继续。`);
  } else if (localExists && !remoteSha) {
    info(`tag ${tagName} 仅本地存在，发版后会 push 到 origin`);
  } else if (!localExists && remoteSha) {
    warn(`tag ${tagName} 仅远程存在 —— 这通常意味着本地与远程 tag 漂移`);
  } else {
    info(`tag ${tagName} 尚未创建，发版成功后会自动创建并 push`);
  }
  return { tagName, localExists, remoteExists: !!remoteSha };
}

function runPipeline() {
  step('4/6 构建与测试');
  info('npm ci');
  run('npm', ['ci']);
  info('npm run typecheck');
  run('npm', ['run', 'typecheck']);
  info('npm test');
  run('npm', ['test']);
  info('npm run build');
  run('npm', ['run', 'build']);
  ok('全部检查通过');
}

async function doPublish(version) {
  step('5/6 npm publish');
  let otp;
  if (DRY_RUN) {
    info('dry-run 模式：跳过 OTP 提示');
  } else {
    otp = await promptOtp();
  }
  const args = ['publish', '--access', 'public', '--provenance'];
  if (DRY_RUN) args.push('--dry-run');
  if (otp) args.push(`--otp=${otp}`);
  // 关键：用 spawn 不打印 args（OTP 不能出现在 stdout 日志里）
  const safeArgsForLog = args.map((a) => (a.startsWith('--otp=') ? '--otp=******' : a));
  info(`npm ${safeArgsForLog.join(' ')}`);
  const r = spawnSync('npm', args, {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    shell: false,
  });
  if (r.status !== 0) {
    throw new Error(`npm publish 失败（exit ${r.status}）`);
  }
  if (DRY_RUN) {
    ok('dry-run 完成（未真正上传到 npm registry）');
  } else {
    ok(`已 publish tapd-server-cli@${version} 到 npm`);
  }
}

function ensureTagAndPush(tagName, localExists, remoteExists) {
  step('6/6 创建 + 推送 git tag');
  if (DRY_RUN) {
    info('dry-run 模式：跳过 tag 创建/推送');
    return;
  }
  if (!localExists) {
    info(`git tag -a ${tagName}`);
    run('git', ['tag', '-a', tagName, '-m', `${tagName} — release`]);
  }
  if (!remoteExists) {
    info(`git push origin ${tagName}`);
    run('git', ['push', 'origin', tagName]);
  } else {
    info(`tag ${tagName} 已在远程，跳过 push`);
  }
  ok('tag 已就位');
}

function postPublishHints(name, version) {
  console.log();
  console.log(c('1', '完成！'));
  console.log();
  console.log(`  npm view ${name} version    # 应输出 ${version}`);
  console.log(`  npm view ${name}            # 完整 metadata`);
  console.log();
  console.log('GitHub Release 在 CI 端会通过 release.yml 自动创建（如果 tag 触发了）。');
  console.log('如果 CI 不通，可以手动：');
  console.log(`  gh release create v${version} --generate-notes`);
  console.log();
}

// -------- main --------
async function main() {
  const { name, version } = readVersion();
  console.log(c('1', `📦 ${name}@${version}${DRY_RUN ? ' (dry-run)' : ''}`));
  console.log();

  checkGitClean();
  checkRemoteSync();
  const { tagName, localExists, remoteExists } = checkTag(version);
  runPipeline();

  if (!DRY_RUN) {
    const proceed = await confirm(
      `准备 npm publish ${name}@${version}。继续？`,
    );
    if (!proceed) {
      info('用户取消，已退出');
      process.exit(0);
    }
  }

  await doPublish(version);
  ensureTagAndPush(tagName, localExists, remoteExists);
  postPublishHints(name, version);
}

main().catch((err) => {
  fail(err.message || String(err));
  process.exit(1);
});
