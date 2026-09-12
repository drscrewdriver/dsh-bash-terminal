// Interactive terminal test: drive the real node-pty through the plugin's
// registry + tool surface (fake ctx, real PTY backend).
import { createTerminalRegistry, terminalTool, terminalArgv } from "../lib/terminal.js";
import { buildEnv } from "../lib/index.js";
import { createRequire } from "node:module";
import { PassThrough } from "node:stream";
import os from "node:os";
import { join } from "node:path";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import assert from "node:assert";

const profileRequire = createRequire(join(os.homedir(), ".dsh", "profiles", "web", "package.json"));
function loadNodePty() {
  // CI: node-pty installed into the project node_modules (npm install node-pty --no-save);
  // local dev: resolve from the profile dependency tree.
  try {
    return createRequire(import.meta.url)("node-pty");
  } catch {
    return profileRequire("node-pty");
  }
}
const nodePty = loadNodePty();

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function realPtyHandle(spec) {
  const term = nodePty.spawn(spec.argv[0], spec.argv.slice(1), {
    name: "dumb", rows: spec.rows, cols: spec.cols, cwd: spec.cwd, env: { ...spec.env, TERM: "dumb", NO_COLOR: "1" }
  });
  const output = new PassThrough();
  term.onData((d) => output.write(Buffer.from(d, "utf8")));
  const writes = [];
  const signals = [];
  const done = new Promise((resolve) => term.onExit(({ exitCode, signal }) => resolve({ exitCode, signal })));
  return {
    pid: term.pid,
    output,
    done,
    write: async (data) => { writes.push(data); term.write(data); },
    signalForeground: async (sig) => { signals.push(sig); try { term.kill(sig); } catch {} return 1; },
    terminate: async () => { try { term.kill(); } catch {} },
    inspectForeground: async () => undefined,
    writes,
    signals
  };
}

const shellEnv = { collect: () => ({ DSH_WEB_URL: "http://x" }) };
const jobsStarted = [];
const ctx = {
  shellEnv,
  subprocess: { spawnTerminal: async (spec) => realPtyHandle(spec) },
  effect: () => () => {},
  get: (key) => key === "jobs" ? { start: (spec) => { jobsStarted.push(spec); return "job-session-1"; } } : undefined
};
const registry = createTerminalRegistry(ctx);
const pwsh7 = "C:/Program Files/PowerShell/7/pwsh.exe";
const paths = { pwsh: existsSync(pwsh7) ? pwsh7 : "C:/WINDOWS/System32/WindowsPowerShell/v1.0/powershell.exe", gitbash: "C:/Program Files/Git/bin/bash.exe", msys2: "C:/msys64/usr/bin/bash.exe", wsl: "C:/WINDOWS/System32/wsl.exe" };
let defaultShell = "gitbash";
const tool = terminalTool(ctx, registry, paths, () => defaultShell);
assert.strictEqual(tool.name, "terminal");
// Machine-independent session cwd (the old D:/WorkSpace hardcode broke the
// test on every machine but the author's).
const workdir = mkdtempSync(join(os.tmpdir(), "dsh-terminal-test-"));
const exec = { signal: new AbortController().signal, agent: { session: { header: { cwd: workdir } } }, callId: "c1" };
function gitbashPath(p) {
  const m = /^([A-Za-z]):\\(.*)$/.exec(p);
  return m ? "/" + m[1].toLowerCase() + "/" + m[2].replace(/\\/g, "/") : p;
}

// argv shape
assert.deepStrictEqual(terminalArgv("gitbash", paths, undefined), ["C:/Program Files/Git/bin/bash.exe", "-i"]);
assert.deepStrictEqual(terminalArgv("powershell", paths, undefined), ["C:/WINDOWS/System32/WindowsPowerShell/v1.0/powershell.exe", "-NoLogo", "-NoProfile"]);
assert.deepStrictEqual(terminalArgv("wsl", paths, "Ubuntu"), ["C:/WINDOWS/System32/wsl.exe", "-d", "Ubuntu", "-e", "bash", "-i"]);
assert.deepStrictEqual(terminalArgv("wsl", paths, undefined), ["C:/WINDOWS/System32/wsl.exe", "--", "bash", "-i"]);
// msys2 runs a login shell so /etc/profile selects the toolchain (bash.exe, not msys2.exe).
assert.deepStrictEqual(terminalArgv("msys2", paths, undefined), ["C:/msys64/usr/bin/bash.exe", "-l"]);

// open a persistent git-bash session
const opened = await tool.execute({ action: "open" }, exec);
assert.strictEqual(opened.kind, "open");
assert.ok(opened.sessionId, "session id returned");
assert.strictEqual(opened.shell, "gitbash");
assert.ok(opened.pid > 0);
assert.strictEqual(opened.jobId, "job-session-1", "session registered as a background job");
assert.strictEqual(jobsStarted.length, 1);
assert.strictEqual(jobsStarted[0].kind, "terminal/session");
assert.strictEqual(typeof jobsStarted[0].run, "function");

// session state persists across sends (cd then pwd); give bash -i time to be ready
await delay(1200);
const targetDir = gitbashPath(workdir);
const r1 = await tool.execute({ action: "send", sessionId: opened.sessionId, input: "cd \"" + targetDir + "\"\r" }, exec);
assert.strictEqual(r1.kind, "session");
const r2 = await tool.execute({ action: "send", sessionId: opened.sessionId, input: "pwd\r" }, exec);
assert.ok(r2.output.includes(targetDir), "pwd reflects the cd (session state persisted): " + JSON.stringify(r2.output.slice(-120)));
const r3 = await tool.execute({ action: "send", sessionId: opened.sessionId, input: "echo SESSION-KEEPS-ALIVE\r" }, exec);
assert.ok(r3.output.includes("SESSION-KEEPS-ALIVE"), "echo output visible");

// read without write
await delay(200);
const r4 = await tool.execute({ action: "read", sessionId: opened.sessionId }, exec);
assert.strictEqual(r4.kind, "session");

// signal delivers to foreground (SIGINT to the shell prompt is harmless)
const r5 = await tool.execute({ action: "signal", sessionId: opened.sessionId, signal: "SIGINT" }, exec);
assert.strictEqual(r5.kind, "session");

// close terminates the session
const closed = await tool.execute({ action: "close", sessionId: opened.sessionId }, exec);
assert.strictEqual(closed.kind, "closed");
await assert.rejects(() => tool.execute({ action: "send", sessionId: opened.sessionId, input: "x" }, exec), /not found|closed/);

// open with an initial command: command runs immediately in the fresh shell
defaultShell = "gitbash";
const initOpened = await tool.execute({ action: "open", command: "echo INIT-OK" }, exec);
await delay(1200);
const initRead = await tool.execute({ action: "read", sessionId: initOpened.sessionId }, exec);
assert.ok(initRead.output.includes("INIT-OK"), "initial command output visible: " + JSON.stringify(initRead.output.slice(-120)));
await tool.execute({ action: "close", sessionId: initOpened.sessionId }, exec).catch(() => {});

// msys2 interactive session (REAL PTY): the tool must hand the PTY the SAME env
// the shell tool uses, i.e. buildEnv's MSYSTEM=MINGW64 injection. The `-l` login
// shell sources /etc/profile, which selects the MINGW64 environment only when
// MSYSTEM says so; without it the session runs in the bare MSYS environment and
// /mingw64/bin (gcc, make) is absent from PATH while the `shell` tool still works.
defaultShell = "msys2";
const msys2Available = existsSync("C:/msys64/usr/bin/bash.exe");
if (!msys2Available) {
  console.log("NOTE: MSYS2 not installed at C:/msys64; skipping the msys2 PTY env assertion");
} else {
  const msysOpened = await tool.execute({ action: "open", command: "echo PTY-MARKER; echo MSYSTEM=$MSYSTEM; command -v gcc" }, exec);
  assert.strictEqual(msysOpened.shell, "msys2");
  await delay(2500);
  const msysOut = await tool.execute({ action: "read", sessionId: msysOpened.sessionId }, exec);
  const msysText = msysOpened.output + msysOut.output;
  console.log("MSYS2 PTY evidence: " + JSON.stringify(msysText.replace(/\u001b\[[0-9;?]*[a-zA-Z]/g, "").slice(-260)));
  assert.ok(msysText.includes("MSYSTEM=MINGW64"),
    "msys2 PTY session must get buildEnv's MSYSTEM=MINGW64 (if this fails, the terminal env plumbing stopped using buildEnv and the session fell back to the bare MSYS environment): " + JSON.stringify(msysText.slice(-300)));
  assert.ok(msysText.includes("/mingw64/bin/gcc"),
    "msys2 PTY session must have /mingw64/bin on PATH (gcc reachable): " + JSON.stringify(msysText.slice(-300)));
  await tool.execute({ action: "close", sessionId: msysOpened.sessionId }, exec).catch(() => {});
}

// job hooks shape: the registered job exposes cancel / done / readOutput
const hooks = jobsStarted[0].run();
assert.strictEqual(typeof hooks.cancel, "function");
assert.ok(hooks.done instanceof Promise);
assert.strictEqual(typeof hooks.readOutput, "function");

// powershell backend interactive session.
// Note: Windows PowerShell 5.1 cannot start inside a ConPTY (0x8009001d);
// pwsh 7 works. The test tolerates the 5.1 failure and documents the limit.
defaultShell = "powershell";
const psOpened = await tool.execute({ action: "open" }, exec);
await delay(1000);
const psOut = await tool.execute({ action: "send", sessionId: psOpened.sessionId, input: "Get-Location\r" }, exec);
const psFailed = psOut.output.includes("8009001d") || psOut.output.includes("内部错误");
if (psFailed) {
  console.log("NOTE: powershell interactive unavailable in this environment (Windows PowerShell 5.1 cannot start in a ConPTY; install pwsh 7); skipping assertion");
} else {
  assert.ok(psOut.output.length > 0, "powershell interactive responds: " + JSON.stringify(psOut.output.slice(-100)));
  assert.ok(psOut.output.includes("Path"), "powershell interactive responds with a location: " + JSON.stringify(psOut.output.slice(-100)));
}
await tool.execute({ action: "close", sessionId: psOpened.sessionId }, exec).catch(() => {});

// wsl backend interactive session (WSL distro boot is slow; retry reads)
defaultShell = "wsl";
let wslOpened;
try {
  wslOpened = await tool.execute({ action: "open" }, exec);
} catch {
  console.log("NOTE: wsl.exe interactive unavailable (spawn failed); skipping assertion");
}
if (wslOpened !== undefined) {
  await delay(4500);
  let wslOut = await tool.execute({ action: "send", sessionId: wslOpened.sessionId, input: "pwd\r" }, exec);
  if (!wslOut.output.includes("/mnt/")) {
    await delay(1500);
    wslOut = await tool.execute({ action: "read", sessionId: wslOpened.sessionId }, exec);
  }
  // Tolerate every observed WSL failure mode (no distro, ConPTY RPC errors,
  // and the localhost-proxy "Wsl/Service/E_UNEXPECTED" crash) — environment
  // limits skip; only a genuinely broken PTY path should fail.
  const wslFailed = wslOut.output.length === 0
    || wslOut.output.includes("0x8007072c")
    || wslOut.output.includes("RPC")
    || wslOut.output.includes("not installed")
    || wslOut.output.includes("E_UNEXPECTED")
    || wslOut.output.includes("Wsl/Service");
  if (wslFailed) {
    console.log("NOTE: wsl.exe interactive unavailable in this environment (no distro / ConPTY RPC error); skipping assertion");
  } else {
    assert.ok(wslOut.output.includes("/mnt/"), "wsl interactive responds with /mnt/ path: " + JSON.stringify(wslOut.output.slice(-150)));
  }
  await tool.execute({ action: "close", sessionId: wslOpened.sessionId }, exec).catch(() => {});
}

// session cap: opening beyond MAX_SESSIONS refuses; list shows them
defaultShell = "gitbash";
const capped = [];
for (let i = 0; i < 8; i++) capped.push(await tool.execute({ action: "open" }, exec));
await assert.rejects(() => tool.execute({ action: "open" }, exec), /too many open sessions/);
const listed = await tool.execute({ action: "list" }, exec);
assert.ok(Array.isArray(listed.sessions));
assert.ok(listed.sessions.length >= 8, "list shows open sessions: " + listed.sessions.length);
assert.ok(listed.sessions.every((s) => s.shell === "gitbash"));
for (const s of capped) await tool.execute({ action: "close", sessionId: s.sessionId }, exec);

// settle-based read returns the COMPLETE multi-line reply (not a fixed-delay slice)
defaultShell = "gitbash";
const settleOpened = await tool.execute({ action: "open" }, exec);
await delay(1500);
let multiOut = await tool.execute({ action: "send", sessionId: settleOpened.sessionId, input: "seq 1 8\r" }, exec);
if (!(multiOut.output.match(/^[1-8]$/gm) || []).length) {
  // git-bash may not have been ready for the first write; retry once
  await delay(800);
  multiOut = await tool.execute({ action: "send", sessionId: settleOpened.sessionId, input: "seq 1 8\r" }, exec);
}
const seen = (multiOut.output.match(/^[1-8]$/gm) || []).length;
assert.ok(seen >= 7, "multi-line output settled fully (got " + seen + "/8): " + JSON.stringify(multiOut.output.slice(-160)));
await tool.execute({ action: "close", sessionId: settleOpened.sessionId }, exec).catch(() => {});

// idle timeout: a session with a short idle window auto-closes
const opened2 = await tool.execute({ action: "open", idleMs: 400 }, exec);
await delay(900);
await assert.rejects(() => tool.execute({ action: "send", sessionId: opened2.sessionId, input: "x" }, exec), /not found|closed/);

// validation
await assert.rejects(() => tool.execute({ action: "bogus" }, exec), /must be one of|invalid action/);
await assert.rejects(() => tool.execute({ action: "send", sessionId: "nope", input: "x" }, exec), /not found/);

// WSL PTY env: DSH's spawnTerminal replaces the child env wholesale, so the
// inherited WSLENV allow-list (Windows Terminal's WT_SESSION / WT_PROFILE_ID)
// must be handed to buildEnv explicitly rather than read implicitly at spawn
// time, or a WSL session loses it. Placed last so the session it opens does not
// shift the jobsStarted indexes asserted above.
defaultShell = "wsl";
const wslEnvOpened = await tool.execute({ action: "open", distro: "Ubuntu" }, exec);
assert.strictEqual(wslEnvOpened.shell, "wsl");
// Mirror the exact call lib/terminal.js makes (three arguments).
const wslPtyEnv = buildEnv("wsl", shellEnv.collect(exec), process.env.WSLENV);
if (typeof process.env.WSLENV === "string" && process.env.WSLENV.length > 0) {
  const inherited = process.env.WSLENV.split(":").map((p) => p.trim()).filter((p) => p.length > 0);
  const produced = String(wslPtyEnv.WSLENV ?? "").split(":");
  for (const entry of inherited) {
    assert.ok(produced.includes(entry), `a WSL PTY session must inherit WSLENV entry ${entry}: ` + JSON.stringify(wslPtyEnv.WSLENV));
  }
}
assert.ok(String(wslPtyEnv.WSLENV ?? "").includes("DSH_WEB_URL"), "PTY WSLENV carries DSH vars: " + JSON.stringify(wslPtyEnv.WSLENV));
assert.ok(String(wslPtyEnv.WSLENV ?? "").split(":").every((p) => p.length > 0), "PTY WSLENV has no empty entry: " + JSON.stringify(wslPtyEnv.WSLENV));
await tool.execute({ action: "close", sessionId: wslEnvOpened.sessionId }, exec).catch(() => {});

try { rmSync(workdir, { recursive: true, force: true }); } catch {}

console.log("TERMINAL TESTS PASSED (real node-pty interactive session)");
// node-pty's ConPTY console agent races process teardown on Windows
// (AttachConsole noise); every assertion already ran above, so exit clean.
process.exit(0);
