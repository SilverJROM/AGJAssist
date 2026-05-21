# North-Star — Overmind Round 3 (locked 2026-05-21)

Inherits NS-1..NS-12 + UI-NS-1..7. New (JROM 2026-05-21):

- **R3-NS-1 — Resolve-first notifications.** Overmind only TG-messages JROM for: completed (DONE), or a blocker/decision that is TRULY unresolvable. Before escalating ANY blocker/decision, the Sonnet brain must attempt resolution from north-star + trust-defaults + JROM's previous decisions (run `decisions/` + global `~/.claude/JROM/decisions/`, relevance-filtered). Escalating a resolvable one = overmind FAILURE. Resolve autonomously by default; escalate as last resort.
- **R3-NS-2 — Notification set is CLOSED:** DONE, BLOCKED, needs-your-input — once per transition, verdict-led per NOTIFICATION_PROTOCOL. Nothing else ever (no progress).
- **R3-NS-3 — Custom name wins:** UI rename → `display_name` that survives projcore re-register; display = display_name ?? label.
- **R3-NS-4 — History is a persistent archive** (survives complete/drop), grouped by workflow, newest-first.
- **R3-NS-5 — Token discipline:** the brain's decision-context must be relevance-filtered (grep/select), never the whole decisions corpus (NS-8 holds).
