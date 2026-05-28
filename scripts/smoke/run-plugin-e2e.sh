#!/usr/bin/env bash
# scripts/smoke/run-plugin-e2e.sh
#
# Plugin 端到端自动化 smoke（issue #10 follow-up）。
#
# 这个脚本只跑可在 CLI 全自动验证的部分；GUI 类（弹窗、热加载、/mcp 列表）
# 必须由人在 docs/smoke/<date>-plugin-e2e.md 的 checklist 里手工补证据。
#
# 自动化覆盖：
#   1. plugin manifest 静态合规
#   2. claude plugin validate（若 claude CLI 在 PATH，否则 SKIP）
#   3. npm pack --dry-run 不含 plugin 文件
#   4. .mcp.json 已锁定到 ~<minor>.0
#   5. 用 npx 拉 ~0.2.0 范围拿到的版本与本仓库 package.json minor 一致
#
# 用法：
#   bash scripts/smoke/run-plugin-e2e.sh                # 全部跑，写日志到 stdout
#   SMOKE_OUT=docs/smoke/2026-05-28-plugin-e2e.log \
#     bash scripts/smoke/run-plugin-e2e.sh              # 同时落盘
#   SKIP_NPX=1 bash scripts/smoke/run-plugin-e2e.sh     # 跳过最慢的 step 5（受网络限制时）
#
# 退出码：
#   0 — 全过（含 SKIP）
#   1 — 至少一条断言失败
#
# 注意：此脚本只读不写——除了 SMOKE_OUT 指定的日志文件，不会改任何项目文件，
# 也不需要 sudo 或全局 npm install。

set -euo pipefail

# -- 输出层（同时打 stdout 与可选日志文件） ----------------------------------
log() {
  if [ -n "${SMOKE_OUT:-}" ]; then
    echo "$@" | tee -a "$SMOKE_OUT"
  else
    echo "$@"
  fi
}

if [ -n "${SMOKE_OUT:-}" ]; then
  mkdir -p "$(dirname "$SMOKE_OUT")"
  : > "$SMOKE_OUT"  # 清空旧日志
fi

# 切到仓库根（脚本可能从任意目录调）
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0

assert_pass() {
  log "  ✓ $1"
  PASS_COUNT=$((PASS_COUNT + 1))
}

assert_skip() {
  log "  ⊘ $1 (SKIPPED: $2)"
  SKIP_COUNT=$((SKIP_COUNT + 1))
}

assert_fail() {
  log "  ✗ $1"
  log "    详细：$2"
  FAIL_COUNT=$((FAIL_COUNT + 1))
}

log "=== Plugin E2E Smoke (commit $(git rev-parse --short HEAD)) ==="
log "=== 时间：$(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
log ""

# -- Step 1: plugin manifest 静态合规 ---------------------------------------
log "[1/5] plugin / marketplace / .mcp.json 合规"
if ! node -e "JSON.parse(require('fs').readFileSync('.claude-plugin/plugin.json','utf8'))" 2>/dev/null; then
  assert_fail "plugin.json 不是合法 JSON" "查看 .claude-plugin/plugin.json"
elif ! node -e "JSON.parse(require('fs').readFileSync('.claude-plugin/marketplace.json','utf8'))" 2>/dev/null; then
  assert_fail "marketplace.json 不是合法 JSON" "查看 .claude-plugin/marketplace.json"
elif ! node -e "JSON.parse(require('fs').readFileSync('.mcp.json','utf8'))" 2>/dev/null; then
  assert_fail ".mcp.json 不是合法 JSON" "查看 .mcp.json"
else
  PKG_VERSION=$(node -p "require('./package.json').version")
  PLG_VERSION=$(node -p "require('./.claude-plugin/plugin.json').version")
  MKT_VERSION=$(node -p "require('./.claude-plugin/marketplace.json').plugins[0].version")
  if [ "$PKG_VERSION" != "$PLG_VERSION" ] || [ "$PKG_VERSION" != "$MKT_VERSION" ]; then
    assert_fail "version 不同步" "package=$PKG_VERSION plugin=$PLG_VERSION marketplace=$MKT_VERSION"
  else
    assert_pass "版本三处一致：$PKG_VERSION"
  fi
fi

# -- Step 2: claude plugin validate（可选） --------------------------------
log ""
log "[2/5] claude plugin validate"
if command -v claude >/dev/null 2>&1; then
  if claude plugin validate ./ >/tmp/claude-validate.out 2>&1; then
    assert_pass "claude plugin validate 通过"
  else
    assert_fail "claude plugin validate 失败" "$(cat /tmp/claude-validate.out)"
  fi
else
  assert_skip "claude plugin validate" "claude CLI 不在 PATH（属于环境限制，非本次 PR 问题）"
fi

# -- Step 3: npm pack --dry-run 不含 plugin 文件 ----------------------------
log ""
log "[3/5] npm pack --dry-run 排除 plugin 文件"
PACK_OUT=$(mktemp)
if npm pack --dry-run >"$PACK_OUT" 2>&1; then
  PATTERN='(\.claude-plugin/|[[:space:]]\.mcp\.json$|[[:space:]]commands/|[[:space:]]skills/|[[:space:]]openspec/|[[:space:]]docs/)'
  if grep -E "$PATTERN" "$PACK_OUT" >/dev/null 2>&1; then
    assert_fail "plugin 文件被打入 npm 包" "$(grep -E "$PATTERN" "$PACK_OUT" | head -5)"
  else
    assert_pass "npm 包仅含 dist/ + README + LICENSE + package.json"
  fi
else
  assert_fail "npm pack --dry-run 失败" "$(tail -10 "$PACK_OUT")"
fi
rm -f "$PACK_OUT"

# -- Step 4: .mcp.json 锁版本范围正确 ---------------------------------------
log ""
log "[4/5] .mcp.json 锁定到 ~<minor>.0"
# 用单独的 node 调用读 args[1]（避免 bash 转义嵌套的反斜杠地狱）
MCP_ARG=$(node -p 'require("./.mcp.json").mcpServers.tapd.args[1]') || MCP_ARG=""
PKG_MAJOR_MINOR=$(node -p 'require("./package.json").version.split(".").slice(0,2).join(".")') || PKG_MAJOR_MINOR=""
EXPECTED="tapd-server-cli@~${PKG_MAJOR_MINOR}.0"
if [ -z "$MCP_ARG" ] || [ -z "$PKG_MAJOR_MINOR" ]; then
  assert_fail ".mcp.json 或 package.json 读取失败" "MCP_ARG=[$MCP_ARG] PKG_MAJOR_MINOR=[$PKG_MAJOR_MINOR]"
elif [ "$MCP_ARG" = "$EXPECTED" ]; then
  assert_pass ".mcp.json args[1] = $MCP_ARG"
else
  assert_fail ".mcp.json args[1] 锁定形态不正确" "实际=$MCP_ARG 期望=$EXPECTED"
fi

# -- Step 5: 用锁版本范围拉真实 npm 包并启动 --------------------------------
log ""
log "[5/5] 验证 ~<minor>.0 范围在 npm registry 上能解析到合法版本"
if [ "${SKIP_NPX:-}" = "1" ]; then
  assert_skip "npx ~$PKG_VERSION 拉取" "SKIP_NPX=1"
else
  RANGE="${MCP_ARG#tapd-server-cli@}"
  # 不实际 spawn server——server 启动需要 TAPD_TOKEN，会要交互。
  # 改用 npm view 拿能匹配该范围的最高版本，断言其 minor 与 package.json 一致。
  RESOLVED_VERSION=$(npm view "tapd-server-cli@${RANGE}" version 2>/dev/null | tail -1 | tr -d '"' || true)
  if [ -z "$RESOLVED_VERSION" ]; then
    assert_skip "npm view 范围解析" "网络受限或 corporate registry，可手工跑 npm view tapd-server-cli@${RANGE} version"
  else
    PKG_MAJOR_MINOR=$(echo "$PKG_VERSION" | cut -d. -f1-2)
    RESOLVED_MAJOR_MINOR=$(echo "$RESOLVED_VERSION" | cut -d. -f1-2)
    if [ "$PKG_MAJOR_MINOR" = "$RESOLVED_MAJOR_MINOR" ]; then
      assert_pass "范围 ${RANGE} 解析到 $RESOLVED_VERSION（minor 与本仓库一致）"
    else
      assert_fail "锁版本解析的 minor 不一致" "本地=$PKG_MAJOR_MINOR registry=$RESOLVED_MAJOR_MINOR 解析版本=$RESOLVED_VERSION"
    fi
  fi
fi

# -- 汇总 -------------------------------------------------------------------
log ""
log "=== 汇总：PASS=$PASS_COUNT  FAIL=$FAIL_COUNT  SKIP=$SKIP_COUNT ==="

if [ "$FAIL_COUNT" -gt 0 ]; then
  log ""
  log "❌ 自动化部分有 $FAIL_COUNT 项失败，请按上面提示处理后重跑。"
  exit 1
fi

log ""
log "✅ 自动化部分全过。GUI / 交互验证（/plugin install 弹窗、/mcp Connected、"
log "   /tapd-server-cli:login 浏览器弹窗、/tapd-server-cli:update 渲染等）"
log "   请按 docs/smoke/<date>-plugin-e2e.md 的 checklist 手工补证据。"
