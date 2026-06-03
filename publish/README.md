# tapd-server-cli 双击发版工具

为不熟悉命令行的 maintainer 提供"双击就发版"的体验。底层仍然调
`scripts/publish.mjs`（与本地终端 `node scripts/publish.mjs` 等价），
但前置预检 + 友好错误提示让"成功率"和"出错可恢复性"显著提升。

> 国内 maintainer 强烈推荐：本工具自动探测本地代理 7890 并向 npm ci 注入；
> 跑命令行版需要手动 `set HTTPS_PROXY=...`，容易忘。

---

## 文件清单

| 文件 | 角色 | 谁来跑 |
|---|---|---|
| `publish.bat` | 双击启动器（cmd 壳） | 双击启动 |
| `publish.ps1` | 真正的发版脚本（PowerShell） | bat 调用，也可手动跑 |
| `README.md`（本文件） | 使用说明 + 故障排查 | 你正在看 |

`publish.bat` 只做两件事：① `cd` 到项目根（脚本所在目录的上一级）；
② 调 PowerShell 执行 `publish.ps1`，并 `pause` 让你看到结果。

---

## 怎么用

### 双击模式（推荐）

```
1. 在 Windows 资源管理器里打开本目录
2. 双击 publish.bat
3. 按提示一路 Enter（如果未登录 npm，脚本会自动触发 npm login）
4. 完成后窗口会显示验证命令，按任意键关闭
```

### 命令行模式（高级）

```powershell
# 在项目根：
powershell -NoProfile -ExecutionPolicy Bypass -File .\publish\publish.ps1

# 或者跳过本壳，直接跑底层（不推荐——少了预检 + 代理探测的人体工学）
node scripts\publish.mjs
```

---

## 预检清单（脚本会逐个跑）

| 步骤 | 检查 | 失败时怎么办 |
|---|---|---|
| 1/7 | cwd 是项目根 + `package.json` 含 `name: tapd-server-cli` | 双击重新触发；或手动 `cd` 到项目根再跑 |
| 2/7 | `node` / `npm` / `git` 在 PATH，且 Node ≥ 22.13.0 | 升级 Node：`nvm install 22 && nvm use 22` |
| 3/7 | 在 `main` 分支，工作树干净，本地与 origin 同步（不同步会问是否 push） | 看脚本输出的具体修复指令 |
| 4/7 | 已登录 npm 官方 registry（`npm whoami` 能拿到用户名） | `npm login --registry=https://registry.npmjs.org/` |
| 5/7 | 代理可达（`HTTPS_PROXY` env 或本机 `127.0.0.1:7890` 任一） | 国内用户：开 Clash / V2Ray；国外用户：忽略警告 |
| 6/7 | 用户最终确认 + 调 `publish.mjs --no-otp` | `publish.mjs` 自身处理 CHANGELOG / 测试 / 发布 / 打 tag |
| 7/7 | 跑完总结 | 失败时给具体恢复命令 |

---

## npm 2FA 与 OTP

**当前 npm 账号 `wanggan768q` 未开启 2FA**（`npm profile get` 显示
`two-factor auth: disabled`），所以：

- `npm login` 只问 username / password / email，**不要 OTP**
- `npm publish` 不要 OTP
- 脚本调 `publish.mjs --no-otp` 标志，跳过 OTP 提问步骤
- v0.3.2 已成功发布过 `--provenance` 包，证明无 2FA 也能拿 sigstore 签名

**如果你将来给账号开了 2FA**，需要：

1. 在 npmjs.com → Account → Two-Factor Authentication 开启
2. 编辑 `publish/publish.ps1`，把 `& node scripts\publish.mjs --no-otp`
   里的 `--no-otp` 删掉
3. 然后跑发版时，`npm login` 会要 1 次 OTP，`npm publish` 会再要 1 次

**OTP 来源**：Authenticator app（Google Authenticator / 1Password /
微软 Authenticator 等）中找到 npmjs.com 这个 entry，输入当前 6 位数字。

---

## 常见问题

### Q1: 双击 `.bat` 后窗口一闪而过

**原因**：PowerShell ExecutionPolicy 阻止脚本运行，bat 立即返回。

**解决**：以管理员身份打开 PowerShell 跑一次：
```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```
之后正常双击即可。我们的 `.bat` 已加 `-ExecutionPolicy Bypass` 兜底，
但有些组策略会强制覆盖。

### Q2: 提示 "未检测到代理"

如果你在国内，`npm ci` / `npm publish` 大概率会 ECONNRESET。
开启 Clash 或 V2Ray，确保 HTTP 代理监听 `127.0.0.1:7890` 即可。

或者在终端设置环境变量后再跑：
```powershell
$env:HTTPS_PROXY = 'http://127.0.0.1:7890'
$env:HTTP_PROXY  = 'http://127.0.0.1:7890'
.\publish\publish.bat
```

### Q3: `publish.mjs` 第 5/7 步 `npm ci` 失败

`publish.mjs` 本身已加 3 次 retry + 代理注入逻辑。如果 3 次都败：

1. 确认代理通：`curl -x http://127.0.0.1:7890 -I https://registry.npmjs.org/` 应返回 200
2. 检查代理流量：是否走的 "rule" 模式且 `npmjs.org` 没被 reject
3. 改用国内镜像（不推荐，会丢 provenance）：`npm config set registry https://registry.npmmirror.com` —— 临时绕开后**记得改回官方 registry 再 publish**

### Q4: `npm publish` 失败 401 Unauthorized

token 过期。重新登录：
```powershell
npm login --registry=https://registry.npmjs.org/
```

### Q5: publish 成功但 tag 没推到 GitHub

`publish.mjs` 第 6/7 步 push tag 失败时会保留本地 tag。手动补推：
```powershell
git push origin v0.4.0   # 改成你刚发的版本号
```

### Q6: GitHub Release 没自动建出来

push tag 触发 `.github/workflows/release.yml`，它从 CHANGELOG 抽 release notes。
如果 CI 失败：
```powershell
gh run list --workflow=release.yml --limit 1
gh run rerun --failed -R wanggan768q/tapd-server-cli
```

---

## 我能不能完全跳过这些脚本，纯手工发？

可以，但要按顺序跑：
```powershell
git status                                    # 干净
git log --oneline origin/main..HEAD           # 本地领先 origin
git push origin main                          # 同步到远端
$env:HTTPS_PROXY='http://127.0.0.1:7890'      # 国内才需
node scripts\publish.mjs                      # 跑底层 publish
```

`scripts\publish.mjs` 本身就是完整流程（git 校验 / CHANGELOG / 测试 / 发布 / 打 tag），
我们这两个脚本只是给它套一层"双击友好"的外壳。

---

## 出问题想升级这个脚本？

`publish.ps1` 顶部注释列了职责。改的时候保持"它只做轻量化预检 + 调
`publish.mjs`"——不要把 publish.mjs 的逻辑挪过来重复。

测试方式：
```powershell
# 在干净的工作树跑（不会真发版，因为 publish.mjs 会再问一次确认）
.\publish\publish.bat
```

确认进到 publish.mjs 的"5/7 构建与测试"那步即认为脚本入口跑通。
回答 publish.mjs 最后的 "继续? [y/N]" 时按 N 退出，不污染 npm。
