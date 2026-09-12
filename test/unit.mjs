
import { buildArgv, buildEnv, candidateGitBashPaths, candidateMsys2Paths, candidatePwshPaths, internals, SHELLS } from "../lib/index.js";
const { renderResult, resolveAllPaths, validateArgs, toolDescription, SHELL_DESCRIPTIONS } = internals;
import assert from "node:assert";

const paths = { pwsh: "C:\\pwsh.exe", gitbash: "C:\\Git\\bin\\bash.exe", msys2: "C:\\msys64\\usr\\bin\\bash.exe", wsl: "C:\\Windows\\System32\\wsl.exe" };
assert.deepStrictEqual(buildArgv("powershell", "echo hi", paths), ["C:\\pwsh.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "echo hi"]);
assert.deepStrictEqual(buildArgv("gitbash", "ls", paths), ["C:\\Git\\bin\\bash.exe", "-lc", "ls"]);
// msys2 must use -lc: a login shell is what sources /etc/profile and puts
// /usr/bin + /mingw64/bin on PATH. With a bare -c every coreutil is missing.
assert.deepStrictEqual(buildArgv("msys2", "make all", paths), ["C:\\msys64\\usr\\bin\\bash.exe", "-lc", "make all"]);
assert.deepStrictEqual(buildArgv("wsl", "pwd", paths, undefined), ["C:\\Windows\\System32\\wsl.exe", "-e", "bash", "-lc", "pwd"]);
assert.deepStrictEqual(buildArgv("wsl", "pwd", paths, "Ubuntu"), ["C:\\Windows\\System32\\wsl.exe", "-d", "Ubuntu", "-e", "bash", "-lc", "pwd"]);
assert.throws(() => buildArgv("fish", "x", paths));

const env = buildEnv("gitbash", { DSH_WEB_URL: "http://127.0.0.1:3080" });
assert.strictEqual(env.DSH_WEB_URL, "http://127.0.0.1:3080");
assert.strictEqual(env.NO_COLOR, "1");
// MSYS2 needs MSYSTEM so /etc/profile selects the MINGW64 toolchain.
assert.strictEqual(buildEnv("msys2", undefined).MSYSTEM, "MINGW64");
assert.strictEqual(buildEnv("msys2", { MSYSTEM: "CLANG64" }).MSYSTEM, "CLANG64", "explicit MSYSTEM wins");
assert.strictEqual(buildEnv("gitbash", undefined).MSYSTEM, undefined, "MSYSTEM only set for msys2");
const wslEnv = buildEnv("wsl", { DSH_WEB_URL: "http://x", DSH_TEST: "1" });
assert.ok(wslEnv.WSLENV.includes("DSH_WEB_URL"));
assert.ok(wslEnv.WSLENV.includes("DSH_TEST"));
assert.strictEqual(buildEnv("wsl", undefined).WSLENV, undefined);

// ---- WSLENV layering --------------------------------------------------------
// WSLENV normally already exists for unrelated reasons (Windows Terminal exports
// "WT_SESSION:WT_PROFILE_ID:"). The DSH keys must be LAYERED onto that inherited
// allow-list, never replace it, or every WSL call cuts WT's vars off. The
// inherited value is passed explicitly so these assertions do not depend on the
// ambient environment (this host really does have WSLENV set).
const layered = buildEnv("wsl", { DSH_WEB_URL: "http://x" }, "WT_SESSION:WT_PROFILE_ID:");
assert.ok(layered.WSLENV.includes("WT_SESSION") && layered.WSLENV.includes("WT_PROFILE_ID"),
  "inherited WSLENV entries preserved: " + JSON.stringify(layered.WSLENV));
assert.ok(layered.WSLENV.includes("DSH_WEB_URL"), "DSH key appended to the inherited list: " + JSON.stringify(layered.WSLENV));
// Exact shape: the inherited trailing ":" must not become a malformed empty entry.
assert.strictEqual(layered.WSLENV, "WT_SESSION:WT_PROFILE_ID:DSH_WEB_URL");
// An explicit caller-supplied WSLENV wins over the inherited one.
assert.strictEqual(buildEnv("wsl", { WSLENV: "CALLER_ONLY", DSH_WEB_URL: "http://x" }, "WT_SESSION:").WSLENV,
  "CALLER_ONLY:DSH_WEB_URL", "explicit caller WSLENV wins and is not duplicated");
// WSLENV is a key of dshEnv and must not itself be appended as a crossed var.
assert.ok(!buildEnv("wsl", { WSLENV: "CALLER_ONLY" }, undefined).WSLENV.split(":").includes("WSLENV"),
  "WSLENV is not appended to itself");
// No WSLENV for the other backends.
assert.strictEqual(buildEnv("gitbash", { DSH_WEB_URL: "http://x" }, "WT_SESSION:").WSLENV, undefined, "no WSLENV for gitbash");
assert.strictEqual(buildEnv("msys2", { DSH_WEB_URL: "http://x" }, "WT_SESSION:").WSLENV, undefined, "no WSLENV for msys2");
// The third argument is explicit throughout, so nothing here reads the ambient
// host WSLENV (this machine really has one set). An empty inherited list means
// the DSH key is simply the whole list.
assert.strictEqual(buildEnv("wsl", { DSH_WEB_URL: "http://x" }, "").WSLENV, "DSH_WEB_URL", "empty inherited list yields just the DSH key");
// Omitting the argument falls back to the default parameter (the ambient
// process.env.WSLENV), so assert the shape instead of a host-specific literal.
const ambient = buildEnv("wsl", { DSH_WEB_URL: "http://x" }, undefined).WSLENV;
assert.ok(ambient.endsWith("DSH_WEB_URL"), "DSH key appended to the ambient inherited list: " + JSON.stringify(ambient));
if (typeof process.env.WSLENV === "string" && process.env.WSLENV.length > 0) {
  assert.strictEqual(ambient, buildEnv("wsl", { DSH_WEB_URL: "http://x" }, process.env.WSLENV).WSLENV,
    "omitted argument inherits process.env.WSLENV");
}

assert.strictEqual(renderResult({ stdout: { text: "hello", truncated: false }, stderr: { text: "", truncated: false }, exitCode: 0, signal: null, timedOut: false, timeoutMs: 1000 }), "hello");
assert.ok(renderResult({ stdout: { text: "out", truncated: false }, stderr: { text: "err", truncated: false }, exitCode: 3, signal: null, timedOut: false, timeoutMs: 1000 }).includes("[stderr]"));
assert.ok(renderResult({ stdout: { text: "out", truncated: false }, stderr: { text: "", truncated: false }, exitCode: 3, signal: null, timedOut: false, timeoutMs: 1000 }).includes("[exit code: 3]"));
assert.ok(renderResult({ stdout: { text: "", truncated: false }, stderr: { text: "", truncated: false }, exitCode: 0, signal: null, timedOut: true, timeoutMs: 5000 }).includes("[timed out after 5000ms]"));

const real = resolveAllPaths({}, process.env);
console.log("resolved paths:", JSON.stringify(real));
assert.ok(real.pwsh, "pwsh should resolve");
assert.ok(real.gitbash && real.gitbash.toLowerCase().includes("git"), "gitbash should resolve: " + real.gitbash);
assert.ok(real.wsl, "wsl should resolve");
assert.ok(real.msys2, "msys2 should resolve: " + real.msys2);
// The resolved msys2 backend must be a real bash.exe: msys2.exe is the
// console-allocating Cygwin launcher (exit 0, zero bytes on piped stdio).
assert.ok(real.msys2.toLowerCase().endsWith("bash.exe"), "resolved msys2 backend must be bash.exe, not msys2.exe: " + real.msys2);

const cgb = candidateGitBashPaths({ ...process.env, PATH: "C:\\Windows\\System32;C:\\Program Files\\Git\\bin" });
assert.ok(!cgb.some((p) => p.toLowerCase().includes("system32")), "system32 bash excluded");

const cms = candidateMsys2Paths({ ...process.env, PATH: "C:\\msys64\\usr\\bin;C:\\mingw64\\bin" });
assert.ok(cms.some((p) => p.toLowerCase().includes("msys64")), "msys64 paths included");
// msys2.exe is a piped-stdio dead end (exit 0, no output), so a real bash.exe
// must always outrank it.
const bashIdx = cms.findIndex((p) => p.toLowerCase().endsWith("bash.exe"));
const exeIdx = cms.findIndex((p) => p.toLowerCase().endsWith("msys2.exe"));
assert.ok(bashIdx !== -1, "a bash.exe candidate exists");
assert.ok(exeIdx === -1 || bashIdx < exeIdx, `bash.exe must precede msys2.exe (bash=${bashIdx}, exe=${exeIdx})`);
// Every bash.exe candidate, not just the first, must outrank msys2.exe.
const lastBash = cms.map((p) => p.toLowerCase().endsWith("bash.exe")).lastIndexOf(true);
assert.ok(exeIdx === -1 || lastBash < exeIdx, `every bash.exe must precede msys2.exe (lastBash=${lastBash}, exe=${exeIdx})`);

validateArgs({ command: "ls", description: "list" });
assert.throws(() => validateArgs({ command: "  ", description: "x" }));
// shell is user-settings controlled: a stale shell arg must be tolerated
validateArgs({ command: "ls", description: "x", shell: "fish" });
assert.throws(() => validateArgs({ command: "ls", description: "x", timeoutMs: -5 }));

// ---- backend-aware tool description -----------------------------------------

// Every backend is covered by its own lead sentence.
assert.deepStrictEqual(Object.keys(SHELL_DESCRIPTIONS).sort(), ["gitbash", "msys2", "powershell", "wsl"]);

// gitbash -> bash-flavored description; the active backend is named up front.
const gitDesc = toolDescription(true, "gitbash");
assert.ok(gitDesc.includes("bash -lc"), "gitbash lead mentions bash -lc: " + gitDesc);
assert.ok(gitDesc.includes("POSIX syntax"), "gitbash lead mentions POSIX");
assert.ok(gitDesc.includes("The user's chosen default terminal (Settings -> General -> Default terminal) is gitbash"), "gitbash names the active backend");
assert.ok(gitDesc.includes("Git Bash"), "gitbash mentions Git Bash unconfined");
assert.ok(gitDesc.includes("run unconfined"), "gitbash description advertises unconfined execution");

// powershell -> PowerShell-flavored description.
const psDesc = toolDescription(true, "powershell");
assert.ok(psDesc.includes("pwsh -NoLogo -NoProfile -NonInteractive -Command"), "powershell lead mentions pwsh argv");
assert.ok(psDesc.includes("PowerShell syntax"), "powershell lead mentions PowerShell");
assert.ok(psDesc.includes("is powershell"), "powershell names the active backend");

// msys2 -> MSYS2-bash-flavored description; never advertise the msys2.exe dead end.
const msysDesc = toolDescription(true, "msys2");
assert.ok(msysDesc.includes("MSYS2 bash -lc"), "msys2 lead mentions MSYS2 bash -lc: " + msysDesc);
assert.ok(!msysDesc.includes("msys2.exe -c"), "msys2 must not advertise msys2.exe -c");
assert.ok(msysDesc.includes("/c/"), "msys2 lead mentions /c/ paths");
assert.ok(msysDesc.includes("MSYS2 provides a full GCC/mingw64 toolchain"), "msys2 lead mentions the toolchain");
assert.ok(msysDesc.includes("is msys2"), "msys2 names the active backend");
assert.ok(msysDesc.includes("MSYS2"), "msys2 mentions MSYS2 as unconfined");

// wsl -> Linux-bash-flavored description.
const wslDesc = toolDescription(true, "wsl");
assert.ok(wslDesc.includes("wsl [-d <distro>] -e bash -lc"), "wsl lead mentions wsl argv");
assert.ok(wslDesc.includes("/mnt/"), "wsl lead mentions /mnt/ paths");
assert.ok(wslDesc.includes("is wsl"), "wsl names the active backend");

// Shared tail: fresh shell, exit codes, background controls.
for (const desc of [gitDesc, psDesc, msysDesc, wslDesc]) {
  assert.ok(desc.includes("spawns a fresh shell"), "shared fresh-shell tail");
  assert.ok(desc.includes("[exit code: N]"), "shared exit-code tail");
  assert.ok(desc.includes("run_in_background: true"), "background advertised when enabled");
  assert.ok(desc.includes("under the DSH sandbox"), "sandbox honored in description");
  assert.ok(!desc.includes("outside the DSH sandbox"), "no stale outside-sandbox claim");
}
assert.ok(!toolDescription(false, "gitbash").includes("run_in_background"), "background hidden when disabled");

// Unknown backend falls back to the default lead without throwing.
assert.ok(toolDescription(true, "fish").includes("is powershell"), "unknown backend falls back to default");

// Shell catalog order is what the Web UI settings row mirrors.
assert.deepStrictEqual(SHELLS, ["powershell", "gitbash", "msys2", "wsl"], "msys2 is the third backend");

console.log("ALL UNIT TESTS PASSED");
