import { ClaudeCliProvider } from "../llm/claude-cli-provider.js";
import { ChatMessage, LlmProvider } from "../llm/base-provider.js";

export interface StuckInput {
  label: string;
  coordinatorPaneTail: string;
  progressTail: string;
  callbacksTail: string;
}

export interface DecisionInput {
  label: string;
  pendingDecision: string;
  northStar: string;
  trustDefaults: string;
}

export type BrainVerdictAction = "nudge" | "escalate-blocked" | "false-alarm";

export interface BrainVerdict {
  action: BrainVerdictAction;
  nudgeText?: string;
  reason: string;
}

export type DecisionVerdictAction = "answer" | "escalate";

export interface DecisionVerdict {
  action: DecisionVerdictAction;
  answerText?: string;
  reason: string;
}

export interface OvermindBrain {
  analyzeStuck(input: StuckInput): Promise<BrainVerdict>;
  answerDecision(input: DecisionInput): Promise<DecisionVerdict>;
}

interface RawBrainVerdict {
  action?: unknown;
  nudge_text?: unknown;
  nudgeText?: unknown;
  reason?: unknown;
}

interface RawDecisionVerdict {
  action?: unknown;
  answer_text?: unknown;
  answerText?: unknown;
  reason?: unknown;
}

export const ALWAYS_ESCALATE_KEYWORDS = [
  "merge to master",
  "merge",
  "deploy",
  "qa",
  "prod",
  "production",
  "delete",
  "drop",
  "force push",
  "force-push",
  "auth",
  "rbac",
  "password",
  "secret",
  "token",
  "money",
  "billing",
  "payment",
  "charge"
] as const;

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

const DECISION_SYSTEM_PROMPT = [
  "You are Overmind's decision-interception brain for one projcore coordinator workflow.",
  "Use only the provided decision prompt, workflow north-star, and trust-defaults.",
  "Return STRICT JSON only, with no markdown, prose, or code fences.",
  "Allowed shape: {\"action\":\"answer|escalate\",\"answer_text\":\"optional\",\"reason\":\"short reason\"}.",
  "Use action=answer only when the north-star or trust-defaults clearly and directly cover the decision.",
  "Use action=escalate when coverage is absent, ambiguous, risky, irreversible, or broader than the supplied defaults.",
  "When answering, provide only the exact coordinator reply to send; prefer concise free text when the prompt allows it.",
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

  async answerDecision(input: DecisionInput): Promise<DecisionVerdict> {
    const messages: ChatMessage[] = [
      { role: "system", content: DECISION_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          `Workflow label: ${input.label}`,
          "",
          "Pending decision prompt:",
          input.pendingDecision || "<empty>",
          "",
          "Workflow north-star:",
          input.northStar || "<missing>",
          "",
          "Trust defaults:",
          input.trustDefaults || "<missing>"
        ].join("\n")
      }
    ];

    const raw = await this.llm.chat(messages, 800);
    return normalizeDecisionVerdict(parseJsonObject(raw));
  }
}

export function hasAlwaysEscalateKeyword(text: string): boolean {
  const lower = text.toLowerCase();
  return ALWAYS_ESCALATE_KEYWORDS.some((keyword) => lower.includes(keyword));
}

function parseJsonObject<T extends object>(raw: string): T {
  const trimmed = raw.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(withoutFence) as T;
  } catch {
    const start = withoutFence.indexOf("{");
    const end = withoutFence.lastIndexOf("}");
    if (start === -1 || end <= start) {
      throw new Error("Sonnet brain returned non-JSON output");
    }
    return JSON.parse(withoutFence.slice(start, end + 1)) as T;
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

function normalizeDecisionVerdict(raw: RawDecisionVerdict): DecisionVerdict {
  const action = typeof raw.action === "string" ? raw.action : "";
  const reason = typeof raw.reason === "string" && raw.reason.trim()
    ? raw.reason.trim().slice(0, 500)
    : "Sonnet brain did not provide a reason.";

  if (action === "escalate") {
    return { action, reason };
  }

  if (action === "answer") {
    const answerText = typeof raw.answer_text === "string"
      ? normalizeCoordinatorLine(raw.answer_text)
      : typeof raw.answerText === "string"
        ? normalizeCoordinatorLine(raw.answerText)
        : "";
    if (!answerText) {
      return {
        action: "escalate",
        reason: "Sonnet brain requested an answer without answer_text."
      };
    }
    return { action, answerText, reason };
  }

  return {
    action: "escalate",
    reason: `Sonnet brain returned unsupported decision action: ${action || "<missing>"}.`
  };
}

function normalizeCoordinatorLine(text: string): string {
  return text.trim().replace(/\s+/g, " ").slice(0, 1000);
}
