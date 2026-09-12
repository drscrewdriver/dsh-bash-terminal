# Changelog

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
