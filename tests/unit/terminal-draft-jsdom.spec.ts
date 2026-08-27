import { describe, it, expect, beforeEach } from "vitest";
import {
  readTerminalDraft,
  writeTerminalDraft,
  clearTerminalDraft
} from "../../src/web/public/terminal-chat-state.js";

// Mock localStorage for Node environment
const storage = new Map();
global.localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => { storage.set(key, value); },
  removeItem: (key) => { storage.delete(key); },
  clear: () => { storage.clear(); }
};

describe("terminal draft localStorage", () => {
  beforeEach(() => {
    // Ensure clean localStorage for each test
    localStorage.clear();
  });

  it("writes and reads a draft for a viewer/pane pair", () => {
    const viewer = "viewer-1";
    const pane = "0.0";
    const draft = "export const x = 1;";
    writeTerminalDraft(viewer, pane, draft);
    expect(readTerminalDraft(viewer, pane)).toBe(draft);
  });

  it("isolates drafts by viewer and pane", () => {
    writeTerminalDraft("v1", "0.0", "draft A");
    writeTerminalDraft("v1", "0.1", "draft B");
    writeTerminalDraft("v2", "0.0", "draft C");

    expect(readTerminalDraft("v1", "0.0")).toBe("draft A");
    expect(readTerminalDraft("v1", "0.1")).toBe("draft B");
    expect(readTerminalDraft("v2", "0.0")).toBe("draft C");
    expect(readTerminalDraft("v2", "0.1")).toBeNull();
  });

  it("clears a specific viewer/pane draft", () => {
    writeTerminalDraft("v1", "0.0", "to be cleared");
    clearTerminalDraft("v1", "0.0");
    expect(readTerminalDraft("v1", "0.0")).toBeNull();
    // Other drafts remain
    writeTerminalDraft("v1", "0.1", "still here");
    expect(readTerminalDraft("v1", "0.1")).toBe("still here");
  });

  it("returns null for missing drafts", () => {
    expect(readTerminalDraft("nonexistent", "0.0")).toBeNull();
  });

  it("persists across calls via localStorage", () => {
    const viewer = "viewer-persist";
    const pane = "1.2";
    const draft = "persisted content";
    writeTerminalDraft(viewer, pane, draft);
    // Simulate reload by reading directly from localStorage
    const key = `agj_terminal_draft:${viewer}:${pane}`;
    expect(localStorage.getItem(key)).toBe(draft);
    expect(readTerminalDraft(viewer, pane)).toBe(draft);
  });

  it("overwrites existing draft", () => {
    writeTerminalDraft("v", "p", "first");
    writeTerminalDraft("v", "p", "second");
    expect(readTerminalDraft("v", "p")).toBe("second");
  });
});
