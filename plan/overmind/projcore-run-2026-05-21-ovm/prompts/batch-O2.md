Batch-O2: OVM session manager (open-reuse / restart / close) + operator primer

Batch ID: O2
Requirements: og-requirements-ovm.md (OU2)
Branch: feat/overmind (CONTINUE)
Estimated: SHORT* (split O2a primer / O2b manager if >30min).

Part A — Operator primer doc (plan/overmind/OVM_OPERATOR_PRIMER.md):
A markdown the OVM claude reads at startup so it can manage workflows. Must cover, accurately (read the codebase + plan/overmind/projcore-run-* decisions/validation to get it right):
- WHO it is: "You are the Overmind operator — an interactive Sonnet console JROM chats with to inspect and adjust workflow supervision."
- WHAT overmind is + its full feature set: the watcher (45s, deterministic), per-session parent/child status (incl closed), the nudge ladder + tiers, the Sonnet brain (resolve-first from north-star+decisions), notifications (DONE/BLOCKED/needs-input once/transition), the dashboard (collapsible cards, unified colors 🟢working/🟡idle/🔵waiting/🔴stuck/⚪done, Active/Completed/History tabs), tasklist + history archive, rename (display_name), per-run elapsed + total, projcore §2.11 self-reporting.
- The KNOWN QUIRKS/LESSONS: tmux bare-session targeting, the self-nudge-as-activity fix, npm run build deploy step, idle-awaiting-JROM-vs-stuck nuance, schema version (currently ~v19).
- HOW TO INSPECT: GET http://127.0.0.1:3101/api/overmind/workflows (read live state).
- HOW TO ADJUST (the controls it may use): the localhost+token endpoints — pause/resume (POST /api/overmind/workflows/:id/pause|/resume), drop (DELETE /api/overmind/workflows/:id), tasks (POST /api/overmind/tasks), rename (POST /api/overmind/workflows/:id/name), register/complete. Use OVERMIND_TOKEN (provided in the kickoff message) in the body for the token-guarded ones.
- HARD RULES: manage ONLY via these overmind controls. Do NOT send keystrokes into real coordinator tmux sessions (hris-d-22 etc.). DESTRUCTIVE/IRREVERSIBLE actions (drop a workflow, end a run, anything risky) → PROPOSE to JROM in chat and WAIT for explicit confirmation before doing. Be concise.

Part B — Session manager + endpoints (JWT auth, browser-driven):
- tmuxService already has createSession(name,cwd), terminateSession(name), sessionExists(name), sendCommand, capturePane.
- POST /api/overmind/ovm/open: if sessionExists('OVM') → REUSE (return {reused:true, status:open}); else createSession('OVM', cwd=<AGJAssist repo dir>), then 3-call launch `claude --dangerously-skip-permissions --model sonnet`, wait for it to settle, then send a kickoff message (single line): "Read /home/agjrom/TGBOTS/AGJAssist/plan/overmind/OVM_OPERATOR_PRIMER.md and operate as the Overmind operator per it. OVERMIND_TOKEN=<token from .env>. Reply 'ready' when you've read it." Return {opened:true}.
- POST /api/overmind/ovm/restart: terminateSession('OVM') if exists, then do the open flow fresh.
- POST /api/overmind/ovm/close: terminateSession('OVM'). 
- GET /api/overmind/ovm/status: {open: sessionExists('OVM'), since?: <track open time>}.
- Handle the launch timing carefully (codex/claude TUI needs a few seconds to boot before the kickoff send — use a settle delay; do NOT chain send-keys text+Enter, use the safe 2-step or the existing sendCommand).
- npx tsc clean.

Likely files: plan/overmind/OVM_OPERATOR_PRIMER.md (NEW doc), src/api/routes/overmind-routes.ts (ovm/open|restart|close|status, JWT), maybe a small src/services/ovm-session.ts helper, src/index.ts if wiring needed.
Scope: primer + session manager ONLY. NOT the TG commands (O4) or the web tab (O3). Surgical.
Tests: a unit/integration test for the manager logic (reuse-if-exists vs create; close terminates) using a mocked tmuxService (don't actually spawn claude in unit tests). + the endpoints exist. tsc + npm run build.

Plan handshake (MANDATORY): read brief + tmux-service.ts + overmind-routes.ts + .env (OVERMIND_TOKEN) + skim a couple plan/overmind validation docs for the primer content. Reply STATUS: PROPOSED with the primer outline, the manager/endpoints, the launch+kickoff+settle approach, reuse logic, and tests. WAIT for APPROVED-PLAN.
After APPROVED-PLAN: implement, commit, gate. Artifacts batch-O2/changes.md + test-report.md + independent-validation.md. projcore LIVE-SMOKE: call open → confirm OVM tmux exists + claude running + primed; open again → reused; close → gone.
Completion: callback FIRST to plan/overmind/projcore-run-2026-05-21-ovm/callbacks.md [projcore callback] O2 <STATE> <note>, THEN STATUS: <verb> -- reason.
