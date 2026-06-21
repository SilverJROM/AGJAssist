import { describe, expect, it } from "vitest";
import {
  parseGoodBad,
  FallbackParentBrain,
  type BrainProvider,
  type GoodBad,
} from "../src/services/overmind/parent-brain.js";
import { ChatMessage, LlmProvider } from "../src/llm/base-provider.js";

function makeFakeProvider(
  name: string,
  responses: string[] = [],
  shouldThrow = false
): BrainProvider {
  const llm: LlmProvider = {
    name,
    async chat(_messages: ChatMessage[]) {
      if (shouldThrow) {
        throw new Error(`fake-${name}-throw`);
      }
      const next = responses.shift();
      return next ?? "unknown";
    },
  };
  return {
    name,
    available: () => true,
    provider: llm,
  };
}

function makeUnavailable(name: string): BrainProvider {
  return {
    name,
    available: () => false,
    provider: {
      name,
      async chat() {
        throw new Error("should never call unavailable provider");
      },
    } as LlmProvider,
  };
}

describe("parseGoodBad", () => {
  it("GOOD → good", () => {
    expect(parseGoodBad("GOOD")).toBe("good");
  });

  it("bad → bad", () => {
    expect(parseGoodBad("bad")).toBe("bad");
  });

  it("GOOD then BAD → good (first wins)", () => {
    expect(parseGoodBad("maybe GOOD then later BAD")).toBe("good");
    expect(parseGoodBad("BAD first then GOOD")).toBe("bad");
  });

  it("maybe / no match → unknown", () => {
    expect(parseGoodBad("maybe")).toBe("unknown");
    expect(parseGoodBad("")).toBe("unknown");
    expect(parseGoodBad("perhaps it is ok")).toBe("unknown");
  });

  it("case-insensitive whole-word scan", () => {
    expect(parseGoodBad("The verdict is Good here.")).toBe("good");
    expect(parseGoodBad("result: BAD!")).toBe("bad");
    expect(parseGoodBad("GoodBad")).toBe("unknown"); // not whole word
  });
});

describe("FallbackParentBrain", () => {
  it("skips an unavailable() provider and falls through to the next available. [R4]", async () => {
    const spark = makeUnavailable("spark");
    const sonnet = makeFakeProvider("sonnet", ["good"]);
    const brain = new FallbackParentBrain([spark, sonnet]);
    const res = await brain.judgeParent("agj-4", "some pane content\nline2");
    expect(res.verdict).toBe("good");
    expect(res.provider).toBe("sonnet");
  });

  it("returns the verdict + provider name of the FIRST provider giving a definite good/bad. [R4]", async () => {
    const p1 = makeFakeProvider("spark", ["bad"]);
    const p2 = makeFakeProvider("sonnet", ["good"]);
    const brain = new FallbackParentBrain([p1, p2]);
    const res = await brain.judgeParent("foo", "pane");
    expect(res.verdict).toBe("bad");
    expect(res.provider).toBe("spark");
  });

  it("a provider whose chat() THROWS is skipped and the chain continues to the next. [R4 token/err fallthrough]", async () => {
    const p1 = makeFakeProvider("spark", [], true);
    const p2 = makeFakeProvider("sonnet", ["bad"]);
    const brain = new FallbackParentBrain([p1, p2]);
    const res = await brain.judgeParent("s", "t");
    expect(res.verdict).toBe("bad");
    expect(res.provider).toBe("sonnet");
  });

  it("all providers unavailable/failing → { verdict: \"unknown\", provider: null }.", async () => {
    const p1 = makeUnavailable("spark");
    const p2 = makeFakeProvider("sonnet", [], true);
    const brain = new FallbackParentBrain([p1, p2]);
    const res = await brain.judgeParent("x", "");
    expect(res.verdict).toBe("unknown");
    expect(res.provider).toBe(null);
  });

  it("order is honored: spark-like (available) answering \"good\" wins over a later sonnet-like.", async () => {
    const spark = makeFakeProvider("spark", ["good"]);
    const sonnet = makeFakeProvider("sonnet", ["bad"]);
    const brain = new FallbackParentBrain([spark, sonnet]);
    const res = await brain.judgeParent("agj", "pane tail here\nmore lines");
    expect(res.verdict).toBe("good");
    expect(res.provider).toBe("spark");
  });

  it("parse returning unknown from a provider continues to next (no definite)", async () => {
    const p1 = makeFakeProvider("spark", ["not sure at all"]);
    const p2 = makeFakeProvider("sonnet", ["GOOD"]);
    const brain = new FallbackParentBrain([p1, p2]);
    const res = await brain.judgeParent("session-1", "tail content");
    expect(res.verdict).toBe("good");
    expect(res.provider).toBe("sonnet");
  });

  it("parseGoodBad first-occurrence wins even inside longer brain text", async () => {
    const p = makeFakeProvider("grok", ["After review I conclude it is BAD because child role."]);
    const brain = new FallbackParentBrain([p]);
    const res = await brain.judgeParent("lkvc-7", "lines");
    expect(res.verdict).toBe("bad");
    expect(res.provider).toBe("grok");
  });
});
