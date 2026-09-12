# Changelog

## 0.2.5 (2026-09-13)

- **交互式 `terminal` 工具改用共享 `buildEnv`**：`lib/terminal.js` 原先内联拼装 PTY 环境（`{ NO_COLOR, TERM, PAGER, GIT_PAGER, ...ctx.shellEnv.collect() }`），绕过了 `buildEnv` 的 `MSYSTEM=MINGW64` 注入，于是 msys2 交互会话以默认 MSYS 环境 source `/etc/profile`——`shell` 工具能用 `gcc`/`make`，`terminal` 里 `/mingw64/bin` 却不在 PATH 上。现在 PTY 环境同样走 `buildEnv(shell, ctx.shellEnv.collect(exec))`，登录旗标不变。真实 PTY 已验证：提示符从 `MSYS` 变为 `MINGW64 ~`，`MSYSTEM=MINGW64` 与 `/mingw64/bin/gcc` 均成立。
- **构建可复现**：`scripts/build-client.mjs` 显式固定 `tsconfigRaw: { compilerOptions: { target: "ES2022", useDefineForClassFields: true } }`（即仓库根 tsconfig 原本提供的值），不再让 esbuild 从入口向上搜索 tsconfig——此前仓库内构建会继承根 `tsconfig.json` 并在 bundle 前面多出一行 `"use strict";`，而仓库外 worktree 用同一份源码构建则没有，同一源码产出两种已提交产物。唯一可见差异是那行多余 `"use strict";`（惰性：core 被 loader 包装进函数表达式，本就不是指令序言）。固定后重新构建的输出与本分支已提交的 bundle 逐字节一致。
- **修正 MSYS2 后端（分支上 4637975 引入的实现在管道 stdio 下静默空跑）**：原实现把 `C:\msys64\msys2.exe` 作为首选可执行文件并用 `-c` 执行。`msys2.exe` 是分配控制台的 Cygwin 启动器，管道 stdio 下对任何命令都返回 exit 0 且 stdout/stderr 各 0 字节（在 MSYS2 bash 5.3.15 上实测）——看着成功、实际什么都没跑。现在候选顺序是 `C:\msys64\usr\bin\bash.exe` → `C:\msys64\bin\bash.exe` → PATH 派生项，`msys2.exe` 仅作为文档化的最后兜底；`buildArgv("msys2")` 改用 `-lc`（登录 shell 才会 source `/etc/profile`，这才是把 `/usr/bin` 与 `/mingw64/bin` 放进 PATH 的东西；裸 `-c` 下 `tr`/`sed`/`gcc` 全部 command not found）。
- `buildEnv("msys2", ...)` 注入 `MSYSTEM=MINGW64`（用户显式传值优先），让 `/mingw64/bin`（gcc、make 等）进入 PATH；仅对 msys2 生效。
- `SHELL_DESCRIPTIONS.msys2` 改为描述 `MSYS2 bash -lc <command>`，不再宣传 `msys2.exe -c`。
- 客户端「默认终端」设置行补上 MSYS2 选项（此前服务端有、UI 里选不到），中英词典各加 `shell.msys2: "MSYS2"`。
- 测试：`buildArgv("msys2")` 断言 `-lc`、`buildEnv` 断言 `MSYSTEM=MINGW64` 且显式值优先、候选列表中每个 `bash.exe` 必须排在 `msys2.exe` 之前、解析结果必须落在 `bash.exe`、apply 用例覆盖 msys2 的 argv/env 以及「`terminal` 工具 PTY 环境必须带 `MSYSTEM=MINGW64`」的断言，client 用例新增「宿主 `SHELLS` 与客户端选项顺序 + 双语词典 + 描述」一致性漂移守卫；`test/client.mjs` 不再硬编码作者机器的 profile 路径，改为先在项目 `node_modules` 解析、失败再回退 profile。

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
