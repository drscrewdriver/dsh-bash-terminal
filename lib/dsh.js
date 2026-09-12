// Value bridge to the @deepseek-ai/* peer packages.
//
// Peer packages ship their own .d.ts, but this plugin's contract with them is
// a narrow, stable face (see ./dsh-types.ts). Every import passes through one
// narrow cast here, so the plugin compiles against any 0.1.x peer whose
// runtime behavior matches the face — no deep generic coupling, no version
// drift leaking into the rewrite.
import * as toolsNs from "@deepseek-ai/dsh-tools";
import * as sandboxNs from "@deepseek-ai/dsh-sandbox";
import { HarnessError } from "@deepseek-ai/dsh-llm";
import { parseExitStatus } from "@deepseek-ai/dsh-shell";
import { settingsNamespace } from "@deepseek-ai/dsh-settings";
import { clampTimeout, deadline, timeoutOf } from "@deepseek-ai/dsh-timeout";
import zDefault from "@deepseek-ai/schemastery";
export { HarnessError, parseExitStatus, clampTimeout, deadline, timeoutOf };
/** 0.1.x settings seam: register() takes a namespaced key built by this helper. */
export { settingsNamespace };
/** Wrap a fully specified tool spec into a registrable tool definition. */
export const defineTool = toolsNs.defineTool;
/** Sentinel code stamped on aborted tool calls. */
export const TOOL_ABORTED = toolsNs.TOOL_ABORTED;
/** Escalation modes advertised by the official sandbox seam. */
export const ESCALATION_TARGETS = sandboxNs.ESCALATION_TARGETS;
/** Official sandbox escalation (mirrors dsh-tool-bash / dsh-tool-pwsh). */
export const approveEscalation = sandboxNs.approveEscalation;
/** Fail-closed validation of the sandbox_permissions / justification pair. */
export const validateEscalationArgs = sandboxNs.validateEscalationArgs;
/** Marker appended to denied results so the UI can offer escalation. */
export const sandboxDenialMarker = sandboxNs.sandboxDenialMarker;
/** Marker appended to denied results pointing at the escalation affordance. */
export const escalationHintMarker = sandboxNs.escalationHintMarker;
export const z = zDefault;
