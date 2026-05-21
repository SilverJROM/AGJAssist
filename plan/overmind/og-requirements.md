# Overmind — Requirements Contract

**Goal:** A token-efficient multi-workflow supervisor inside AGJAssist that monitors the set of *"projcore work that has started but not finished."* Detection is 100% deterministic (tmux pane captures + run_dir file mtimes, ZERO tokens). It **watches all sessions of a workflow (projcore coordinator + child codex sessions)** but **only ever sends keystrokes to the main coordinator — never a child codex pane** (codex is projcore's responsibility). Sonnet (via the user's Claude subscription, NO outside API) is the "brain" used only on the rare ambiguous-stuck case. Live status surfaces on a web UI panel + Telegram; only DONE/BLOCKED go on the wire (NOTIFICATION_PROTOCOL).

**Host:** AGJAssist — TypeScript, Fastify, better-sqlite3, Preact/HTM no-build SPA, port 3101. Deploy: `npx tsc` → copy static → `pm2 restart agjassist`. Current schema version 10.

---

## Stage A — Overmind feature in AGJAssist

**R1 — Schema + persistence.** A new `overmind_workflows` table (schema v11, `CREATE TABLE IF NOT EXISTS` in SCHEMA_SQL + a `version < 11` migration block matching the existing pattern in `src/db/database.ts`). Columns: `id`, `label`, `coordinator_session`, `child_sessions` (JSON list, watched-not-nudged), `run_dir`, `status` (`active|working|waiting_human|awaiting_decision|stuck|paused|completed|failed`), `current_task` (TEXT, the task projcore is on right now), `tasks` (TEXT JSON array of `{id,label,state}` where state ∈ `done|processing|pending` — projcore's submitted tasklist, R14), `pending_decision` (TEXT, the verbatim decision prompt when `awaiting_decision`, R15), `last_pane_hash`, `last_activity_at`, `stuck_since`, `nudge_count`, `tier`, `created_at`, `updated_at`. CRUD methods on the service layer using synchronous better-sqlite3 prepared statements.
*Acceptance:* table exists after restart; insert/list/get/update/setStatus/delete round-trip works, including `tasks` JSON round-trip.

**R2 — Lifecycle endpoints (projcore→overmind).** `POST /api/overmind/register` `{label, session, child_sessions?, run_dir, token}` (insert/upsert by `coordinator_session`) and `POST /api/overmind/complete` `{session, token}` (mark `completed`, stop watching). Both **localhost-only**, guarded by a shared `OVERMIND_TOKEN` from `.env` (NOT JWT). Reject missing/wrong token with 401.
*Acceptance:* `curl` register creates a watched row; `curl` complete marks it completed; bad token → 401.

**R3 — Read endpoint (UI).** `GET /api/overmind/workflows` (optional `?status=` filter), behind the normal `createAuthMiddleware`. Pure DB read (zero tokens). Returns all workflows + current status fields.
*Acceptance:* authenticated GET returns the registered workflows with live status.

**R4 — Watcher loop (deterministic, zero tokens).** A `setInterval(~45s)` in `OvermindService` (started from `index.ts`, mirroring the reminder scheduler at `index.ts:165`). Per non-terminal workflow: `tmuxService.capturePane()` the **coordinator AND each child session**, hash the coordinator pane, scan all captured panes for busy markers (ported from `~/.claude/agents/watchers/projcore-watcher.sh`: `"esc to interrupt"`, `"Working ("`, `"Waiting for"`, `"Compacting"`, `"Thinking"`), and stat `run_dir` mtimes of `callbacks.md`/`progress.md`/`queue.md`. Update the row. No LLM in this loop.
*Acceptance:* with a registered workflow, status fields update each tick from real pane/file state; loop makes zero LLM calls.

**R5 — Classifier.** Deterministic state machine driving `status`: busy markers OR coordinator pane-hash change OR run_dir mtime advance → `working` (reset stuck timers); a **decision-prompt pattern** in the coordinator pane (numbered options menu / AskUserQuestion-style: "Enter to select", "Type something", numbered choices) → `awaiting_decision` (capture the prompt text into `pending_decision`; hand to the brain per R15 — do NOT plain-nudge); a plain pending-question/`NEEDS-INFO` pattern → `waiting_human` (do NOT nudge); `queue.md` drained + final-validation evidence → `completed`; `BLOCKED` marker → `failed`/escalate; pane frozen + no busy markers ≥ threshold → `stuck`. Child-pane signals (e.g. codex `"Worked for"` with no callback) **enrich** classification but the action target is always the coordinator. Detection is deterministic (pattern match, zero tokens); the brain (R15) only engages on `awaiting_decision`/persistent-`stuck`.
*Acceptance:* induced idle → `stuck`; busy marker resets to `working`; a numbered-decision menu yields `awaiting_decision` with the prompt captured; a plain question yields `waiting_human`; both suppress plain nudging.

**R6 — Nudge ladder Tier 1–2 (coordinator-only, zero tokens).** On `stuck`: send a canned re-engage message to the **coordinator session only** via `tmuxService.sendCommand(session, "...", true, true)` (skipSafetyCheck). Backoff across ticks (`nudge_count`/`tier`); busy markers reset the timer. **Never** send keys to a child codex session.
*Acceptance:* a stuck coordinator receives exactly one canned nudge per tier with backoff; child sessions never receive keystrokes (verifiable: no send-keys targets a child).

**R7 — Sonnet brain Tier 3 (rare).** Only when the coordinator pane stays frozen after Tier 1–2: call `new ClaudeCliProvider("sonnet").chat(...)` with tiny context (last ~40 coordinator pane lines + tails of `progress.md`/`callbacks.md`), returning `{action: nudge|escalate-question|escalate-blocked|false-alarm, nudge_text?, reason}`. NO outside API.
*Acceptance:* Tier 3 fires only after Tier 1–2 exhausted; uses Sonnet via Claude CLI; small prompt; result drives the next action.

**R8 — Tier 4 + notifications.** `escalate-*` → Telegram push via existing `bot.sendMessage`, structured per NOTIFICATION_PROTOCOL (verdict-led, DONE/BLOCKED categories ONLY — no progress chatter). Mark `waiting_human`, stop nudging until JROM acts. Completion → DONE push.
*Acceptance:* a brain `escalate-blocked` produces one BLOCKED Telegram message and halts nudging; a `completed` workflow produces one DONE message.

**R9 — Telegram commands.** `/overmind` (status: pure DB read, one line per workflow showing **label · status · current_task · done/total task counts**, e.g. `lkcamp ▶ working · "B5 visibility toggle" · 14/15`), `/om_pause <id>`, `/om_resume <id>`, `/om_drop <id>`, and `/om_tasks <id>` (full tasklist: done/processing/pending) — added to `assistant-core.ts handleCommand()` + `telegram-bot.ts setMyCommands()`.
*Acceptance:* each command works against real rows; `/overmind` shows which workflow is working + its current task + task counts with zero LLM cost.

**R10 — UI panel.** A `/overmind` Preact/HTM view in `src/web/public/app.js` (nav link + component), fed by `GET /api/overmind/workflows`, showing each workflow's label, coordinator + child sessions, status, current_task, tier, stuck-time, and an expandable **tasklist** rendering each task as done / processing / pending (from the `tasks` JSON), plus the `pending_decision` text when `awaiting_decision`.
*Acceptance:* navigating to `#/overmind` renders the registered workflows with live status AND the per-workflow tasklist (done/processing/pending).

**R11 — Live updates (WS).** An `OvermindStreamManager` (cloned from `src/tmux/tmux-stream-manager.ts`) over `/ws/overmind` broadcasting status updates so the panel updates live without manual refresh.
*Acceptance:* a status change in the watcher loop pushes to a connected panel client.

## Stage A (cont.) — Tasklist + decision interception

**R14 — Tasklist ingestion + display.** projcore submits its tasklist to overmind (each task `{id, label, state ∈ done|processing|pending}` + the `current_task`). Transport: `POST /api/overmind/tasks` `{session, current_task?, tasks, token}` (localhost, `OVERMIND_TOKEN`), updating the `tasks`/`current_task` columns; `register` may also carry an initial tasklist. Overmind displays it: Telegram (`/overmind` current task + counts, `/om_tasks` full list) and the UI panel (done/processing/pending). projcore pushes an update as batches advance.
*Acceptance:* a `curl` tasks-update is reflected in `GET /api/overmind/workflows`, `/om_tasks`, and the UI panel as done/processing/pending.

**R15 — Decision interception + north-star answering (Sonnet).** When the classifier flags `awaiting_decision` (R5), the brain reads the **workflow's own `run_dir/north-star.md`** + global `~/.claude/JROM/style/trust-defaults.md` and decides:
- **answer-from-northstar** — the north-star/defaults clearly cover the decision AND it is NOT in the ALWAYS-ESCALATE class (irreversible, merge-to-master, QA/PROD deploy, auth/RBAC, money, hardened-module, scope-creep). → Send the answer into the **coordinator** (prefer the free-text/"type something" path; else the option number), log it, and emit a correction (R16).
- **escalate-to-jrom** — north-star doesn't cover it, OR it is ALWAYS-ESCALATE class. → Telegram push (verdict-led) with the verbatim decision + overmind's read; leave the coordinator waiting; do NOT auto-answer.
The brain runs Sonnet via `ClaudeCliProvider("sonnet")`, tiny context (decision text + relevant north-star excerpt), NO outside API. Auto-answers go ONLY to the coordinator, never a child.
*Acceptance:* a north-star-covered, non-escalate decision is auto-answered into the coordinator + logged; a merge-to-master/deploy decision is escalated to JROM, never auto-answered.

**R16 — Projcore correction (frontload enforcement).** Whenever overmind handles an `awaiting_decision` that should have been frontloaded, it records a correction (decision-log entry + a concise note to the coordinator) reminding projcore that such decisions belong in the §1.4a frontloaded interview / north-star at intake, not mid-implementation. Repeated offenders are surfaced to JROM.
*Acceptance:* handling a decision produces a logged correction citing "should have been frontloaded (§1.4a)"; the coordinator receives the reminder.

## Stage B — Projcore lifecycle wiring

**R12.** Edit `~/.claude/agents/projcore.md` so projcore: (a) `curl`s `POST /api/overmind/register` on work-start (run start — `label`, coordinator `session`, child codex `session(s)`, `run_dir`, initial tasklist, `OVERMIND_TOKEN`); (b) `curl`s `POST /api/overmind/tasks` to update the tasklist/current_task at each batch boundary (R14); (c) `curl`s `POST /api/overmind/complete` on acknowledged-done (Phase 3 hand-back/teardown); and (d) reinforces the §1.4a rule that product/scope/merge decisions are frontloaded at intake, NOT raised mid-implementation (the behavior R16 enforces externally). Single-line curls, token from env. Do NOT touch `coord.md`.
*Acceptance:* projcore.md contains register/tasks/complete steps at the correct phases + the frontload-reinforcement note.

## Stage C — Onboard the three live workflows (capstone)

**R13.** Register the three currently-running projcore workflows so they appear live on the dashboard. Coordinators (nudge-able): `hris-d` → `hris-d-22`, `lkcamp` → `lkcamp-12`, `lkvc` → `lkvc-38`. Their child codex sessions (watched, never nudged): `hrcdx-33`, `lkcdx-may20`, `lkcdx-meet-v7`. For each, discover `run_dir` by peeking the coordinator pane, then register (either by nudging the coordinator to re-read the updated projcore.md and self-register, or by a direct `curl` register on its behalf). **Touching live coordinator sessions is gated on JROM's Stage-C autonomy decision (north-star NS-7).**
*Acceptance:* all three workflows visible on `#/overmind` and `/overmind` with correct coordinator+child sessions and a live status.

---

**Cross-cutting constraints:** token efficiency is the whole point — watcher 100% deterministic, Sonnet only on rare ambiguity, status reads pure DB. Match existing conventions (Preact/HTM no-build SPA, sync better-sqlite3, Fastify route-module + `createAuthMiddleware`/`requireOwner`). Commit per batch. Verifier ≠ fixer.
