# dsh-bash-terminal

> Community: [LINUX DO](https://linux.do) · [GitHub](https://github.com/MAXeaglet/dsh-bash-terminal)

A DeepSeek Harness (DSH) plugin: one `shell` tool that runs commands through **PowerShell / Git Bash / MSYS2 / WSL** on Windows, plus an **interactive terminal** tool — all following the terminal **you** choose in the Web UI settings.

![test](https://github.com/MAXeaglet/dsh-bash-terminal/actions/workflows/test.yml/badge.svg)

## Features

| Backend | Runs | Syntax / paths | Env vars |
|---------|------|----------------|----------|
| `powershell` (default) | `pwsh -NoLogo -NoProfile -NonInteractive -Command <cmd>` | PowerShell; `C:\\...` | `$env:NAME` |
| `gitbash` | Git for Windows `bash -lc <cmd>` | POSIX; `/d/WorkSpace`; PATH includes `/usr/bin` and `/mingw64/bin` | `$NAME` |
| `msys2` | MSYS2 `bash -lc <cmd>` (`C:\msys64\usr\bin\bash.exe`, `MSYSTEM=MINGW64`) | POSIX; `/c/...`; PATH includes `/usr/bin` and `/mingw64/bin` | `$NAME` |
| `wsl` | `wsl [-d <distro>] -e bash -lc <cmd>` | Linux; `/mnt/d/...` | `$NAME` (via WSLENV) |

- **User decides, the AI cannot override**: pick the default terminal in Settings -> General -> Default terminal (PowerShell / Git Bash / MSYS2 / WSL). The setting persists through the DSH settings system; the `shell` tool always obeys it.
- **Official sandbox seam**: the `shell` tool resolves the DSH sandbox policy per call and confines PowerShell argv through `ctx.sandbox` — same fail-closed `SandboxUnavailableError` semantics as the shipped executors. Git Bash, MSYS2 and WSL run unconfined: WSL is its own Linux VM, while Git Bash and MSYS2 cannot run under the DSH Windows ACL restricted-token runner (Cygwin/MSYS2 aborts with `CreateFileMapping` Win32 error 5). Official `sandbox_permissions` / `justification` escalation and denial markers included.
- **Interactive terminal**: the `terminal` tool opens persistent real-PTY sessions over node-pty — on non-Windows via the official `ctx.subprocess.spawnTerminal` seam, on Windows directly through node-pty because the upstream seam's process inspector is POSIX-only. Actions `open` / `send` / `read` / `signal` / `close`; shell state persists across calls; sessions are managed as background jobs and auto-close when idle.
- **Background execution** via the generic jobs registry (`run_in_background` / `job_output` / `job_kill`).

## Install

The package ships the official `dsh.bundle` manifest (its own `cordis.patch.yml`): listing `dsh-bash-terminal` in a profile's `dsh.profile.bundles` auto-applies the mount — no manual profile edits.

```powershell
npm install -g dsh-bash-terminal
dsh plugin --profile web add dsh-bash-terminal        # adds to profile bundles + applies the patch
powershell -ExecutionPolicy Bypass -File install.ps1 install   # patches the DSH settings-UI allowlist (see below)
# restart dsh web
```

> **DSH limitation**: the Web settings client only exposes a hard-coded allowlist of settings namespaces (`dsh-host-apiproxy`); third-party settings writes are refused with `settings-not-exposed` otherwise. `install.ps1` patches the allowlist (with a backup) — re-run it after upgrading DSH; `install` / `uninstall` restores it.

For local development (junction install, source changes apply instantly) see the Chinese README's development section.

## Sandbox

- `danger-full-access` sessions run directly (no wrapping).
- Confined sessions wrap PowerShell argv through `ctx.sandbox.confine`; fail-closed when no backend is available.
- Git Bash is never wrapped: the Windows ACL restricted-token runner cannot host Cygwin/MSYS2 (`CreateFileMapping` Win32 error 5); results report `enforcement: gitbash-unconfined`.
- MSYS2 is never wrapped: same Cygwin/MSYS2 runtime as Git Bash, so it cannot start under the Windows ACL restricted-token runner either; results report `enforcement: msys2-unconfined`.
- WSL is never wrapped (its VM isolation is the sandbox; results report `enforcement: wsl-isolation`).
- Denied calls render the official `[sandbox: file access denied under <mode> mode]` marker plus a same-turn escalation hint; the model may retry once with `sandbox_permissions` + `justification` (user-approved via `ctx.approval`).
- Note: when DSH's Windows ACL runner is available, it confines PowerShell; Git Bash and MSYS2 remain unconfined due to the Cygwin/MSYS2 incompatibility.

## Interactive terminal

`terminal` actions: `open` (start a session on the configured default terminal), `send` (write input + read new output), `read`, `signal` (SIGINT = Ctrl+C etc.), `close`, `list` (enumerate live sessions). Reads wait for output to settle (quiet 300ms, cap 5s) so `send` returns the complete reply; buffer overflow reports a `truncated` notice. State (cwd / variables / aliases) persists across calls; end input with `\\n`. Sessions are background jobs (`job_kill` works) and auto-close after 10 idle minutes (`idleMs` overrides on open).

## Interactive terminal known limits (ConPTY)

- **Windows PowerShell 5.1 cannot start in a ConPTY** (0x8009001d) — install [PowerShell 7](https://github.com/PowerShell/PowerShell/releases) for interactive PowerShell (one-shot commands are unaffected).
- **wsl.exe interactive mode may hit a WSL service RPC error under ConPTY** (0x8007072c, intermittent) — one-shot `wsl -e bash -lc ...` works; for interactive WSL prefer a real terminal (Windows Terminal / WSL app) or retry.
- **node-pty accepts no named signals on Windows**: `signal` maps `SIGINT` to Ctrl+C (`\x03`); other signals (`SIGTERM` / `SIGKILL` / `SIGTSTP` / `SIGHUP`) degrade to terminating the session.
- Git Bash interactive sessions work fully.

## Config

Web UI: Settings -> General -> Default terminal. Plugin row `config` overrides: `defaultShell`, `timeoutMs`, `maxTimeoutMs`, `pwshPath`, `gitBashPath`, `msys2Path`, `wslPath`.
- The MSYS2 backend runs `C:\msys64\usr\bin\bash.exe -lc`, **not** `C:\msys64\msys2.exe`: `msys2.exe` is the console-allocating Cygwin launcher, so under piped stdio (exactly how this plugin spawns) it returns exit 0 with **zero bytes** on both streams and the command fails silently. It is therefore kept only as the last-resort entry in the candidate list, behind every `bash.exe`. `-lc` rather than `-c` because only a login shell sources `/etc/profile`, which is what puts `/usr/bin` and `/mingw64/bin` on PATH — with a bare `-c`, `tr`/`sed`/`gcc` are all "command not found".
- The MSYS2 backend injects `MSYSTEM=MINGW64` (an explicit user value wins) so `/etc/profile` selects the MINGW64 environment and `/mingw64/bin` (gcc, make) joins PATH.

## Uninstall

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1 uninstall
```

## Tests

```powershell
node test/unit.mjs && node test/apply.mjs && node test/client.mjs && node test/terminal.mjs
```
