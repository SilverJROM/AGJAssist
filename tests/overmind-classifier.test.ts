import { describe, expect, it } from "vitest";
import {
  classifyChildSessionStatus,
  classifyParentSession,
  classifyWorkflow,
  determineActiveSessionAttribution,
  hashPane
} from "../src/services/overmind-watcher.js";

const NOW = "2026-05-21T12:00:00.000Z";

describe("classifyWorkflow", () => {
  it("classifies busy markers in any pane as working and resets stuck state", () => {
    const result = classifyWorkflow({
      coordinatorPane: "idle coordinator",
      childPanes: ["Working (12s)\nesc to interrupt"],
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

  it("classifies coordinator pane hash changes as working", () => {
    const coordinatorPane = "new coordinator output";
    const result = classifyWorkflow({
      coordinatorPane,
      childPanes: [],
      coordinatorHashPrev: hashPane("previous coordinator output"),
      mtimeAdvanced: false,
      stuckSincePrev: null,
      now: NOW
    });

    expect(result.status).toBe("working");
    expect(result.coordinatorHash).toBe(hashPane(coordinatorPane));
    expect(result.lastActivityAt).toBe(NOW);
  });

  it("classifies run directory mtime advancement as working", () => {
    const coordinatorPane = "same coordinator output";
    const result = classifyWorkflow({
      coordinatorPane,
      childPanes: [],
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
  it("classifies a busy parent pane as working", () => {
    expect(classifyParentSession({
      coordinatorPane: "Working (12s)\nesc to interrupt",
      coordinatorHashPrev: hashPane("Working (12s)\nesc to interrupt"),
      stuckSincePrev: null,
      now: NOW
    })).toBe("working");
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

  it("classifies child panes as working, idle, or closed", () => {
    expect(classifyChildSessionStatus({
      pane: "Thinking\nesc to interrupt",
      exists: true
    })).toBe("working");
    expect(classifyChildSessionStatus({
      pane: "quiet child pane",
      exists: true
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
