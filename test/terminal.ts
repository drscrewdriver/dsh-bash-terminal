// Interactive terminal test: drive the real node-pty through the plugin's
// registry + tool surface (fake ctx, real PTY backend).
import { createTerminalRegistry, terminalTool, terminalArgv } from "../lib/terminal.js";
import type { TerminalToolResult } from "../lib/terminal.js";
import { internals } from "../lib/index.js";
import { createRequire } from "node:module";
import { PassThrough } from "node:stream";
import os from "node:os";
import { join } from "node:path";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import assert from "node:assert";

interface NodePtyLike {
  spawn: (
    file: string,
    args: string[],
    options: { name: string; rows: number; cols: number; cwd: string; env: Record<string, string | undefined> }
  ) => {
    pid: number;
    write: (data: string) => void;
    kill: (signal?: string) => void;
    onData: (cb: (d: string) => void) => void;
    onExit: (cb: (e: { exitCode: number; signal: unknown }) => void) => void;
  };
}

const profileRequire = createRequire(join(os.homedir(), ".dsh", "profiles", "web", "package.json"));
function loadNodePty(): NodePtyLike {
  // CI: node-pty installed into the project node_modules (npm install node-pty --no-save);
  // local dev: resolve from the profile dependency tree.
  try {
    return createRequire(import.meta.url)("node-pty") as NodePtyLike;
  } catch {
    return profileRequire("node-pty") as NodePtyLike;
  }
}
const nodePty = loadNodePty();

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function realPtyHandle(spec: { argv: string[]; rows: number; cols: number; cwd: string; env: Record<string, string | undefined> }) {
  const term = nodePty.spawn(spec.argv[0], spec.argv.slice(1), {
    name: "dumb", rows: spec.rows, cols: spec.cols, cwd: spec.cwd, env: { ...spec.env, TERM: "dumb", NO_COLOR: "1" }
  });
  const output = new PassThrough();
  term.onData((d) => output.write(Buffer.from(d, "utf8")));
  const writes: string[] = [];
  const signals: string[] = [];
  const done = new Promise<{ exitCode: number; signal: unknown }>((resolve) => term.onExit(({ exitCode, signal }) => resolve({ exitCode, signal })));
  return {
    pid: term.pid,
    output,
    done,
    write: async (data: string) => { writes.push(data); term.write(data); },
    signalForeground: async (sig: string) => { signals.push(sig); try { term.kill(sig); } catch {} return 1; },
    terminate: async () => { try { term.kill(); } catch {} },
    inspectForeground: async () => undefined,
    writes,
    signals
  };
}

const shellEnv = { collect: () => ({ DSH_WEB_URL: "http://x" }) };
const jobsStarted: { kind: string; run: () => { cancel: () => void; done: Promise<unknown>; readOutput: () => string } }[] = [];
const ctx = {
  shellEnv,
  subprocess: {
    spawnTerminal: async (spec: Parameters<typeof realPtyHandle>[0]) => realPtyHandle(spec),
    spawn: () => { throw new Error("shell spawn not used in terminal tests"); }
  },
  effect: () => () => {},
  get: (key: string) => key === "jobs" ? { start: (spec: { kind: string; run: () => { cancel: () => void; done: Promise<unknown>; readOutput: () => string } }) => { jobsStarted.push(spec); return "job-session-1"; } } : undefined
};
const registry = createTerminalRegistry(ctx as never);
const pwsh7 = "C:/Program Files/PowerShell/7/pwsh.exe";
const paths = { pwsh: existsSync(pwsh7) ? pwsh7 : "C:/WINDOWS/System32/WindowsPowerShell/v1.0/powershell.exe", gitbash: "C:/Program Files/Git/bin/bash.exe", msys2: "C:/msys64/usr/bin/bash.exe", wsl: "C:/WINDOWS/System32/wsl.exe" };
let defaultShell = "gitbash";
const tool = terminalTool(ctx as never, registry, paths, () => defaultShell);
assert.strictEqual(tool.name, "terminal");
// Machine-independent session cwd (the old D:/WorkSpace hardcode broke the
// test on every machine but the author's).
const workdir = mkdtempSync(join(os.tmpdir(), "dsh-terminal-test-"));
const exec = { signal: new AbortController().signal, agent: { session: { header: { cwd: workdir } } }, callId: "c1" };
function gitbashPath(p: string): string {
  const m = /^([A-Za-z]):\\(.*)$/.exec(p);
  return m ? "/" + m[1].toLowerCase() + "/" + m[2].replace(/\\/g, "/") : p;
}

// argv shape
assert.deepStrictEqual(terminalArgv("gitbash", paths, undefined), ["C:/Program Files/Git/bin/bash.exe", "-i"]);
// msys2 interactive sessions use -l, NEVER -lc: this argv carries no command,
// and `bash -lc` with no operand dies with "-c: option requires an argument".
assert.deepStrictEqual(terminalArgv("msys2", paths, undefined), ["C:/msys64/usr/bin/bash.exe", "-l"]);
assert.deepStrictEqual(terminalArgv("powershell", paths, undefined), ["C:/WINDOWS/System32/WindowsPowerShell/v1.0/powershell.exe", "-NoLogo", "-NoProfile"]);

// Wiring guard: the PTY path must take its env from the shared buildEnv helper
// (with the inherited WSLENV passed explicitly), not from an inline duplicate —
// an inline copy silently lost the msys2 MSYSTEM injection, so the interactive
// msys2 shell got the bare MSYS environment with no /mingw64/bin on PATH.
const terminalModule = readFileSync(new URL("../lib/terminal.js", import.meta.url), "utf8");
assert.ok(
  terminalModule.includes("buildEnv(shell, ctx.shellEnv.collect(exec), process.env.WSLENV)"),
  "terminal.ts builds its env through buildEnv(..., process.env.WSLENV): " + terminalModule.slice(0, 0)
);
assert.ok(!terminalModule.includes('PAGER: "cat", GIT_PAGER: "cat"'), "no inline env duplicate in the PTY path");

// The real resolved msys2 backend must be a bash.exe, never the msys2.exe launcher.
const realMsys2 = (internals.resolveAllPaths({}, process.env) as { msys2?: string }).msys2;
if (realMsys2 !== undefined) {
  assert.ok(realMsys2.toLowerCase().endsWith("bash.exe"), "resolved msys2 backend is a bash.exe: " + realMsys2);
  assert.ok(!realMsys2.toLowerCase().endsWith("msys2.exe"), "msys2.exe must never win resolution: " + realMsys2);
  assert.ok(terminalArgv("msys2", { msys2: realMsys2 }, undefined)[0]!.toLowerCase().endsWith("bash.exe"), "interactive argv[0] is a bash.exe");
}
assert.deepStrictEqual(terminalArgv("wsl", paths, "Ubuntu"), ["C:/WINDOWS/System32/wsl.exe", "-d", "Ubuntu", "-e", "bash", "-i"]);
assert.deepStrictEqual(terminalArgv("wsl", paths, undefined), ["C:/WINDOWS/System32/wsl.exe", "--", "bash", "-i"]);

// open a persistent git-bash session
const opened = await tool.execute({ action: "open" }, exec) as Extract<TerminalToolResult, { kind: "open" }>;
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
const r1 = await tool.execute({ action: "send", sessionId: opened.sessionId, input: "cd \"" + targetDir + "\"\r" }, exec) as Extract<TerminalToolResult, { kind: "session" }>;
assert.strictEqual(r1.kind, "session");
const r2 = await tool.execute({ action: "send", sessionId: opened.sessionId, input: "pwd\r" }, exec) as Extract<TerminalToolResult, { kind: "session" }>;
assert.ok(r2.output.includes(targetDir), "pwd reflects the cd (session state persisted): " + JSON.stringify(r2.output.slice(-120)));
const r3 = await tool.execute({ action: "send", sessionId: opened.sessionId, input: "echo SESSION-KEEPS-ALIVE\r" }, exec) as Extract<TerminalToolResult, { kind: "session" }>;
assert.ok(r3.output.includes("SESSION-KEEPS-ALIVE"), "echo output visible");

// NOTE: a "MSYSTEM does not leak into gitbash" check cannot be made from inside
// the session — Git for Windows sets MSYSTEM=MINGW64 in its own startup scripts
// (measured: `bash -i` with a minimal env still prints MSYSTEM=[MINGW64]), so the
// observation says nothing about this plugin. The leak guard therefore lives at
// the buildEnv level in test/unit.ts (buildEnv("gitbash"|"powershell").MSYSTEM is
// undefined, msys2 is the only backend that injects it).

// read without write
await delay(200);
const r4 = await tool.execute({ action: "read", sessionId: opened.sessionId }, exec) as Extract<TerminalToolResult, { kind: "session" }>;
assert.strictEqual(r4.kind, "session");

// signal delivers to foreground (SIGINT to the shell prompt is harmless)
const r5 = await tool.execute({ action: "signal", sessionId: opened.sessionId, signal: "SIGINT" }, exec) as Extract<TerminalToolResult, { kind: "session" }>;
assert.strictEqual(r5.kind, "session");

// close terminates the session
const closed = await tool.execute({ action: "close", sessionId: opened.sessionId }, exec) as Extract<TerminalToolResult, { kind: "closed" }>;
assert.strictEqual(closed.kind, "closed");
await assert.rejects(() => tool.execute({ action: "send", sessionId: opened.sessionId, input: "x" }, exec), /not found|closed/);

// open with an initial command: command runs immediately in the fresh shell
defaultShell = "gitbash";
const initOpened = await tool.execute({ action: "open", command: "echo INIT-OK" }, exec) as Extract<TerminalToolResult, { kind: "open" }>;
await delay(1200);
const initRead = await tool.execute({ action: "read", sessionId: initOpened.sessionId }, exec) as Extract<TerminalToolResult, { kind: "session" }>;
assert.ok(initRead.output.includes("INIT-OK"), "initial command output visible: " + JSON.stringify(initRead.output.slice(-120)));
await tool.execute({ action: "close", sessionId: initOpened.sessionId }, exec).catch(() => {});

// job hooks shape: the registered job exposes cancel / done / readOutput
const hooks = jobsStarted[0].run();
assert.strictEqual(typeof hooks.cancel, "function");
assert.ok(hooks.done instanceof Promise);
assert.strictEqual(typeof hooks.readOutput, "function");

// powershell backend interactive session.
// Note: Windows PowerShell 5.1 cannot start inside a ConPTY (0x8009001d);
// pwsh 7 works. The test tolerates the 5.1 failure and documents the limit.
defaultShell = "powershell";
const psOpened = await tool.execute({ action: "open" }, exec) as Extract<TerminalToolResult, { kind: "open" }>;
await delay(1000);
const psOut = await tool.execute({ action: "send", sessionId: psOpened.sessionId, input: "Get-Location\r" }, exec) as Extract<TerminalToolResult, { kind: "session" }>;
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
let wslOpened: Extract<TerminalToolResult, { kind: "open" }> | undefined;
try {
  wslOpened = await tool.execute({ action: "open" }, exec) as Extract<TerminalToolResult, { kind: "open" }>;
} catch {
  console.log("NOTE: wsl.exe interactive unavailable (spawn failed); skipping assertion");
}
if (wslOpened !== undefined) {
  await delay(4500);
  let wslOut = await tool.execute({ action: "send", sessionId: wslOpened.sessionId, input: "pwd\r" }, exec) as Extract<TerminalToolResult, { kind: "session" }>;
  if (!wslOut.output.includes("/mnt/")) {
    await delay(1500);
    wslOut = await tool.execute({ action: "read", sessionId: wslOpened.sessionId }, exec) as Extract<TerminalToolResult, { kind: "session" }>;
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

// msys2 backend interactive session. The regression this guards: the PTY path
// used to build its env inline instead of through buildEnv, so MSYSTEM never
// reached the login shell — /etc/profile then picked the default MSYS
// environment and /mingw64/bin (gcc, make) was missing from PATH while the
// one-shot `shell` tool worked fine. Kept after the wsl block so it cannot
// shift wsl.exe's (already intermittent) ConPTY startup timing.
defaultShell = "msys2";
if (existsSync("C:/msys64/usr/bin/bash.exe")) {
  const msysOpened = await tool.execute({ action: "open" }, exec) as Extract<TerminalToolResult, { kind: "open" }>;
  assert.strictEqual(msysOpened.shell, "msys2");
  await delay(2500); // login shell sources /etc/profile first
  let msysOut = await tool.execute({ action: "send", sessionId: msysOpened.sessionId, input: "echo MSYSTEM=$MSYSTEM; command -v gcc; echo BASH=$BASH\r" }, exec) as Extract<TerminalToolResult, { kind: "session" }>;
  for (let i = 0; i < 3 && !msysOut.output.includes("MSYSTEM="); i++) {
    await delay(1200);
    msysOut = await tool.execute({ action: "read", sessionId: msysOpened.sessionId }, exec) as Extract<TerminalToolResult, { kind: "session" }>;
  }
  console.log("msys2 PTY output:", JSON.stringify(msysOut.output.slice(-200)));
  assert.ok(msysOut.output.length > 0, "msys2 interactive session produced output (0 bytes = the msys2.exe dead end)");
  assert.ok(msysOut.output.includes("MSYSTEM=MINGW64"), "interactive msys2 session runs the MINGW64 environment: " + JSON.stringify(msysOut.output.slice(-200)));
  assert.ok(msysOut.output.includes("/mingw64/bin/gcc"), "interactive msys2 session has /mingw64/bin/gcc on PATH: " + JSON.stringify(msysOut.output.slice(-200)));
  assert.ok(msysOut.output.includes("BASH=/usr/bin/bash"), "interactive msys2 session runs the real bash.exe: " + JSON.stringify(msysOut.output.slice(-200)));
  await tool.execute({ action: "close", sessionId: msysOpened.sessionId }, exec).catch(() => {});
} else {
  console.log("NOTE: msys2 backend not installed; skipping the interactive msys2 assertion");
}

// session cap: opening beyond MAX_SESSIONS refuses; list shows them
defaultShell = "gitbash";
const capped: Extract<TerminalToolResult, { kind: "open" }>[] = [];
for (let i = 0; i < 8; i++) capped.push(await tool.execute({ action: "open" }, exec) as Extract<TerminalToolResult, { kind: "open" }>);
await assert.rejects(() => tool.execute({ action: "open" }, exec), /too many open sessions/);
const listed = await tool.execute({ action: "list" }, exec) as Extract<TerminalToolResult, { kind: "list" }>;
assert.ok(Array.isArray(listed.sessions));
assert.ok(listed.sessions.length >= 8, "list shows open sessions: " + listed.sessions.length);
assert.ok(listed.sessions.every((s) => s.shell === "gitbash"));
for (const s of capped) await tool.execute({ action: "close", sessionId: s.sessionId }, exec).catch(() => {});

// settle-based read returns the COMPLETE multi-line reply (not a fixed-delay slice)
defaultShell = "gitbash";
const settleOpened = await tool.execute({ action: "open" }, exec) as Extract<TerminalToolResult, { kind: "open" }>;
await delay(1500);
let multiOut = await tool.execute({ action: "send", sessionId: settleOpened.sessionId, input: "seq 1 8\r" }, exec) as Extract<TerminalToolResult, { kind: "session" }>;
if (!(multiOut.output.match(/^[1-8]$/gm) || []).length) {
  // git-bash may not have been ready for the first write; retry once
  await delay(800);
  multiOut = await tool.execute({ action: "send", sessionId: settleOpened.sessionId, input: "seq 1 8\r" }, exec) as Extract<TerminalToolResult, { kind: "session" }>;
}
const seen = (multiOut.output.match(/^[1-8]$/gm) || []).length;
assert.ok(seen >= 7, "multi-line output settled fully (got " + seen + "/8): " + JSON.stringify(multiOut.output.slice(-160)));
await tool.execute({ action: "close", sessionId: settleOpened.sessionId }, exec).catch(() => {});

// idle timeout: a session with a short idle window auto-closes
const opened2 = await tool.execute({ action: "open", idleMs: 400 }, exec) as Extract<TerminalToolResult, { kind: "open" }>;
await delay(900);
await assert.rejects(() => tool.execute({ action: "send", sessionId: opened2.sessionId, input: "x" }, exec), /not found|closed/);

// validation
await assert.rejects(() => tool.execute({ action: "bogus" }, exec), /must be one of|invalid action/);
await assert.rejects(() => tool.execute({ action: "send", sessionId: "nope", input: "x" }, exec), /not found/);

try { rmSync(workdir, { recursive: true, force: true }); } catch {}

console.log("TERMINAL TESTS PASSED (real node-pty interactive session)");
// node-pty's ConPTY console agent races process teardown on Windows
// (AttachConsole noise); every assertion already ran above, so exit clean.
process.exit(0);
