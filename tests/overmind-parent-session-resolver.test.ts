import { describe, expect, it } from "vitest";
import {
  deriveBaseName,
  selectParentCandidate,
  type TmuxSessionInfo,
} from "../src/services/overmind/parent-session-resolver.js";

function s(
  name: string,
  group: string,
  attached = false,
  activity = 0
): TmuxSessionInfo {
  return { name, group, attached, activity };
}

describe("overmind parent-session-resolver", () => {
  describe("deriveBaseName", () => {
    it("strips trailing -digits and child-role suffixes (the 5 cases)", () => {
      expect(deriveBaseName("agj-4")).toBe("agj");
      expect(deriveBaseName("hris-23")).toBe("hris");
      expect(deriveBaseName("agj")).toBe("agj");
      expect(deriveBaseName("lkvc-grok")).toBe("lkvc");
      expect(deriveBaseName("helm-codex55-planner")).toBe("helm");
    });
  });

  describe("selectParentCandidate", () => {
    it("exact fast path (stored \"agj-4\", live \"agj-4\" → session \"agj-4\", method exact) [R3]", () => {
      const sessions = [s("agj-4", "agj", true, 100)];
      const res = selectParentCandidate("agj-4", sessions);
      expect(res.session).toBe("agj-4");
      expect(res.base).toBe("agj");
      expect(res.method).toBe("exact");
      expect(res.ambiguous).toBe(false);
      expect(res.candidates).toEqual(["agj-4"]);
    });

    it("base→group pick (stored \"agj\", live agj-4 group agj → \"agj-4\", method group) [R1]", () => {
      const sessions = [s("agj-4", "agj", false, 50)];
      const res = selectParentCandidate("agj", sessions);
      expect(res.session).toBe("agj-4");
      expect(res.base).toBe("agj");
      expect(res.method).toBe("group");
      expect(res.ambiguous).toBe(false);
    });

    it("child exclusion (stored \"lkvc\", live lkvc-24 group lkvc + lkvc-grok/lkvc-sonnet/lkvc-codex55 group \"\" → \"lkvc-24\", children never returned) [R2]", () => {
      const sessions = [
        s("lkvc-24", "lkvc", false, 100),
        s("lkvc-grok", "", false, 200),
        s("lkvc-sonnet", "", false, 150),
        s("lkvc-codex55", "", false, 50),
      ];
      const res = selectParentCandidate("lkvc", sessions);
      expect(res.session).toBe("lkvc-24");
      expect(res.method).toBe("group");
      expect(res.candidates).toEqual(["lkvc-24"]);
      expect(res.candidates).not.toContain("lkvc-grok");
      expect(res.candidates).not.toContain("lkvc-sonnet");
      expect(res.candidates).not.toContain("lkvc-codex55");
    });

    it("self-heal (stored \"hris-19\" dead, live hris-23 group hris → \"hris-23\") [R3]", () => {
      const sessions = [s("hris-23", "hris", false, 300)];
      const res = selectParentCandidate("hris-19", sessions);
      expect(res.session).toBe("hris-23");
      expect(res.base).toBe("hris");
      expect(res.method).toBe("group");
      expect(res.ambiguous).toBe(false);
    });

    it("prefix fallback (no group set: stored \"rsp\", live \"rsp-0\" group \"\" → \"rsp-0\" via prefix)", () => {
      const sessions = [s("rsp-0", "", false, 10)];
      const res = selectParentCandidate("rsp", sessions);
      expect(res.session).toBe("rsp-0");
      expect(res.base).toBe("rsp");
      expect(res.method).toBe("prefix");
      expect(res.ambiguous).toBe(false);
    });

    it("none-found (stored \"ghost\", no match → session null, method none)", () => {
      const res = selectParentCandidate("ghost", []);
      expect(res.session).toBe(null);
      expect(res.base).toBe("ghost");
      expect(res.method).toBe("none");
      expect(res.candidates).toEqual([]);
      expect(res.ambiguous).toBe(false);
    });

    it("ambiguous flag (two attached candidates same base → ambiguous true)", () => {
      const sessions = [
        s("agj-4", "agj", true, 100),
        s("agj-10", "agj", true, 200),
      ];
      const res = selectParentCandidate("agj", sessions);
      expect(res.session).toBe("agj-10"); // highest activity after rank
      expect(res.method).toBe("group");
      expect(res.ambiguous).toBe(true);
    });

    it("ranking prefers attached then activity (attached wins)", () => {
      const sessions = [
        s("base-1", "base", false, 9999),
        s("base-2", "base", true, 10),
      ];
      const res = selectParentCandidate("base", sessions);
      expect(res.session).toBe("base-2");
      expect(res.method).toBe("group");
    });

    it("exact fast path is skipped for child-role names", () => {
      const sessions = [s("lkvc-grok", "", true, 500)];
      const res = selectParentCandidate("lkvc-grok", sessions);
      expect(res.method).not.toBe("exact");
    });
  });
});
