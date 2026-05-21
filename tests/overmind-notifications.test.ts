import { describe, expect, it } from "vitest";
import {
  buildBlockedNotification,
  buildDoneNotification,
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
});
