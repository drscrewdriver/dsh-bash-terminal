import type { BashTerminalContext, ExecAgent, JobsRegistry, JsonSchemaNode, ResolvedPaths, SandboxFacts, SandboxPolicy, ShellId, ToolRunContext } from "./dsh-types.js";
/** Stable Cordis plugin name. */
export declare const name = "bash-terminal";
/** Services required before the tool can register. */
export declare const inject: string[];
/** The terminal backends this tool exposes, in catalog order. */
export declare const SHELLS: readonly ["powershell", "gitbash", "msys2", "wsl"];
/** The backend used when the caller does not name one. */
export declare const DEFAULT_SHELL: ShellId;
/** Settings namespace backing the user-chosen default terminal. */
export declare const SETTINGS_NAMESPACE = "bash-terminal";
/** Static shape of the runtime configuration schema. */
export interface ConfigValues {
    defaultShell: string;
    timeoutMs: number;
    maxTimeoutMs: number;
    pwshPath: string;
    gitBashPath: string;
    msys2Path: string;
    wslPath: string;
}
/** Runtime configuration schema. */
export declare const Config: import("./dsh.js").SchemasterySchema;
declare function candidateExists(candidate: string): boolean;
/** Well-known PowerShell install locations plus PATH entries, newest first. */
export declare function candidatePwshPaths(env?: NodeJS.ProcessEnv): string[];
/**
 * Git for Windows locations, then PATH bash.exe entries EXCLUDING the
 * System32 launcher (c:\\windows\\system32\\bash.exe is the WSL
 * forwarder, not a Git Bash shell).
 */
export declare function candidateGitBashPaths(env?: NodeJS.ProcessEnv): string[];
/**
 * MSYS2 locations, in preference order: the real `bash.exe` under usr\bin first,
 * then bin\bash.exe, and `msys2.exe` dead last.
 *
 * msys2.exe is NOT a usable backend for piped execution: it is the console-
 * allocating Cygwin launcher, so a spawn with piped stdio returns exit 0 with
 * zero bytes on both stdout and stderr (measured on MSYS2 with bash 5.3.15).
 * Keeping it in the list only as a last-resort fallback preserves the path the
 * config docs reference, but a working bash.exe always wins.
 *
 * MSYS2 uses the same Cygwin/MSYS2 runtime as Git Bash, so it cannot run under
 * the DSH Windows ACL restricted-token sandbox.
 */
export declare function candidateMsys2Paths(env?: NodeJS.ProcessEnv): string[];
export declare function defaultWslPath(env?: NodeJS.ProcessEnv): string;
/** Executable paths, possibly undefined when a backend is not installed. */
export type { ResolvedPaths };
type PathConfig = Partial<Pick<ConfigValues, "pwshPath" | "gitBashPath" | "msys2Path" | "wslPath">>;
export declare function resolveAllPaths(config?: PathConfig, env?: NodeJS.ProcessEnv): ResolvedPaths;
export declare function buildArgv(shell: string, command: string, paths: ResolvedPaths, distro?: string): Array<string | undefined>;
/**
 * Merge the DSH_* environment over the process environment. For WSL, only
 * variables explicitly listed in WSLENV cross the boundary, so every DSH_* key is
 * appended to it (WSLENV is a `:` separated VAR[/flag] list).
 *
 * WSLENV usually already exists for reasons unrelated to us -- Windows Terminal
 * exports e.g. `WT_SESSION:WT_PROFILE_ID:` -- so the list is layered rather than
 * rebuilt, or those entries would be silently dropped from every WSL call.
 * Callers that spawn through a seam which replaces the parent environment
 * wholesale (the PTY path) must pass the inherited value explicitly.
 *
 * @param inheritedWslenv - the WSLENV the child would otherwise inherit.
 */
export declare function buildEnv(shell: string, dshEnv?: Record<string, string>, inheritedWslenv?: string | undefined): Record<string, string | undefined>;
export interface SpawnResolution {
    command: string;
    workdir: string;
    timeoutMs: number;
    stdoutMaxBytes: number;
    stdin?: string;
}
declare function spawnSpec(resolved: SpawnResolution, argv: string[], env: Record<string, string | undefined>, signal: AbortSignal): {
    readonly argv: string[];
    readonly cwd: string;
    readonly stdio: {
        readonly stdin: "ignore" | {
            data: string;
        };
        readonly stdout: {
            maxBytes: number;
            spill: {
                maxBytes: number;
            };
        };
        readonly stderr: {
            maxBytes: number;
            spill: {
                maxBytes: number;
            };
        };
    };
    readonly graceMs: 3000;
    readonly signal: AbortSignal;
    readonly env: Record<string, string | undefined>;
};
interface StreamOutput {
    text: string;
    truncated: boolean;
    spillPath?: string;
}
export interface ForegroundOutcome {
    exitCode: number | null;
    signal: string | null;
    timedOut: boolean;
    aborted: boolean;
    timeoutMs: number;
    stdout: StreamOutput;
    stderr: StreamOutput;
}
declare function runForeground(ctx: BashTerminalContext, argv: string[], resolved: SpawnResolution, env: Record<string, string | undefined>, signal: AbortSignal, timeoutMs: number): Promise<ForegroundOutcome>;
export interface ProcessRead {
    delta: string;
    lossy: boolean;
    stdoutSpillPath?: string;
    stderrSpillPath?: string;
}
interface BackgroundProc {
    status: "running" | "killed" | "completed";
    exitCode: number | null;
    signal: string | null;
    done: Promise<void>;
    readOutput(): ProcessRead;
    kill(): boolean;
}
declare function startBackground(ctx: BashTerminalContext, argv: string[], resolved: SpawnResolution, env: Record<string, string | undefined>, signal: AbortSignal): BackgroundProc;
declare function processOutcome(proc: BackgroundProc): {
    status: string;
    detail: string;
};
export interface RenderedResult {
    stdout: StreamOutput;
    stderr: StreamOutput;
    exitCode: number | null;
    signal: string | null;
    timedOut: boolean;
    timeoutMs: number;
}
export declare function renderResult(result: RenderedResult): string;
/** Model-facing lead sentence for each backend. The user's default terminal is
 * stated up front so the model never has to guess which syntax applies. */
export declare const SHELL_DESCRIPTIONS: Record<ShellId, string>;
/**
 * Render the model-facing tool description for one backend. The backend is
 * whatever the user chose in Settings -> General -> Default terminal; the
 * description names it explicitly so the model writes the right syntax.
 * @param backgroundEnabled - advertise `run_in_background` controls.
 * @param shell - active backend; unknown values fall back to the default.
 */
export declare function toolDescription(backgroundEnabled: boolean, shell?: string): string;
/** The shell tool's arguments after runtime validation. */
export type ValidatedShellArgs = {
    command: string;
    description: string;
    timeoutMs?: number;
    distro?: string;
    sandbox_permissions?: string;
    justification?: string;
    workdir?: string;
    run_in_background?: boolean;
    stdin?: string;
};
export declare function validateArgs(args: Record<string, unknown>): ValidatedShellArgs;
declare function resolveWorkdir(modelWorkdir: string | undefined, exec: ToolRunContext): string | undefined;
export interface ForegroundResult {
    kind: "foreground";
    exitCode: number | null;
    signal: string | null;
    timedOut: boolean;
    aborted: boolean;
    timeoutMs: number;
    stdout: StreamOutput;
    stderr: StreamOutput;
    sandbox?: SandboxFacts;
}
export interface BackgroundResult {
    kind: "background";
    jobId: string;
}
export type ShellToolResult = ForegroundResult | BackgroundResult;
export declare function apply(ctx: BashTerminalContext, config?: Partial<ConfigValues>): void;
export declare const internals: {
    candidateExists: typeof candidateExists;
    resolveAllPaths: typeof resolveAllPaths;
    resolveWorkdir: typeof resolveWorkdir;
    renderResult: typeof renderResult;
    processOutcome: typeof processOutcome;
    startBackground: typeof startBackground;
    runForeground: typeof runForeground;
    spawnSpec: typeof spawnSpec;
    buildEnv: typeof buildEnv;
    buildArgv: typeof buildArgv;
    validateArgs: typeof validateArgs;
    toolDescription: typeof toolDescription;
    SHELL_DESCRIPTIONS: Record<ShellId, string>;
    DEFAULT_TIMEOUT_MS: number;
    MAX_TIMEOUT_MS: number;
    DEFAULT_MAX_OUTPUT_BYTES: number;
};
export type { ExecAgent, JobsRegistry, JsonSchemaNode, SandboxFacts, SandboxPolicy, ShellId, ToolRunContext };
