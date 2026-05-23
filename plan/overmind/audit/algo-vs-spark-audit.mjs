#!/usr/bin/env node
/**
 * algo-vs-spark-audit.mjs
 *
 * Cron-driven one-shot: compares overmind's deterministic session-status classifier
 * against gpt-5.3-codex (spark) reading the actual panes. Runs every 20–30 min
 * (random 60/40 cadence) for AUDIT_DAYS days, then invokes Opus to propose
 * concrete classifier improvements, writes a markdown report, and pings JROM via TG.
 *
 * Usage:
 *   node plan/overmind/audit/algo-vs-spark-audit.mjs            # normal cron tick
 *   node plan/overmind/audit/algo-vs-spark-audit.mjs --render-only  # interim report from JSONL
 */

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  appendFileSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// ---------------------------------------------------------------------------
// Env / config
// ---------------------------------------------------------------------------
const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), "../../../..");
const AUDIT_DAYS = Number(process.env.AUDIT_DAYS ?? 3);
const CADENCE_20_WEIGHT = Number(process.env.AUDIT_CADENCE_20_WEIGHT ?? 0.6);
const SPARK_CMD = process.env.AUDIT_SPARK_CMD ??
  "codex exec --model gpt-5.3-codex --skip-git-repo-check";
const SONNET_FALLBACK_CMD = process.env.AUDIT_SONNET_FALLBACK_CMD ??
  "claude -p --dangerously-skip-permissions --model sonnet";
const ANALYST_MODEL = process.env.AUDIT_ANALYST_MODEL ?? "opus";
const LOG_DIR = path.resolve(
  REPO_ROOT,
  process.env.AUDIT_LOG_DIR ?? "plan/overmind/audit"
);

const DB_PATH = path.join(REPO_ROOT, "data/agjassist.db");
const STATE_FILE = path.join(LOG_DIR, "audit-state.json");
const JSONL_FILE = path.join(LOG_DIR, "audit-log.jsonl");
const PANES_DIR = path.join(LOG_DIR, "panes");

const RENDER_ONLY = process.argv.includes("--render-only");
const TAIL_LINES = 50;

// ---------------------------------------------------------------------------
// better-sqlite3 (CJS module, loaded via createRequire)
// ---------------------------------------------------------------------------
const require = createRequire(import.meta.url);
let Database;
try {
  Database = require(path.join(REPO_ROOT, "node_modules/better-sqlite3"));
} catch (err) {
  log(`FATAL: cannot load better-sqlite3: ${err.message}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------
function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
}

// ---------------------------------------------------------------------------
// State file helpers
// ---------------------------------------------------------------------------
function readState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
  } catch {
    return null;
  }
}

function writeState(state) {
  // Atomic on Linux: write to .tmp then rename (same filesystem, atomic)
  const tmp = STATE_FILE + ".tmp";
  try {
    writeFileSync(tmp, JSON.stringify(state, null, 2), "utf-8");
    renameSync(tmp, STATE_FILE);
  } catch {
    // Fallback: direct overwrite (safe for single-writer cron)
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
  }
}

// ---------------------------------------------------------------------------
// Shell helper — always try/catch, partial failures are logged not thrown
// ---------------------------------------------------------------------------
function shellSpawn(bin, args, inputText, timeoutMs = 60_000) {
  try {
    const result = spawnSync(bin, args, {
      input: inputText ?? undefined,
      timeout: timeoutMs,
      encoding: "utf-8",
      maxBuffer: 4 * 1024 * 1024,
    });
    if (result.error) throw result.error;
    return { ok: result.status === 0, stdout: result.stdout ?? "", stderr: result.stderr ?? "", status: result.status };
  } catch (err) {
    return { ok: false, stdout: "", stderr: String(err?.message ?? err), status: -1 };
  }
}

function tmuxHasSession(name) {
  const r = shellSpawn("tmux", ["has-session", "-t", name], null, 5_000);
  return r.status === 0;
}

function tmuxCapturePane(target) {
  const r = shellSpawn("tmux", ["capture-pane", "-p", "-t", target], null, 10_000);
  if (!r.ok) return null;
  const lines = r.stdout.split("\n");
  return lines.slice(-TAIL_LINES).join("\n");
}

// ---------------------------------------------------------------------------
// DB (read-only)
// ---------------------------------------------------------------------------
function getActiveWorkflows() {
  try {
    const db = new Database(DB_PATH, { readonly: true });
    const rows = db.prepare(`
      SELECT id, label, coordinator_session, child_sessions, child_statuses, parent_status, display_name
      FROM overmind_workflows
      WHERE status NOT IN ('completed','failed','paused')
        AND monitoring_paused = 0
    `).all();
    db.close();
    return rows.map((r) => ({
      ...r,
      child_sessions: safeJson(r.child_sessions, []),
      child_statuses: safeJson(r.child_statuses, []),
    }));
  } catch (err) {
    log(`DB read error: ${err.message}`);
    return [];
  }
}

function safeJson(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

// ---------------------------------------------------------------------------
// Judge-with-fallback helper (spark → Sonnet)
// Tries primaryCmd first via spawnSync. On any failure (spawn error / non-zero /
// timeout / parse fail) tries fallbackCmd once. Returns null if both fail.
// Returns { json, model: "primary"|"fallback" } on success.
// ---------------------------------------------------------------------------
function invokeJudgeWithFallback(prompt, primaryCmd, fallbackCmd, timeoutMs = 120_000) {
  function tryCmd(cmd) {
    const [bin, ...args] = cmd.trim().split(/\s+/);
    const result = shellSpawn(bin, args, prompt, timeoutMs);
    if (!result.ok) return null;
    try {
      return parseSparkJson(result.stdout?.trim() ?? "");
    } catch {
      return null;
    }
  }

  const primary = tryCmd(primaryCmd);
  if (primary !== null) return { json: primary, model: "primary" };

  const fallback = tryCmd(fallbackCmd);
  if (fallback !== null) return { json: fallback, model: "fallback" };

  return null;
}

// ---------------------------------------------------------------------------
// Spark invocation
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT =
  "You judge each tmux session's status from its pane snippet.\n" +
  "'working' = active turn (spinner, esc to interrupt, mid-thought) OR substantive new output.\n" +
  "'idle' = stable composer + no activity.\n" +
  "'stuck' = appears active but no real progress (chrome timer ticking but body unchanged).\n" +
  "'closed' = session terminated/empty.\n" +
  "'unknown' = can't tell.\n" +
  "Reply STRICT JSON only.";

function buildSparkPrompt(workflow, sessionPanes) {
  const sessionList = sessionPanes
    .map(({ name, role, pane }) =>
      `=== SESSION: ${name} (${role}) ===\n${pane ?? "(no pane captured)"}\n=== END SESSION ===`
    )
    .join("\n\n");

  return (
    `${SYSTEM_PROMPT}\n\nWorkflow: ${workflow.label ?? workflow.id}\n\n${sessionList}\n\n` +
    `Reply with STRICT JSON only — no markdown, no explanation:\n` +
    `{"sessions":[{"name":"<session>","role":"parent|child","status":"working|idle|stuck|closed|unknown","reason":"<short, ≤12 words>"}]}`
  );
}

// invokeSpark: tries spark first, falls back to Sonnet on any failure.
// Returns { sessions: [...], judge_model: "spark"|"sonnet" }.
// Throws if both fail (caller catches and logs spark_parse_error).
function invokeSpark(prompt) {
  log(`  Invoking spark (${SPARK_CMD.split(" ")[0]}) with Sonnet fallback…`);
  const result = invokeJudgeWithFallback(prompt, SPARK_CMD, SONNET_FALLBACK_CMD, 120_000);
  if (!result) {
    throw new Error("both spark and Sonnet fallback failed");
  }
  const judgeModel = result.model === "primary" ? "spark" : "sonnet";
  log(`  Judge model: ${judgeModel}`);
  return { ...result.json, judge_model: judgeModel };
}

function parseSparkJson(raw) {
  // Strip code fences if present
  const cleaned = raw.replace(/^```[a-z]*\n?/im, "").replace(/```\s*$/m, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error(`spark: no JSON object found in output: ${raw.slice(0, 200)}`);
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

// ---------------------------------------------------------------------------
// Status normalization
// Spark statuses: working | idle | stuck | closed | unknown
// Algo statuses: working | idle | stuck | closed | waiting_human | awaiting_decision
// Agreement rule:
//   spark "working"  == algo "working"
//   spark "stuck"    == algo "stuck"
//   spark "closed"   == algo "closed"
//   spark "idle"     == algo "idle" | "waiting_human" | "awaiting_decision"
//   spark "unknown"  == never agrees
// ---------------------------------------------------------------------------
function normalizeAlgoStatus(algoStatus) {
  if (!algoStatus) return "unknown";
  if (["idle", "waiting_human", "awaiting_decision"].includes(algoStatus)) return "idle";
  return algoStatus; // working | stuck | closed
}

function sparkMatchesAlgo(sparkStatus, algoStatus) {
  if (sparkStatus === "unknown") return false;
  return sparkStatus === normalizeAlgoStatus(algoStatus);
}

// ---------------------------------------------------------------------------
// Hash helpers
// ---------------------------------------------------------------------------
function hashExcerpt(text) {
  return createHash("sha256").update(text ?? "").digest("hex").slice(0, 16);
}

// ---------------------------------------------------------------------------
// JSONL append (append-mode; resilient to concurrent cron fires)
// ---------------------------------------------------------------------------
function appendJsonl(row) {
  appendFileSync(JSONL_FILE, JSON.stringify(row) + "\n", "utf-8");
}

// ---------------------------------------------------------------------------
// Sidecar panes/<key>.json
// ---------------------------------------------------------------------------
function writePaneSidecar(key, panesMap) {
  const outPath = path.join(PANES_DIR, `${key}.json`);
  writeFileSync(outPath, JSON.stringify(panesMap, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// TICK
// ---------------------------------------------------------------------------
function runTick(tickN) {
  log(`=== TICK ${tickN} ===`);
  const workflows = getActiveWorkflows();

  if (workflows.length === 0) {
    log("  No active workflows — tick skipped.");
    return;
  }

  for (const wf of workflows) {
    log(`  Workflow ${wf.id}: ${wf.label}`);
    const sessionPanes = [];
    const panesMap = {};

    // --- Parent pane ---
    const parentSession = wf.coordinator_session;
    try {
      if (tmuxHasSession(parentSession)) {
        const parentPane = tmuxCapturePane(parentSession);
        panesMap[parentSession] = parentPane;
        sessionPanes.push({ name: parentSession, role: "parent", pane: parentPane });
      } else {
        log(`    Parent session ${parentSession} not found in tmux.`);
        panesMap[parentSession] = null;
        sessionPanes.push({ name: parentSession, role: "parent", pane: "(session not found)" });
      }
    } catch (err) {
      log(`    Error capturing parent pane: ${err.message}`);
      panesMap[parentSession] = null;
      sessionPanes.push({ name: parentSession, role: "parent", pane: "(capture error)" });
    }

    // --- Child panes ---
    for (const childName of wf.child_sessions) {
      try {
        if (!tmuxHasSession(childName)) {
          log(`    Child ${childName}: session closed.`);
          panesMap[childName] = null;
          sessionPanes.push({ name: childName, role: "child", pane: "(closed)" });
          continue;
        }
        const childPane = tmuxCapturePane(childName);
        panesMap[childName] = childPane;
        sessionPanes.push({ name: childName, role: "child", pane: childPane });
      } catch (err) {
        log(`    Error capturing child ${childName}: ${err.message}`);
        panesMap[childName] = null;
        sessionPanes.push({ name: childName, role: "child", pane: "(capture error)" });
      }
    }

    // Write sidecar BEFORE spark (evidence preserved even if spark fails)
    const sidecarKey = `${tickN}-wf${wf.id}`;
    try {
      writePaneSidecar(sidecarKey, panesMap);
    } catch (err) {
      log(`    Sidecar write error: ${err.message}`);
    }

    // --- Invoke spark (with Sonnet fallback) ---
    let sparkSessions = null;
    let judgeModel = "spark";
    try {
      const prompt = buildSparkPrompt(wf, sessionPanes);
      const sparkReply = invokeSpark(prompt);
      sparkSessions = sparkReply?.sessions ?? null;
      judgeModel = sparkReply?.judge_model ?? "spark";
      if (!Array.isArray(sparkSessions)) throw new Error("spark reply missing .sessions array");
      log(`    Judge replied (${judgeModel}) with ${sparkSessions.length} session(s).`);
    } catch (err) {
      log(`    spark_parse_error: ${err.message}`);
      appendJsonl({
        at: new Date().toISOString(),
        tick_n: tickN,
        workflow_id: wf.id,
        workflow_label: wf.label,
        event: "spark_parse_error",
        error: String(err.message).slice(0, 300),
      });
      continue;
    }

    // --- Build algo status lookup ---
    const algoParentStatus = wf.parent_status ?? null;
    const algoChildMap = {};
    for (const cs of wf.child_statuses) {
      algoChildMap[cs.session] = cs.status;
    }

    // --- Emit one JSONL row per session ---
    for (const sp of sparkSessions) {
      const sessionName = sp.name;
      const role = sp.role;
      const sparkStatus = sp.status;
      const sparkReason = sp.reason ?? "";

      const algoStatus =
        (role === "parent" || sessionName === wf.coordinator_session)
          ? algoParentStatus
          : (algoChildMap[sessionName] ?? null);

      const agreement = sparkMatchesAlgo(sparkStatus, algoStatus);
      const paneExcerptHash = hashExcerpt(panesMap[sessionName] ?? "");

      const row = {
        at: new Date().toISOString(),
        tick_n: tickN,
        workflow_id: wf.id,
        workflow_label: wf.label,
        session: sessionName,
        role,
        algo_status: algoStatus,
        spark_status: sparkStatus,
        agreement,
        spark_reason: sparkReason,
        pane_excerpt_hash: paneExcerptHash,
        judge_model: judgeModel,
      };

      try {
        appendJsonl(row);
        log(`    ${sessionName}: algo=${algoStatus} spark=${sparkStatus} agree=${agreement}`);
      } catch (err) {
        log(`    JSONL append error: ${err.message}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Read JSONL
// ---------------------------------------------------------------------------
function readJsonl() {
  try {
    return readFileSync(JSONL_FILE, "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((line) => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// FINALIZE
// ---------------------------------------------------------------------------
function runFinalize(state) {
  log("=== FINALIZE ===");
  const rows = readJsonl();
  const dataRows = rows.filter((r) => !r.event);
  const errorRows = rows.filter((r) => r.event === "spark_parse_error");

  const totalTicks = new Set(dataRows.map((r) => r.tick_n)).size;
  const totalSampled = dataRows.length;
  const agreed = dataRows.filter((r) => r.agreement).length;
  const overallPct = totalSampled > 0 ? Math.round((agreed / totalSampled) * 100) : 0;

  // Per-role
  const parentRows = dataRows.filter((r) => r.role === "parent");
  const childRows = dataRows.filter((r) => r.role === "child");
  const parentPct = parentRows.length > 0
    ? Math.round((parentRows.filter((r) => r.agreement).length / parentRows.length) * 100)
    : null;
  const childPct = childRows.length > 0
    ? Math.round((childRows.filter((r) => r.agreement).length / childRows.length) * 100)
    : null;

  // Disagreement pairs
  const pairCounts = {};
  for (const r of dataRows.filter((r) => !r.agreement)) {
    const key = `algo=${r.algo_status} → spark=${r.spark_status}`;
    pairCounts[key] = (pairCounts[key] ?? 0) + 1;
  }
  const topPairs = Object.entries(pairCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  // Per-workflow tally
  const wfMap = {};
  for (const r of dataRows) {
    const k = String(r.workflow_id);
    if (!wfMap[k]) wfMap[k] = { label: r.workflow_label, id: r.workflow_id, total: 0, agree: 0 };
    wfMap[k].total++;
    if (r.agreement) wfMap[k].agree++;
  }

  // Worst single disagreements: parent priority, then recency
  const disagree = dataRows
    .filter((r) => !r.agreement)
    .sort((a, b) => {
      const roleDiff = (b.role === "parent" ? 1 : 0) - (a.role === "parent" ? 1 : 0);
      if (roleDiff !== 0) return roleDiff;
      return new Date(b.at) - new Date(a.at);
    })
    .slice(0, 10);

  const summary = {
    started_at: state.started_at,
    finished_at: new Date().toISOString(),
    total_ticks: totalTicks,
    total_sessions_sampled: totalSampled,
    spark_errors: errorRows.length,
    overall_agreement_pct: overallPct,
    parent_agreement_pct: parentPct,
    child_agreement_pct: childPct,
    top_disagreement_pairs: topPairs.map(([pair, count]) => ({ pair, count })),
    worst_disagreements: disagree,
    per_workflow: Object.values(wfMap),
  };

  const summaryPath = path.join(LOG_DIR, "audit-summary.json");
  try {
    writeFileSync(summaryPath, JSON.stringify(summary, null, 2), "utf-8");
    log(`Summary written: ${summaryPath}`);
  } catch (err) {
    log(`Summary write error: ${err.message}`);
  }

  // Pull pane excerpts for worst disagreements
  const worstExcerpts = disagree.map((wr) => {
    const sidecarPath = path.join(PANES_DIR, `${wr.tick_n}-wf${wr.workflow_id}.json`);
    let paneTail = "(sidecar not found)";
    try {
      const sc = JSON.parse(readFileSync(sidecarPath, "utf-8"));
      const pane = sc[wr.session];
      paneTail = typeof pane === "string"
        ? pane.split("\n").slice(-20).join("\n")
        : "(null)";
    } catch { /* best-effort */ }
    return {
      at: wr.at,
      session: wr.session,
      role: wr.role,
      algo_status: wr.algo_status,
      spark_status: wr.spark_status,
      spark_reason: wr.spark_reason,
      pane_tail: paneTail,
    };
  });

  // Invoke Opus analyst
  let opusReport = "";
  try {
    opusReport = invokeAnalyst(summary, worstExcerpts);
  } catch (err) {
    log(`Analyst invocation error: ${err.message}`);
    opusReport = `*(Analyst invocation failed: ${err.message})*`;
  }

  const startDate = new Date(state.started_at).toISOString().slice(0, 10);
  const reportPath = path.join(LOG_DIR, `audit-report-${startDate}.md`);

  // Always write report (with fallback summary even if analyst failed)
  const wfTally = Object.values(wfMap)
    .map((w) => `- wf${w.id} ${w.label}: ${w.agree}/${w.total} (${Math.round((w.agree / w.total) * 100)}%)`)
    .join("\n") || "_(none)_";

  const reportContent = [
    "# Overmind Algo-vs-Spark Audit Report",
    "",
    `## Summary`,
    "",
    `- Period: ${state.started_at} → ${new Date().toISOString()}`,
    `- Total ticks: ${totalTicks}`,
    `- Sessions sampled: ${totalSampled}`,
    `- Spark errors: ${errorRows.length}`,
    `- **Overall agreement: ${overallPct}%**`,
    `- Parent agreement: ${parentPct ?? "N/A"}%`,
    `- Child agreement: ${childPct ?? "N/A"}%`,
    "",
    "### Top Disagreement Pairs",
    topPairs.length > 0
      ? topPairs.map(([p, c]) => `- ${p} (×${c})`).join("\n")
      : "_(none)_",
    "",
    "### Per-Workflow",
    wfTally,
    "",
    "---",
    "",
    "## Opus Analyst Findings",
    "",
    opusReport || "_(analyst did not respond)_",
  ].join("\n");

  try {
    writeFileSync(reportPath, reportContent, "utf-8");
    log(`Report written: ${reportPath}`);
  } catch (err) {
    log(`Report write error: ${err.message}`);
  }

  // TG notification
  try {
    sendTgDone(overallPct, topPairs, reportPath);
  } catch (err) {
    log(`TG notification error (non-fatal): ${err.message}`);
  }

  return reportPath;
}

// ---------------------------------------------------------------------------
// Opus analyst
// ---------------------------------------------------------------------------
function invokeAnalyst(summary, worstExcerpts) {
  const excerptText = worstExcerpts
    .map((w, i) =>
      `### Disagreement ${i + 1} — ${w.session} (${w.role}) at ${w.at}\n` +
      `algo: ${w.algo_status} | spark: ${w.spark_status}\n` +
      `spark reason: ${w.spark_reason}\n` +
      `Pane tail:\n\`\`\`\n${w.pane_tail}\n\`\`\``
    )
    .join("\n\n");

  const summaryText = JSON.stringify(summary, null, 2).slice(0, 8000);
  const excerptCapped = excerptText.slice(0, 16000);

  const prompt =
    `Read this 3-day overmind algo-vs-spark audit. Goal: catch/improve the deterministic classifier.\n\n` +
    `Summarize agreement %. Then propose 3–7 SPECIFIC, ACTIONABLE improvements to ` +
    `src/services/overmind-watcher.ts — specifically: \`extractBody\`, \`hasActiveTurn\`, ` +
    `\`hashPane\`, \`classifyWorkflow\`, \`classifyParentSession\`, \`classifyChildSessionStatus\`, ` +
    `the mtime check, and \`isPaneChromeLine\` — with file:line hints and a 1-line patch idea each. ` +
    `Cite evidence from the worst-disagreement samples. End with a prioritized list (P0/P1/P2).\n\n` +
    `## Audit Summary (JSON)\n\n\`\`\`json\n${summaryText}\n\`\`\`\n\n` +
    `## Worst Disagreement Samples\n\n${excerptCapped}`;

  log(`  Invoking analyst (claude -p --model ${ANALYST_MODEL})…`);
  const result = shellSpawn(
    "claude",
    ["-p", "--dangerously-skip-permissions", "--model", ANALYST_MODEL],
    prompt,
    300_000
  );

  if (!result.ok) {
    throw new Error(`analyst exited ${result.status}: ${result.stderr.slice(0, 400)}`);
  }
  return result.stdout?.trim() ?? "";
}

// ---------------------------------------------------------------------------
// TG notification (DONE format per NOTIFICATION_PROTOCOL.md)
// ---------------------------------------------------------------------------
function sendTgDone(overallPct, topPairs, reportPath) {
  const topGap = topPairs.length > 0 ? topPairs[0][0] : "no disagreements found";

  const msg =
    `🎉 DONE · AGJAssist · claude/dev\n\n` +
    `✅ 3-day algo-vs-spark classifier audit complete.\n` +
    `Verified: ${overallPct}% overall agreement across all sampled sessions.\n` +
    `Top gap: ${topGap}\n` +
    `Where: ${reportPath}\n\n` +
    `➡️ Next: review report + apply Opus-proposed classifier improvements.`;

  const payload = JSON.stringify({
    name: "claude/dev",
    project: "AGJAssist",
    model: "Opus",
    message: msg,
  });

  log("  Sending TG DONE notification…");
  const result = spawnSync("curl", [
    "-s", "-m", "10",
    "-X", "POST",
    "http://127.0.0.1:8701/notify",
    "-H", "Content-Type: application/json",
    "-d", payload,
  ], { encoding: "utf-8", timeout: 15_000 });

  if (result.error) {
    log(`  TG curl error: ${result.error.message}`);
  } else if (result.status !== 0) {
    log(`  TG curl failed (status ${result.status}): ${(result.stderr ?? "").slice(0, 200)}`);
  } else {
    log(`  TG notification sent. Response: ${(result.stdout ?? "").slice(0, 100)}`);
  }
}

// ---------------------------------------------------------------------------
// Random cadence
// ---------------------------------------------------------------------------
function pickIntervalMs() {
  return Math.random() < CADENCE_20_WEIGHT ? 20 * 60 * 1000 : 30 * 60 * 1000;
}

// ---------------------------------------------------------------------------
// Ensure dirs exist
// ---------------------------------------------------------------------------
function ensureDirs() {
  mkdirSync(LOG_DIR, { recursive: true });
  mkdirSync(PANES_DIR, { recursive: true });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  ensureDirs();

  // --render-only: skip ticking, finalize immediately from existing JSONL
  if (RENDER_ONLY) {
    log("--render-only: generating interim report from existing JSONL…");
    const state = readState() ?? {
      started_at: new Date().toISOString(),
      next_fire_at: new Date().toISOString(),
      tick_count: 0,
      done: false,
    };
    runFinalize(state);
    log("Render-only done.");
    return;
  }

  const now = Date.now();
  let state = readState();

  // Bootstrap on first run
  if (!state) {
    state = {
      started_at: new Date(now).toISOString(),
      next_fire_at: new Date(now).toISOString(), // fire immediately on first tick
      tick_count: 0,
      done: false,
    };
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
    log(`Bootstrapped state. Started at ${state.started_at}`);
  }

  // Already done — exit silently
  if (state.done) {
    log("Audit already complete (done=true). Remove cron entry or reset state to restart.");
    return;
  }

  // Not yet our slot — exit silently (cron fired early)
  if (now < new Date(state.next_fire_at).getTime()) {
    log(`Not yet. Next fire: ${state.next_fire_at} (${Math.round((new Date(state.next_fire_at).getTime() - now) / 60_000)}min away)`);
    return;
  }

  // 3-day window elapsed → FINALIZE
  const startMs = new Date(state.started_at).getTime();
  if (now >= startMs + AUDIT_DAYS * 24 * 60 * 60 * 1000) {
    log(`${AUDIT_DAYS}-day window elapsed. Running FINALIZE…`);
    const reportPath = runFinalize(state);
    state.done = true;
    state.finished_at = new Date().toISOString();
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
    log(`Done. Report: ${reportPath}`);
    return;
  }

  // Normal tick
  const tickN = state.tick_count + 1;
  try {
    runTick(tickN);
  } catch (err) {
    log(`Tick ${tickN} error (non-fatal): ${err.message}`);
  }

  // Schedule next fire
  const intervalMs = pickIntervalMs();
  state.tick_count = tickN;
  state.next_fire_at = new Date(now + intervalMs).toISOString();
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
  log(`Tick ${tickN} done. Next fire: ${state.next_fire_at} (+${intervalMs / 60_000}min)`);
}

main();
