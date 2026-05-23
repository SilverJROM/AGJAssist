// Prior-decision matching utilities — given a "topic" (free-text describing the
// current decision/situation), find relevant prior decision markdown files
// from `<runDir>/decisions/` + `~/.claude/JROM/decisions/` and assemble a
// context blob for the brain. Plus a guardrail that overrides a brain verdict
// when an ALWAYS-ESCALATE keyword is present in the pending decision.
//
// Extracted from overmind-watcher.ts in batch B6 of the modularization refactor
// (2026-05-23). IO-touching (reads from disk), but no DB and no tmux — fits
// cleanly into the overmind/ tree as a single-purpose module.

import { readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { DecisionVerdict, hasAlwaysEscalateKeyword } from "../overmind-brain.js";

// ─── Constants ───────────────────────────────────────────────────────────────

export const PRIOR_DECISION_CONTEXT_CHAR_LIMIT = 6000;
export const PRIOR_DECISION_FILE_CHAR_LIMIT = 1000;
export const PRIOR_DECISION_MAX_FILES = 5;

// ─── Always-escalate guardrail ───────────────────────────────────────────────

/**
 * If the pending decision text contains an ALWAYS-ESCALATE keyword (e.g.
 * irreversible/database/migration/etc), override whatever the brain returned
 * with action=escalate. Stops the brain from accidentally auto-answering
 * something JROM has policy-protected.
 */
export function applyAlwaysEscalateGuardrail(
  pendingDecision: string,
  verdict: DecisionVerdict
): DecisionVerdict {
  if (!hasAlwaysEscalateKeyword(pendingDecision)) {
    return verdict;
  }
  return {
    action: "escalate",
    reason: `Deterministic ALWAYS_ESCALATE_KEYWORDS guardrail matched the pending decision; overriding brain action=${verdict.action}.`
  };
}

// ─── Prior-decision collection ───────────────────────────────────────────────

interface PriorDecisionMatch {
  filePath: string;
  score: number;
  matchedTerms: string[];
  snippet: string;
  mtimeMs: number;
}

export async function collectPriorDecisions(runDir: string, topic: string): Promise<string> {
  const terms = extractDecisionTerms(topic);
  const files = await listDecisionFiles([
    path.join(runDir, "decisions"),
    path.join(homedir(), ".claude/JROM/decisions")
  ]);
  const matches: PriorDecisionMatch[] = [];

  for (const filePath of files) {
    const raw = await readFileBestEffort(filePath);
    if (!raw) continue;
    const lowerPath = filePath.toLowerCase();
    const lowerRaw = raw.toLowerCase();
    const matchedTerms = terms.filter((term) => lowerPath.includes(term) || lowerRaw.includes(term));
    if (matchedTerms.length === 0 && terms.length > 0) continue;
    const fileStat = await statBestEffort(filePath);
    matches.push({
      filePath,
      score: matchedTerms.reduce((score, term) => {
        const inPath = lowerPath.includes(term) ? 3 : 0;
        const inBody = countOccurrences(lowerRaw, term);
        return score + inPath + inBody;
      }, terms.length === 0 ? 1 : 0),
      matchedTerms,
      snippet: selectDecisionSnippet(raw, matchedTerms),
      mtimeMs: fileStat?.mtimeMs ?? 0
    });
  }

  if (matches.length === 0) {
    const recentFiles = await Promise.all(
      files.slice(-PRIOR_DECISION_MAX_FILES).map(async (filePath) => ({
        filePath,
        raw: await readFileBestEffort(filePath),
        fileStat: await statBestEffort(filePath)
      }))
    );
    for (const recent of recentFiles) {
      if (!recent.raw) continue;
      matches.push({
        filePath: recent.filePath,
        score: 0,
        matchedTerms: [],
        snippet: recent.raw.slice(0, PRIOR_DECISION_FILE_CHAR_LIMIT),
        mtimeMs: recent.fileStat?.mtimeMs ?? 0
      });
    }
  }

  const selected = matches
    .sort((a, b) => b.score - a.score || b.mtimeMs - a.mtimeMs)
    .slice(0, PRIOR_DECISION_MAX_FILES);

  let output = "";
  for (const match of selected) {
    const entry = [
      `Source: ${match.filePath}`,
      `Matched terms: ${match.matchedTerms.length ? match.matchedTerms.join(", ") : "<recent fallback>"}`,
      match.snippet.trim()
    ].join("\n");
    const next = output ? `${output}\n\n---\n${entry}` : entry;
    if (next.length > PRIOR_DECISION_CONTEXT_CHAR_LIMIT) {
      const remaining = PRIOR_DECISION_CONTEXT_CHAR_LIMIT - output.length;
      if (remaining > 200) output += `\n\n---\n${entry.slice(0, remaining)}`;
      break;
    }
    output = next;
  }

  return output.slice(0, PRIOR_DECISION_CONTEXT_CHAR_LIMIT);
}

export function extractDecisionTerms(text: string): string[] {
  const stop = new Set([
    "about",
    "after",
    "before",
    "blocked",
    "choose",
    "confirm",
    "continue",
    "could",
    "decision",
    "default",
    "enter",
    "human",
    "input",
    "jrom",
    "needs",
    "option",
    "please",
    "projcore",
    "question",
    "should",
    "status",
    "stuck",
    "their",
    "there",
    "these",
    "thing",
    "which",
    "workflow",
    "would"
  ]);
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .match(/[a-z0-9][a-z0-9_-]{3,}/g)
        ?.filter((term) => !stop.has(term) && !/^\d+$/.test(term))
        .slice(0, 24) ?? []
    )
  );
}

async function listDecisionFiles(dirs: string[]): Promise<string[]> {
  const files: string[] = [];
  for (const dir of dirs) {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".md")) {
          files.push(path.join(dir, entry.name));
        }
      }
    } catch {
      // Missing decisions directories are expected for some workflows.
    }
  }
  return files;
}

export function selectDecisionSnippet(raw: string, matchedTerms: string[]): string {
  const normalized = raw.replace(/\r\n/g, "\n");
  const lower = normalized.toLowerCase();
  const firstIndex = matchedTerms
    .map((term) => lower.indexOf(term))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, firstIndex - 300);
  return normalized.slice(start, start + PRIOR_DECISION_FILE_CHAR_LIMIT);
}

export function countOccurrences(text: string, term: string): number {
  if (!term) return 0;
  let count = 0;
  let index = text.indexOf(term);
  while (index >= 0) {
    count += 1;
    index = text.indexOf(term, index + term.length);
  }
  return count;
}

async function statBestEffort(filePath: string): Promise<{ mtimeMs: number } | null> {
  try {
    return await stat(filePath);
  } catch {
    return null;
  }
}

async function readFileBestEffort(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return "";
  }
}

export function checkedContextLine(): string {
  return "workflow north-star.md, trust-defaults.md, and relevance-filtered prior decisions";
}
