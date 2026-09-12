# Changelog

## 0.2.5 (2026-09-12)

- **MSYS2 设置项修复**: MSYS2 此前只加进了服务端，Web UI 的「默认终端」下拉从没出现过它 —— 后端支持而前端选不了。`src/client.tsx` 补上 `msys2` 选项与 `shell.msys2` 双语文案（顺序 powershell / gitbash / msys2 / wsl）。
- **MSYS2 管道 stdio 修复（后端原本也不可用）**: `C:\msys64\msys2.exe` 是分配控制台窗口的 Cygwin 启动器，在管道 stdio 下以 exit 0 返回零字节输出，任何 MSYS2 命令都会静默失败。改为优先解析 `C:\msys64\usr\bin\bash.exe`，并把 `msys2.exe` 降级为候选列表末尾的兜底项。
- **MSYS2 登录 shell**: argv 由 `-c` 改为 `-lc`；只有登录 shell 会 source `/etc/profile` 把 `/usr/bin` 与 `/mingw64/bin` 加进 PATH，裸 `-c` 下 `tr`/`sed`/`gcc` 都是 command not found。
- **MSYS2 环境**: `buildEnv` 注入 `MSYSTEM=MINGW64`（用户显式设置优先），让 `/mingw64/bin` 的 gcc、make 等进入 PATH。
- **回归防护**: `test/client.ts` 新增漂移守卫 —— 用 `SHELLS` 逐项断言每个后端在 dist/client.js 里都有 `<option>`、且中英文字典都有 `shell.<id>`；`test/unit.ts` 断言 `bash.exe` 必须排在 `msys2.exe` 之前。
- **交互终端补齐 MSYSTEM**: `src/terminal.ts` 原本自己内联拼装 PTY 环境变量，绕过了 `buildEnv` 的 `MSYSTEM=MINGW64` 注入 —— 结果是 `shell` 工具正常，但 `terminal` 的 MSYS2 会话在 `/etc/profile` 里落回默认 MSYS 环境，`/mingw64/bin`（gcc、make）不在 PATH 上。改为统一走 `buildEnv`。真实 PTY 实测提示符由 `MSYS` 变为 `MINGW64`，`command -v gcc` 解析到 `/mingw64/bin/gcc`。`test/apply.ts` 新增断言（PTY spec 的 env 必须含 `MSYSTEM=MINGW64`、argv[0] 必须是 `bash.exe`、且 MSYSTEM 不得泄漏到 gitbash），并做了反向验证：把内联 env 改回去后该断言确实失败。
- **构建可复现**: `scripts/build-client.mjs` 显式 pin `tsconfigRaw`，不再让 esbuild 向上查找 tsconfig。此前在仓库内构建会捡到根 `tsconfig.json` 而多输出一行 `"use strict";`，在仓库外 worktree 构建则没有 —— 同一份源码产出两种产物。pin 后行为不变，仅去掉那行多余的 `"use strict";`。
- **WSL 的 WSLENV 不再被重建**: `buildEnv` 之前只从 `dshEnv` 构造 `WSLENV`，而 `WSLENV` 是 WSL 的**白名单** —— 重建等于把环境里已有的条目静默丢弃。本机 `WSLENV=WT_SESSION:WT_PROFILE_ID:`（Windows Terminal 导出），原实现会让这两个变量再也进不了 WSL。改为在继承值之上追加 DSH_* 键，并做 split/规范化（Windows Terminal 的值以 `:` 结尾，直接拼接会产生空条目 `A:B::DSH_X`）；调用方显式传入的 `WSLENV` 优先；`WSLENV` 自身不再被列为待转发键。PTY 路径经 DSH `spawnTerminal` 会整包替换子进程环境，故显式把继承值传进去。`test/unit.ts` 补断言并做反向验证（去掉继承处理后断言失败）。

## 0.2.4 (2026-09-12)

- **全量 TypeScript 重写**. 服务端 lib/index.js / lib/terminal.js → src/index.ts / src/terminal.ts；客户端 src/client.jsx → src/client.tsx；测试 test/*.mjs → test/*.ts（编译到 test-dist/ 运行）。tsc strict + noUncheckedIndexedAccess 全绿。
- DSH 接缝契约收敛为手写结构类型（src/dsh-types.ts），peer 包值导入统一经 src/dsh.ts 桥接窄化，peer 版本漂移不再渗入重写代码。
- 构建链：npm run build = tsc（服务端 → lib/）+ tsc -p tsconfig.client.json（类型检查）+ esbuild（src/client.tsx → dist/client.js）+ tsc -p tsconfig.test.json。lib/、dist/ 产物继续随仓库提交。
- 导出面与运行时行为同 0.2.3 保持一致；client 测试里硬编码的本机 profile 路径改为 os.homedir() 探测。

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
