import path from "node:path";

export const OVERMIND_PROJECT = path.basename(process.cwd());
export const OVERMIND_AGENT = "overmind";

export interface OvermindNotificationWorkflow {
  label: string;
  display_name?: string | null;
  run_dir?: string;
}

export interface UnresolvedNotificationInput {
  workflow: OvermindNotificationWorkflow;
  issue: string;
  checked: string;
  reason: string;
}

export interface ParentOrphanedNotificationInput {
  workflow: OvermindNotificationWorkflow;
  parentSession: string;
  paneKind: "bare-bash" | "no-session";
}

export function buildDoneNotification(workflow: OvermindNotificationWorkflow): string {
  const name = workflowDisplayName(workflow);
  return [
    `🎉 DONE · ${OVERMIND_PROJECT} · ${OVERMIND_AGENT}`,
    "",
    `✅ ${name} completed.`,
    "Verified: workflow reported completed through the overmind lifecycle endpoint.",
    `Where: ${workflow.run_dir || name}`,
    "",
    "➡️ Next: none — review at leisure"
  ].join("\n");
}

export function buildBlockedNotification(input: UnresolvedNotificationInput): string {
  const name = workflowDisplayName(input.workflow);
  return [
    `🛑 BLOCKED · ${OVERMIND_PROJECT} · ${OVERMIND_AGENT}`,
    "",
    `⛔ ${name} is stopped and needs you.`,
    `Blocker: ${compactLine(input.issue)}`,
    `Checked: ${input.checked}`,
    `Why unresolved: ${compactLine(input.reason)}`,
    `Where: ${input.workflow.run_dir || name}`,
    "",
    "Need from you: provide the missing unblocker in the coordinator workflow"
  ].join("\n");
}

export function buildNeedsInputNotification(input: UnresolvedNotificationInput): string {
  const name = workflowDisplayName(input.workflow);
  return [
    `🚨 URGENT · ${OVERMIND_PROJECT} · ${OVERMIND_AGENT}`,
    "",
    `❓ ${name} needs a decision before it can continue.`,
    `Question: ${compactLine(input.issue)}`,
    `Why you: ${compactLine(input.reason)}`,
    "If unanswered: holding until you reply",
    `Where: ${input.workflow.run_dir || name}`,
    `Checked: ${input.checked}`
  ].join("\n");
}

export interface GuardianEscalationInput {
  runId: string;
  severity: "BLOCKED" | "URGENT";
  title: string;
  lines: string[];
  action: string;
}

export function buildGuardianEscalationNotification(input: GuardianEscalationInput): string {
  const emoji = input.severity === "BLOCKED" ? "🛑" : "🚨";
  const verdictGlyph = input.severity === "BLOCKED" ? "⛔" : "❓";
  return [
    `${emoji} ${input.severity} · ${OVERMIND_PROJECT} · guardian`,
    "",
    `${verdictGlyph} ${compactLine(input.title)}`,
    `Run: ${input.runId}`,
    ...input.lines.map((line) => compactLine(line)),
    "",
    `Need from you: ${compactLine(input.action)}`
  ].join("\n");
}

export function buildParentOrphanedNotification(input: ParentOrphanedNotificationInput): string {
  const name = workflowDisplayName(input.workflow);
  return [
    `🚨 URGENT · ${OVERMIND_PROJECT} · ${OVERMIND_AGENT}`,
    "",
    `⚠️ ${name} parent session is orphaned.`,
    `Parent: ${input.parentSession}`,
    `Detected: ${input.paneKind}`,
    "Action taken: suppressed the outbound Overmind nudge before it could paste into the parent pane.",
    `Where: ${input.workflow.run_dir || name}`
  ].join("\n");
}

function workflowDisplayName(workflow: OvermindNotificationWorkflow): string {
  return workflow.display_name || workflow.label;
}

function compactLine(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" / ")
    .slice(0, 900) || "<not provided>";
}
