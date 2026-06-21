import fs from "node:fs";
import path from "node:path";
import { ChatMessage, LlmProvider } from "../../llm/base-provider.js";
import { ClaudeCliProvider } from "../../llm/claude-cli-provider.js";
import { GrokCliProvider } from "../../llm/grok-cli-provider.js";

export type GoodBad = "good" | "bad" | "unknown";

export function parseGoodBad(text: string): GoodBad {
  if (!text || typeof text !== "string") return "unknown";
  const lower = text.toLowerCase();
  const goodMatch = lower.match(/\bgood\b/);
  const badMatch = lower.match(/\bbad\b/);
  if (goodMatch && badMatch) {
    // first occurrence wins
    if (goodMatch.index! < badMatch.index!) return "good";
    return "bad";
  }
  if (goodMatch) return "good";
  if (badMatch) return "bad";
  return "unknown";
}

export interface BrainProvider {
  name: string;
  available(): boolean;
  provider: LlmProvider;
}

export interface ParentBrain {
  judgeParent(session: string, paneTail: string): Promise<{ verdict: GoodBad; provider: string | null }>;
}

export class FallbackParentBrain implements ParentBrain {
  constructor(private readonly providers: BrainProvider[]) {}

  async judgeParent(session: string, paneTail: string): Promise<{ verdict: GoodBad; provider: string | null }> {
    const lines = (paneTail || "").split(/\r?\n/).slice(-30);
    const tail = lines.join("\n");

    const messages: ChatMessage[] = [
      {
        role: "system",
        content: "You are a headless judge for determining the legitimate parent coordinator session for a projcore run. Given a tmux session name and the last ~30 lines of its pane content, decide whether it is the main projcore/coordinator PARENT session (an agent coordinator pane) or a child worker/bash pane. Answer with exactly one word: GOOD or BAD."
      },
      {
        role: "user",
        content: `Session name: ${session}

Last ~30 lines of pane:
${tail || "<empty>"}

Is this a legitimate projcore/coordinator PARENT session (NOT a child worker or bare bash)? Answer exactly GOOD or BAD.`
      }
    ];

    for (const bp of this.providers) {
      if (!bp.available()) continue;
      try {
        const reply = await bp.provider.chat(messages);
        const verdict = parseGoodBad(reply);
        if (verdict !== "unknown") {
          return { verdict, provider: bp.name };
        }
        // unknown parse: continue to next (not definite)
      } catch (err) {
        // log + continue to next (token/err fallthrough per NS5)
        console.warn(`[parent-brain] provider ${bp.name} threw (skipping for fallthrough):`, (err as Error).message || err);
        continue;
      }
    }
    return { verdict: "unknown", provider: null };
  }
}

function commandOnPath(cmd: string): boolean {
  // Small synchronous PATH check only — never spawn the CLI to test availability.
  const p = process.env.PATH || "";
  const sep = path.delimiter;
  const dirs = p.split(sep).filter(Boolean);
  for (const d of dirs) {
    if (fs.existsSync(path.join(d, cmd))) return true;
  }
  // Common fallback locations on linux
  const home = process.env.HOME || "/home/agjrom";
  const commons = [
    path.join(home, ".local/bin", cmd),
    `/usr/local/bin/${cmd}`,
    `/usr/bin/${cmd}`,
    `/bin/${cmd}`,
  ];
  for (const c of commons) {
    if (fs.existsSync(c)) return true;
  }
  return false;
}

export function defaultBrainProviders(): BrainProvider[] {
  const sparkAvail = commandOnPath("spark");
  const claudeAvail = commandOnPath("claude");
  const grokAvail = commandOnPath("grok");

  // Dummy for spark: chat() is never reached while !available() (spark not installed on this box per NS5).
  // Slot is first so it will be tried first once a real Spark CLI/provider is present.
  const dummySpark: LlmProvider = {
    name: "spark",
    async chat() {
      throw new Error("spark CLI slot reserved (available()===false today; implement SparkCliProvider when CLI present)");
    }
  };

  return [
    { name: "spark", available: () => sparkAvail, provider: dummySpark },
    { name: "sonnet", available: () => claudeAvail, provider: new ClaudeCliProvider("sonnet") },
    { name: "grok", available: () => grokAvail, provider: new GrokCliProvider() },
  ];
}
