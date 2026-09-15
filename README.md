# dsh-bash-terminal-ts

[![test](https://github.com/drscrewdriver/dsh-bash-terminal-ts/actions/workflows/test.yml/badge.svg)](https://github.com/drscrewdriver/dsh-bash-terminal-ts/actions/workflows/test.yml)

[English](README.en.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | **中文**

DSH（DeepSeek Harness）插件：一个 `shell` 工具，在 Windows 上统一执行 **PowerShell / Git Bash / MSYS2 / WSL** 四种终端命令。

终端由**你在 Web UI 里选**，模型不能改。选一次，之后所有命令都按你选的终端跑。

## 为什么用它

| 卖点 | 一句话 |
|------|--------|
| **MSYS2 真的能用** | 不是"加了个下拉选项"，而是把 `bash.exe` 解析、登录 shell、`MSYSTEM` 环境三件事都做对了 —— 选 MSYS2 就能直接 `gcc`、`make`（见下方「MSYS2 支持」） |
| **TypeScript 源码** | `strict` + `noUncheckedIndexedAccess`；纯函数负责 argv/env 构造，可单测 |
| **以 DSH 0.1.2 为主版** | `engines.dsh: >=0.1.2-rc.1 <0.2.0-0`，随 0.1.2 的 `ctx.subprocess` / `ctx.sandbox` / PTY 接缝构建 |
| **四种终端一个工具** | 同一套 `shell` 工具覆盖 PowerShell / Git Bash / MSYS2 / WSL，模型不用学四套参数 |
| **沙箱对齐官方** | 走官方 `ctx.sandboxPolicy` + `ctx.sandbox`，fail-closed，拒绝时给出同轮升级提示 |
| **交互式终端** | 另有真 PTY 会话工具：`open / send / read / signal / close`，可 Ctrl+C，跨轮保持状态 |

## 支持的后端

| 后端 | 实际执行 | 语法 / 路径 | 环境变量 |
|------|----------|-------------|----------|
| `powershell`（默认） | `pwsh -NoLogo -NoProfile -NonInteractive -Command <cmd>` | PowerShell；`C:\...` | `$env:NAME` |
| `gitbash` | Git for Windows `bash -lc <cmd>` | POSIX；`/d/WorkSpace`；PATH 含 `/usr/bin`、`/mingw64/bin` | `$NAME` |
| `msys2` | `C:\msys64\usr\bin\bash.exe -lc <cmd>`（登录 shell；`MSYSTEM=MINGW64`） | POSIX；自带完整 GCC / mingw64 工具链 | `$NAME` |
| `wsl` | `wsl [-d <distro>] -e bash -lc <cmd>` | Linux；`/mnt/d/...` | `$NAME`（经 WSLENV） |

每次调用都启动全新 shell：**不保留状态**（cwd / 变量 / 别名）—— 请传 `workdir` 而不是用 `cd`。需要跨轮保持状态时用交互式终端工具。

## MSYS2 支持

MSYS2 看着只是"再加一个后端"，实际有三个坑，插件逐个处理了：

**1. 不能启动 `msys2.exe`。**
`C:\msys64\msys2.exe` 是分配控制台窗口的 Cygwin 启动器。本插件用管道 stdio spawn（这是 DSH 的标准方式），此时它会 **exit 0 返回零字节输出** —— 命令静默失败，看起来"成功"了但什么都没做。所以候选顺序是：`usr\bin\bash.exe` → `bin\bash.exe` → `msys2.exe` 兜底，**可用的 `bash.exe` 永远优先**。

**2. `-lc` 不能省。**
只有登录 shell 会读 `/etc/profile`，而只有 `/etc/profile` 会把 `/usr/bin` 与 `/mingw64/bin` 加进 PATH。用裸 `-c` 的话 `tr`、`sed`、`gcc` 全是 `command not found`。

**3. 要注入 `MSYSTEM=MINGW64`。**
否则 `/etc/profile` 按默认 MSYS 环境初始化，`/mingw64/bin` 里的 gcc、make 不可用。插件经 `buildEnv` 注入（**你显式设置的值优先**），并且 `shell` 工具与交互式终端走的是同一个 `buildEnv` —— 不会出现"工具能跑、终端不能跑"的偏差。

实测（真 PTY）：prompt 从 `MSYS` 变成 `MINGW64`，`command -v gcc` → `/mingw64/bin/gcc`。

这三条都有回归测试守着：`test/unit.ts` 断言 `bash.exe` 排在 `msys2.exe` 之前；`test/apply.ts` 断言 PTY 环境含 `MSYSTEM=MINGW64`，且不会泄漏到 gitbash。

## 设计要点

- **终端由用户决定，AI 无法更改**：Web UI 设置页（设置 → 通用）出现"默认终端"下拉（PowerShell / Git Bash / MSYS2 / WSL）；`shell` 工具永远只使用该设置，不暴露终端参数给模型。设置通过 DSH settings 系统持久化（settings.yaml）。
- **不占用 `ctx.shell` 能力接缝**：DSH 自带的沙箱化 `pwsh` 工具保持原样可用；本插件的 `shell` 工具是**额外的**多终端入口。
- 通过共享的 `ctx.subprocess` seam 派生进程：进程树终止（Windows `taskkill /T`）、SIGTERM→grace→SIGKILL、输出 spill 文件，与官方 `dsh-tool-bash` / `dsh-tool-pwsh` 行为一致。
- 后台任务注册进通用 `jobs` registry，支持 `run_in_background` / `job_output` / `job_kill`。
- 工具参数 `shell` 是枚举（UI 自动渲染为下拉），模型每次调用自行选择终端。
- 四种后端在前端下拉里的 `<option>`、以及两种语言包里的 `shell.<id>` 文案，都有 drift 守卫测试 —— 加后端忘了改文案会直接测试失败。

## 安装

### 标准安装（npm）

```powershell
# 1. 安装插件包
npm install -g dsh-bash-terminal-ts
dsh plugin --profile web add dsh-bash-terminal-ts

# 2. patch DSH 设置白名单（DSH 限制，见下方说明；install.ps1 可单独执行此步）
powershell -ExecutionPolicy Bypass -File install.ps1 install

# 3. 重启 dsh web
```

### 本地开发安装（junction 直连，改源码即时生效）

```powershell
# 1. 链接插件包到 profile 的 node_modules（junction，改源码即时生效）
$profile = "$env:USERPROFILE\.dsh\profiles\web"
New-Item -ItemType Junction -Path "$profile\node_modules\dsh-bash-terminal-ts" -Target "D:\WorkSpace\projects\dsh-bash-terminal-ts" | Out-Null

# 2. 让插件能解析 @deepseek-ai/* 依赖（junction 到 profile 的依赖树）
New-Item -ItemType Junction -Path "D:\WorkSpace\projects\dsh-bash-terminal-ts\node_modules\@deepseek-ai" -Target "$profile\..\node_modules\@deepseek-ai" | Out-Null

# 3. 在 cordis.patch.yml 追加挂载行（见下方 patch 片段）
# 4. （仅修改前端源码后）重新打包 client bundle:
#    cd D:\WorkSpace\projects\dsh-bash-terminal-ts && node scripts/build-client.mjs
# 5. 让设置 UI 接受本插件的设置写入（DSH 限制，见下方说明）
# 6. 重启 dsh web
```

> **DSH 设置 UI 白名单限制**：DSH 的 api-gateway（dsh-host-apiproxy）对
> Web 设置客户端暴露的 settings namespace 有**硬编码白名单**（第三方插件
> 的设置默认会被 `settings-not-exposed` 拒绝，UI 里改了不生效）。
> install.ps1 会自动 patch 该白名单（加入 `bash-terminal`，先备份原文件）。
> **升级 DSH 后需重新运行 install.ps1** 恢复 patch。卸载时 install.ps1 会还原。

`cordis.patch.yml` 追加：

```yaml
- insert:
    - id: tool-bash-terminal
      name: 'dsh-bash-terminal-ts'
```

验证组合树（无需重启）：

```powershell
node "$env:APPDATA\nvm\v24.16.0\node_modules\@deepseek-ai\dsh\lib\bin.js" --profile web --dump-config | Select-String dsh-bash-terminal-ts
```

## 使用

**用户在 Web UI 设置默认终端**：打开设置（齿轮）→ 通用 →「默认终端」下拉，选择 PowerShell / Git Bash / MSYS2 / WSL 之一。改动即时生效并持久化。

模型看到 `shell` 工具后，执行命令时自动使用你选择的终端（工具不暴露终端参数，模型无法更改你的选择）：

- 默认终端 = Git Bash 时：`shell(command: "git status")` 走 Git Bash
- 默认终端 = MSYS2 时：`shell(command: "gcc --version")` 走 MSYS2（登录 shell，PATH 含 `/usr/bin` 与 `/mingw64/bin`，自带完整 GCC / mingw64 工具链）
- 默认终端 = WSL 时：`shell(command: "ls -la /mnt/d/WorkSpace")` 走 WSL；传 `distro: "Ubuntu"` 可指定发行版
- 默认终端 = PowerShell 时：`shell(command: "Get-Process node")` 走 PowerShell

## 配置

**Web UI 设置**（推荐）：设置 → 通用 →「默认终端」。

插件 row 的 `config`（覆盖默认，作为设置的 composition 基准）：

| 键 | 默认 | 说明 |
|----|------|------|
| `defaultShell` | `powershell` | 设置未覆盖时的后端 |
| `timeoutMs` | 120000 | 默认超时 |
| `maxTimeoutMs` | 600000 | 调用方 timeoutMs 上限 |
| `pwshPath` | 自动探测 | 固定 pwsh.exe 路径 |
| `gitBashPath` | 自动探测 | 固定 git bash.exe 路径 |
| `msys2Path` | 自动探测 | 固定 MSYS2 入口路径（需指向 `bash.exe`，不要指向 `msys2.exe`；见「MSYS2 支持」） |
| `wslPath` | 自动探测 | 固定 wsl.exe 路径 |

## 卸载

```powershell
Remove-Item "$env:USERPROFILE\.dsh\profiles\web\node_modules\dsh-bash-terminal-ts" -Force
# 并从 cordis.patch.yml 删掉 insert 块，重启 dsh web
```

## 沙箱（官方机制对接）

`shell` 工具走 DSH 官方沙箱接缝（`ctx.sandboxPolicy` + `ctx.sandbox`）：

- 每次调用解析当前沙箱策略；`danger-full-access` 会话直接执行（不包装）。
- PowerShell / Git Bash / MSYS2 后端经 `ctx.sandbox.confine` 包装 argv —— 与官方 executor 相同的 **fail-closed** 语义：请求受限模式但无可用后端时抛 `SandboxUnavailableError`，拒绝裸跑。
- WSL 后端不包装：WSL 独立 Linux 虚拟机本身就是隔离（结果报告 `enforcement: wsl-isolation`）。
- 受限模式下被沙箱拒绝时，结果携带官方标记 `[sandbox: file access denied under <mode> mode]` 与同轮升级提示；模型可凭 `sandbox_permissions` + `justification` 发起一次升级（经 `ctx.approval` 用户审批），与官方 bash/pwsh 工具完全一致。
- 注意：DSH 的 Windows ACL 沙箱 launcher（`node-addon-landlock-run-win32-x64`）当前尚未在 npm 发布，本机沙箱后端暂不可用；架构已就绪，DSH 发布后自动生效。

## ⚠️ 安全说明

`shell` 工具的命令**在 DSH 沙箱之外**运行，与 dsh 进程同权限（等同完整访问的命令执行），
不享受 `pwsh` 工具的 ConstrainedLanguage 限制。DSH 的文件操作工具（read/write/edit）仍受文件沙箱约束。
仅在你信任的会话中使用；需要受沙箱保护的 PowerShell 时请继续使用官方 `pwsh` 工具。

## 已知限制

- 本插件仅在 `win32` 平台注册工具。
- WSL 后台进程在超时/中断后可能在发行版内短暂残留（WSL 实例在最后一个进程退出后自动关闭）。
- Git Bash 与 MSYS2 都是 msys2 环境，与 WSL 的 Linux 行为存在差异（路径映射、包可用性）。
- 若 `C:\msys64` 装在非默认位置且不在 PATH 上，需显式配置 `msys2Path`。

## 测试

```powershell
git clone https://github.com/drscrewdriver/dsh-bash-terminal-ts.git
cd dsh-bash-terminal-ts
npm install          # 安装依赖（含 typescript）
npm run build        # tsc 编译 src/*.ts → lib/*.js；client.tsx → dist/client.js；test/*.ts → test-dist/
npm test             # node test-dist/unit.js → apply.js → client.js
```

CI 在 `windows-latest` 上跑同一套（`.github/workflows/test.yml`）。

## 技术实现

运行要求：**Node.js 22+（推荐 24）**，DSH 0.1.2+。

源码为 TypeScript（`strict` + `noUncheckedIndexedAccess`），编译产物 `lib/`、`dist/` 随仓库提交，DSH 直接按 `lib/index.js` 加载，**无需安装即可使用**。

require 侧依赖（`@deepseek-ai/*` 等 13 个包）全部声明为 `peerDependencies` + `peerDependenciesMeta.optional`，避免与宿主自带的副本重复安装。

## 致谢

本项目基于 [MAXeaglet/dsh-bash-terminal](https://github.com/MAXeaglet/dsh-bash-terminal) 演进 —— 原始的 `shell` 工具、PowerShell / Git Bash / WSL 三后端架构与沙箱接缝对接均来自原作者。本版在此基础上加入 MSYS2 后端、TypeScript 重写与 DSH 0.1.2 适配。

## License

MIT
