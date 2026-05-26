#!/usr/bin/env bash
# ============================================================================
# TAPD API 手工探测脚本
# 沿用在 design.md 阶段验证过的 curl 探针，便于在排错时快速重放。
#
# 用法:
#   TAPD_TOKEN=<your-pat> ./scripts/probe-api.sh
#   TAPD_TOKEN=<your-pat> TAPD_API_BASE=https://api.tapd.cn ./scripts/probe-api.sh
#
# 退出码:
#   0 = 全部接口可正常调用
#   1 = TAPD_TOKEN 未设置
#   2 = 某次接口调用返回非 status=1
# ============================================================================
set -euo pipefail

if [[ -z "${TAPD_TOKEN:-}" ]]; then
  echo "ERROR: TAPD_TOKEN 未设置。请通过环境变量传入个人访问令牌。" >&2
  exit 1
fi

API_BASE="${TAPD_API_BASE:-https://api.tapd.cn}"
AUTH_HEADER="Authorization: Bearer ${TAPD_TOKEN}"

probe() {
  local label="$1"
  local path="$2"
  echo "----- ${label} -----"
  echo "GET ${API_BASE}${path}"
  local body
  body="$(curl -fsS -H "${AUTH_HEADER}" "${API_BASE}${path}")"
  echo "${body}" | head -c 400
  echo
  if [[ "${body}" != *'"status":1'* ]]; then
    echo "ERROR: ${label} 返回非 status=1" >&2
    exit 2
  fi
}

probe "quickstart/testauth"                    "/quickstart/testauth"
probe "users/info"                             "/users/info"
probe "workspaces/user_participant_projects"   "/workspaces/user_participant_projects"

echo "----- 全部探测通过 -----"
