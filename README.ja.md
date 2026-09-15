# dsh-bash-terminal-ts

[![test](https://github.com/drscrewdriver/dsh-bash-terminal-ts/actions/workflows/test.yml/badge.svg)](https://github.com/drscrewdriver/dsh-bash-terminal-ts/actions/workflows/test.yml)

[English](README.en.md) | **日本語** | [한국어](README.ko.md) | [中文](README.md)

DSH（DeepSeek Harness）プラグイン：Windows 上で **PowerShell / Git Bash / MSYS2 / WSL** の 4 種類のターミナルコマンドを 1 つの `shell` ツールに統合して実行します。

ターミナルは**あなたが Web UI で選びます**。モデルは変更できません。一度選べば、以降のすべてのコマンドはそのターミナルで実行されます。

## なぜ使うのか

| 売り | ひとことで |
|------|--------|
| **MSYS2 が本当に動く** | 「ドロップダウンの選択肢を 1 つ足した」だけではありません。`bash.exe` の解決、ログインシェル、`MSYSTEM` 環境という 3 点をすべて正しく処理しています —— MSYS2 を選べばそのまま `gcc` や `make` が使えます（後述の「MSYS2 サポート」参照） |
| **TypeScript ソース** | `strict` + `noUncheckedIndexedAccess`。argv / env の構築は純関数が担当するため単体テスト可能です |
| **DSH 0.1.2 を主対象** | `engines.dsh: >=0.1.2-rc.1 <0.2.0-0`。0.1.2 の `ctx.subprocess` / `ctx.sandbox` / PTY の接合部に合わせて構築しています |
| **4 種類のターミナルを 1 つのツールで** | 同じ `shell` ツールが PowerShell / Git Bash / MSYS2 / WSL をカバーするので、モデルは 4 通りもの引数を覚える必要がありません |
| **サンドボックスは公式準拠** | 公式の `ctx.sandboxPolicy` + `ctx.sandbox` を使用し、fail-closed。拒否時には同一ターン内での昇格案内を返します |
| **対話型ターミナル** | 本物の PTY セッションツールも用意しています：`open / send / read / signal / close`。Ctrl+C が使え、ターンをまたいで状態を保持します |

## 対応バックエンド

| バックエンド | 実際の実行 | 構文 / パス | 環境変数 |
|------|----------|-------------|----------|
| `powershell`（デフォルト） | `pwsh -NoLogo -NoProfile -NonInteractive -Command <cmd>` | PowerShell；`C:\...` | `$env:NAME` |
| `gitbash` | Git for Windows `bash -lc <cmd>` | POSIX；`/d/WorkSpace`；PATH に `/usr/bin`、`/mingw64/bin` を含む | `$NAME` |
| `msys2` | `C:\msys64\usr\bin\bash.exe -lc <cmd>`（ログインシェル；`MSYSTEM=MINGW64`） | POSIX；完全な GCC / mingw64 ツールチェーンを同梱 | `$NAME` |
| `wsl` | `wsl [-d <distro>] -e bash -lc <cmd>` | Linux；`/mnt/d/...` | `$NAME`（WSLENV 経由） |

呼び出しごとにまったく新しいシェルが起動します：**状態は保持されません**（cwd / 変数 / エイリアス）。`cd` ではなく `workdir` を渡してください。ターンをまたいで状態を保持したい場合は対話型ターミナルツールを使ってください。

## MSYS2 サポート

MSYS2 は「バックエンドをもう 1 つ足すだけ」に見えますが、実際には 3 つの落とし穴があり、本プラグインはそれを 1 つずつ処理しています。

**1. `msys2.exe` は起動できません。**
`C:\msys64\msys2.exe` はコンソールウィンドウを割り当てる Cygwin ランチャーです。本プラグインはパイプ stdio で spawn しますが（これが DSH の標準方式です）、その場合これは **exit 0 でゼロバイトの出力を返します** —— コマンドは静かに失敗し、「成功」したように見えて実際には何も行われません。したがって候補の順序は `usr\bin\bash.exe` → `bin\bash.exe` → `msys2.exe` のフォールバックとなり、**利用可能な `bash.exe` が常に優先されます**。

**2. `-lc` は省略できません。**
`/etc/profile` を読むのはログインシェルだけで、`/usr/bin` と `/mingw64/bin` を PATH に追加するのも `/etc/profile` だけです。裸の `-c` を使うと `tr`、`sed`、`gcc` がすべて `command not found` になります。

**3. `MSYSTEM=MINGW64` を注入する必要があります。**
そうしないと `/etc/profile` がデフォルトの MSYS 環境として初期化され、`/mingw64/bin` にある gcc や make が使えません。本プラグインは `buildEnv` 経由で注入します（**あなたが明示的に設定した値が優先されます**）。また `shell` ツールと対話型ターミナルは同じ `buildEnv` を通るため、「ツールでは動くのにターミナルでは動かない」といったずれは発生しません。

実測（本物の PTY）：プロンプトが `MSYS` から `MINGW64` に変わり、`command -v gcc` → `/mingw64/bin/gcc` となります。

これら 3 点はすべて回帰テストで守られています。`test/unit.ts` は `bash.exe` が `msys2.exe` より前に並ぶことを断言し、`test/apply.ts` は PTY 環境に `MSYSTEM=MINGW64` が含まれ、かつ gitbash に漏れないことを断言します。

## 設計上の要点

- **ターミナルはユーザーが決め、AI は変更できない**：Web UI の設定画面（設定 → 一般）に「デフォルトターミナル」ドロップダウン（PowerShell / Git Bash / MSYS2 / WSL）が表示されます。`shell` ツールは常にこの設定のみを使用し、モデルにターミナル引数を公開しません。設定は DSH settings システム（settings.yaml）で永続化されます。
- **`ctx.shell` 能力の接合部を占有しない**：DSH 標準のサンドボックス化された `pwsh` ツールはそのまま利用可能です。本プラグインの `shell` ツールは**追加の**マルチターミナル入口です。
- 共有された `ctx.subprocess` seam を通じてプロセスを派生させます：プロセスツリーの終了（Windows `taskkill /T`）、SIGTERM→grace→SIGKILL、出力の spill ファイル。公式の `dsh-tool-bash` / `dsh-tool-pwsh` と同じ挙動です。
- バックグラウンドタスクは共通の `jobs` registry に登録され、`run_in_background` / `job_output` / `job_kill` をサポートします。
- ツール引数 `shell` は列挙型です（UI ではドロップダウンとして自動レンダリングされます）。モデルは呼び出しごとにターミナルを自身で選択します。
- 4 つのバックエンドについて、フロントエンドのドロップダウン内の `<option>` と 2 つの言語パックの `shell.<id>` 文言には drift ガードテストがあります —— バックエンドを追加して文言の更新を忘れると、テストがそのまま失敗します。

## インストール

### 標準インストール（npm）

```powershell
# 1. プラグインパッケージをインストール
npm install -g dsh-bash-terminal-ts
dsh plugin --profile web add dsh-bash-terminal-ts

# 2. DSH 設定のホワイトリストを patch（DSH 側の制限。下記の説明を参照。install.ps1 でこの手順だけを単独実行することもできます）
powershell -ExecutionPolicy Bypass -File install.ps1 install

# 3. dsh web を再起動
```

### ローカル開発インストール（junction 直結、ソース変更が即時反映）

```powershell
# 1. プラグインパッケージを profile の node_modules にリンク（junction なのでソース変更が即時反映されます）
$profile = "$env:USERPROFILE\.dsh\profiles\web"
New-Item -ItemType Junction -Path "$profile\node_modules\dsh-bash-terminal-ts" -Target "D:\WorkSpace\projects\dsh-bash-terminal-ts" | Out-Null

# 2. プラグインが @deepseek-ai/* 依存を解決できるようにする（profile の依存ツリーへ junction）
New-Item -ItemType Junction -Path "D:\WorkSpace\projects\dsh-bash-terminal-ts\node_modules\@deepseek-ai" -Target "$profile\..\node_modules\@deepseek-ai" | Out-Null

# 3. cordis.patch.yml にマウント行を追記（下記の patch 断片を参照）
# 4. （フロントエンドのソースを変更した場合のみ）client bundle を再ビルド:
#    cd D:\WorkSpace\projects\dsh-bash-terminal-ts && node scripts/build-client.mjs
# 5. 設定 UI が本プラグインの設定書き込みを受け付けるようにする（DSH 側の制限。下記の説明を参照）
# 6. dsh web を再起動
```

> **DSH 設定 UI のホワイトリスト制限**：DSH の api-gateway（dsh-host-apiproxy）は、
> Web 設定クライアントに公開する settings namespace について**ハードコードされた
> ホワイトリスト**を持っています（サードパーティ製プラグインの設定はデフォルトで
> `settings-not-exposed` として拒否され、UI で変更しても反映されません）。
> install.ps1 はこのホワイトリストを自動で patch します（`bash-terminal` を追加し、
> 元のファイルは先にバックアップされます）。
> **DSH をアップグレードした後は install.ps1 を再実行して** patch を復元してください。アンインストール時には install.ps1 が元に戻します。

`cordis.patch.yml` への追記：

```yaml
- insert:
    - id: tool-bash-terminal
      name: 'dsh-bash-terminal-ts'
```

組み立てツリーの検証（再起動不要）：

```powershell
node "$env:APPDATA\nvm\v24.16.0\node_modules\@deepseek-ai\dsh\lib\bin.js" --profile web --dump-config | Select-String dsh-bash-terminal-ts
```

## 使い方

**ユーザーは Web UI でデフォルトターミナルを設定します**：設定（歯車）→ 一般 →「デフォルトターミナル」ドロップダウンから、PowerShell / Git Bash / MSYS2 / WSL のいずれかを選びます。変更は即時反映され、永続化されます。

モデルは `shell` ツールを認識すると、コマンド実行時にあなたが選んだターミナルを自動的に使用します（ツールはターミナル引数を公開しないため、モデルはあなたの選択を変更できません）。

- デフォルトターミナル = Git Bash の場合：`shell(command: "git status")` は Git Bash を通ります
- デフォルトターミナル = MSYS2 の場合：`shell(command: "gcc --version")` は MSYS2 を通ります（ログインシェルで、PATH に `/usr/bin` と `/mingw64/bin` を含み、完全な GCC / mingw64 ツールチェーンを同梱）
- デフォルトターミナル = WSL の場合：`shell(command: "ls -la /mnt/d/WorkSpace")` は WSL を通ります。`distro: "Ubuntu"` を渡すとディストリビューションを指定できます
- デフォルトターミナル = PowerShell の場合：`shell(command: "Get-Process node")` は PowerShell を通ります

## 設定

**Web UI 設定**（推奨）：設定 → 一般 →「デフォルトターミナル」。

プラグイン row の `config`（デフォルトを上書きし、設定の composition の基準となります）：

| キー | デフォルト | 説明 |
|----|------|------|
| `defaultShell` | `powershell` | 設定で上書きされていない場合のバックエンド |
| `timeoutMs` | 120000 | デフォルトのタイムアウト |
| `maxTimeoutMs` | 600000 | 呼び出し側 timeoutMs の上限 |
| `pwshPath` | 自動検出 | pwsh.exe のパスを固定 |
| `gitBashPath` | 自動検出 | git bash.exe のパスを固定 |
| `msys2Path` | 自動検出 | MSYS2 入口パスを固定（`bash.exe` を指す必要があり、`msys2.exe` を指してはいけません。「MSYS2 サポート」参照） |
| `wslPath` | 自動検出 | wsl.exe のパスを固定 |

## アンインストール

```powershell
Remove-Item "$env:USERPROFILE\.dsh\profiles\web\node_modules\dsh-bash-terminal-ts" -Force
# あわせて cordis.patch.yml から insert ブロックを削除し、dsh web を再起動します
```

## サンドボックス（公式機構との接続）

`shell` ツールは DSH 公式のサンドボックス接合部（`ctx.sandboxPolicy` + `ctx.sandbox`）を通ります：

- 呼び出しごとに現在のサンドボックス方針を解決します。`danger-full-access` のセッションではそのまま実行されます（ラップしません）。
- PowerShell / Git Bash / MSYS2 の各バックエンドは `ctx.sandbox.confine` を通じて argv をラップします —— 公式 executor と同じ **fail-closed** の意味論です：制限モードを要求したのに利用可能なバックエンドがない場合は `SandboxUnavailableError` を投げ、ラップなしの実行を拒否します。
- WSL バックエンドはラップしません：WSL の独立した Linux 仮想マシン自体が隔離であるためです（結果は `enforcement: wsl-isolation` を報告します）。
- 制限モードでサンドボックスに拒否された場合、結果には公式のマーカー `[sandbox: file access denied under <mode> mode]` と同一ターン内での昇格案内が付与されます。モデルは `sandbox_permissions` + `justification` によって 1 回の昇格を申請できます（`ctx.approval` を通じたユーザー承認を経由）。公式の bash/pwsh ツールと完全に同じです。
- 注意：DSH の Windows ACL サンドボックス launcher（`node-addon-landlock-run-win32-x64`）は現在まだ npm で公開されていないため、本機のサンドボックスバックエンドは当面利用できません。アーキテクチャはすでに整っており、DSH の公開後には自動的に有効になります。

## ⚠️ セキュリティに関する注意

`shell` ツールのコマンドは**DSH サンドボックスの外側**で実行され、dsh プロセスと同じ権限を持ちます（完全アクセスのコマンド実行に相当します）。
`pwsh` ツールの ConstrainedLanguage 制限は適用されません。DSH のファイル操作ツール（read/write/edit）は引き続きファイルサンドボックスの制約を受けます。
信頼できるセッションでのみ使用してください。サンドボックスで保護された PowerShell が必要な場合は、引き続き公式の `pwsh` ツールを使用してください。

## 既知の制限

- 本プラグインは `win32` プラットフォームでのみツールを登録します。
- WSL のバックグラウンドプロセスは、タイムアウトや中断の後、ディストリビューション内に一時的に残ることがあります（WSL インスタンスは最後のプロセスが終了した時点で自動的に終了します）。
- Git Bash と MSYS2 はどちらも msys2 環境であり、WSL の Linux とは挙動に差があります（パスマッピング、パッケージの可用性）。
- `C:\msys64` がデフォルト以外の場所にインストールされていて PATH 上にない場合は、`msys2Path` を明示的に設定する必要があります。

## テスト

```powershell
git clone https://github.com/drscrewdriver/dsh-bash-terminal-ts.git
cd dsh-bash-terminal-ts
npm install          # 依存をインストール（typescript を含む）
npm run build        # tsc でコンパイル src/*.ts → lib/*.js；client.tsx → dist/client.js；test/*.ts → test-dist/
npm test             # node test-dist/unit.js → apply.js → client.js
```

CI は `windows-latest` 上で同じ一式を実行します（`.github/workflows/test.yml`）。

## 技術実装

ソースは TypeScript（`strict` + `noUncheckedIndexedAccess`）で、コンパイル成果物 `lib/`、`dist/` はリポジトリにコミットされています。DSH は `lib/index.js` をそのまま読み込むため、**インストール不要で使用できます**。

require 側の依存（`@deepseek-ai/*` など 13 パッケージ）はすべて `peerDependencies` + `peerDependenciesMeta.optional` として宣言し、ホストが同梱するコピーとの重複インストールを避けています。

## 謝辞

本プロジェクトは [MAXeaglet/dsh-bash-terminal](https://github.com/MAXeaglet/dsh-bash-terminal) を基に発展させたものです —— オリジナルの `shell` ツール、PowerShell / Git Bash / WSL の 3 バックエンド構成、およびサンドボックス接合部との接続はいずれも原作者によるものです。本バージョンではこれに MSYS2 バックエンド、TypeScript への書き直し、DSH 0.1.2 への適合を加えています。

## ライセンス

MIT
