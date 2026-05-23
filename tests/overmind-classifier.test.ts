import { describe, expect, it } from "vitest";
import {
  classifyChildSessionStatus,
  classifyParentSession,
  classifyWorkflow
} from "../src/services/overmind/classifier.js";
import { determineActiveSessionAttribution } from "../src/services/overmind/active-session-attribution.js";
import { extractBody, hashPane, hasActiveTurn } from "../src/services/overmind/pane-utils.js";

const NOW = "2026-05-21T12:00:00.000Z";

describe("extractBody", () => {
  it("strips chrome-only monitor and timer drift from the activity body", () => {
    const first = [
      "Coordinator output",
      "────────────",
      "◦ Waiting for background terminal (11m 13s) · 3 monitors · /ps to view",
      "› Type a message",
      "gpt-5.3-codex · ~/TGBOTS/AGJAssist"
    ].join("\n");
    const second = [
      "Coordinator output",
      "────────────",
      "• Waiting for background terminal (11m 16s) · 5 monitors · /ps to view",
      "› Type a message",
      "gpt-5.3-codex · ~/TGBOTS/AGJAssist"
    ].join("\n");

    expect(extractBody(first)).toBe("Coordinator output");
    expect(extractBody(second)).toBe("Coordinator output");
    expect(hashPane(first)).toBe(hashPane(second));
  });

  it("keeps substantive pane body content distinct after stripping chrome", () => {
    const timerOnly = "◦ Waiting for background terminal (11m 13s) · 2 background terminals running · /ps to view";
    const realOutput = [
      timerOnly,
      "Created migration file src/db/migrations/004_add_jobs.sql"
    ].join("\n");

    expect(extractBody(timerOnly)).toBe("");
    expect(extractBody(realOutput)).toBe("Created migration file src/db/migrations/004_add_jobs.sql");
    expect(hashPane(realOutput)).not.toBe(hashPane(timerOnly));
  });

  it("detects active turns independently from body changes", () => {
    expect(hasActiveTurn("◦ Waiting for background terminal (11m 13s • esc to interrupt)")).toBe(true);
    expect(hasActiveTurn("◦ Waiting for background terminal (11m 13s)")).toBe(false);
  });

  it("does not treat persistent status-bar esc hints as active turns", () => {
    const pane = [
      "›",
      "⏵⏵ bypass permissions on (shift+tab to cycle) · esc to interrupt · ctrl+t to hide tasks"
    ].join("\n");

    expect(hasActiveTurn(pane)).toBe(false);
  });

  it("treats real spinner esc lines as active turns", () => {
    expect(hasActiveTurn("✻ Working… (5s · esc to interrupt)")).toBe(true);
  });
});

describe("classifyWorkflow", () => {
  it("classifies changed child panes as working and resets stuck state", () => {
    const result = classifyWorkflow({
      coordinatorPane: "idle coordinator",
      childPanes: ["Working (12s)\nesc to interrupt"],
      childPaneHashChanged: true,
      coordinatorHashPrev: null,
      mtimeAdvanced: false,
      stuckSincePrev: "2026-05-21T11:59:00.000Z",
      now: NOW
    });

    expect(result.status).toBe("working");
    expect(result.stuckSince).toBeNull();
    expect(result.pendingDecision).toBeNull();
    expect(result.lastActivityAt).toBe(NOW);
  });

  it("classifies an active-turn pane as working even when the body hash is unchanged", () => {
    const coordinatorPane = [
      "same quiet coordinator pane",
      "✻ Working… (5s · esc to interrupt)"
    ].join("\n");

    const result = classifyWorkflow({
      coordinatorPane,
      childPanes: [],
      childPaneHashChanged: false,
      coordinatorHashPrev: hashPane(coordinatorPane),
      mtimeAdvanced: false,
      stuckSincePrev: "2026-05-21T11:58:29.000Z",
      now: NOW
    });

    expect(result.status).toBe("working");
    expect(result.stuckSince).toBeNull();
    expect(result.lastActivityAt).toBe(NOW);
  });

  it("classifies frozen Waiting for recap text past the threshold as stuck", () => {
    const coordinatorPane = [
      "Recap:",
      "Waiting for codex proposal review from earlier.",
      "No composer activity."
    ].join("\n");

    const result = classifyWorkflow({
      coordinatorPane,
      childPanes: ["quiet child pane"],
      childPaneHashChanged: false,
      coordinatorHashPrev: hashPane(coordinatorPane),
      mtimeAdvanced: false,
      stuckSincePrev: "2026-05-21T11:58:29.000Z",
      now: NOW
    });

    expect(result.status).toBe("stuck");
    expect(result.stuckSince).toBe("2026-05-21T11:58:29.000Z");
    expect(result.lastActivityAt).toBeNull();
  });

  it("classifies coordinator pane hash changes as working", () => {
    const coordinatorPane = "new coordinator output";
    const result = classifyWorkflow({
      coordinatorPane,
      childPanes: [],
      childPaneHashChanged: false,
      coordinatorHashPrev: hashPane("previous coordinator output"),
      mtimeAdvanced: false,
      stuckSincePrev: null,
      now: NOW
    });

    expect(result.status).toBe("working");
    expect(result.coordinatorHash).toBe(hashPane(coordinatorPane));
    expect(result.lastActivityAt).toBe(NOW);
  });

  it("classifies a frozen coordinator with a changed child pane as working", () => {
    const coordinatorPane = "same quiet coordinator pane";
    const result = classifyWorkflow({
      coordinatorPane,
      childPanes: ["new child output"],
      childPaneHashChanged: true,
      coordinatorHashPrev: hashPane(coordinatorPane),
      mtimeAdvanced: false,
      stuckSincePrev: "2026-05-21T11:58:29.000Z",
      now: NOW
    });

    expect(result.status).toBe("working");
    expect(result.stuckSince).toBeNull();
    expect(result.lastActivityAt).toBe(NOW);
  });

  it("does not treat child timer-only chrome drift as working past the stuck threshold", () => {
    const coordinatorPane = "same quiet coordinator pane";
    const firstChildPane = "◦ Waiting for background terminal (11m 13s) · 3 monitors · /ps to view";
    const secondChildPane = "• Waiting for background terminal (11m 16s) · 5 monitors · /ps to view";

    const result = classifyWorkflow({
      coordinatorPane,
      childPanes: [secondChildPane],
      childPaneHashChanged: hashPane(firstChildPane) !== hashPane(secondChildPane),
      coordinatorHashPrev: hashPane(coordinatorPane),
      mtimeAdvanced: false,
      stuckSincePrev: "2026-05-21T11:58:29.000Z",
      now: NOW
    });

    expect(hashPane(firstChildPane)).toBe(hashPane(secondChildPane));
    expect(result.status).toBe("stuck");
    expect(result.lastActivityAt).toBeNull();
  });

  it("still treats substantive child pane output as working", () => {
    const coordinatorPane = "same quiet coordinator pane";
    const firstChildPane = "Waiting for background terminal";
    const secondChildPane = [
      "Waiting for background terminal",
      "Implemented normalizePaneForActivity in overmind-watcher.ts"
    ].join("\n");

    const result = classifyWorkflow({
      coordinatorPane,
      childPanes: [secondChildPane],
      childPaneHashChanged: hashPane(firstChildPane) !== hashPane(secondChildPane),
      coordinatorHashPrev: hashPane(coordinatorPane),
      mtimeAdvanced: false,
      stuckSincePrev: "2026-05-21T11:58:29.000Z",
      now: NOW
    });

    expect(hashPane(firstChildPane)).not.toBe(hashPane(secondChildPane));
    expect(result.status).toBe("working");
    expect(result.lastActivityAt).toBe(NOW);
  });

  it("classifies run directory mtime advancement as working", () => {
    const coordinatorPane = "same coordinator output";
    const result = classifyWorkflow({
      coordinatorPane,
      childPanes: [],
      childPaneHashChanged: false,
      coordinatorHashPrev: hashPane(coordinatorPane),
      mtimeAdvanced: true,
      stuckSincePrev: null,
      now: NOW
    });

    expect(result.status).toBe("working");
    expect(result.lastActivityAt).toBe(NOW);
  });

  it("classifies coordinator decision menus as awaiting_decision with captured prompt text", () => {
    const coordinatorPane = [
      "Merge / test choice",
      "Pick the next action",
      "1. Run targeted tests",
      "2. Merge the branch",
      "Enter to select · Tab/Arrow keys to navigate",
      "Type something"
    ].join("\n");

    const result = classifyWorkflow({
      coordinatorPane,
      childPanes: [],
      childPaneHashChanged: false,
      coordinatorHashPrev: hashPane(coordinatorPane),
      mtimeAdvanced: false,
      stuckSincePrev: null,
      now: NOW
    });

    expect(result.status).toBe("awaiting_decision");
    expect(result.pendingDecision).toContain("Pick the next action");
    expect(result.pendingDecision).toContain("1. Run targeted tests");
    expect(result.pendingDecision).toContain("Enter to select");
    expect(result.lastActivityAt).toBeNull();
  });

  it("classifies plain pending human questions as waiting_human", () => {
    const coordinatorPane = "NEEDS-INFO: please confirm whether QA should run the slow suite.";

    const result = classifyWorkflow({
      coordinatorPane,
      childPanes: [],
      childPaneHashChanged: false,
      coordinatorHashPrev: hashPane(coordinatorPane),
      mtimeAdvanced: false,
      stuckSincePrev: null,
      now: NOW
    });

    expect(result.status).toBe("waiting_human");
    expect(result.pendingDecision).toBeNull();
    expect(result.stuckSince).toBeNull();
    expect(result.lastActivityAt).toBeNull();
  });

  it("keeps sub-threshold frozen panes working while preserving last activity", () => {
    const coordinatorPane = "same quiet pane";

    const result = classifyWorkflow({
      coordinatorPane,
      childPanes: [],
      childPaneHashChanged: false,
      coordinatorHashPrev: hashPane(coordinatorPane),
      mtimeAdvanced: false,
      stuckSincePrev: "2026-05-21T11:59:30.000Z",
      now: NOW
    });

    expect(result.status).toBe("working");
    expect(result.stuckSince).toBe("2026-05-21T11:59:30.000Z");
    expect(result.lastActivityAt).toBeNull();
  });

  it("classifies frozen panes past the threshold as stuck", () => {
    const coordinatorPane = "same quiet pane";

    const result = classifyWorkflow({
      coordinatorPane,
      childPanes: [],
      childPaneHashChanged: false,
      coordinatorHashPrev: hashPane(coordinatorPane),
      mtimeAdvanced: false,
      stuckSincePrev: "2026-05-21T11:58:29.000Z",
      now: NOW
    });

    expect(result.status).toBe("stuck");
    expect(result.stuckSince).toBe("2026-05-21T11:58:29.000Z");
    expect(result.lastActivityAt).toBeNull();
  });
});

describe("per-session classifiers", () => {
  it("classifies a changed parent pane as working", () => {
    expect(classifyParentSession({
      coordinatorPane: "Working (12s)\nesc to interrupt",
      coordinatorHashPrev: hashPane("previous pane"),
      stuckSincePrev: null,
      now: NOW
    })).toBe("working");
  });

  it("does not classify a frozen parent pane with marker text as working", () => {
    const pane = "Waiting for codex proposal review from earlier.";
    expect(classifyParentSession({
      coordinatorPane: pane,
      coordinatorHashPrev: hashPane(pane),
      stuckSincePrev: null,
      now: NOW
    })).toBe("idle");
  });

  it("classifies a quiet parent pane as idle before the stuck threshold", () => {
    const pane = "same quiet coordinator pane";
    expect(classifyParentSession({
      coordinatorPane: pane,
      coordinatorHashPrev: hashPane(pane),
      stuckSincePrev: "2026-05-21T11:59:30.000Z",
      now: NOW
    })).toBe("idle");
  });

  it("classifies a parent human wait as waiting_human", () => {
    const pane = "NEEDS-INFO: please confirm whether QA should run the slow suite.";
    expect(classifyParentSession({
      coordinatorPane: pane,
      coordinatorHashPrev: hashPane(pane),
      stuckSincePrev: null,
      now: NOW
    })).toBe("waiting_human");
  });

  it("classifies a parent decision menu as awaiting_decision", () => {
    const pane = [
      "Pick the next action",
      "1. Run targeted tests",
      "2. Merge the branch",
      "Enter to select"
    ].join("\n");
    expect(classifyParentSession({
      coordinatorPane: pane,
      coordinatorHashPrev: hashPane(pane),
      stuckSincePrev: null,
      now: NOW
    })).toBe("awaiting_decision");
  });

  it("classifies a parent frozen past threshold as stuck", () => {
    const pane = "same quiet coordinator pane";
    expect(classifyParentSession({
      coordinatorPane: pane,
      coordinatorHashPrev: hashPane(pane),
      stuckSincePrev: "2026-05-21T11:58:29.000Z",
      now: NOW
    })).toBe("stuck");
  });

  it("classifies child panes by pane change, idle, or closed", () => {
    expect(classifyChildSessionStatus({
      pane: "Thinking\nesc to interrupt",
      exists: true,
      paneHashChanged: false
    })).toBe("working");
    expect(classifyChildSessionStatus({
      pane: "Thinking",
      exists: true,
      paneHashChanged: false
    })).toBe("idle");
    expect(classifyChildSessionStatus({
      pane: "",
      exists: false
    })).toBe("closed");
  });
});

describe("determineActiveSessionAttribution", () => {
  it("attributes coordinator busy markers to the parent session", () => {
    expect(determineActiveSessionAttribution({
      coordinatorSession: "hris-d-22",
      coordinatorPane: "Working (12s)\nesc to interrupt",
      childSessions: ["hrcdx-33"],
      childPanes: ["quiet child"]
    })).toEqual({
      active_session: "hris-d-22",
      active_role: "parent"
    });
  });

  it("attributes child busy markers to the first busy child session when the parent is idle", () => {
    expect(determineActiveSessionAttribution({
      coordinatorSession: "hris-d-22",
      coordinatorPane: "idle parent",
      childSessions: ["hrcdx-33", "hrcdx-34"],
      childPanes: ["quiet child", "Thinking\nesc to interrupt"]
    })).toEqual({
      active_session: "hrcdx-34",
      active_role: "child"
    });
  });

  it("returns null attribution when no pane has busy markers", () => {
    expect(determineActiveSessionAttribution({
      coordinatorSession: "hris-d-22",
      coordinatorPane: "idle parent",
      childSessions: ["hrcdx-33"],
      childPanes: ["quiet child"]
    })).toEqual({
      active_session: null,
      active_role: null
    });
  });
});
