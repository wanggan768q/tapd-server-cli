#!/usr/bin/env node
/**
 * 兼容备选入口：自动抓取 TAPD 网页 cookie，并写入 ~/.claude.json 的 tapd MCP 配置。
 *
 * 推荐路径已迁移到 MCP 工具 `tapd.login`（直接在 Claude 里说"登录 TAPD"即可）。
 * 本脚本仍保留，便于以下场景：
 *   - CI / 无 GUI 桌面环境
 *   - 用户想把 cookie 持久化到 ~/.claude.json 的 env（而不是 server 自己的 ~/.config/tapd-mcp/cookie）
 *
 * 内部统一调 dist/auth/browser-login.js 的 launchAndGrabCookie，与 MCP 工具同源。
 *
 * 用法：
 *   npm run build  # 确保 dist 是最新的
 *   node scripts/grab-cookie.mjs
 *   node scripts/grab-cookie.mjs --project E:/Git/tapd-mcp-server-gstm
 */

import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distModulePath = resolve(__dirname, '..', 'dist', 'auth', 'browser-login.js');

if (!existsSync(distModulePath)) {
  console.error(`未找到 ${distModulePath}。请先运行 npm run build。`);
  process.exit(1);
}

const { launchAndGrabCookie, BrowserNotFoundError, LoginTimeoutError, CdpConnectError } =
  await import(`file://${distModulePath.replace(/\\/g, '/')}`);

const args = process.argv.slice(2);
const projectKey = argValue(args, '--project') ?? 'E:/Git/tapd-mcp-server-gstm';

function argValue(arr, name) {
  const i = arr.indexOf(name);
  return i >= 0 ? arr[i + 1] : undefined;
}

async function main() {
  console.log('[1/3] 启动隔离浏览器并等待登录...');
  let result;
  try {
    result = await launchAndGrabCookie({});
  } catch (err) {
    if (err instanceof BrowserNotFoundError) {
      console.error('未在常见路径找到 Chrome 或 Edge。请安装 Chrome / Edge 或设置 BROWSER 环境变量。');
      process.exit(2);
    }
    if (err instanceof LoginTimeoutError) {
      console.error(err.message);
      process.exit(3);
    }
    if (err instanceof CdpConnectError) {
      console.error(err.message);
      process.exit(4);
    }
    throw err;
  }

  console.log(`     抓到 ${result.cookieCount} 个 .${result.domainSuffix} cookie，总长 ${result.cookieHeader.length} 字符`);

  console.log(`[2/3] 写入 ~/.claude.json 的 tapd 配置（项目: ${projectKey}）...`);
  const configPath = join(homedir(), '.claude.json');
  const cfg = JSON.parse(readFileSync(configPath, 'utf8'));
  const project = cfg.projects?.[projectKey];
  if (!project || !project.mcpServers?.tapd) {
    console.error(
      `FAIL: ${projectKey} 在 .claude.json 中没有 tapd MCP 条目。请先按 README 配置基础项。`,
    );
    process.exit(5);
  }
  copyFileSync(configPath, `${configPath}.bak.${Date.now()}`);
  project.mcpServers.tapd.env = project.mcpServers.tapd.env || {};
  project.mcpServers.tapd.env.TAPD_WEB_COOKIE = result.cookieHeader;
  writeFileSync(configPath, JSON.stringify(cfg, null, 2));
  console.log(`[3/3] ✓ TAPD_WEB_COOKIE 已写入 ~/.claude.json`);
  console.log('     重启 Claude Code 让 MCP 配置生效。');
  console.log('');
  console.log('     提示：现在更推荐直接在 Claude 中调用 tapd.login 工具，');
  console.log('     无需重启即可生效，cookie 写到 ~/.config/tapd-mcp/cookie。');
}

main().catch((err) => {
  console.error('grab-cookie 失败:', err.stack ?? err.message ?? String(err));
  process.exit(1);
});
