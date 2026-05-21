import { describe, expect, it } from "vitest";
import {
  BOTTOM_NAV_STORAGE_KEY,
  DEFAULT_BOTTOM_NAV_TAB_IDS,
  addBottomNavTab,
  deserializeBottomNavTabIds,
  getBottomNavTabs,
  moveBottomNavTab,
  normalizeBottomNavTabIds,
  readBottomNavTabIds,
  removeBottomNavTab,
  serializeBottomNavTabIds,
  writeBottomNavTabIds
} from "../src/web/public/overmind-helpers.js";

function fakeStorage(initial: Record<string, string> = {}) {
  const store = { ...initial };
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    snapshot: () => ({ ...store })
  };
}

describe("bottom nav helpers", () => {
  it("uses the current default tabs when storage is unset or invalid", () => {
    expect(readBottomNavTabIds(fakeStorage())).toEqual(DEFAULT_BOTTOM_NAV_TAB_IDS);
    expect(deserializeBottomNavTabIds("not-json")).toEqual(DEFAULT_BOTTOM_NAV_TAB_IDS);
    expect(normalizeBottomNavTabIds(["/missing"])).toEqual(DEFAULT_BOTTOM_NAV_TAB_IDS);
  });

  it("reorders tabs with move buttons", () => {
    const tabs = ["/", "/tasks", "/notes"];
    expect(moveBottomNavTab(tabs, "/notes", -1)).toEqual(["/", "/notes", "/tasks"]);
    expect(moveBottomNavTab(tabs, "/", -1)).toEqual(tabs);
    expect(moveBottomNavTab(tabs, "/notes", 1)).toEqual(tabs);
  });

  it("removes tabs but keeps at least one visible tab", () => {
    expect(removeBottomNavTab(["/", "/tasks"], "/tasks")).toEqual(["/"]);
    expect(removeBottomNavTab(["/"], "/")).toEqual(["/"]);
  });

  it("adds hidden known tabs and ignores duplicates or unknown ids", () => {
    expect(addBottomNavTab(["/", "/tasks"], "/overmind")).toEqual(["/", "/tasks", "/overmind"]);
    expect(addBottomNavTab(["/", "/overmind"], "/overmind")).toEqual(["/", "/overmind"]);
    expect(addBottomNavTab(["/"], "/missing")).toEqual(["/"]);
  });

  it("serializes, deserializes, and maps visible tab metadata", () => {
    const serialized = serializeBottomNavTabIds(["/settings", "/overmind", "/settings", "/missing"]);
    expect(deserializeBottomNavTabIds(serialized)).toEqual(["/settings", "/overmind"]);
    expect(getBottomNavTabs(["/overmind"])).toEqual([
      { id: "/overmind", icon: "\u{25B6}", label: "Workflows" }
    ]);
  });

  it("persists normalized tab ids to localStorage-compatible storage", () => {
    const storage = fakeStorage();
    expect(writeBottomNavTabIds(["/notes", "/overmind"], storage)).toEqual(["/notes", "/overmind"]);
    expect(storage.snapshot()[BOTTOM_NAV_STORAGE_KEY]).toBe(JSON.stringify(["/notes", "/overmind"]));
    expect(readBottomNavTabIds(storage)).toEqual(["/notes", "/overmind"]);
  });
});
