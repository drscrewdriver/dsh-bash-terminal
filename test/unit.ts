
import { buildArgv, buildEnv, candidateGitBashPaths, candidateMsys2Paths, candidatePwshPaths, internals } from "../lib/index.js";
const { renderResult, resolveAllPaths, validateArgs } = internals;
import assert from "node:assert";

const paths = { pwsh: "C:\\pwsh.exe", gitbash: "C:\\Git\\bin\\bash.exe", msys2: "C:\\msys64\\msys2.exe", wsl: "C:\\Windows\\System32\\wsl.exe" };
assert.deepStrictEqual(buildArgv("powershell", "echo hi", paths), ["C:\\pwsh.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "echo hi"]);
assert.deepStrictEqual(buildArgv("gitbash", "ls", paths), ["C:\\Git\\bin\\bash.exe", "-lc", "ls"]);
// msys2 must use -lc: a login shell is what sources /etc/profile and puts
// /usr/bin + /mingw64/bin on PATH. With a bare -c every coreutil is missing.
assert.deepStrictEqual(buildArgv("msys2", "make all", paths), ["C:\\msys64\\msys2.exe", "-lc", "make all"]);
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
// The inherited WSLENV is passed explicitly so these assertions do not depend on
// the ambient environment (this host really does export one).
const wslEnv = buildEnv("wsl", { DSH_WEB_URL: "http://x", DSH_TEST: "1" }, undefined);
assert.ok(wslEnv.WSLENV!.includes("DSH_WEB_URL"));
assert.ok(wslEnv.WSLENV!.includes("DSH_TEST"));
assert.strictEqual(buildEnv("wsl", undefined, undefined).WSLENV, undefined);
// A pre-existing WSLENV (Windows Terminal exports WT_SESSION/WT_PROFILE_ID) must
// survive: WSLENV is an allow-list, so rebuilding it would silently stop those
// variables crossing into WSL.
const inherited = buildEnv("wsl", { DSH_WEB_URL: "http://x" }, "WT_SESSION:WT_PROFILE_ID:");
assert.ok(inherited.WSLENV!.includes("WT_SESSION"), "inherited WSLENV entries preserved");
assert.ok(inherited.WSLENV!.includes("WT_PROFILE_ID"), "inherited WSLENV entries preserved");
assert.ok(inherited.WSLENV!.includes("DSH_WEB_URL"), "DSH keys still appended");
assert.strictEqual(inherited.WSLENV, "WT_SESSION:WT_PROFILE_ID:DSH_WEB_URL");
// An explicit WSLENV from the caller wins over the inherited value.
assert.strictEqual(
  buildEnv("wsl", { DSH_WEB_URL: "http://x", WSLENV: "MY_VAR" }, "WT_SESSION:").WSLENV,
  "MY_VAR:DSH_WEB_URL",
  "explicit WSLENV wins over inherited"
);
assert.strictEqual(buildEnv("gitbash", { DSH_WEB_URL: "http://x" }, "WT_SESSION:").WSLENV, undefined, "WSLENV is wsl-only");

assert.strictEqual(renderResult({ stdout: { text: "hello", truncated: false }, stderr: { text: "", truncated: false }, exitCode: 0, signal: null, timedOut: false, timeoutMs: 1000 }), "hello");
assert.ok(renderResult({ stdout: { text: "out", truncated: false }, stderr: { text: "err", truncated: false }, exitCode: 3, signal: null, timedOut: false, timeoutMs: 1000 }).includes("[stderr]"));
assert.ok(renderResult({ stdout: { text: "out", truncated: false }, stderr: { text: "", truncated: false }, exitCode: 3, signal: null, timedOut: false, timeoutMs: 1000 }).includes("[exit code: 3]"));
assert.ok(renderResult({ stdout: { text: "", truncated: false }, stderr: { text: "", truncated: false }, exitCode: 0, signal: null, timedOut: true, timeoutMs: 5000 }).includes("[timed out after 5000ms]"));

const real = resolveAllPaths({}, process.env);
console.log("resolved paths:", JSON.stringify(real));
assert.ok(real.pwsh, "pwsh should resolve");
assert.ok(real.gitbash && real.gitbash.toLowerCase().includes("git"), "gitbash should resolve: " + real.gitbash);
assert.ok(real.msys2 || real.msys2 === undefined, "msys2 may or may not resolve");
assert.ok(real.wsl, "wsl should resolve");

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
assert.ok(
  resolveAllPaths({}, process.env).msys2?.toLowerCase().endsWith("bash.exe") ?? true,
  "resolved msys2 backend must be bash.exe, not msys2.exe: " + resolveAllPaths({}, process.env).msys2
);

// candidatePwshPaths is exercised for parity with the JS baseline.
assert.ok(candidatePwshPaths({}).length > 0, "pwsh candidates produced");

validateArgs({ command: "ls", description: "list" });
assert.throws(() => validateArgs({ command: "  ", description: "x" }));
// shell is user-settings controlled: a stale shell arg must be tolerated
validateArgs({ command: "ls", description: "x", shell: "fish" });
assert.throws(() => validateArgs({ command: "ls", description: "x", timeoutMs: -5 }));

console.log("ALL UNIT TESTS PASSED");
