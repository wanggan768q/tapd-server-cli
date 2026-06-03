<#
  tapd-server-cli release helper (Windows, double-click friendly)

  Triggered by publish.bat double-click, or run directly via:
    powershell -NoProfile -ExecutionPolicy Bypass -File .\publish\publish.ps1

  This script does pre-flight checks then delegates to scripts\publish.mjs.
  We do NOT duplicate publish.mjs's 7-step logic here — only add the
  ergonomic wrapping (cd to project root, proxy probe, npm-login check,
  Chinese-friendly error hints).

  Writing this file as ASCII-only avoids PowerShell 5.x parser breaking
  on UTF-8 without BOM. User-facing prompts are kept English; bilingual
  hints are emitted via Write-Host where safe (after chcp 65001).
#>

$ErrorActionPreference = 'Stop'

# Force UTF-8 output (Windows default cmd is GBK / Code Page 936)
try {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  $OutputEncoding = [System.Text.Encoding]::UTF8
  & chcp 65001 | Out-Null
} catch { }

# -------- helpers --------
function Say-Step($n, $total, $msg) { Write-Host "[$n/$total] $msg" -ForegroundColor Cyan }
function Say-Ok($msg)   { Write-Host "  OK  $msg" -ForegroundColor Green }
function Say-Warn($msg) { Write-Host "  !!  $msg" -ForegroundColor Yellow }
function Say-Err($msg)  { Write-Host "  XX  $msg" -ForegroundColor Red }
function Say-Info($msg) { Write-Host "      $msg" -ForegroundColor Gray }

function Die($title, [string[]]$hintLines) {
  Write-Host ""
  Say-Err $title
  Write-Host ""
  Write-Host "  Recovery:" -ForegroundColor Yellow
  foreach ($line in $hintLines) {
    Write-Host "    $line" -ForegroundColor Yellow
  }
  Write-Host ""
  exit 1
}

Write-Host ""
Write-Host "===============================================================" -ForegroundColor Magenta
Write-Host "      tapd-server-cli  Release Tool  (Windows / double-click)  " -ForegroundColor Magenta
Write-Host "===============================================================" -ForegroundColor Magenta
Write-Host ""

# -------- 1. cwd is project root --------
Say-Step 1 7 "Verify working directory"
if (-not (Test-Path -LiteralPath 'package.json')) {
  Die "package.json not found in $(Get-Location)" @(
    "Probably the .bat did not cd correctly. Try manually:",
    "  cd E:\Git\tapd-mcp-server-gstm",
    "  powershell -NoProfile -ExecutionPolicy Bypass -File .\publish\publish.ps1"
  )
}
$pkg = Get-Content -Raw -Path 'package.json' | ConvertFrom-Json
if ($pkg.name -ne 'tapd-server-cli') {
  Die "package.json name is not tapd-server-cli (got: $($pkg.name))" @(
    "You should be in the tapd-server-cli repo root."
  )
}
Say-Ok "cwd $(Get-Location)  name=$($pkg.name)  version=$($pkg.version)"

# -------- 2. node / git / npm --------
Say-Step 2 7 "Check node / npm / git"
foreach ($tool in @('node','npm','git')) {
  try {
    $v = (& $tool --version 2>&1 | Out-String).Trim()
    Say-Info "$tool : $v"
  } catch {
    Die "$tool not on PATH" @(
      "Install Node.js 22+ (https://nodejs.org/) and Git for Windows."
    )
  }
}
$nodeVer = (& node --version) -replace '^v',''
$nodeMajor = [int]($nodeVer.Split('.')[0])
if ($nodeMajor -lt 22) {
  Die "Node.js $nodeVer is below required 22.13.0" @(
    "Upgrade Node:",
    "  nvm install 22; nvm use 22",
    "  or download LTS from https://nodejs.org/"
  )
}
Say-Ok "node $nodeVer (>= 22)"

# -------- 3. git state --------
Say-Step 3 7 "Check git state"
$branch = (& git rev-parse --abbrev-ref HEAD).Trim()
if ($branch -ne 'main') {
  Die "Current branch is not main (got: $branch)" @(
    "Switch:  git checkout main"
  )
}
$dirty = (& git status --porcelain) | Where-Object { $_ }
if ($dirty) {
  Write-Host ""
  $dirty | ForEach-Object { Write-Host "    $_" -ForegroundColor Yellow }
  Die "Working tree has uncommitted changes" @(
    "Commit or stash first:",
    "  git status",
    "  git add . ; git commit -m '...'",
    "  or  git stash"
  )
}
Say-Ok "On main, working tree clean"

# Sync check vs origin/main
try { & git fetch origin main 2>&1 | Out-Null } catch { Say-Warn "git fetch failed (network? skipping remote compare)" }
$localSha  = (& git rev-parse HEAD).Trim()
$originSha = $null
try { $originSha = (& git rev-parse origin/main).Trim() } catch { }
if ($originSha) {
  if ($localSha -eq $originSha) {
    Say-Ok "HEAD matches origin/main ($($localSha.Substring(0,7)))"
  } else {
    $aheadOut  = (& git rev-list --count "$originSha..$localSha")
    $behindOut = (& git rev-list --count "$localSha..$originSha")
    $ahead  = [int]$aheadOut
    $behind = [int]$behindOut
    if ($behind -gt 0) {
      Die "Local is BEHIND origin/main by $behind commit(s)" @(
        "Sync first:",
        "  git pull --rebase origin main"
      )
    }
    if ($ahead -gt 0) {
      Say-Warn "Local is AHEAD of origin/main by $ahead commit(s); needs push"
      $ans = Read-Host "  Push to origin/main now? [Y/n]"
      if ($ans -eq '' -or $ans -match '^[Yy]') {
        & git push origin main
        if ($LASTEXITCODE -ne 0) {
          Die "git push failed" @(
            "Check error above. If 'rejected', run:",
            "  git pull --rebase origin main ; git push origin main"
          )
        }
        Say-Ok "Pushed to origin/main"
      } else {
        Die "User cancelled push" @(
          "publish.mjs step 2/7 will fail because of out-of-sync origin.",
          "Push first, then re-run."
        )
      }
    }
  }
}

# -------- 4. npm login --------
Say-Step 4 7 "Check npm login"

# Helper: detect whether npm whoami succeeds against the official registry.
# Returns the username string on success, or $null on any failure
# (network / not-logged-in / ENEEDAUTH / 401).
function Get-NpmWhoami {
  try {
    $out = ((& npm whoami --registry=https://registry.npmjs.org/ 2>&1) | Out-String).Trim()
    if (-not $out) { return $null }
    if ($out -match 'ENEEDAUTH|not logged in|401|404') { return $null }
    return $out
  } catch {
    return $null
  }
}

$whoami = Get-NpmWhoami

# Not logged in? Offer to run `npm login` inline so the user does not have
# to drop out of this flow and re-run the script.
if (-not $whoami) {
  Say-Warn "Not logged in to npm registry (or login token expired)."
  Write-Host "      This will start: npm login --registry=https://registry.npmjs.org/" -ForegroundColor Gray
  Write-Host "      It will prompt for: username / password / email (no OTP since 2FA is disabled on this account)." -ForegroundColor Gray
  Write-Host ""
  $ans = Read-Host "  Run npm login now? [Y/n]"
  if ($ans -ne '' -and $ans -notmatch '^[Yy]') {
    Die "User declined npm login" @(
      "Login manually then re-run this script:",
      "  npm login --registry=https://registry.npmjs.org/"
    )
  }
  Write-Host ""
  Write-Host "  ----- npm login -----" -ForegroundColor Magenta
  # Important: do NOT pipe / capture — npm login is interactive and must
  # inherit stdin/stdout/stderr verbatim. PowerShell call operator (&)
  # does this by default.
  & npm login --registry=https://registry.npmjs.org/
  $loginExit = $LASTEXITCODE
  Write-Host "  ----- end npm login -----" -ForegroundColor Magenta
  Write-Host ""
  if ($loginExit -ne 0) {
    Die "npm login exited with code $loginExit" @(
      "Network issue or wrong credentials. Try manually:",
      "  npm login --registry=https://registry.npmjs.org/",
      "Common causes:",
      "  - Behind GFW: set `$env:HTTPS_PROXY='http://127.0.0.1:7890' first",
      "  - 2FA / OTP entered wrong: just retry",
      "  - Account locked / suspended: check email from npm"
    )
  }
  # Re-check after login
  $whoami = Get-NpmWhoami
  if (-not $whoami) {
    Die "npm login finished but whoami still empty" @(
      "Try opening a new terminal (env may need refresh):",
      "  npm whoami --registry=https://registry.npmjs.org/"
    )
  }
}

Say-Ok "Logged in as: $whoami"

# -------- 5. proxy probe --------
Say-Step 5 7 "Probe proxy (for users behind GFW)"
$proxy = $env:HTTPS_PROXY
if (-not $proxy) { $proxy = $env:HTTP_PROXY }
if ($proxy) {
  Say-Ok "Using env proxy: $proxy"
} else {
  $tcp = New-Object Net.Sockets.TcpClient
  $reachable = $false
  try {
    $iar = $tcp.BeginConnect('127.0.0.1', 7890, $null, $null)
    $reachable = $iar.AsyncWaitHandle.WaitOne(300, $false) -and $tcp.Connected
  } catch { }
  finally { try { $tcp.Close() } catch { } }
  if ($reachable) {
    Say-Ok "Local proxy 127.0.0.1:7890 is reachable. publish.mjs will auto-use it."
  } else {
    Say-Warn "No proxy detected. If you are in mainland China, npm publish will likely fail."
    Say-Info "Fix 1: start Clash/V2Ray so port 7890 is open"
    Say-Info "Fix 2: set env in terminal then run publish:"
    Say-Info "         `$env:HTTPS_PROXY='http://127.0.0.1:7890'"
    Say-Info "         node scripts\publish.mjs"
    Say-Info "Outside China: ignore this warning."
  }
}

# -------- 6. final confirm and call publish.mjs --------
Say-Step 6 7 "Run publish.mjs (full release pipeline)"
Write-Host ""
Write-Host "    package: $($pkg.name)" -ForegroundColor White
Write-Host "    version: $($pkg.version)" -ForegroundColor White
Write-Host "    branch:  main @ $($localSha.Substring(0,7))" -ForegroundColor White
Write-Host ""
$ans = Read-Host "  Confirm release v$($pkg.version)? [Y/n]"
if ($ans -ne '' -and $ans -notmatch '^[Yy]') {
  Write-Host ""
  Say-Warn "User cancelled, exiting"
  Write-Host ""
  exit 0
}

Write-Host ""
Write-Host "  publish.mjs will run: git checks / CHANGELOG extract / npm ci+typecheck+test+build / npm publish / git tag" -ForegroundColor Gray
Write-Host "  --no-otp passed: account has 2FA disabled, no Authenticator code needed" -ForegroundColor Gray
Write-Host ""

& node scripts\publish.mjs --no-otp
$exit = $LASTEXITCODE

# -------- 7. summary --------
Say-Step 7 7 "Result"
if ($exit -eq 0) {
  Write-Host ""
  Say-Ok "Release succeeded!"
  Write-Host ""
  Write-Host "  Verify (recommended):" -ForegroundColor Cyan
  Write-Host "    npm view $($pkg.name)@$($pkg.version) version" -ForegroundColor White
  Write-Host "    gh release view v$($pkg.version)" -ForegroundColor White
  Write-Host "    npm view $($pkg.name)@$($pkg.version) dist.signatures" -ForegroundColor White
  Write-Host ""
} else {
  Write-Host ""
  Say-Err "publish.mjs exit code $exit"
  Write-Host ""
  Write-Host "  Common recoveries:" -ForegroundColor Yellow
  Write-Host "    npm ci network dies    -> verify proxy: curl -x http://127.0.0.1:7890 https://registry.npmjs.org/" -ForegroundColor Yellow
  Write-Host "    npm publish 401        -> npm login --registry=https://registry.npmjs.org/" -ForegroundColor Yellow
  Write-Host "    publish OK, tag missing-> git push origin v$($pkg.version)" -ForegroundColor Yellow
  Write-Host ""
  exit $exit
}
