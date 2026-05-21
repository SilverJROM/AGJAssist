import path from "node:path";

export const OVERMIND_PROJECT = path.basename(process.cwd());
export const OVERMIND_AGENT = "overmind";

export interface OvermindNotificationWorkflow {
  label: string;
  run_dir?: string;
}

export interface UnresolvedNotificationInput {
  workflow: OvermindNotificationWorkflow;
  issue: string;
  checked: string;
  reason: string;
}

export function buildDoneNotification(workflow: OvermindNotificationWorkflow): string {
  return [
    `🎉 DONE · ${OVERMIND_PROJECT} · ${OVERMIND_AGENT}`,
    "",
    `✅ ${workflow.label} completed.`,
    "Verified: workflow reported completed through the overmind lifecycle endpoint.",
    `Where: ${workflow.run_dir || workflow.label}`,
    "",
    "➡️ Next: none — review at leisure"
  ].join("\n");
}

export function buildBlockedNotification(input: UnresolvedNotificationInput): string {
  return [
    `🛑 BLOCKED · ${OVERMIND_PROJECT} · ${OVERMIND_AGENT}`,
    "",
    `⛔ ${input.workflow.label} is stopped and needs you.`,
    `Blocker: ${compactLine(input.issue)}`,
    `Checked: ${input.checked}`,
    `Why unresolved: ${compactLine(input.reason)}`,
    `Where: ${input.workflow.run_dir || input.workflow.label}`,
    "",
    "Need from you: provide the missing unblocker in the coordinator workflow"
  ].join("\n");
}

export function buildNeedsInputNotification(input: UnresolvedNotificationInput): string {
  return [
    `🚨 URGENT · ${OVERMIND_PROJECT} · ${OVERMIND_AGENT}`,
    "",
    `❓ ${input.workflow.label} needs a decision before it can continue.`,
    `Question: ${compactLine(input.issue)}`,
    `Why you: ${compactLine(input.reason)}`,
    "If unanswered: holding until you reply",
    `Where: ${input.workflow.run_dir || input.workflow.label}`,
    `Checked: ${input.checked}`
  ].join("\n");
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
