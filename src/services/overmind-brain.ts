import { ClaudeCliProvider } from "../llm/claude-cli-provider.js";
import { ChatMessage, LlmProvider } from "../llm/base-provider.js";

export interface StuckInput {
  label: string;
  coordinatorPaneTail: string;
  progressTail: string;
  callbacksTail: string;
  northStar: string;
  trustDefaults: string;
  priorDecisions: string;
}

export interface DecisionInput {
  label: string;
  pendingDecision: string;
  northStar: string;
  trustDefaults: string;
  priorDecisions: string;
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

export interface CompletionInput {
  label: string;
  tasksSummary: string;
  coordinatorPaneTail: string;
  progressTail: string;
  callbacksTail: string;
  northStar: string;
  priorDecisions: string;
}

// "consult" => ask the coordinator (projcore) to confirm + POST /complete or clarify.
// "working" => false alarm; the run is clearly still active, send nothing.
export type CompletionVerdictAction = "consult" | "working";

export interface CompletionVerdict {
  action: CompletionVerdictAction;
  consultText?: string;
  reason: string;
}

export interface RegistrationReviewInput {
  label: string;
  missing: string[];
  currentTask: string | null;
  tasksSummary: string;
  childSessions: string[];
  childRoles: string[];
  progressTail: string;
  callbacksTail: string;
}

// "request"     => craft a concise coordinator (projcore) message asking for the missing/fixed data.
// "false-alarm" => the data is actually fine/expected; send nothing, clear the badge.
// "escalate"    => truly unresolvable from context; notify JROM (rare last resort).
export type RegistrationReviewAction = "request" | "false-alarm" | "escalate";

export interface RegistrationReviewVerdict {
  action: RegistrationReviewAction;
  requestText?: string;
  requestLabel?: string;
  escalateText?: string;
  reason: string;
}

export interface OvermindBrain {
  analyzeStuck(input: StuckInput): Promise<BrainVerdict>;
  answerDecision(input: DecisionInput): Promise<DecisionVerdict>;
  verifyCompletion?(input: CompletionInput): Promise<CompletionVerdict>;
  reviewRegistration?(input: RegistrationReviewInput): Promise<RegistrationReviewVerdict>;
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

interface RawCompletionVerdict {
  action?: unknown;
  consult_text?: unknown;
  consultText?: unknown;
  reason?: unknown;
}

interface RawRegistrationVerdict {
  action?: unknown;
  request_text?: unknown;
  requestText?: unknown;
  request_label?: unknown;
  requestLabel?: unknown;
  escalate_text?: unknown;
  escalateText?: unknown;
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
  "You must resolve autonomously by default using the workflow north-star, trust-defaults, and prior JROM decisions.",
  "Escalating an issue covered by north-star, trust-defaults, or prior-decisions is a FAILURE.",
  "Return STRICT JSON only, with no markdown, prose, or code fences.",
  "Allowed shape: {\"action\":\"nudge|escalate-blocked|false-alarm\",\"nudge_text\":\"optional\",\"reason\":\"short reason\"}.",
  "Use action=nudge only when a concise coordinator-only re-engagement message can likely unblock the workflow.",
  "Use action=escalate-blocked only when the issue is truly unresolvable from the supplied north-star, trust-defaults, and prior-decisions.",
  "Use action=false-alarm when the workflow appears to be working despite deterministic stuck detection.",
  "Never propose sending anything to child sessions."
].join("\n");

const DECISION_SYSTEM_PROMPT = [
  "You are Overmind's decision-interception brain for one projcore coordinator workflow.",
  "Use only the provided decision prompt, workflow north-star, trust-defaults, and prior JROM decisions.",
  "You must resolve autonomously by default using the workflow north-star, trust-defaults, and prior JROM decisions.",
  "Escalating an issue covered by north-star, trust-defaults, or prior-decisions is a FAILURE.",
  "Return STRICT JSON only, with no markdown, prose, or code fences.",
  "Allowed shape: {\"action\":\"answer|escalate\",\"answer_text\":\"optional\",\"reason\":\"short reason\"}.",
  "Use action=answer when the north-star, trust-defaults, or prior-decisions clearly cover the decision.",
  "Use action=escalate only when coverage is absent, ambiguous, risky, irreversible, or broader than the supplied defaults.",
  "When answering, provide only the exact coordinator reply to send; prefer concise free text when the prompt allows it.",
  "Never propose sending anything to child sessions."
].join("\n");

export const DEFAULT_COMPLETION_CONSULT_TEXT =
  "Overmind: every task on your list is marked done but you haven't reported completion. If the run is finished, POST /api/overmind/complete (projcore §2.11) NOW — even if you're keeping the session alive for field-testing. If work remains, update your tasklist with the open items.";

const COMPLETION_SYSTEM_PROMPT = [
  "You are Overmind's completion-verification brain for one projcore coordinator workflow.",
  "Context: the workflow's task list shows EVERY task done, but the coordinator has NOT reported completion to Overmind (no /complete call).",
  "This is the ONLY situation you are asked to judge — projcore explicitly reporting /complete is trusted and never reaches you.",
  "Decide, from the supplied tiny context, whether the run genuinely finished (and the coordinator merely forgot to report) OR whether there is confusion / remaining work / an open question.",
  "You do NOT mark anything complete — only the coordinator's own /complete is authoritative. The buck stops with projcore.",
  "When in doubt, CONSULT the coordinator (projcore). Never message child sessions. Never escalate to the human here.",
  "Return STRICT JSON only, with no markdown, prose, or code fences.",
  "Allowed shape: {\"action\":\"consult|working\",\"consult_text\":\"optional\",\"reason\":\"short reason\"}.",
  "Use action=consult for the normal case: write a concise coordinator message asking it to POST /api/overmind/complete if truly finished, or to update its task list / answer the open point if work remains.",
  "Use action=working ONLY when the context clearly shows the coordinator is still actively mid-run despite the all-done list (then no message is sent)."
].join("\n");

const REGISTRATION_SYSTEM_PROMPT = [
  "You are Overmind's registration-review brain for one projcore coordinator workflow.",
  "Overmind's deterministic checks flagged the workflow's registration data as present-but-possibly-inconsistent (e.g. current_task names a batch that is not in the published task list).",
  "Decide, from the supplied tiny context, whether there is a genuine inconsistency the coordinator must fix, OR whether the data is actually fine/expected.",
  "Requests go to the COORDINATOR (projcore) only — never to child sessions. Escalate to the human ONLY as a true last resort when the context makes the gap unresolvable.",
  "Return STRICT JSON only, with no markdown, prose, or code fences.",
  "Allowed shape: {\"action\":\"request|false-alarm|escalate\",\"request_text\":\"optional\",\"request_label\":\"optional short badge\",\"escalate_text\":\"optional\",\"reason\":\"short reason\"}.",
  "Use action=request with a concise coordinator message naming exactly what to re-register/update (and a 1-3 word request_label for the dashboard).",
  "Use action=false-alarm when the data is consistent/expected on closer reading; send nothing.",
  "Use action=escalate only when truly unresolvable; provide escalate_text as a verdict-led human note."
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
          input.callbacksTail || "<empty>",
          "",
          "Workflow north-star:",
          input.northStar || "<missing>",
          "",
          "Trust defaults:",
          input.trustDefaults || "<missing>",
          "",
          "Prior JROM decisions (relevance-filtered):",
          input.priorDecisions || "<none matched>"
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
          input.trustDefaults || "<missing>",
          "",
          "Prior JROM decisions (relevance-filtered):",
          input.priorDecisions || "<none matched>"
        ].join("\n")
      }
    ];

    const raw = await this.llm.chat(messages, 800);
    return normalizeDecisionVerdict(parseJsonObject(raw));
  }

  async verifyCompletion(input: CompletionInput): Promise<CompletionVerdict> {
    const messages: ChatMessage[] = [
      { role: "system", content: COMPLETION_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          `Workflow label: ${input.label}`,
          "",
          "Task list (all marked done):",
          input.tasksSummary || "<empty>",
          "",
          "Coordinator pane tail:",
          input.coordinatorPaneTail || "<empty>",
          "",
          "progress.md tail:",
          input.progressTail || "<empty>",
          "",
          "callbacks.md tail:",
          input.callbacksTail || "<empty>",
          "",
          "Workflow north-star:",
          input.northStar || "<missing>",
          "",
          "Prior JROM decisions (relevance-filtered):",
          input.priorDecisions || "<none matched>"
        ].join("\n")
      }
    ];

    const raw = await this.llm.chat(messages, 800);
    return normalizeCompletionVerdict(parseJsonObject(raw));
  }

  async reviewRegistration(input: RegistrationReviewInput): Promise<RegistrationReviewVerdict> {
    const messages: ChatMessage[] = [
      { role: "system", content: REGISTRATION_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          `Workflow label: ${input.label}`,
          `Deterministic gaps flagged: ${input.missing.join(", ") || "<none>"}`,
          `current_task: ${input.currentTask || "<empty>"}`,
          "",
          "Published task list:",
          input.tasksSummary || "<empty>",
          "",
          `child_sessions: ${input.childSessions.join(", ") || "<none>"}`,
          `child_roles: ${input.childRoles.join(", ") || "<none>"}`,
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
    return normalizeRegistrationVerdict(parseJsonObject(raw));
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

function normalizeCompletionVerdict(raw: RawCompletionVerdict): CompletionVerdict {
  const action = typeof raw.action === "string" ? raw.action : "";
  const reason = typeof raw.reason === "string" && raw.reason.trim()
    ? raw.reason.trim().slice(0, 500)
    : "Sonnet brain did not provide a reason.";

  if (action === "working") {
    return { action, reason };
  }

  if (action === "consult") {
    const consultText = typeof raw.consult_text === "string"
      ? normalizeCoordinatorLine(raw.consult_text)
      : typeof raw.consultText === "string"
        ? normalizeCoordinatorLine(raw.consultText)
        : "";
    if (!consultText) {
      return {
        action: "consult",
        consultText: DEFAULT_COMPLETION_CONSULT_TEXT,
        reason: reason === "Sonnet brain did not provide a reason."
          ? "Sonnet brain requested a consult without consult_text; using default."
          : reason
      };
    }
    return { action, consultText, reason };
  }

  // Unknown / malformed action: safest is to consult projcore, never silently drop.
  return {
    action: "consult",
    consultText: DEFAULT_COMPLETION_CONSULT_TEXT,
    reason: `Sonnet brain returned unsupported completion action: ${action || "<missing>"}; defaulting to consult.`
  };
}

function normalizeRegistrationVerdict(raw: RawRegistrationVerdict): RegistrationReviewVerdict {
  const action = typeof raw.action === "string" ? raw.action : "";
  const reason = typeof raw.reason === "string" && raw.reason.trim()
    ? raw.reason.trim().slice(0, 500)
    : "Sonnet brain did not provide a reason.";
  const requestText = typeof raw.request_text === "string"
    ? normalizeCoordinatorLine(raw.request_text)
    : typeof raw.requestText === "string"
      ? normalizeCoordinatorLine(raw.requestText)
      : "";
  const requestLabel = typeof raw.request_label === "string"
    ? raw.request_label.trim().slice(0, 40)
    : typeof raw.requestLabel === "string"
      ? raw.requestLabel.trim().slice(0, 40)
      : "";
  const escalateText = typeof raw.escalate_text === "string"
    ? raw.escalate_text.trim().slice(0, 1000)
    : typeof raw.escalateText === "string"
      ? raw.escalateText.trim().slice(0, 1000)
      : "";

  if (action === "false-alarm") {
    return { action, reason };
  }

  if (action === "escalate") {
    return { action, escalateText: escalateText || undefined, requestLabel: requestLabel || undefined, reason };
  }

  if (action === "request") {
    if (!requestText) {
      return { action: "false-alarm", reason: "Sonnet brain requested a fix without request_text; treating as false alarm." };
    }
    return { action, requestText, requestLabel: requestLabel || undefined, reason };
  }

  return { action: "false-alarm", reason: `Sonnet brain returned unsupported registration action: ${action || "<missing>"}.` };
}

function normalizeCoordinatorLine(text: string): string {
  return text.trim().replace(/\s+/g, " ").slice(0, 1000);
}
