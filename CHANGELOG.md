# Changelog

## 0.3.17 (2026-09-13)

- **MSYS2 成为第四个终端后端**（`SHELLS` = `powershell` / `gitbash` / `msys2` / `wsl`，顺序即目录顺序）：新增 `msys2Path` 配置项、`candidateMsys2Paths()`、`buildArgv` 的 `msys2` 分支、交互式 `terminalArgv` 分支、`SHELL_DESCRIPTIONS.msys2`，以及 `msys2-unconfined` 沙箱结果（与 Git Bash 同理：DSH 的 Windows ACL 受限令牌 runner 无法承载 Cygwin/MSYS2 运行时）。
- **后端用 `bash.exe` + `-lc`，不用 `msys2.exe` + `-c`**：`msys2.exe` 是分配控制台的 Cygwin 启动器，在管道 stdio 下对任何命令都返回 exit 0 且 stdout/stderr 各 0 字节（在 MSYS2 bash 5.3.15 上实测）——看着成功、实际什么都没跑。候选路径改为 `usr\bin\bash.exe` → `bin\bash.exe` → PATH 派生项，`msys2.exe` 仅作为文档化的最后兜底（每台机器上可用的 `bash.exe` 都会优先命中）。`-lc` 而非 `-c`：登录 shell 会 source `/etc/profile`，这才是把 `/usr/bin` 和 `/mingw64/bin` 放进 PATH 的东西；裸 `-c` 下 `tr` / `sed` / `gcc` 全部 command not found。
- `buildEnv("msys2", ...)` 注入 `MSYSTEM=MINGW64`（用户显式传值优先），让 `/mingw64/bin`（gcc、make 等）进入 PATH；只对 msys2 生效，gitbash/wsl 不受影响。
- 客户端「默认终端」设置行补上 MSYS2 选项（此前只有服务端支持，UI 里选不到），中文/英文词典各加 `shell.msys2: "MSYS2"`。
- 测试：`buildArgv("msys2")` 断言 `-lc`、`buildEnv` 断言 `MSYSTEM=MINGW64` 且显式值优先、候选列表中每个 `bash.exe` 必须排在 `msys2.exe` 之前、解析结果必须落在 `bash.exe`、apply 用例覆盖 msys2 的 argv/env/沙箱，client 用例新增「宿主 `SHELLS` 与客户端列表 + 双语词典 + 描述」一致性漂移守卫。

## 0.3.15 (2026-09-11)

- **适配 DSH 0.1.5-rc.1**. 客户端模块表（`PLATFORM_MODULES`）把 `@deepseek-ai/dsh-client-runtime` 改名为 `@deepseek-ai/dsh-client-store`，并且只按**精确裸名**命中（没有 `/client` 子路径，也没有包工厂兜底）。客户端 bundle 原先 `require("@deepseek-ai/dsh-client-runtime/client")`，在 0.1.5 下必然 miss → Web GUI 启动报 `Failed to load plugins / require(...) missed the module table`。现改为 `@deepseek-ai/dsh-client-store`，bundle 的 4 个 require（`react`、`react/jsx-runtime`、`dsh-client-store`、`dsh-client-ui-primitives`）全部落在平台种子表内，不需要 `dsh.client.external`。
- `dsh.client.inject` 更新为 0.1.5 真实存在的客户端包名（`dsh-client-locale`、`dsh-client-ui-settings`、`dsh-api-remotes`）。
- 服务端 settings 接缝不再导出 `settingsNamespace()`（0.1.5 起 `register(ns: string, schema, { base })` 直接收命名空间字符串）；已同步去掉该包装，代码对 0.1.0/0.1.5 两代 API 都成立。
- `peerDependencies` 对齐 `^0.1.5-rc.1`（新增实际依赖的 `dsh-sandbox`，`cordis` 提到 `^4.0.2`）；client 测试新增回归断言：bundle 不得再出现 `dsh-client-runtime`。
- `install.ps1` 的 settings 白名单 patch 加了存在性探测：0.1.5 已无硬编码白名单，脚本不再为了无匹配的替换去重写宿主文件（那只会给它加个 BOM）。
- Git Bash 不再经 `ctx.sandbox.confine` 包装：DSH 的 Windows ACL 受限令牌 runner 与 Cygwin/MSYS2 不兼容（bash 启动时 `CreateFileMapping` Win32 error 5 直接终止），现在 Git Bash 在受限模式下也按不包装运行，结果报告 `enforcement: gitbash-unconfined`。修复 #6。

## 0.3.14 (2026-08-14)

- Settings row now mirrors the shipped EnterBehaviorRow exactly: row layout (title + tertiary description left, capsule selector right), 36px capsule trigger (`--dsw-alias-bg-module-platform`, 18px radius, hover state) with a chevron, `align="end"` portal Menu. CSS injected the same way as first-party rows.
- Removed the "(由你决定，AI 无法更改)" description phrase.

## 0.3.13 (2026-08-14)

- Settings row follows the shipped General-section row grammar (column stack, 1px bottom hairline via `--dsw-alias-border-l2`, 16px vertical padding, 14px/400 title) — matches the Appearance row's layout.

## 0.3.12 (2026-08-14)

- **User-facing native UI**: the Settings -> General "Default terminal" row now renders with DSH-native primitives (`Menu` + `Button` + `IconCodeOutline16`) instead of a plain HTML `<select>` — it looks and behaves exactly like a first-party setting. Client test renders the row through real React (renderToString) with mocked primitives.

## 0.3.11 (2026-08-14)

- `terminal` tool: WSL interactive on the default distro now uses `wsl -- bash -i` (plain `-e` fails under ConPTY with WSL service RPC 0x8007072c); explicit `-d <distro>` keeps `-e`. Verified: pwd -> /mnt/d/WorkSpace.
- CI fixes: wsl argv assertion uses SystemRoot (case-insensitive); client/terminal tests resolve react + node-pty cross-environment (CI installs them no-save); wsl interactive test tolerates environments without a distro.

## 0.3.10 (2026-08-14)

- install.ps1 migrates the profile to the official bundle install (adds `dsh-bash-terminal` to `dsh.profile.bundles` and removes the legacy manual insert), writing package.json without a UTF-8 BOM (PS 5.1 `Set-Content` BOM broke DSH's JSON.parse). Current web profile verified: bundle provides the `tool-bash-terminal` entry via `--dump-config`.

## 0.3.9 (2026-08-14)

- **Official bundle manifest**: the package now declares `dsh.bundle.patch` (ships its own `cordis.patch.yml`); a profile listing `dsh-bash-terminal` in `dsh.profile.bundles` auto-applies the mount — verified via a temp profile + `--dump-config` (entry appears without any manual profile patch).

## 0.3.8 (2026-08-14)

- Test coverage: `shell` background execution registers a job with working `cancel` / `done` / `readOutput` hooks (13 apply/execute cases total).

## 0.3.7 (2026-08-14)

- `terminal` tool: reads now wait for output to settle (quiet for 300ms, cap 5s) instead of a fixed delay, so `send` returns the COMPLETE reply (verified: full multi-line output, e.g. `seq 1 8`).

## 0.3.6 (2026-08-14)

- Test coverage: `terminal` open-with-initial-command (immediate execution in a fresh shell) and the job hooks shape (cancel / done / readOutput) verified against a real node-pty session.

## 0.3.5 (2026-08-14)

- `terminal` tool: buffer overflow is reported (`truncated` flag + "[terminal buffer overflowed; oldest output dropped]" notice) so a busy session never silently loses history.

## 0.3.4 (2026-08-14)

- `terminal` tool: WSL sessions now carry DSH_* environment variables via WSLENV, matching the `shell` tool.

## 0.3.3 (2026-08-14)

- `terminal` tool: new `list` action enumerates live sessions (sessionId / shell / pid) for multi-session management.

## 0.3.2 (2026-08-14)

- Session cap: at most 8 concurrent terminal sessions (fail-fast beyond).
- Multi-backend interactive verification: Git Bash (full), PowerShell 5.1 and wsl.exe documented ConPTY limits (0x8009001d / 0x8007072c; pwsh 7 and one-shot -lc work).
- README (zh/en): interactive-terminal known limits.

## 0.3.1 (2026-08-14)

- Terminal sessions register with the generic jobs registry (jobId on open; `job_kill` / `job_output` work on them).
- Idle timeout: sessions auto-close after 10 minutes without send/read/signal (configurable via `idleMs` on open) so abandoned PTYs never leak process trees.

## 0.3.0 (2026-08-14)

- **Interactive terminal tool (`terminal`)**: persistent PTY sessions over the official `ctx.subprocess.spawnTerminal` seam (node-pty). Actions: `open` / `send` / `read` / `signal` (Ctrl+C etc.) / `close`. Shell state (cwd, variables, aliases) persists across calls; the backend follows the user's default terminal setting. Verified with a real node-pty interactive Git Bash session (cd + pwd + echo + SIGINT + close).

## 0.2.3 (2026-08-14)

- Fail-closed test coverage (unavailable sandbox backend rejects the call).
- README sandbox documentation.
- GitHub Actions CI (unit / apply / client suites on windows-latest).

## 0.2.2 (2026-08-14)

- **Official denial rendering**: a confined call whose stderr matches the runner's denial signatures reports `sandbox.denied: true` and the model-facing output carries the exact official markers — `[sandbox: file access denied under <mode> mode]` plus the same-turn escalation hint.

## 0.2.1 (2026-08-14)

- **Official sandbox-escalation surface**: the `shell` tool now advertises `sandbox_permissions` / `justification` (the exact tool-bash / tool-pwsh contract): a denied call can be retried once with the narrowest wider mode, routed through `ctx.approval` (`approveEscalation`), with strict-widening validation.

## 0.2.0 (2026-08-14)

- **Sandbox integration (official seam)**: the `shell` tool resolves the DSH sandbox policy per call (`ctx.sandboxPolicy`) and confines PowerShell / Git Bash argv through `ctx.sandbox` — the same fail-closed `SandboxUnavailableError` semantics as the shipped executors. WSL runs unconfined (its Linux-VM isolation IS the sandbox). Sandbox facts (`sandbox.mode` / `sandbox.enforcement`) ride on foreground results.
- **Model preference**: the plugin's system-prompt section instructs agents to prefer the `shell` tool over `pwsh` for terminal commands; the tool description leads with the user-chosen default terminal.

## 0.1.0 (2026-08-14)

Initial release.

- `shell` tool: run commands through PowerShell / Git Bash / WSL on Windows.
- Default terminal is chosen by the user in the Web UI settings (Settings -> General -> Default terminal); the model cannot override it.
- Background execution via the generic jobs registry (`run_in_background` / `job_output` / `job_kill`).
- Client plugin registers the settings row; host plugin reads the user setting on every call.
- install.ps1: junction install, cordis.patch.yml mount, and automatic patch of the dsh-host-apiproxy settings allowlist (DSH limitation; see README).
