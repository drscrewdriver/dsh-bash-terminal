import { apply } from "../lib/index.js";
import type { ForegroundResult } from "../lib/index.js";
import type {
  BashTerminalContext,
  PromptAssembly,
  SubprocessSpawnSpec,
  ToolDefinition,
  ToolRunContext
} from "../lib/dsh-types.js";
import assert from "node:assert";

// ---- mock ctx for apply() ----
let registered: ToolDefinition | null = null;
let userDefaultShell = "powershell"; // what the user picked in the Web UI
let sandboxMode = "danger-full-access"; // per-call sandbox policy mode
const assembleCallbacks: ((assembly: PromptAssembly, context: unknown, next: () => Promise<PromptAssembly>) => Promise<PromptAssembly>)[] = [];
const spawnCalls: SubprocessSpawnSpec[] = [];

const ctx: BashTerminalContext = {
  logger: { info: () => {} },
  systemPrompt: { section: (s) => { assert.ok(s.name === "tool:bash-terminal"); } },
  tools: { register: (tool) => { registered = tool; } },
  shellEnv: { collect: () => ({ DSH_WEB_URL: "http://127.0.0.1:3080" }) },
  settings: {
    register: ((ns: string, schema: unknown, options: { base: unknown }) => {
      assert.strictEqual(String(ns), "bash-terminal", "settings namespace");
      assert.ok(schema, "settings schema provided");
      assert.deepStrictEqual(options.base, { defaultShell: "powershell" }, "settings base");
      return { get: () => ({ defaultShell: userDefaultShell }) };
    }) as BashTerminalContext["settings"]["register"]
  },
  sandboxPolicy: {
    resolve: () => ({ mode: sandboxMode, workspaceRoot: "D:/WorkSpace", sessionId: "s1" })
  },
  sandbox: {
    confine: (argv) => ({ argv: ["sandbox-runner", "--", ...argv], enforcement: "full" })
  },
  get: (key) => key === "approval" ? { request: async () => "allowed-once" } : undefined,
  subprocess: null,
  effect: (fn) => fn(),
  on: (event, fn) => { if (event === "system-prompt/assemble") assembleCallbacks.push(fn); }
};
apply(ctx, {});
assert.ok(registered, "tool registered");
const reg = registered as ToolDefinition;
assert.strictEqual(reg.name, "shell");
assert.strictEqual(reg.parameters.properties.shell, undefined, "model-facing shell param removed");

// ---- mock subprocess + execute() ----
const fakeHandle = {
  collected: {
    stdout: { readFrom: () => ({ text: "mock-out", lossy: false, nextOffset: 1 }) },
    stderr: { readFrom: () => ({ text: "", lossy: false, nextOffset: 0 }) }
  },
  done: Promise.resolve({ exitCode: 0, signal: null }),
  terminate: () => {}
};
ctx.subprocess = {
  spawn: (spec) => { spawnCalls.push(spec); return fakeHandle; }
};

const exec: ToolRunContext = { signal: new AbortController().signal, agent: { session: { header: { cwd: "D:/WorkSpace" } } }, callId: "c1" };

// 1) user setting = powershell (default) -> powershell argv
userDefaultShell = "powershell";
const result = await reg.execute({ command: "Get-Date", description: "t" }, exec) as ForegroundResult;
assert.strictEqual(result.kind, "foreground");
assert.strictEqual(result.exitCode, 0);
assert.strictEqual(spawnCalls.length, 1);
const spec = spawnCalls[0];
assert.ok(spec.argv[0].endsWith("pwsh.exe") || spec.argv[0].endsWith("powershell.exe"), "pwsh/powershell resolved: " + spec.argv[0]);
assert.deepStrictEqual(spec.argv.slice(1, 5), ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command"]);
assert.strictEqual(spec.cwd, "D:/WorkSpace");
assert.strictEqual(spec.env!.DSH_WEB_URL, "http://127.0.0.1:3080");
assert.strictEqual(spec.graceMs, 3000);
assert.ok(spec.signal instanceof AbortSignal);

// 2) user setting = gitbash -> gitbash argv (model cannot override)
userDefaultShell = "gitbash";
spawnCalls.length = 0;
await reg.execute({ command: "echo hi", description: "test" }, exec);
assert.deepStrictEqual(spawnCalls[0].argv.slice(0, 2), ["C:\\Program Files\\Git\\bin\\bash.exe", "-lc"]);

// 3) user setting = wsl + distro + workdir
userDefaultShell = "wsl";
spawnCalls.length = 0;
await reg.execute({ command: "pwd", description: "t", distro: "Ubuntu", workdir: "projects" }, exec);
const wslPath = spawnCalls[0].argv[0];
assert.ok(wslPath.toLowerCase().endsWith("wsl.exe"), "wsl path");
assert.deepStrictEqual(spawnCalls[0].argv.slice(1), ["-d", "Ubuntu", "-e", "bash", "-lc", "pwd"]);
assert.strictEqual(spawnCalls[0].cwd, "D:\\WorkSpace\\projects");
assert.ok(spawnCalls[0].env!.WSLENV!.includes("DSH_WEB_URL"), "WSLENV should carry DSH vars");

// 4) timeout clamp: timeoutMs beyond max is capped
userDefaultShell = "powershell";
spawnCalls.length = 0;
await reg.execute({ command: "x", description: "t", timeoutMs: 99999999 }, exec);
assert.ok(spawnCalls[0].signal, "has fused signal");

// render output shape
const rendered = reg.output.render({}, { kind: "foreground", stdout: { text: "hi", truncated: false }, stderr: { text: "", truncated: false }, exitCode: 0, signal: null, timedOut: false, timeoutMs: 1, aborted: false });
assert.strictEqual(rendered[0].text, "hi");

// 5) sandbox: danger-full-access -> no confine, no sandbox facts
userDefaultShell = "powershell";
sandboxMode = "danger-full-access";
spawnCalls.length = 0;
await reg.execute({ command: "x", description: "t" }, exec);
assert.ok(!spawnCalls[0].argv.includes("sandbox-runner"), "no confine under danger-full-access");

// 6) sandbox: read-only + powershell -> confine argv through ctx.sandbox
sandboxMode = "read-only";
spawnCalls.length = 0;
const confined = await reg.execute({ command: "x", description: "t" }, exec) as ForegroundResult;
assert.strictEqual(spawnCalls[0].argv[0], "sandbox-runner", "confined argv first element is the runner");
assert.deepStrictEqual(confined.sandbox, { mode: "read-only", enforcement: "full", denied: false });

// 7) sandbox: read-only + wsl -> not confined (WSL isolation is the sandbox)
sandboxMode = "read-only";
userDefaultShell = "wsl";
spawnCalls.length = 0;
const wslConfined = await reg.execute({ command: "echo hi", description: "t" }, exec) as ForegroundResult;
assert.ok(!spawnCalls[0].argv.includes("sandbox-runner"), "wsl not confined");
assert.strictEqual(wslConfined.sandbox!.enforcement, "wsl-isolation");

// 8) sandbox: read-only + gitbash -> NOT confined (Cygwin/MSYS2 cannot run under restricted token)
userDefaultShell = "gitbash";
spawnCalls.length = 0;
const gitbashUnconfined = await reg.execute({ command: "echo hi", description: "t" }, exec) as ForegroundResult;
assert.ok(!spawnCalls[0].argv.includes("sandbox-runner"), "gitbash not confined (Cygwin/MSYS2 incompatibility)");
assert.strictEqual(gitbashUnconfined.sandbox!.enforcement, "gitbash-unconfined");

// 8b) sandbox: read-only + msys2 -> NOT confined (Cygwin/MSYS2 cannot run under restricted token)
userDefaultShell = "msys2";
spawnCalls.length = 0;
const msys2Unconfined = await reg.execute({ command: "ls", description: "t" }, exec) as ForegroundResult;
assert.ok(!spawnCalls[0].argv.includes("sandbox-runner"), "msys2 not confined (Cygwin/MSYS2 incompatibility)");
assert.strictEqual(msys2Unconfined.sandbox!.enforcement, "msys2-unconfined");

// 9) sandbox escalation: sandbox_permissions + justification widens policy
userDefaultShell = "powershell";
sandboxMode = "read-only";
spawnCalls.length = 0;
const escalated = await reg.execute({ command: "x", description: "t", sandbox_permissions: "danger-full-access", justification: "need full access for the test" }, exec) as ForegroundResult;
assert.strictEqual(escalated.sandbox, undefined, "danger-full-access approved -> no confine");

// 10) escalation pairing validation
await assert.rejects(() => reg.execute({ command: "x", description: "t", sandbox_permissions: "workspace-write" }, exec), /justification/);
await assert.rejects(() => reg.execute({ command: "x", description: "t", justification: "why" }, exec), /sandbox_permissions/);

// 11) params advertise escalation modes
assert.ok(reg.parameters.properties.sandbox_permissions, "sandbox_permissions advertised");
assert.deepStrictEqual(reg.parameters.properties.sandbox_permissions!.enum, ["workspace-write", "danger-full-access"]);

// 12) fail-closed: sandbox backend unavailable -> SandboxUnavailableError-like rejection (powershell)
sandboxMode = "read-only";
userDefaultShell = "powershell";
const realConfine = ctx.sandbox.confine;
ctx.sandbox.confine = () => { throw new Error("sandbox mode \"read-only\" is requested but no sandbox backend is usable on this host"); };
await assert.rejects(() => reg.execute({ command: "x", description: "t" }, exec), /no sandbox backend/);
ctx.sandbox.confine = realConfine;

// invalid args throw
await assert.rejects(() => reg.execute({ command: "", description: "t" }, exec));

// settings schema rejects an out-of-enum user value
userDefaultShell = "fish";
await assert.rejects(() => reg.execute({ command: "x", description: "t" }, exec));

console.log("APPLY/EXECUTE MOCK TESTS PASSED");
