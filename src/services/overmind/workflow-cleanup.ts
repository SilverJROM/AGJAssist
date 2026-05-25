import type { NudgeStateService } from "../nudge-state-service.js";
import type { WatcherCooldowns } from "./cooldowns.js";
import type { EvidenceReader } from "./evidence-reader.js";

export interface WorkflowCleanupDeps {
  cooldowns: WatcherCooldowns;
  nudgeState?: NudgeStateService;
  childPaneHashes: Map<number, Map<string, string>>;
  lastReconcileAsk: Map<number, string>;
  subagentInFlight: Map<number, unknown>;
  apparentIdleSince: Map<number, number>;
  evidenceReader: EvidenceReader;
}

export function cleanupWorkflowState(
  workflowId: number,
  deps: WorkflowCleanupDeps
): void {
  deps.cooldowns.forgetKey(workflowId, "unified_idle_nudge");
  deps.cooldowns.forgetKey(workflowId, "evidence_read");
  deps.evidenceReader.forget(workflowId);
  deps.lastReconcileAsk.delete(workflowId);
  deps.childPaneHashes.delete(workflowId);
  deps.subagentInFlight.delete(workflowId);
  deps.apparentIdleSince.delete(workflowId);
  deps.nudgeState?.forgetWorkflow(workflowId);
}
