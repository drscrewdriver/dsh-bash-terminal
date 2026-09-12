# Changelog

## 0.3.17 (2026-09-13)

- **MSYS2 成为第 4 个终端后端**（`SHELLS` 顺序 powershell / gitbash / msys2 / wsl）。`Config` 新增 `msys2Path`，经 `resolveAllPaths` 接线；`SHELL_DESCRIPTIONS.msys2` 与 `toolDescription` 同步补上后端说明。
- **MSYS2 设置项补齐（客户端）**: Web UI「默认终端」行此前只有 powershell / gitbash / wsl —— 后端有 MSYS2 而前端选不了。`src/client.tsx` 补上 `msys2` 选项与 `shell.msys2` 双语文案（MSYS2 为专有名词，中英文一致）。
- **MSYS2 管道 stdio 修复**: `C:\msys64\msys2.exe` 是分配控制台的 Cygwin 启动器，在管道 stdio 下以 exit 0 返回零字节（stdout/stderr 均为 0 字节，实测 MSYS2 bash 5.3.15），任何 MSYS2 命令都会静默无输出。候选顺序改为优先 `C:\msys64\usr\bin\bash.exe` → `bin\bash.exe` → PATH 中的 mingw64/msys64 条目，`msys2.exe` 降级为候选列表末尾的兜底项。
- **MSYS2 登录 shell**: `buildArgv` 用 `-lc` 而非 `-c`；只有登录 shell 会 source `/etc/profile`，把 `/usr/bin` 与 `/mingw64/bin` 加进 PATH（裸 `-c` 下 `bash` 会解析到 `C:\Windows\System32\bash.exe`，`gcc`/`make` 全部 command not found）。
- **MSYS2 环境**: `buildEnv` 注入 `MSYSTEM=MINGW64`（用户显式传入的值优先），让 `/mingw64/bin` 的 gcc、make 进入 PATH；`terminal` 工具的交互式会话 env 与之一致。
- **MSYS2 沙箱**: 与 Git Bash 同理不包装（Windows ACL 受限令牌 runner 与 Cygwin/MSYS2 不兼容），结果报告 `enforcement: msys2-unconfined`。
- **交互式终端 env 走 `buildEnv`**: `src/terminal.ts` 原先自己拼一份 env，绕过了 `buildEnv` 里的 MSYSTEM 注入 —— 结果 `shell` 工具正常、msys2 **交互式终端**却拿不到 `/mingw64/bin`（`/etc/profile` 按默认 MSYS 环境配置 PATH）。现改为 `buildEnv(shell, ctx.shellEnv.collect(exec), process.env.WSLENV)`：既拿到 MSYSTEM 注入，也不再重复维护 WSLENV 逻辑。第三个参数必须显式传：`spawnTerminal` 用 `childEnv(spec.env)` 整体替换子进程环境，环境里的 WSLENV 否则不可见。
- **WSL `WSLENV` 改为叠加而非重建**: WSLENV 是 WSL 的跨界白名单，旧代码只用 `dshEnv` 重建它，会丢掉环境里已有的条目（本机 `WSLENV=WT_SESSION:WT_PROFILE_ID:`，Windows Terminal 导出），这些变量将不再进入 WSL。现改为在继承值上叠加：按 `:` 切分后过滤空项（继承值以 `:` 结尾，字符串拼接会产出空条目）、排除 `WSLENV` 键自身（它也是 `dshEnv` 的键，追加会得到 `...:WSLENV`）；调用方显式提供的 WSLENV 优先于继承值。
- **交互式终端**: `terminalArgv("msys2")` 用 `-l`。不能沿用 `-lc`：该 argv 不带命令（PTY 本身即会话），`bash -lc` 无操作数会立即以 `-c: option requires an argument`（exit 2）退出。
- **客户端 bundle 可复现**: `scripts/build-client.mjs` 原先让 esbuild 从 `src/client.tsx` 向上搜索 tsconfig，仓库内构建会命中根 `tsconfig.json` 并多输出一行 `"use strict";`，而仓库外 worktree 构建不会 —— 同一份源码产出两个不同的提交产物。现显式固定 `tsconfigRaw: { compilerOptions: { target: "ES2022", useDefineForClassFields: true } }`（即根 tsconfig 实际生效的值），唯一可观察差异是那行 `"use strict";` 消失。
- **回归防护**: `test/unit.ts` 断言 msys2 的 `-lc` argv、`MSYSTEM` 注入与用户值优先、`bash.exe` 必须排在 `msys2.exe` 之前、`WSLENV` 叠加语义（继承条目保留 / 无空条目 / 不追加 `WSLENV` 自身 / 显式值优先），并加了一条真实 spawn 冒烟断言（stdout 非空且含 `/mingw64/bin/gcc`；0 字节即失败）；`test/apply.ts` 断言 msys2 的 argv/env、`msys2-unconfined` 与 WSLENV 结构；`test/terminal.ts` 断言交互式 argv、PTY env 走 `buildEnv` 的接线，并跑一条**真实 node-pty 的 msys2 会话**（断言 `MSYSTEM=MINGW64`、`/mingw64/bin/gcc`、`BASH=/usr/bin/bash`）；`test/client.ts` 新增漂移守卫——按宿主 `SHELLS` 逐项断言客户端 bundle 的列表与渲染出的菜单项一致（含顺序）且中英文字典都有 `shell.<id>`。上述每条守卫都做过反向对照（改坏构建产物 → 断言失败 → 还原后通过）。

## 0.3.16 (2026-09-12)

- **全量 TypeScript 重写**. 服务端 `lib/index.js` / `lib/terminal.js` → `src/index.ts` / `src/terminal.ts`；客户端 `src/client.jsx` → `src/client.tsx`；测试 `test/*.mjs` → `test/*.ts`（编译到 `test-dist/` 运行）。`tsc --strict` + `noUncheckedIndexedAccess` 全绿。
- 插件自身对 DSH 接缝的契约收敛为手写结构类型（`src/dsh-types.ts`）；peer 包的值导入统一经 `src/dsh.ts` 桥接窄化，peer 版本漂移不再渗入重写代码。
- 构建链：`npm run build` = `tsc`（服务端 → `lib/`）+ `tsc -p tsconfig.client.json`（client 类型检查）+ esbuild（`src/client.tsx` → `lib/client.js` + `dist/client.js`）+ `tsc -p tsconfig.test.json`。`lib/`、`dist/` 产物继续随仓库提交，DSH 按 `lib/index.js` 加载的路径不变。
- 导出面逐字保持（`name` / `inject` / `Config` / `apply` / `SHELLS` / `DEFAULT_SHELL` / `SETTINGS_NAMESPACE` / `internals`），运行时行为与 0.3.15 一致；仅去掉了 terminal.js 末尾一个不可达的 `pathResolve` 死函数与未使用的 `MAX_TIMER_DELAY_MS` 导入。

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
