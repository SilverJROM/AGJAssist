import { describe, expect, it } from "vitest";
import {
  buildBlockedNotification,
  buildDoneNotification,
  buildGuardianEscalationNotification,
  buildNeedsInputNotification
} from "../src/services/overmind-notifications.js";

describe("overmind notification formatting", () => {
  const workflow = {
    label: "projcore W1",
    run_dir: "/tmp/projcore-W1"
  };

  it("builds verdict-led DONE messages", () => {
    const message = buildDoneNotification(workflow);

    expect(message).toContain("🎉 DONE · AGJAssist · overmind");
    expect(message).toContain("✅ projcore W1 completed.");
    expect(message).toContain("Verified:");
    expect(message).toContain("Where: /tmp/projcore-W1");
    expect(message).toContain("➡️ Next:");
  });

  it("uses display_name when a workflow has a custom name", () => {
    const renamedWorkflow = {
      ...workflow,
      display_name: "JROM Rename"
    };

    expect(buildDoneNotification(renamedWorkflow)).toContain("✅ JROM Rename completed.");
    expect(buildBlockedNotification({
      workflow: renamedWorkflow,
      issue: "Coordinator says NEEDS-INFO from JROM.",
      checked: "workflow north-star.md",
      reason: "No supplied context covers the missing credential."
    })).toContain("⛔ JROM Rename is stopped and needs you.");
    expect(buildNeedsInputNotification({
      workflow: renamedWorkflow,
      issue: "Which undocumented scope expansion should be accepted?",
      checked: "workflow north-star.md",
      reason: "No prior decision covers this expansion."
    })).toContain("❓ JROM Rename needs a decision before it can continue.");
  });

  it("builds verdict-led BLOCKED messages", () => {
    const message = buildBlockedNotification({
      workflow,
      issue: "Coordinator says NEEDS-INFO from JROM.",
      checked: "workflow north-star.md, trust-defaults.md, and relevance-filtered prior decisions",
      reason: "No supplied context covers the missing credential."
    });

    expect(message).toContain("🛑 BLOCKED · AGJAssist · overmind");
    expect(message).toContain("⛔ projcore W1 is stopped and needs you.");
    expect(message).toContain("Blocker:");
    expect(message).toContain("Checked:");
    expect(message).toContain("Need from you:");
  });

  it("builds verdict-led needs-input messages", () => {
    const message = buildNeedsInputNotification({
      workflow,
      issue: "Which undocumented scope expansion should be accepted?",
      checked: "workflow north-star.md, trust-defaults.md, and relevance-filtered prior decisions",
      reason: "No prior decision covers this expansion."
    });

    expect(message).toContain("🚨 URGENT · AGJAssist · overmind");
    expect(message).toContain("❓ projcore W1 needs a decision before it can continue.");
    expect(message).toContain("Question:");
    expect(message).toContain("Why you:");
    expect(message).toContain("If unanswered:");
  });

  it("builds verdict-led guardian escalation messages for BLOCKED", () => {
    const message = buildGuardianEscalationNotification({
      runId: "app-fixes-v2",
      severity: "BLOCKED",
      title: "coordinator session died",
      lines: ["session: rs-grok", "agent: grok45", "batch: B24c"],
      action: "restart rs-grok and reseed projcore from context-handoff.md"
    });

    expect(message).toContain("🛑 BLOCKED · AGJAssist · guardian");
    expect(message).toContain("⛔ coordinator session died");
    expect(message).toContain("Run: app-fixes-v2");
    expect(message).toContain("session: rs-grok");
    expect(message).toContain("Need from you: restart rs-grok and reseed projcore from context-handoff.md");
  });

  it("builds verdict-led guardian escalation messages for URGENT", () => {
    const message = buildGuardianEscalationNotification({
      runId: "app-fixes-v2",
      severity: "URGENT",
      title: "ambiguous scope decision",
      lines: ["batch: B25"],
      action: "confirm whether to include the migration"
    });

    expect(message).toContain("🚨 URGENT · AGJAssist · guardian");
    expect(message).toContain("❓ ambiguous scope decision");
  });
});
