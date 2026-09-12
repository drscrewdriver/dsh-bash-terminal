
import { spawnSync } from "node:child_process";
import { buildArgv, buildEnv, candidateGitBashPaths, candidateMsys2Paths, candidatePwshPaths, internals } from "../lib/index.js";
const { renderResult, resolveAllPaths, validateArgs, toolDescription, SHELL_DESCRIPTIONS } = internals;
import assert from "node:assert";

const paths = { pwsh: "C:\\pwsh.exe", gitbash: "C:\\Git\\bin\\bash.exe", msys2: "C:\\msys64\\usr\\bin\\bash.exe", wsl: "C:\\Windows\\System32\\wsl.exe" };
assert.deepStrictEqual(buildArgv("powershell", "echo hi", paths), ["C:\\pwsh.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "echo hi"]);
assert.deepStrictEqual(buildArgv("gitbash", "ls", paths), ["C:\\Git\\bin\\bash.exe", "-lc", "ls"]);
// msys2 must use -lc: /etc/profile is what puts /usr/bin and /mingw64/bin on PATH.
assert.deepStrictEqual(buildArgv("msys2", "ls", paths), ["C:\\msys64\\usr\\bin\\bash.exe", "-lc", "ls"]);
assert.deepStrictEqual(buildArgv("wsl", "pwd", paths, undefined), ["C:\\Windows\\System32\\wsl.exe", "-e", "bash", "-lc", "pwd"]);
assert.deepStrictEqual(buildArgv("wsl", "pwd", paths, "Ubuntu"), ["C:\\Windows\\System32\\wsl.exe", "-d", "Ubuntu", "-e", "bash", "-lc", "pwd"]);
assert.throws(() => buildArgv("fish", "x", paths));

const env = buildEnv("gitbash", { DSH_WEB_URL: "http://127.0.0.1:3080" });
assert.strictEqual(env.DSH_WEB_URL, "http://127.0.0.1:3080");
assert.strictEqual(env.NO_COLOR, "1");
// msys2 selects the MINGW64 environment so /mingw64/bin (gcc, make) joins PATH.
assert.strictEqual(buildEnv("msys2", undefined).MSYSTEM, "MINGW64");
assert.strictEqual(buildEnv("msys2", { DSH_WEB_URL: "http://x" }).MSYSTEM, "MINGW64");
// An explicitly supplied MSYSTEM always wins.
assert.strictEqual(buildEnv("msys2", { MSYSTEM: "UCRT64" }).MSYSTEM, "UCRT64");
assert.strictEqual(buildEnv("msys2", { MSYSTEM: "CLANG64" }).MSYSTEM, "CLANG64");
// ...and the default never leaks into the other backends.
assert.strictEqual(buildEnv("gitbash", undefined).MSYSTEM, undefined);
assert.strictEqual(buildEnv("powershell", undefined).MSYSTEM, undefined);
// WSLENV is WSL's allow-list, so the host's value must be LAYERED ONTO, never
// rebuilt from dshEnv alone. The inherited value is passed explicitly so these
// assertions do not depend on the ambient environment (this host really has
// WSLENV set, Windows Terminal exports WT_SESSION:WT_PROFILE_ID:).
const INHERITED = "WT_SESSION:WT_PROFILE_ID:";
const wslEnv = buildEnv("wsl", { DSH_WEB_URL: "http://x", DSH_TEST: "1" }, INHERITED);
assert.ok(wslEnv.WSLENV!.includes("DSH_WEB_URL"), "dsh key listed: " + wslEnv.WSLENV);
assert.ok(wslEnv.WSLENV!.includes("DSH_TEST"), "dsh key listed: " + wslEnv.WSLENV);
assert.ok(wslEnv.WSLENV!.includes("WT_SESSION"), "inherited WSLENV entries preserved: " + wslEnv.WSLENV);
assert.ok(wslEnv.WSLENV!.includes("WT_PROFILE_ID"), "inherited WSLENV entries preserved: " + wslEnv.WSLENV);
assert.strictEqual(wslEnv.WSLENV, "WT_SESSION:WT_PROFILE_ID:DSH_WEB_URL:DSH_TEST", "layered, in order");
assert.ok(!wslEnv.WSLENV!.includes("::"), "no empty WSLENV entry from the inherited trailing colon: " + wslEnv.WSLENV);
assert.ok(!wslEnv.WSLENV!.endsWith(":"), "no trailing separator: " + wslEnv.WSLENV);
assert.ok(!wslEnv.WSLENV!.split(":").includes("WSLENV"), "WSLENV itself is never appended: " + wslEnv.WSLENV);
// An explicit caller-supplied WSLENV wins over the inherited one.
assert.strictEqual(buildEnv("wsl", { DSH_WEB_URL: "http://x", WSLENV: "CALLER_ONLY" }, INHERITED).WSLENV, "CALLER_ONLY:DSH_WEB_URL", "declared WSLENV wins");
assert.strictEqual(buildEnv("wsl", { WSLENV: "CALLER_ONLY" }, INHERITED).WSLENV, "CALLER_ONLY", "declared WSLENV alone is kept");
// No inherited value and no declared value -> exactly the DSH keys. An explicit
// `undefined` would re-trigger the default parameter (JS semantics: defaults fire
// on undefined), so opting out of inheritance means passing the empty string.
assert.strictEqual(buildEnv("wsl", { DSH_WEB_URL: "http://x" }, "").WSLENV, "DSH_WEB_URL", "empty inherited base");
assert.ok(buildEnv("wsl", { DSH_WEB_URL: "http://x" }).WSLENV!.includes("DSH_WEB_URL"), "default base is the ambient WSLENV");
assert.strictEqual(buildEnv("wsl", undefined, INHERITED).WSLENV, undefined, "no dsh keys -> WSLENV untouched");
// msys2 must not grow a WSLENV.
assert.strictEqual(buildEnv("msys2", { DSH_WEB_URL: "http://x" }, INHERITED).WSLENV, undefined, "WSLENV is wsl-only");

assert.strictEqual(renderResult({ stdout: { text: "hello", truncated: false }, stderr: { text: "", truncated: false }, exitCode: 0, signal: null, timedOut: false, timeoutMs: 1000 }), "hello");
assert.ok(renderResult({ stdout: { text: "out", truncated: false }, stderr: { text: "err", truncated: false }, exitCode: 3, signal: null, timedOut: false, timeoutMs: 1000 }).includes("[stderr]"));
assert.ok(renderResult({ stdout: { text: "out", truncated: false }, stderr: { text: "", truncated: false }, exitCode: 3, signal: null, timedOut: false, timeoutMs: 1000 }).includes("[exit code: 3]"));
assert.ok(renderResult({ stdout: { text: "", truncated: false }, stderr: { text: "", truncated: false }, exitCode: 0, signal: null, timedOut: true, timeoutMs: 5000 }).includes("[timed out after 5000ms]"));

const real = resolveAllPaths({}, process.env);
console.log("resolved paths:", JSON.stringify(real));
assert.ok(real.pwsh, "pwsh should resolve");
assert.ok(real.gitbash && real.gitbash.toLowerCase().includes("git"), "gitbash should resolve: " + real.gitbash);
assert.ok(real.wsl, "wsl should resolve");
// The msys2 backend must never resolve to msys2.exe: the console-allocating
// Cygwin launcher returns exit 0 with ZERO bytes on both streams under piped
// stdio, so every command would silently produce no output.
if (real.msys2 !== undefined) {
  assert.ok(real.msys2.toLowerCase().endsWith("bash.exe"), "msys2 must resolve to bash.exe, not msys2.exe: " + real.msys2);
  assert.ok(!real.msys2.toLowerCase().endsWith("msys2.exe"), "msys2.exe must never win resolution: " + real.msys2);
}

const cgb = candidateGitBashPaths({ ...process.env, PATH: "C:\\Windows\\System32;C:\\Program Files\\Git\\bin" });
assert.ok(!cgb.some((p) => p.toLowerCase().includes("system32")), "system32 bash excluded");

// candidateMsys2Paths: a real bash.exe always outranks the msys2.exe fallback.
const cmz = candidateMsys2Paths({ ...process.env, PATH: "C:\\msys64\\usr\\bin;C:\\msys64\\mingw64\\bin" });
assert.ok(cmz.length > 0, "msys2 candidates produced");
assert.ok(cmz[0].toLowerCase().endsWith("bash.exe"), "first msys2 candidate is a bash.exe: " + cmz[0]);
assert.ok(/usr[\\/]bin[\\/]bash\.exe$/i.test(cmz[0]), "first candidate is the usr\\bin\\bash.exe: " + cmz[0]);
const firstMsys2Exe = cmz.findIndex((p) => p.toLowerCase().endsWith("msys2.exe"));
const lastBashExe = cmz.reduce((acc, p, i) => (p.toLowerCase().endsWith("bash.exe") ? i : acc), -1);
assert.ok(firstMsys2Exe !== -1, "msys2.exe kept as last-resort fallback");
assert.ok(lastBashExe !== -1, "bash.exe candidates present");
assert.ok(lastBashExe < firstMsys2Exe, `every bash.exe must precede msys2.exe (lastBash=${lastBashExe}, firstExe=${firstMsys2Exe}): ${JSON.stringify(cmz)}`);
assert.ok(cmz.some((p) => /mingw64/i.test(p)), "MINGW64 PATH bash.exe entries are considered");

// Live smoke test: the ported backend must actually RETURN OUTPUT. A 0-byte
// stdout here is the msys2.exe dead end this port exists to avoid.
if (real.msys2 !== undefined && real.msys2.toLowerCase().endsWith("bash.exe")) {
  const smokeArgv = buildArgv("msys2", "echo MSYS2_OK; command -v gcc make bash; echo MSYSTEM=$MSYSTEM", real as never);
  const smoke = spawnSync(smokeArgv[0] as string, smokeArgv.slice(1) as string[], {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    env: { ...process.env, ...buildEnv("msys2", undefined) } as NodeJS.ProcessEnv,
    timeout: 30000
  });
  const smokeOut = smoke.stdout ?? "";
  console.log("msys2 smoke stdout:", JSON.stringify(smokeOut.trim()));
  assert.strictEqual(smoke.status, 0, "msys2 smoke command exits 0 (stderr: " + (smoke.stderr ?? "").trim() + ")");
  assert.ok(smokeOut.trim().length > 0, "msys2 smoke stdout must not be empty");
  assert.ok(smokeOut.includes("MSYS2_OK"), "msys2 smoke prints the marker");
  assert.ok(smokeOut.includes("MSYSTEM=MINGW64"), "msys2 env carries MSYSTEM=MINGW64");
  assert.ok(smokeOut.includes("/usr/bin/bash"), "login-shell PATH exposes /usr/bin: " + JSON.stringify(smokeOut));
  // gcc is only present when the MSYS2 install has the mingw64 toolchain; when
  // it resolves at all it must come from /mingw64/bin (i.e. MSYSTEM=MINGW64
  // took effect through /etc/profile).
  if (smokeOut.includes("gcc")) {
    assert.ok(smokeOut.includes("/mingw64/bin/gcc"), "gcc resolves under /mingw64/bin: " + JSON.stringify(smokeOut));
  } else {
    console.log("NOTE: no gcc in this MSYS2 install; skipping the /mingw64/bin/gcc assertion");
  }
} else {
  console.log("NOTE: msys2 backend not installed; skipping the live smoke assertion");
}

// candidatePwshPaths is exercised for parity with the JS baseline.
assert.ok(candidatePwshPaths({}).length > 0, "pwsh candidates produced");

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

// msys2 -> MSYS2 bash-flavored description; the lead names bash -lc, not msys2.exe.
const msysDesc = toolDescription(true, "msys2");
assert.ok(msysDesc.includes("MSYS2 bash -lc"), "msys2 lead mentions MSYS2 bash -lc: " + msysDesc);
assert.ok(!msysDesc.includes("msys2.exe"), "msys2 lead never advertises the msys2.exe dead end");
assert.ok(msysDesc.includes("POSIX syntax"), "msys2 lead mentions POSIX");
assert.ok(msysDesc.includes("is msys2"), "msys2 names the active backend");
assert.ok(msysDesc.includes("MSYS2"), "msys2 description names MSYS2 in the sandbox sentence");

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
for (const desc of [gitDesc, msysDesc, psDesc, wslDesc]) {
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
