# dsh-bash-terminal-ts

[![test](https://github.com/drscrewdriver/dsh-bash-terminal-ts/actions/workflows/test.yml/badge.svg)](https://github.com/drscrewdriver/dsh-bash-terminal-ts/actions/workflows/test.yml)

**English** | [日本語](README.ja.md) | [한국어](README.ko.md) | [中文](README.md)

A DSH (DeepSeek Harness) plugin: a single `shell` tool that runs **PowerShell / Git Bash / MSYS2 / WSL** commands through one unified entry point on Windows.

The terminal is **selected by you in the Web UI** — the model cannot change it. Pick one once, and every command from then on runs through it.

## Why use it

| Selling point | In one line |
|------|--------|
| **MSYS2 genuinely works** | This isn't "a new dropdown option" — it gets three things right at once: `bash.exe` resolution, the login shell, and the `MSYSTEM` environment. Pick MSYS2 and `gcc` / `make` just work (see "MSYS2 support" below) |
| **TypeScript source** | `strict` + `noUncheckedIndexedAccess`; pure functions build argv/env and are unit-testable |
| **Targets DSH 0.1.2 as the primary version** | `engines.dsh: >=0.1.2-rc.1 <0.2.0-0`, built against the 0.1.2 `ctx.subprocess` / `ctx.sandbox` / PTY seams |
| **Four terminals, one tool** | A single `shell` tool covers PowerShell / Git Bash / MSYS2 / WSL, so the model never has to learn four parameter sets |
| **Sandbox aligned with the official mechanism** | Uses the official `ctx.sandboxPolicy` + `ctx.sandbox`, fail-closed, and surfaces the same-turn escalation hint when a call is denied |
| **Interactive terminal** | A separate real-PTY session tool: `open / send / read / signal / close`, with Ctrl+C support and state that survives across turns |

## Supported backends

| Backend | What actually runs | Syntax / paths | Environment variables |
|------|----------|-------------|----------|
| `powershell` (default) | `pwsh -NoLogo -NoProfile -NonInteractive -Command <cmd>` | PowerShell; `C:\...` | `$env:NAME` |
| `gitbash` | Git for Windows `bash -lc <cmd>` | POSIX; `/d/WorkSpace`; PATH includes `/usr/bin`, `/mingw64/bin` | `$NAME` |
| `msys2` | `C:\msys64\usr\bin\bash.exe -lc <cmd>` (login shell; `MSYSTEM=MINGW64`) | POSIX; ships a full GCC / mingw64 toolchain | `$NAME` |
| `wsl` | `wsl [-d <distro>] -e bash -lc <cmd>` | Linux; `/mnt/d/...` | `$NAME` (via WSLENV) |

Every call spins up a fresh shell: **no state is preserved** (cwd / variables / aliases) — pass `workdir` instead of using `cd`. Use the interactive terminal tool when you need state to persist across turns.

## MSYS2 support

MSYS2 looks like "just one more backend", but it actually hides three traps, and the plugin handles each one:

**1. You cannot launch `msys2.exe`.**
`C:\msys64\msys2.exe` is a Cygwin launcher that allocates a console window. This plugin spawns processes with piped stdio (the standard DSH approach), and under those conditions it **exits 0 while returning zero bytes of output** — the command fails silently, appearing to "succeed" while doing nothing at all. So the candidate order is `usr\bin\bash.exe` → `bin\bash.exe` → `msys2.exe` as a fallback, and **a usable `bash.exe` always wins**.

**2. `-lc` is not optional.**
Only a login shell reads `/etc/profile`, and only `/etc/profile` adds `/usr/bin` and `/mingw64/bin` to PATH. With a bare `-c`, `tr`, `sed`, and `gcc` all come back as `command not found`.

**3. `MSYSTEM=MINGW64` has to be injected.**
Otherwise `/etc/profile` initializes with the default MSYS environment and the gcc and make in `/mingw64/bin` are unavailable. The plugin injects it through `buildEnv` (**values you set explicitly take precedence**), and the `shell` tool and the interactive terminal share that same `buildEnv` — so you never hit a "works in the tool but not in the terminal" discrepancy.

Verified in practice (real PTY): the prompt changes from `MSYS` to `MINGW64`, and `command -v gcc` → `/mingw64/bin/gcc`.

All three are guarded by regression tests: `test/unit.ts` asserts that `bash.exe` is ordered before `msys2.exe`; `test/apply.ts` asserts that the PTY environment contains `MSYSTEM=MINGW64` and that it does not leak into gitbash.

## Design notes

- **The terminal is the user's decision, and the AI cannot change it**: the Web UI settings page (Settings → General) shows a "Default terminal" dropdown (PowerShell / Git Bash / MSYS2 / WSL); the `shell` tool always uses that setting and never exposes a terminal parameter to the model. The setting persists through the DSH settings system (settings.yaml).
- **It does not take over the `ctx.shell` capability seam**: DSH's built-in sandboxed `pwsh` tool stays available as-is; this plugin's `shell` tool is an **additional** multi-terminal entry point.
- Processes are spawned through the shared `ctx.subprocess` seam: process-tree termination (Windows `taskkill /T`), SIGTERM → grace → SIGKILL, and output spill files, matching the behavior of the official `dsh-tool-bash` / `dsh-tool-pwsh`.
- Background tasks register with the generic `jobs` registry and support `run_in_background` / `job_output` / `job_kill`.
- The tool's `shell` parameter is an enum (the UI renders it as a dropdown), and the model chooses a terminal on each call.
- The `<option>` entries for the four backends in the frontend dropdown, along with the `shell.<id>` strings in both locale bundles, are covered by drift-guard tests — add a backend and forget the copy, and the tests fail immediately.

## Installation

### Standard install (npm)

```powershell
# 1. Install the plugin package
npm install -g dsh-bash-terminal-ts
dsh plugin --profile web add dsh-bash-terminal-ts

# 2. Patch the DSH settings allowlist (a DSH limitation, see the note below; install.ps1 can run this step on its own)
powershell -ExecutionPolicy Bypass -File install.ps1 install

# 3. Restart dsh web
```

### Local development install (junction-linked, source edits take effect immediately)

```powershell
# 1. Link the plugin package into the profile's node_modules (junction, so source edits take effect immediately)
$profile = "$env:USERPROFILE\.dsh\profiles\web"
New-Item -ItemType Junction -Path "$profile\node_modules\dsh-bash-terminal-ts" -Target "D:\WorkSpace\projects\dsh-bash-terminal-ts" | Out-Null

# 2. Let the plugin resolve its @deepseek-ai/* dependencies (junction into the profile's dependency tree)
New-Item -ItemType Junction -Path "D:\WorkSpace\projects\dsh-bash-terminal-ts\node_modules\@deepseek-ai" -Target "$profile\..\node_modules\@deepseek-ai" | Out-Null

# 3. Append the mount line to cordis.patch.yml (see the patch snippet below)
# 4. (Only after changing frontend source) rebuild the client bundle:
#    cd D:\WorkSpace\projects\dsh-bash-terminal-ts && node scripts/build-client.mjs
# 5. Let the settings UI accept this plugin's settings writes (a DSH limitation, see the note below)
# 6. Restart dsh web
```

> **DSH settings UI allowlist limitation**: DSH's api-gateway (dsh-host-apiproxy) enforces a
> **hardcoded allowlist** of the settings namespaces exposed to the Web settings client
> (third-party plugin settings are rejected with `settings-not-exposed` by default, so
> changes made in the UI silently do nothing).
> install.ps1 patches that allowlist automatically (adding `bash-terminal`, after backing up
> the original file). **You must re-run install.ps1 after upgrading DSH** to restore the
> patch. On uninstall, install.ps1 reverts it.

Add to `cordis.patch.yml`:

```yaml
- insert:
    - id: tool-bash-terminal
      name: 'dsh-bash-terminal-ts'
```

Verify the composition tree (no restart required):

```powershell
node "$env:APPDATA\nvm\v24.16.0\node_modules\@deepseek-ai\dsh\lib\bin.js" --profile web --dump-config | Select-String dsh-bash-terminal-ts
```

## Usage

**The user sets the default terminal in the Web UI**: open Settings (gear icon) → General → the "Default terminal" dropdown, and choose one of PowerShell / Git Bash / MSYS2 / WSL. The change takes effect immediately and is persisted.

Once the model sees the `shell` tool, it automatically runs commands through the terminal you selected (the tool exposes no terminal parameter, so the model cannot override your choice):

- Default terminal = Git Bash: `shell(command: "git status")` runs through Git Bash
- Default terminal = MSYS2: `shell(command: "gcc --version")` runs through MSYS2 (login shell, PATH includes `/usr/bin` and `/mingw64/bin`, with a full GCC / mingw64 toolchain)
- Default terminal = WSL: `shell(command: "ls -la /mnt/d/WorkSpace")` runs through WSL; pass `distro: "Ubuntu"` to target a specific distribution
- Default terminal = PowerShell: `shell(command: "Get-Process node")` runs through PowerShell

## Configuration

**Web UI settings** (recommended): Settings → General → "Default terminal".

The plugin row's `config` (overrides the defaults and forms the composition baseline for the setting):

| Key | Default | Description |
|----|------|------|
| `defaultShell` | `powershell` | The backend used when the setting does not override it |
| `timeoutMs` | 120000 | Default timeout |
| `maxTimeoutMs` | 600000 | Upper bound for a caller-supplied timeoutMs |
| `pwshPath` | auto-detected | Pin the pwsh.exe path |
| `gitBashPath` | auto-detected | Pin the git bash.exe path |
| `msys2Path` | auto-detected | Pin the MSYS2 entry path (must point at `bash.exe`, not `msys2.exe`; see "MSYS2 support") |
| `wslPath` | auto-detected | Pin the wsl.exe path |

## Uninstall

```powershell
Remove-Item "$env:USERPROFILE\.dsh\profiles\web\node_modules\dsh-bash-terminal-ts" -Force
# Then delete the insert block from cordis.patch.yml and restart dsh web
```

## Sandbox (official mechanism integration)

The `shell` tool goes through DSH's official sandbox seams (`ctx.sandboxPolicy` + `ctx.sandbox`):

- Every call resolves the current sandbox policy; `danger-full-access` sessions execute directly (unwrapped).
- The PowerShell / Git Bash / MSYS2 backends wrap argv through `ctx.sandbox.confine` — with the same **fail-closed** semantics as the official executor: requesting a confined mode with no backend available throws `SandboxUnavailableError` rather than falling back to an unconfined run.
- The WSL backend is not wrapped: a WSL instance is its own isolated Linux VM (results report `enforcement: wsl-isolation`).
- When a confined mode denies the call, the result carries the official marker `[sandbox: file access denied under <mode> mode]` along with the same-turn escalation hint; the model can request a single escalation using `sandbox_permissions` + `justification` (approved by the user through `ctx.approval`), exactly as with the official bash/pwsh tools.
- Note: DSH's Windows ACL sandbox launcher (`node-addon-landlock-run-win32-x64`) is not published to npm yet, so the native sandbox backend is currently unavailable; the architecture is ready and activates automatically once DSH ships it.

## ⚠️ Security notes

Commands run by the `shell` tool **outside the DSH sandbox**, with the same privileges as the dsh process
(equivalent to full-access command execution), and they do not benefit from the `pwsh` tool's
ConstrainedLanguage restrictions. DSH's file operation tools (read/write/edit) remain bound by the file sandbox.
Use this only in sessions you trust; when you need sandbox-protected PowerShell, keep using the official `pwsh` tool.

## Known limitations

- The plugin only registers its tool on the `win32` platform.
- A WSL background process may briefly linger inside the distribution after a timeout or interruption (the WSL instance shuts down automatically once its last process exits).
- Git Bash and MSYS2 are both msys2 environments, so their behavior differs from WSL's Linux behavior (path mapping, package availability).
- If `C:\msys64` is installed in a non-default location and is not on PATH, `msys2Path` must be configured explicitly.

## Testing

```powershell
git clone https://github.com/drscrewdriver/dsh-bash-terminal-ts.git
cd dsh-bash-terminal-ts
npm install          # install dependencies (including typescript)
npm run build        # tsc compiles src/*.ts → lib/*.js; client.tsx → dist/client.js; test/*.ts → test-dist/
npm test             # node test-dist/unit.js → apply.js → client.js
```

CI runs the same suite on `windows-latest` (`.github/workflows/test.yml`).

## Technical implementation

The source is TypeScript (`strict` + `noUncheckedIndexedAccess`), and the compiled artifacts `lib/` and `dist/` are committed alongside the repository, so DSH loads `lib/index.js` directly and the plugin **works without a build step**.

All require-side dependencies (13 packages, `@deepseek-ai/*` and friends) are declared as `peerDependencies` + `peerDependenciesMeta.optional`, avoiding a duplicate install alongside the host's own copies.

## Credits

This project evolves from [MAXeaglet/dsh-bash-terminal](https://github.com/MAXeaglet/dsh-bash-terminal) — the original `shell` tool, the three-backend PowerShell / Git Bash / WSL architecture, and the sandbox seam integration all come from the original author, MAXeaglet. This version builds on that work by adding the MSYS2 backend, a TypeScript rewrite, and DSH 0.1.2 support.

## License

MIT
