
import { buildArgv, buildEnv, candidateGitBashPaths, candidateMsys2Paths, candidatePwshPaths, internals } from "../lib/index.js";
const { renderResult, resolveAllPaths, validateArgs } = internals;
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

// The inherited WSLENV is the host's allow-list for what crosses into WSL
// (Windows Terminal exports "WT_SESSION:WT_PROFILE_ID:" on this machine).
// Rebuilding it from the DSH keys alone dropped those entries; passing the
// inherited value explicitly keeps these assertions off the ambient env.
const inherited = "WT_SESSION:WT_PROFILE_ID:";
const inheritedEnv = buildEnv("wsl", { DSH_WEB_URL: "http://x" }, inherited);
assert.ok(inheritedEnv.WSLENV.includes("WT_SESSION") && inheritedEnv.WSLENV.includes("WT_PROFILE_ID"), "inherited WSLENV entries preserved");
assert.ok(inheritedEnv.WSLENV.includes("DSH_WEB_URL"), "DSH keys still appended");
assert.strictEqual(inheritedEnv.WSLENV, "WT_SESSION:WT_PROFILE_ID:DSH_WEB_URL", "normalised: no empty entry from the trailing ':'");
// An explicit caller-supplied WSLENV wins over the inherited one.
const declaredEnv = buildEnv("wsl", { WSLENV: "MINE", DSH_WEB_URL: "http://x" }, inherited);
assert.strictEqual(declaredEnv.WSLENV, "MINE:DSH_WEB_URL", "explicit WSLENV wins, and WSLENV itself is not re-listed");
assert.strictEqual(buildEnv("gitbash", { DSH_WEB_URL: "http://x" }, inherited).WSLENV, undefined, "WSLENV is wsl-only");

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

console.log("ALL UNIT TESTS PASSED");
