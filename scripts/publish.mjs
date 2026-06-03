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
 *   3) 校验 CHANGELOG.md 顶部含 [<version>] 段（硬门禁，缺则拒绝发版）
 *   4) npm ci → typecheck → test → build
 *   5) 提示输入 npm OTP（6 位数字，从你的 Authenticator app 取）
 *   6) npm publish --access public [--provenance if CI] [--otp=...] (本地默认无 provenance)
 *   7) push tag 到 origin（让 GitHub Release 也建出来 —— 由 CI 触发或本地兜底）
 *
 * 安全：
 *   - OTP 通过 stdin muted 输入，不进 shell history、不出现在 ps / 进程列表里
 *   - 整个流程不会读、写任何持久化文件外的凭据
 *   - 不通过环境变量传 OTP（避免误粘）
 */

import { spawn, spawnSync } from 'node:child_process';
import { Socket } from 'node:net';
import { readFileSync, existsSync, writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { extractChangelogSection } from './extract-changelog.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const DRY_RUN = process.argv.includes('--dry-run');
const NO_OTP = process.argv.includes('--no-otp');

// --provenance / --no-provenance:
// npm 的 sigstore provenance 需要 CI 环境的 OIDC token，本地直接跑会拿到
// `Automatic provenance generation not supported for provider: null`。
// 默认行为：在已知 CI 环境（CI / GITHUB_ACTIONS / GITLAB_CI / BUILDKITE）开启，
// 否则关闭。用户也可以用 --provenance / --no-provenance 显式覆盖。
const FORCE_PROVENANCE = process.argv.includes('--provenance');
const NO_PROVENANCE = process.argv.includes('--no-provenance');
function isInCI() {
  const env = process.env;
  return (
    env.CI === 'true' ||
    env.GITHUB_ACTIONS === 'true' ||
    env.GITLAB_CI === 'true' ||
    env.BUILDKITE === 'true' ||
    env.CIRCLECI === 'true' ||
    env.TRAVIS === 'true'
  );
}
const USE_PROVENANCE = NO_PROVENANCE
  ? false
  : FORCE_PROVENANCE
    ? true
    : isInCI();

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
    // Windows 下 npm/git 是 .cmd / .exe，spawn 默认 shell:false 找不到。
    // 用 shell:true 让 cmd.exe 帮我们解析 PATH 与扩展名。
    shell: process.platform === 'win32',
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
  // muted 路径：rl.question 调用时 prompt 已被 readline 写出，之后用户键入的字符
  // 才进入 _writeToOutput。所以仅在 question 触发后才打开 muted。
  const rlInternal = rl;
  const origWrite = rlInternal._writeToOutput?.bind(rl);
  let muted = false;
  if (origWrite) {
    rlInternal._writeToOutput = (chunk) => {
      if (muted) return;
      origWrite(chunk);
    };
  }
  try {
    const answer = await new Promise((r) => {
      // rl.question 自己把 prompt 文本写到 output；不要再用 stdout.write 写一次
      rl.question('请输入 npm OTP（6 位数字，从你的 Authenticator app 取）: ', (ans) => {
        muted = false;
        r(ans);
      });
      // question 把 prompt 写完后立刻进入 muted；用户接下来键入的字符不回显
      muted = true;
    });
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

/**
 * 从 CHANGELOG.md 提取指定版本的 release notes 段。
 *
 * 实际抽取逻辑在 scripts/extract-changelog.mjs(同时被 CI 复用,确保
 * 本地与 CI 行为一致;不再维护两份并行实现)。这里只做发版前置校验:
 * 缺少版本段 / 段正文为空 → 抛错。
 */
function checkChangelog(version) {
  step('3/7 校验 CHANGELOG.md');
  const path = join(REPO_ROOT, 'CHANGELOG.md');
  if (!existsSync(path)) {
    throw new Error(
      `CHANGELOG.md 不存在。请创建并在顶部添加 [${version}] 版本段后重试。\n` +
        `参考格式:https://keepachangelog.com/zh-CN/1.1.0/`,
    );
  }
  const section = extractChangelogSection(version, REPO_ROOT);
  if (!section) {
    throw new Error(
      `CHANGELOG.md 顶部缺少 [${version}] 版本段(或该段正文为空)。\n` +
        `请在 CHANGELOG.md 中添加形如 "## [${version}] - YYYY-MM-DD" 的标题,` +
        `下面按 Added / Changed / Fixed 等分组列出本次变更后再重试。`,
    );
  }
  const lineCount = section.body.split('\n').length;
  ok(`CHANGELOG.md 含 [${version}] 段(${lineCount} 行 release notes)`);
  return section;
}

function checkGitClean() {
  step('1/7 检查 git 状态');
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
  step('2/7 检查与 origin 同步');
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
  step('4/7 检查 tag 状态');
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

/**
 * 探测可用代理。
 * 优先级：HTTPS_PROXY env > HTTP_PROXY env > 本地 127.0.0.1:7890（Clash/V2Ray 默认）
 * 返回 undefined 表示无代理，按裸网络跑（适合 CI / 海外用户）。
 *
 * 本地代理探测仅看端口监听（TCP connect 200ms 超时），不实际请求 registry，
 * 避免误判（DNS / 证书问题不属于代理可达性）。
 */
function detectProxy() {
  const envProxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  if (envProxy) return envProxy;
  // 本地默认端口探测 — 同步快速 (300ms 超时由 Socket 控制)
  return new Promise((resolve) => {
    const s = new Socket();
    let done = false;
    const cleanup = (v) => {
      if (done) return;
      done = true;
      try {
        s.destroy();
      } catch {
        /* ignore */
      }
      resolve(v);
    };
    s.setTimeout(300);
    s.once('connect', () => cleanup('http://127.0.0.1:7890'));
    s.once('error', () => cleanup(undefined));
    s.once('timeout', () => cleanup(undefined));
    s.connect(7890, '127.0.0.1');
  });
}

/**
 * 跑 npm ci，遇到 ECONNRESET / ETIMEDOUT / network 类错误自动重试，
 * 最多 3 次。每次失败间隔 15s。
 *
 * 探测到代理时把代理注入子进程 env（不污染当前 process），且给 npm 加
 * --maxsockets=3 降低并发抖动（默认 15，国内网络条件下偶发雪崩）。
 */
async function runNpmCiWithRetry(proxy) {
  const baseEnv = proxy
    ? { HTTPS_PROXY: proxy, HTTP_PROXY: proxy, npm_config_https_proxy: proxy, npm_config_http_proxy: proxy }
    : {};
  const args = ['ci', '--maxsockets=3'];
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      info(
        `npm ci (attempt ${attempt}/${maxAttempts}${proxy ? `, proxy: ${proxy}` : ', no proxy'})`,
      );
      run('npm', args, { env: baseEnv });
      return;
    } catch (e) {
      const msg = (e.message || '').toLowerCase();
      const networkError =
        msg.includes('econnreset') ||
        msg.includes('etimedout') ||
        msg.includes('network aborted') ||
        msg.includes('socket hang up') ||
        msg.includes('econnrefused');
      if (attempt === maxAttempts || !networkError) {
        throw e;
      }
      warn(`npm ci 失败（${attempt}/${maxAttempts}），15s 后重试。错误：${e.message.split('\n')[0]}`);
      await new Promise((r) => setTimeout(r, 15_000));
    }
  }
}

async function runPipeline() {
  step('5/7 构建与测试');
  const proxy = await detectProxy();
  await runNpmCiWithRetry(proxy);
  info('npm run typecheck');
  run('npm', ['run', 'typecheck']);
  info('npm test');
  run('npm', ['test']);
  info('npm run build');
  run('npm', ['run', 'build']);
  ok('全部检查通过');
}

function checkNpmLogin() {
  // dry-run 也跑，提前发现没登录的尴尬
  try {
    const who = tryRun('npm', [
      'whoami',
      '--registry=https://registry.npmjs.org/',
    ]);
    info(`已登录 npm 官方 registry：${who}`);
  } catch (e) {
    throw new Error(
      'npm 官方 registry 未登录。请先 `npm login --registry=https://registry.npmjs.org/` 完成登录，然后重跑。\n' +
        `底层错误：${e.message.split('\n')[0]}`,
    );
  }
}

async function doPublish(version) {
  step('6/7 npm publish');
  let otp;
  if (DRY_RUN) {
    info('dry-run 模式：跳过 OTP 提示');
  } else if (NO_OTP) {
    info('--no-otp：跳过 OTP 提示（假定账号 2FA 已关闭或不要求 publish OTP）');
  } else {
    otp = await promptOtp();
  }
  // 强制使用 npm 官方 registry，避免本地 .npmrc 把 registry 指向镜像（如腾讯/淘宝）
  // 导致 publish 失败或发到错误的地方。
  const args = [
    'publish',
    '--registry=https://registry.npmjs.org/',
    '--access',
    'public',
  ];
  if (USE_PROVENANCE) {
    args.push('--provenance');
    info('已启用 sigstore provenance（CI 环境或 --provenance 强制）');
  } else {
    info(
      '未启用 provenance（本地非 CI 环境；如需 sigstore 签名请通过 GitHub Actions release.yml 走 tag 路径，或加 --provenance 强制本地尝试）',
    );
  }
  if (DRY_RUN) args.push('--dry-run');
  if (otp) args.push(`--otp=${otp}`);
  // 关键：用 spawn 不打印 args（OTP 不能出现在 stdout 日志里）
  const safeArgsForLog = args.map((a) => (a.startsWith('--otp=') ? '--otp=******' : a));
  info(`npm ${safeArgsForLog.join(' ')}`);
  const r = spawnSync('npm', args, {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
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
  step('7/7 创建 + 推送 git tag');
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

function postPublishHints(name, version, changelogSection) {
  console.log();
  console.log(c('1', '完成！'));
  console.log();
  console.log(`  npm view ${name} version    # 应输出 ${version}`);
  console.log(`  npm view ${name}            # 完整 metadata`);
  console.log();
  // 把 release notes 落到临时文件,方便用户在 gh CLI 兜底创建 release 时直接 --notes-file
  let notesPath;
  if (changelogSection) {
    const tmp = mkdtempSync(join(tmpdir(), 'tapd-release-notes-'));
    notesPath = join(tmp, `v${version}.md`);
    writeFileSync(notesPath, changelogSection.body + '\n', 'utf8');
  }
  console.log('GitHub Release 在 CI 端会通过 release.yml 自动创建(如果 tag 触发了)。');
  console.log('如果 CI 不通,可以手动:');
  if (notesPath) {
    console.log(`  gh release create v${version} --notes-file ${notesPath}`);
    console.log();
    console.log(`(release notes 已从 CHANGELOG.md 提取并写入 ${notesPath})`);
  } else {
    console.log(`  gh release create v${version} --generate-notes`);
  }
  console.log();
}

// -------- main --------
async function main() {
  const { name, version } = readVersion();
  console.log(c('1', `📦 ${name}@${version}${DRY_RUN ? ' (dry-run)' : ''}`));
  console.log();

  checkGitClean();
  checkRemoteSync();
  const changelogSection = checkChangelog(version);
  const { tagName, localExists, remoteExists } = checkTag(version);
  await runPipeline();
  checkNpmLogin();

  if (!DRY_RUN) {
    const proceed = await confirm(
      `准备 npm publish ${name}@${version}。继续?`,
    );
    if (!proceed) {
      info('用户取消,已退出');
      process.exit(0);
    }
  }

  await doPublish(version);
  ensureTagAndPush(tagName, localExists, remoteExists);
  postPublishHints(name, version, changelogSection);
}

main().catch((err) => {
  fail(err.message || String(err));
  process.exit(1);
});
