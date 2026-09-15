# dsh-bash-terminal-ts

[![test](https://github.com/drscrewdriver/dsh-bash-terminal-ts/actions/workflows/test.yml/badge.svg)](https://github.com/drscrewdriver/dsh-bash-terminal-ts/actions/workflows/test.yml)

[English](README.en.md) | [日本語](README.ja.md) | **한국어** | [中文](README.md)

DSH(DeepSeek Harness) 플러그인: Windows에서 **PowerShell / Git Bash / MSYS2 / WSL** 네 가지 터미널 명령을 하나의 `shell` 도구로 통합 실행합니다.

터미널은 **Web UI에서 직접 선택**하며, 모델은 바꿀 수 없습니다. 한 번 선택하면 이후 모든 명령이 선택한 터미널로 실행됩니다.

## 왜 사용해야 할까요

| 장점 | 한 줄 요약 |
|------|--------|
| **MSYS2가 실제로 동작합니다** | 단순히 "드롭다운 항목을 하나 추가한" 것이 아니라 `bash.exe` 해석, 로그인 셸, `MSYSTEM` 환경이라는 세 가지를 모두 제대로 처리했습니다 —— MSYS2를 선택하면 `gcc`, `make`를 바로 쓸 수 있습니다(아래 "MSYS2 지원" 참고) |
| **TypeScript 소스** | `strict` + `noUncheckedIndexedAccess` 적용, argv/env 구성은 순수 함수가 담당하므로 단위 테스트가 가능합니다 |
| **DSH 0.1.2를 주 버전으로 지원** | `engines.dsh: >=0.1.2-rc.1 <0.2.0-0`이며, 0.1.2의 `ctx.subprocess` / `ctx.sandbox` / PTY 접점에 맞춰 구축했습니다 |
| **네 가지 터미널을 하나의 도구로** | 동일한 `shell` 도구가 PowerShell / Git Bash / MSYS2 / WSL을 모두 지원하므로 모델이 네 가지 파라미터 체계를 익힐 필요가 없습니다 |
| **공식 샌드박스와 정렬** | 공식 `ctx.sandboxPolicy` + `ctx.sandbox`를 사용하고 fail-closed로 동작하며, 거부 시 같은 턴에 승격 안내를 제공합니다 |
| **대화형 터미널** | 실제 PTY 세션 도구를 별도로 제공합니다: `open / send / read / signal / close`, Ctrl+C 사용 가능, 턴 간 상태 유지 |

## 지원하는 백엔드

| 백엔드 | 실제 실행 | 문법 / 경로 | 환경 변수 |
|------|----------|-------------|----------|
| `powershell`(기본) | `pwsh -NoLogo -NoProfile -NonInteractive -Command <cmd>` | PowerShell; `C:\...` | `$env:NAME` |
| `gitbash` | Git for Windows `bash -lc <cmd>` | POSIX; `/d/WorkSpace`; PATH에 `/usr/bin`, `/mingw64/bin` 포함 | `$NAME` |
| `msys2` | `C:\msys64\usr\bin\bash.exe -lc <cmd>`(로그인 셸; `MSYSTEM=MINGW64`) | POSIX; 완전한 GCC / mingw64 툴체인 내장 | `$NAME` |
| `wsl` | `wsl [-d <distro>] -e bash -lc <cmd>` | Linux; `/mnt/d/...` | `$NAME`(WSLENV 경유) |

호출할 때마다 완전히 새로운 셸을 시작하며 **상태를 유지하지 않습니다**(cwd / 변수 / 별칭) —— `cd` 대신 `workdir`를 전달하세요. 턴 간에 상태를 유지해야 한다면 대화형 터미널 도구를 사용하세요.

## MSYS2 지원

MSYS2는 얼핏 "백엔드를 하나 더 추가하는 것"처럼 보이지만 실제로는 세 가지 함정이 있고, 플러그인이 이를 하나씩 처리했습니다.

**1. `msys2.exe`는 실행할 수 없습니다.**
`C:\msys64\msys2.exe`는 콘솔 창을 할당하는 Cygwin 런처입니다. 이 플러그인은 파이프 stdio로 spawn하는데(DSH의 표준 방식), 이때 이 런처는 **exit 0을 반환하면서 출력은 0바이트**입니다 —— 명령이 조용히 실패하므로 "성공"한 것처럼 보이지만 아무 일도 하지 않습니다. 그래서 후보 순서는 `usr\bin\bash.exe` → `bin\bash.exe` → `msys2.exe` 폴백이며, **사용 가능한 `bash.exe`가 항상 우선**입니다.

**2. `-lc`는 생략할 수 없습니다.**
로그인 셸만 `/etc/profile`을 읽고, `/etc/profile`만 `/usr/bin`과 `/mingw64/bin`을 PATH에 추가합니다. 순수 `-c`를 쓰면 `tr`, `sed`, `gcc`가 전부 `command not found`가 됩니다.

**3. `MSYSTEM=MINGW64`를 주입해야 합니다.**
그렇지 않으면 `/etc/profile`이 기본 MSYS 환경으로 초기화되어 `/mingw64/bin`의 gcc, make를 사용할 수 없습니다. 플러그인은 `buildEnv`를 통해 주입하며(**명시적으로 설정한 값이 우선**), `shell` 도구와 대화형 터미널이 동일한 `buildEnv`를 사용하므로 "도구는 되는데 터미널은 안 되는" 편차가 생기지 않습니다.

실측(실제 PTY): 프롬프트가 `MSYS`에서 `MINGW64`로 바뀌고, `command -v gcc` → `/mingw64/bin/gcc`.

이 세 가지는 모두 회귀 테스트가 지키고 있습니다: `test/unit.ts`는 `bash.exe`가 `msys2.exe`보다 앞에 오는지 검증하고, `test/apply.ts`는 PTY 환경에 `MSYSTEM=MINGW64`가 포함되고 이것이 gitbash로 누출되지 않는지 검증합니다.

## 설계 포인트

- **터미널은 사용자가 정하고 AI는 바꿀 수 없습니다**: Web UI 설정 페이지(설정 → 일반)에 "기본 터미널" 드롭다운(PowerShell / Git Bash / MSYS2 / WSL)이 나타나며, `shell` 도구는 항상 이 설정만 사용하고 터미널 파라미터를 모델에 노출하지 않습니다. 설정은 DSH settings 시스템을 통해 영구 저장됩니다(settings.yaml).
- **`ctx.shell` 능력 접점을 점유하지 않습니다**: DSH에 내장된 샌드박스 `pwsh` 도구는 그대로 사용할 수 있으며, 이 플러그인의 `shell` 도구는 **추가적인** 멀티 터미널 진입점입니다.
- 공유 `ctx.subprocess` seam을 통해 프로세스를 생성합니다: 프로세스 트리 종료(Windows `taskkill /T`), SIGTERM→grace→SIGKILL, 출력 spill 파일 등이 공식 `dsh-tool-bash` / `dsh-tool-pwsh`와 동일하게 동작합니다.
- 백그라운드 작업은 공용 `jobs` registry에 등록되며 `run_in_background` / `job_output` / `job_kill`을 지원합니다.
- 도구 파라미터 `shell`은 열거형이고(UI가 자동으로 드롭다운으로 렌더링), 모델이 호출할 때마다 터미널을 직접 선택합니다.
- 네 가지 백엔드의 프런트엔드 드롭다운 `<option>`과 두 언어 팩의 `shell.<id>` 문구에는 drift 가드 테스트가 있어, 백엔드를 추가하고 문구를 고치지 않으면 테스트가 바로 실패합니다.

## 설치

### 표준 설치(npm)

```powershell
# 1. 플러그인 패키지 설치
npm install -g dsh-bash-terminal-ts
dsh plugin --profile web add dsh-bash-terminal-ts

# 2. DSH 설정 화이트리스트 패치 (DSH 제약, 아래 설명 참조; install.ps1로 이 단계만 따로 실행 가능)
powershell -ExecutionPolicy Bypass -File install.ps1 install

# 3. dsh web 재시작
```

### 로컬 개발 설치(junction 직접 연결, 소스 수정 즉시 반영)

```powershell
# 1. 플러그인 패키지를 profile의 node_modules에 연결 (junction, 소스 수정 즉시 반영)
$profile = "$env:USERPROFILE\.dsh\profiles\web"
New-Item -ItemType Junction -Path "$profile\node_modules\dsh-bash-terminal-ts" -Target "D:\WorkSpace\projects\dsh-bash-terminal-ts" | Out-Null

# 2. 플러그인이 @deepseek-ai/* 의존성을 해석하도록 연결 (profile 의존성 트리로 junction)
New-Item -ItemType Junction -Path "D:\WorkSpace\projects\dsh-bash-terminal-ts\node_modules\@deepseek-ai" -Target "$profile\..\node_modules\@deepseek-ai" | Out-Null

# 3. cordis.patch.yml에 마운트 행 추가 (아래 patch 조각 참조)
# 4. (프런트엔드 소스를 수정한 경우에만) client bundle 재빌드:
#    cd D:\WorkSpace\projects\dsh-bash-terminal-ts && node scripts/build-client.mjs
# 5. 설정 UI가 이 플러그인의 설정 쓰기를 받아들이도록 처리 (DSH 제약, 아래 설명 참조)
# 6. dsh web 재시작
```

> **DSH 설정 UI 화이트리스트 제한**: DSH의 api-gateway(dsh-host-apiproxy)는
> Web 설정 클라이언트에 노출하는 settings namespace에 **하드코딩된 화이트리스트**를
> 둡니다(서드파티 플러그인의 설정은 기본적으로 `settings-not-exposed`로 거부되어 UI에서 바꿔도 반영되지 않습니다).
> install.ps1이 이 화이트리스트를 자동으로 patch합니다(`bash-terminal` 추가, 원본 파일은 먼저 백업).
> **DSH를 업그레이드한 뒤에는 install.ps1을 다시 실행해 patch를 복원해야 합니다.** 제거 시 install.ps1이 원래대로 되돌립니다.

`cordis.patch.yml` 추가:

```yaml
- insert:
    - id: tool-bash-terminal
      name: 'dsh-bash-terminal-ts'
```

조합 트리 검증(재시작 불필요):

```powershell
node "$env:APPDATA\nvm\v24.16.0\node_modules\@deepseek-ai\dsh\lib\bin.js" --profile web --dump-config | Select-String dsh-bash-terminal-ts
```

## 사용

**사용자가 Web UI에서 기본 터미널을 설정합니다**: 설정(톱니바퀴) → 일반 → "기본 터미널" 드롭다운에서 PowerShell / Git Bash / MSYS2 / WSL 중 하나를 선택합니다. 변경 사항은 즉시 반영되고 영구 저장됩니다.

모델은 `shell` 도구를 인식하면 명령을 실행할 때 자동으로 선택한 터미널을 사용합니다(도구가 터미널 파라미터를 노출하지 않으므로 모델이 선택을 바꿀 수 없습니다):

- 기본 터미널 = Git Bash일 때: `shell(command: "git status")`는 Git Bash로 실행
- 기본 터미널 = MSYS2일 때: `shell(command: "gcc --version")`은 MSYS2로 실행(로그인 셸, PATH에 `/usr/bin`과 `/mingw64/bin` 포함, 완전한 GCC / mingw64 툴체인 내장)
- 기본 터미널 = WSL일 때: `shell(command: "ls -la /mnt/d/WorkSpace")`는 WSL로 실행되며, `distro: "Ubuntu"`를 전달해 배포판을 지정할 수 있습니다
- 기본 터미널 = PowerShell일 때: `shell(command: "Get-Process node")`는 PowerShell로 실행

## 설정

**Web UI 설정**(권장): 설정 → 일반 → "기본 터미널".

플러그인 row의 `config`(기본값을 덮어쓰며, 설정의 composition 기준이 됩니다):

| 키 | 기본값 | 설명 |
|----|------|------|
| `defaultShell` | `powershell` | 설정이 덮어쓰지 않았을 때의 백엔드 |
| `timeoutMs` | 120000 | 기본 타임아웃 |
| `maxTimeoutMs` | 600000 | 호출자 timeoutMs 상한 |
| `pwshPath` | 자동 감지 | pwsh.exe 경로 고정 |
| `gitBashPath` | 자동 감지 | git bash.exe 경로 고정 |
| `msys2Path` | 자동 감지 | MSYS2 진입 경로 고정(`bash.exe`를 가리켜야 하며 `msys2.exe`를 가리키면 안 됩니다. "MSYS2 지원" 참고) |
| `wslPath` | 자동 감지 | wsl.exe 경로 고정 |

## 제거

```powershell
Remove-Item "$env:USERPROFILE\.dsh\profiles\web\node_modules\dsh-bash-terminal-ts" -Force
# 그리고 cordis.patch.yml에서 insert 블록을 삭제하고 dsh web 재시작
```

## 샌드박스(공식 메커니즘 연동)

`shell` 도구는 DSH 공식 샌드박스 접점(`ctx.sandboxPolicy` + `ctx.sandbox`)을 사용합니다:

- 호출할 때마다 현재 샌드박스 정책을 해석하며, `danger-full-access` 세션은 래핑 없이 직접 실행합니다.
- PowerShell / Git Bash / MSYS2 백엔드는 `ctx.sandbox.confine`으로 argv를 래핑합니다 —— 공식 executor와 동일한 **fail-closed** 의미론으로, 제한 모드를 요청했지만 사용할 수 있는 백엔드가 없으면 `SandboxUnavailableError`를 던지고 그대로 실행하는 것을 거부합니다.
- WSL 백엔드는 래핑하지 않습니다: WSL은 그 자체가 독립적인 Linux 가상 머신이므로 격리로 간주합니다(결과에 `enforcement: wsl-isolation`으로 보고).
- 제한 모드에서 샌드박스가 거부하면 결과에 공식 마커 `[sandbox: file access denied under <mode> mode]`와 같은 턴의 승격 안내가 함께 담깁니다. 모델은 `sandbox_permissions` + `justification`으로 한 번의 승격을 요청할 수 있으며(`ctx.approval` 사용자 승인 경유), 공식 bash/pwsh 도구와 완전히 동일합니다.
- 참고: DSH의 Windows ACL 샌드박스 launcher(`node-addon-landlock-run-win32-x64`)는 현재 npm에 아직 게시되지 않아 이 머신에서는 샌드박스 백엔드를 사용할 수 없습니다. 아키텍처는 이미 준비되어 있으므로 DSH가 게시되면 자동으로 적용됩니다.

## ⚠️ 보안 안내

`shell` 도구의 명령은 **DSH 샌드박스 밖에서** 실행되며 dsh 프로세스와 동일한 권한을 가집니다(완전 접근 명령 실행과 동일).
`pwsh` 도구의 ConstrainedLanguage 제한을 받지 않습니다. DSH의 파일 작업 도구(read/write/edit)는 여전히 파일 샌드박스의 제약을 받습니다.
신뢰할 수 있는 세션에서만 사용하세요. 샌드박스 보호가 필요한 PowerShell이 필요하다면 공식 `pwsh` 도구를 계속 사용하세요.

## 알려진 제한 사항

- 이 플러그인은 `win32` 플랫폼에서만 도구를 등록합니다.
- WSL 백그라운드 프로세스는 타임아웃/중단 후 배포판 안에 잠시 남아 있을 수 있습니다(WSL 인스턴스는 마지막 프로세스가 종료되면 자동으로 닫힙니다).
- Git Bash와 MSYS2는 모두 msys2 환경이므로 WSL의 Linux 동작과 차이가 있습니다(경로 매핑, 패키지 가용성).
- `C:\msys64`가 기본 위치가 아닌 곳에 설치되어 있고 PATH에 없다면 `msys2Path`를 명시적으로 설정해야 합니다.

## 테스트

```powershell
git clone https://github.com/drscrewdriver/dsh-bash-terminal-ts.git
cd dsh-bash-terminal-ts
npm install          # 의존성 설치 (typescript 포함)
npm run build        # tsc 컴파일 src/*.ts → lib/*.js; client.tsx → dist/client.js; test/*.ts → test-dist/
npm test             # node test-dist/unit.js → apply.js → client.js
```

CI는 `windows-latest`에서 동일한 세트를 실행합니다(`.github/workflows/test.yml`).

## 기술 구현

실행 요구사항: **Node.js 22+ (24 권장)**, DSH 0.1.2+.

소스는 TypeScript(`strict` + `noUncheckedIndexedAccess`)이며, 컴파일 산출물 `lib/`, `dist/`는 저장소에 함께 커밋되어 DSH가 `lib/index.js`로 바로 로드하므로 **설치 없이 사용할 수 있습니다**.

require 측 의존성(`@deepseek-ai/*` 등 13개 패키지)은 모두 `peerDependencies` + `peerDependenciesMeta.optional`로 선언하여 호스트에 내장된 사본과 중복 설치되는 것을 피했습니다.

## 감사의 글

이 프로젝트는 [MAXeaglet/dsh-bash-terminal](https://github.com/MAXeaglet/dsh-bash-terminal)을 기반으로 발전시킨 것입니다 —— 원래의 `shell` 도구와 PowerShell / Git Bash / WSL 3백엔드 아키텍처, 샌드박스 접점 연동은 모두 원작자 MAXeaglet의 것입니다. 이 버전은 그 위에 MSYS2 백엔드, TypeScript 재작성, DSH 0.1.2 대응을 추가했습니다.

## 라이선스

MIT
