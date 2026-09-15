// Hand-written boundary types for the DSH seams this plugin consumes.
//
// The @deepseek-ai/* packages ship their own .d.ts, but their full generic
// surface (cordis Context augmentation, agent/session graphs) is far wider
// than what a plugin touches. These structural types describe exactly the
// face this plugin programs against — call them the plugin's side of the
// contract. Value imports stay on the real packages (see ./dsh.ts); only
// the shapes live here, so peer version drift cannot ripple into this tree.

// ---- shared ------------------------------------------------------------------

/** The terminal backends this plugin exposes. */
export type ShellId = "powershell" | "gitbash" | "msys2" | "wsl";

/** Permissive node of the DSH JSON-schema dialect used in tool output declarations. */
export interface JsonSchemaNode {
  type?: string;
  required?: boolean;
  const?: string;
  enum?: readonly string[];
  properties?: Record<string, JsonSchemaNode>;
  items?: JsonSchemaNode;
  oneOf?: JsonSchemaNode[];
  additionalProperties?: boolean;
}

/** Model-facing content block (subset). */
export interface ContentBlock {
  type: string;
  text?: string;
}

// ---- tool surface ------------------------------------------------------------

/** One entry of a tool's `parameters` declaration. */
export interface ToolParameterProperty {
  type: string;
  required?: boolean;
  description?: string;
  enum?: readonly string[];
}

export interface ToolParameters {
  type: "object";
  properties: Record<string, ToolParameterProperty>;
}

/** Flat parameter map as accepted by defineTool (wrapped into `ToolParameters` by the runtime). */
export type ToolParameterMap = Record<string, ToolParameterProperty>;

/** The exec object every tool body receives. */
export interface ToolRunContext {
  /** Caller cancellation; observe or forward it in async work. */
  signal: AbortSignal;
  callId?: string;
  agent?: ExecAgent;
}

/** The agent slice of exec this plugin reads (session cwd) or passes on (owner). */
export interface ExecAgent {
  session: { header: { cwd?: string } };
}

export interface ToolResult {
  content: ContentBlock[];
  isError?: boolean;
}

/** Tool output view handed to presentResult. */
export interface CallView {
  card: string;
  [key: string]: unknown;
}

/** A fully specified tool: schema, canonical output, body, presentations. */
export interface ToolSpec<TValue> {
  name: string;
  description: string;
  parameters: ToolParameterMap;
  output: {
    schema: JsonSchemaNode;
    render: (args: unknown, value: TValue) => ContentBlock[];
  };
  execute: (args: Record<string, unknown>, exec: ToolRunContext) => Promise<TValue>;
  presentCall?: (args: Record<string, unknown>) => CallView;
  presentResult?: (args: Record<string, unknown>, result: ToolResult) => CallView | undefined;
}

/** Canonical output declaration, erased of the tool's value type (registry face). */
export interface ToolOutputDefinition {
  schema: JsonSchemaNode;
  render: (args: unknown, value: unknown) => ContentBlock[];
}

/** What defineTool hands back (opaque to the plugin; registered as-is). */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameters;
  output: ToolOutputDefinition;
  execute: (args: Record<string, unknown>, exec: ToolRunContext) => Promise<unknown>;
}

// ---- ctx services ------------------------------------------------------------

export interface LoggerSeam {
  info?: (message: string) => void;
  warn?: (message: string) => void;
  error?: (message: string) => void;
}

export interface SystemPromptSection {
  name: string;
  order: number;
  text: string;
}

export interface SystemPromptSeam {
  section(spec: SystemPromptSection): unknown;
}

export interface ToolsSeam {
  register(tool: ToolDefinition): unknown;
}

/** A tool entry seen during system-prompt assembly (description re-render). */
export interface AssembledToolRef {
  name: string;
  description?: string;
}

export interface PromptAssembly {
  tools: AssembledToolRef[];
  [key: string]: unknown;
}

/** Type of the system-prompt/assemble waterfall listener. */
export type AssembleHandler = (
  assembly: PromptAssembly,
  context: unknown,
  next: () => Promise<PromptAssembly>
) => Promise<PromptAssembly>;

export interface ShellEnvSeam {
  collect(exec: ToolRunContext): Record<string, string> | undefined;
}

export interface SettingsScope<T> {
  get(): T;
}

export interface SettingsSeam {
  register<T>(namespace: string, schema: unknown, options: { base: T }): SettingsScope<T>;
}

// ---- sandbox ------------------------------------------------------------------

export interface SandboxPolicy {
  mode: string;
  workspaceRoot?: string;
  sessionId?: string;
}

export interface SandboxPolicySeam {
  resolve(scope: { session?: unknown }): SandboxPolicy;
}

export interface SandboxConfineResult {
  argv: string[];
  enforcement: string;
  denialSignatures?: string[];
}

export interface SandboxSeam {
  confine(argv: string[], policy: SandboxPolicy): SandboxConfineResult;
}

/** Sandbox facts embedded in a canonical result. */
export interface SandboxFacts {
  mode: string;
  enforcement: string;
  denialSignatures?: string[];
  denied?: boolean;
}

export interface EscalationRequest {
  requestedMode: string;
  justification: string;
  effectiveMode: string;
  subject: string;
}

export interface EscalationContext {
  approver?: unknown;
  agent?: unknown;
  callId?: string;
  toolName: string;
  signal: AbortSignal;
}

// ---- background jobs ------------------------------------------------------------

export interface JobHooks {
  cancel: () => void;
  done: Promise<unknown>;
  readOutput: () => string;
}

export interface JobSpec {
  kind: string;
  label: string;
  owner?: unknown;
  run: () => JobHooks;
}

export interface JobsRegistry {
  start(spec: JobSpec): string;
}

// ---- subprocess seam ------------------------------------------------------------

/** Executable paths per backend; undefined when a backend is not installed. */
export interface ResolvedPaths {
  pwsh?: string;
  gitbash?: string;
  msys2?: string;
  wsl?: string;
}

export interface CollectSpec {
  maxBytes: number;
  spill: { maxBytes: number };
}

export interface StdioSpec {
  stdin: { data: string } | "ignore";
  stdout: CollectSpec;
  stderr: CollectSpec;
}

export interface SubprocessSpawnSpec {
  argv: string[];
  cwd?: string;
  stdio: StdioSpec;
  graceMs: number;
  signal?: AbortSignal;
  env?: Record<string, string | undefined>;
}

export interface CollectedStream {
  readFrom(offset: number): { text: string; lossy: boolean; nextOffset: number; spillPath?: string };
}

export interface SubprocessOutcome {
  exitCode: number | null;
  signal: string | null;
}

export interface SubprocessHandle {
  collected: { stdout: CollectedStream; stderr: CollectedStream };
  done: Promise<SubprocessOutcome>;
  terminate: () => void | Promise<void>;
}

export interface TerminalSpawnSpec {
  argv: string[];
  cwd: string;
  env: Record<string, string | undefined>;
  rows: number;
  cols: number;
  graceMs?: number;
}

export interface TerminalHandle {
  pid: number;
  output: NodeJS.ReadableStream;
  done: Promise<SubprocessOutcome>;
  write(data: string): void | Promise<void>;
  signalForeground(sig: string): void | Promise<unknown>;
  terminate(): Promise<void>;
}

export interface SubprocessSeam {
  spawn(spec: SubprocessSpawnSpec): SubprocessHandle;
  spawnTerminal?(spec: TerminalSpawnSpec): Promise<TerminalHandle>;
}

// ---- approval ------------------------------------------------------------------

export interface ApprovalSeam {
  request(input: unknown): Promise<unknown>;
}

// ---- plugin context (server side) ----------------------------------------------

/**
 * The structural context face dsh-bash-terminal-ts programs against: the union
 * of every `ctx.*` member touched by src/index.ts and src/terminal.ts.
 */
export interface BashTerminalContext {
  logger?: LoggerSeam;
  systemPrompt: SystemPromptSeam;
  tools: ToolsSeam;
  on(event: "system-prompt/assemble", handler: AssembleHandler): void;
  shellEnv: ShellEnvSeam;
  settings: SettingsSeam;
  sandboxPolicy: SandboxPolicySeam;
  sandbox: SandboxSeam;
  get(key: string): unknown;
  effect(fn: () => void | (() => void), name?: string): unknown;
  /** Injected via `inject: ["subprocess"]`; tests may defer assignment. */
  subprocess: SubprocessSeam | null;
}
