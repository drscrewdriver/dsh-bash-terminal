import type { BashTerminalContext, ResolvedPaths, TerminalHandle } from "./dsh-types.js";
declare const TERMINAL_SIGNALS: readonly ["SIGINT", "SIGTERM", "SIGKILL", "SIGTSTP", "SIGHUP"];
export type TerminalSignal = (typeof TERMINAL_SIGNALS)[number];
interface TerminalBufferRead {
    delta: string;
    nextOffset: number;
    truncated: boolean;
}
interface TerminalBuffer {
    append(chunk: string): void;
    readFrom(offset: number): TerminalBufferRead;
    snapshot(): string;
    wasTruncated(): boolean;
    lastAppendAt(): number;
}
/** Interactive-shell argv (no -c: the terminal itself is the session). */
export declare function terminalArgv(shell: string, paths: ResolvedPaths, distro?: string): Array<string | undefined>;
export interface TerminalSessionInfo {
    sessionId: string;
    shell: string;
    pid: number;
    closed: boolean;
}
interface TerminalSession {
    id: string;
    handle: TerminalHandle;
    buffer: TerminalBuffer;
    shell: string;
    distro?: string;
    closed: boolean;
    idleMs: number;
    idleTimer?: NodeJS.Timeout;
    touch: () => void;
}
export interface TerminalOpenOptions {
    argv: string[];
    shell: string;
    cwd: string;
    env: Record<string, string | undefined>;
    rows: number;
    cols: number;
    distro?: string;
    initial?: string;
    idleMs?: number;
}
export interface TerminalRegistry {
    open(options: TerminalOpenOptions): Promise<TerminalSession>;
    get(id: string): TerminalSession;
    send(id: string, input: string): Promise<TerminalBufferRead>;
    read(id: string): TerminalBufferRead;
    signal(id: string, sig: string): Promise<TerminalBufferRead>;
    close(id: string): Promise<boolean>;
    list(): TerminalSessionInfo[];
}
/**
 * Terminal-session registry owned by the plugin fiber: opens PTYs through
 * the official seam, forwards output into a capped buffer, and tears every
 * session down on plugin disposal.
 */
export declare function createTerminalRegistry(ctx: BashTerminalContext): TerminalRegistry;
/** The terminal tool's arguments after runtime validation (discriminated by action). */
export type ValidatedTerminalArgs = {
    action: "open";
    sessionId?: string;
    command?: string;
    distro?: string;
    workdir?: string;
    idleMs?: number;
} | {
    action: "send";
    sessionId: string;
    input: string;
} | {
    action: "read";
    sessionId: string;
} | {
    action: "signal";
    sessionId: string;
    signal: TerminalSignal;
} | {
    action: "close";
    sessionId: string;
} | {
    action: "list";
};
export declare function validateArgs(args: Record<string, unknown>): asserts args is ValidatedTerminalArgs;
export interface TerminalOpenResult {
    kind: "open";
    sessionId: string;
    jobId?: string;
    pid: number;
    shell: string;
    output: string;
}
export interface TerminalSessionResult {
    kind: "session";
    output: string;
    truncated?: boolean;
}
export interface TerminalClosedResult {
    kind: "closed";
    sessionId: string;
}
export interface TerminalListResult {
    kind: "list";
    sessions: TerminalSessionInfo[];
}
export type TerminalToolResult = TerminalOpenResult | TerminalSessionResult | TerminalClosedResult | TerminalListResult;
export declare function terminalTool(ctx: BashTerminalContext, registry: TerminalRegistry, paths: ResolvedPaths, defaultShell: () => string): import("./dsh-types.js").ToolDefinition;
export {};
