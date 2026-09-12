import { HarnessError } from "@deepseek-ai/dsh-llm";
import { parseExitStatus } from "@deepseek-ai/dsh-shell";
import { clampTimeout, deadline, timeoutOf } from "@deepseek-ai/dsh-timeout";
import type { EscalationContext, EscalationRequest, JsonSchemaNode, ToolDefinition, ToolSpec } from "./dsh-types.js";
export { HarnessError, parseExitStatus, clampTimeout, deadline, timeoutOf };
/** Wrap a fully specified tool spec into a registrable tool definition. */
export declare const defineTool: <TValue>(spec: ToolSpec<TValue>) => ToolDefinition;
/** Sentinel code stamped on aborted tool calls. */
export declare const TOOL_ABORTED: string;
/** Escalation modes advertised by the official sandbox seam. */
export declare const ESCALATION_TARGETS: readonly string[];
/** Official sandbox escalation (mirrors dsh-tool-bash / dsh-tool-pwsh). */
export declare const approveEscalation: (request: EscalationRequest, context: EscalationContext) => Promise<string>;
/** Fail-closed validation of the sandbox_permissions / justification pair. */
export declare const validateEscalationArgs: (permissions: unknown, justification: unknown) => void;
/** Marker appended to denied results so the UI can offer escalation. */
export declare const sandboxDenialMarker: (mode: string) => string;
/** Marker appended to denied results pointing at the escalation affordance. */
export declare const escalationHintMarker: (subject: string) => string;
/** Runtime config schema factory (schemastery fork). */
export interface SchemasterySchema {
    default(value: unknown): SchemasterySchema;
}
export interface Schemastery {
    object(fields: Record<string, SchemasterySchema>): SchemasterySchema;
    string(): SchemasterySchema;
    number(): SchemasterySchema;
    const(value: string): SchemasterySchema;
    union(schemas: SchemasterySchema[]): SchemasterySchema;
}
export declare const z: Schemastery;
/** Re-exported for consumers that want to validate output schemas. */
export type { JsonSchemaNode };
