
import { buildArgv, buildEnv, candidateGitBashPaths, candidateMsys2Paths, candidatePwshPaths, internals } from "../lib/index.js";
const { renderResult, resolveAllPaths, validateArgs, toolDescription, SHELL_DESCRIPTIONS } = internals;
import assert from "node:assert";

const paths = { pwsh: "C:\\pwsh.exe", gitbash: "C:\\Git\\bin\\bash.exe", msys2: "C:\\msys64\\usr\\bin\\bash.exe", wsl: "C:\\Windows\\System32\\wsl.exe" };
assert.deepStrictEqual(buildArgv("powershell", "echo hi", paths), ["C:\\pwsh.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "echo hi"]);
assert.deepStrictEqual(buildArgv("gitbash", "ls", paths), ["C:\\Git\\bin\\bash.exe", "-lc", "ls"]);
// -lc, not -c: a bare -c leaves /usr/bin and /mingw64/bin off PATH, so `tr`,
// `sed` and `gcc` are all "command not found".
assert.deepStrictEqual(buildArgv("msys2", "make all", paths), ["C:\\msys64\\usr\\bin\\bash.exe", "-lc", "make all"]);
assert.deepStrictEqual(buildArgv("wsl", "pwd", paths, undefined), ["C:\\Windows\\System32\\wsl.exe", "-e", "bash", "-lc", "pwd"]);
assert.deepStrictEqual(buildArgv("wsl", "pwd", paths, "Ubuntu"), ["C:\\Windows\\System32\\wsl.exe", "-d", "Ubuntu", "-e", "bash", "-lc", "pwd"]);
assert.throws(() => buildArgv("fish", "x", paths));

const env = buildEnv("gitbash", { DSH_WEB_URL: "http://127.0.0.1:3080" });
assert.strictEqual(env.DSH_WEB_URL, "http://127.0.0.1:3080");
assert.strictEqual(env.NO_COLOR, "1");
const wslEnv = buildEnv("wsl", { DSH_WEB_URL: "http://x", DSH_TEST: "1" });
assert.ok(wslEnv.WSLENV.includes("DSH_WEB_URL"));
assert.ok(wslEnv.WSLENV.includes("DSH_TEST"));
assert.strictEqual(buildEnv("wsl", undefined).WSLENV, undefined);

// msys2 gets MSYSTEM=MINGW64 so /mingw64/bin (gcc, make, ...) joins PATH via
// /etc/profile; an explicit user value must win.
assert.strictEqual(buildEnv("msys2", undefined).MSYSTEM, "MINGW64");
assert.strictEqual(buildEnv("msys2", { MSYSTEM: "UCRT64" }).MSYSTEM, "UCRT64", "explicit MSYSTEM wins");
assert.strictEqual(buildEnv("gitbash", undefined).MSYSTEM, undefined, "MSYSTEM is msys2-only");

assert.strictEqual(renderResult({ stdout: { text: "hello", truncated: false }, stderr: { text: "", truncated: false }, exitCode: 0, signal: null, timedOut: false, timeoutMs: 1000 }), "hello");
assert.ok(renderResult({ stdout: { text: "out", truncated: false }, stderr: { text: "err", truncated: false }, exitCode: 3, signal: null, timedOut: false, timeoutMs: 1000 }).includes("[stderr]"));
assert.ok(renderResult({ stdout: { text: "out", truncated: false }, stderr: { text: "", truncated: false }, exitCode: 3, signal: null, timedOut: false, timeoutMs: 1000 }).includes("[exit code: 3]"));
assert.ok(renderResult({ stdout: { text: "", truncated: false }, stderr: { text: "", truncated: false }, exitCode: 0, signal: null, timedOut: true, timeoutMs: 5000 }).includes("[timed out after 5000ms]"));

const real = resolveAllPaths({}, process.env);
console.log("resolved paths:", JSON.stringify(real));
assert.ok(real.pwsh, "pwsh should resolve");
assert.ok(real.gitbash && real.gitbash.toLowerCase().includes("git"), "gitbash should resolve: " + real.gitbash);
assert.ok(real.msys2 && real.msys2.toLowerCase().endsWith("bash.exe"), "msys2 must resolve to a real bash.exe, not the msys2.exe launcher: " + real.msys2);
assert.ok(real.wsl, "wsl should resolve");

const cgb = candidateGitBashPaths({ ...process.env, PATH: "C:\\Windows\\System32;C:\\Program Files\\Git\\bin" });
assert.ok(!cgb.some((p) => p.toLowerCase().includes("system32")), "system32 bash excluded");

// Candidate order: every bash.exe must outrank the msys2.exe launcher, which
// returns exit 0 with zero bytes on both streams under piped stdio.
const cms = candidateMsys2Paths({ ...process.env, PATH: "C:\\msys64\\usr\\bin;C:\\mingw64\\bin" });
assert.ok(cms.length > 0, "msys2 candidates exist");
assert.ok(cms.some((p) => p.toLowerCase().endsWith("bash.exe")), "candidates include a bash.exe");
assert.ok(cms.some((p) => p.toLowerCase().endsWith("msys2.exe")), "msys2.exe kept as documented last resort");
const lastBash = cms.map((p) => p.toLowerCase()).reduce((acc, p, i) => (p.endsWith("bash.exe") ? i : acc), -1);
const firstLauncher = cms.findIndex((p) => p.toLowerCase().endsWith("msys2.exe"));
assert.ok(firstLauncher > lastBash, `every bash.exe candidate must precede msys2.exe: ${JSON.stringify(cms)}`);

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

// msys2 -> MSYS2-bash-flavored description; never the msys2.exe launcher.
const msys2Desc = toolDescription(true, "msys2");
assert.ok(msys2Desc.includes("MSYS2 bash -lc"), "msys2 lead mentions MSYS2 bash -lc: " + msys2Desc);
assert.ok(!msys2Desc.includes("msys2.exe -c"), "msys2 lead must not advertise the broken launcher argv");
assert.ok(msys2Desc.includes("is msys2"), "msys2 names the active backend");
assert.ok(msys2Desc.includes("MSYS2"), "msys2 mentions MSYS2 unconfined");

// powershell -> PowerShell-flavored description.
const psDesc = toolDescription(true, "powershell");
assert.ok(psDesc.includes("pwsh -NoLogo -NoProfile -NonInteractive -Command"), "powershell lead mentions pwsh argv");
assert.ok(psDesc.includes("PowerShell syntax"), "powershell lead mentions PowerShell");
assert.ok(psDesc.includes("is powershell"), "powershell names the active backend");

// wsl -> Linux-bash-flavored description.
const wslDesc = toolDescription(true, "wsl");
assert.ok(wslDesc.includes("wsl [-d <distro>] -e bash -lc"), "wsl lead mentions wsl argv");
assert.ok(wslDesc.includes("/mnt/"), "wsl lead mentions /mnt/ paths");
assert.ok(wslDesc.includes("is wsl"), "wsl names the active backend");

// Shared tail: fresh shell, exit codes, background controls.
for (const desc of [gitDesc, psDesc, wslDesc, msys2Desc]) {
  assert.ok(desc.includes("spawns a fresh shell"), "shared fresh-shell tail");
  assert.ok(desc.includes("[exit code: N]"), "shared exit-code tail");
  assert.ok(desc.includes("run_in_background: true"), "background advertised when enabled");
  assert.ok(desc.includes("under the DSH sandbox"), "sandbox honored in description");
  assert.ok(!desc.includes("outside the DSH sandbox"), "no stale outside-sandbox claim");
}
assert.ok(!toolDescription(false, "gitbash").includes("run_in_background"), "background hidden when disabled");

// Unknown backend falls back to the default lead without throwing.
assert.ok(toolDescription(true, "fish").includes("is powershell"), "unknown backend falls back to default");

console.log("ALL UNIT TESTS PASSED");
