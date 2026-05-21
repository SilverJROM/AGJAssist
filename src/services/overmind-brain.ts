import { ClaudeCliProvider } from "../llm/claude-cli-provider.js";
import { ChatMessage, LlmProvider } from "../llm/base-provider.js";

export interface StuckInput {
  label: string;
  coordinatorPaneTail: string;
  progressTail: string;
  callbacksTail: string;
}

export type BrainVerdictAction = "nudge" | "escalate-blocked" | "false-alarm";

export interface BrainVerdict {
  action: BrainVerdictAction;
  nudgeText?: string;
  reason: string;
}

export interface OvermindBrain {
  analyzeStuck(input: StuckInput): Promise<BrainVerdict>;
}

interface RawBrainVerdict {
  action?: unknown;
  nudge_text?: unknown;
  nudgeText?: unknown;
  reason?: unknown;
}

const STUCK_SYSTEM_PROMPT = [
  "You are Overmind's Tier-3 stuck-analysis brain.",
  "Analyze only the provided tiny context for one projcore coordinator workflow.",
  "Return STRICT JSON only, with no markdown, prose, or code fences.",
  "Allowed shape: {\"action\":\"nudge|escalate-blocked|false-alarm\",\"nudge_text\":\"optional\",\"reason\":\"short reason\"}.",
  "Use action=nudge only when a concise coordinator-only re-engagement message can likely unblock the workflow.",
  "Use action=escalate-blocked when the coordinator needs human input or is genuinely blocked.",
  "Use action=false-alarm when the workflow appears to be working despite deterministic stuck detection.",
  "Never propose sending anything to child sessions."
].join("\n");

export class SonnetOvermindBrain implements OvermindBrain {
  private readonly llm: LlmProvider;

  constructor(timeoutMs = 120_000, llm?: LlmProvider) {
    this.llm = llm ?? new ClaudeCliProvider("sonnet", timeoutMs);
  }

  async analyzeStuck(input: StuckInput): Promise<BrainVerdict> {
    const messages: ChatMessage[] = [
      { role: "system", content: STUCK_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          `Workflow label: ${input.label}`,
          "",
          "Coordinator pane tail:",
          input.coordinatorPaneTail || "<empty>",
          "",
          "progress.md tail:",
          input.progressTail || "<empty>",
          "",
          "callbacks.md tail:",
          input.callbacksTail || "<empty>"
        ].join("\n")
      }
    ];

    const raw = await this.llm.chat(messages, 800);
    return normalizeBrainVerdict(parseJsonObject(raw));
  }
}

function parseJsonObject(raw: string): RawBrainVerdict {
  const trimmed = raw.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(withoutFence) as RawBrainVerdict;
  } catch {
    const start = withoutFence.indexOf("{");
    const end = withoutFence.lastIndexOf("}");
    if (start === -1 || end <= start) {
      throw new Error("Sonnet brain returned non-JSON output");
    }
    return JSON.parse(withoutFence.slice(start, end + 1)) as RawBrainVerdict;
  }
}

function normalizeBrainVerdict(raw: RawBrainVerdict): BrainVerdict {
  const rawAction = typeof raw.action === "string" ? raw.action : "";
  const action = rawAction === "escalate-question" ? "escalate-blocked" : rawAction;
  const reason = typeof raw.reason === "string" && raw.reason.trim()
    ? raw.reason.trim().slice(0, 500)
    : "Sonnet brain did not provide a reason.";

  if (action === "false-alarm") {
    return { action, reason };
  }

  if (action === "escalate-blocked") {
    return { action, reason };
  }

  if (action === "nudge") {
    const nudgeText = typeof raw.nudge_text === "string"
      ? raw.nudge_text.trim()
      : typeof raw.nudgeText === "string"
        ? raw.nudgeText.trim()
        : "";
    if (!nudgeText) {
      return {
        action: "escalate-blocked",
        reason: "Sonnet brain requested a nudge without nudge_text."
      };
    }
    return { action, nudgeText: nudgeText.slice(0, 1000), reason };
  }

  return {
    action: "escalate-blocked",
    reason: `Sonnet brain returned unsupported action: ${rawAction || "<missing>"}.`
  };
}
