---
date: 2026-05-21
project: AGJAssist
type: scope-injection
source: projcore
priority: high
search_hooks: [overmind, tasklist, decision-interception, frontload, sonnet, north-star]
---

**Injected mid-Phase-0 (pre-dispatch) by JROM, verbatim:**
"and on the TG UI, it shows the status on w/c is working and the current status of the task. also have the projcore submit a tasklist that is seen by the overmind as well on w/c has been completed and w/c are processing and pending. and also sometimes projcore would send a decision tree like this that should have been frontloaded [screenshot of a Merge/test decision menu, 15 tasks 14 done 1 open] so overmind (sonnet) answer this or ask projcore and overmind answer this via the north star and scold or correct projcore to frontload this and not bring this up mid implementation"

(Earlier same-session injection, already folded: overmind watches child codex sessions too, nudges coordinator only — NS-2/NS-3.)

**Folded into contract as:**
- R14 — tasklist ingestion (`POST /api/overmind/tasks`) + done/processing/pending display on TG + UI; `tasks`/`current_task` columns (NS-10).
- R15 — `awaiting_decision` classifier state + Sonnet brain answers from the workflow's north-star or escalates (NS-11).
- R16 — projcore frontload-correction when it raises a should-have-been-frontloaded decision (NS-12).

**Autonomous guardrail decided (projcore, grounded in trust-defaults.md):** overmind auto-answers a decision ONLY when the north-star/defaults clearly cover it AND it is NOT in the ALWAYS-ESCALATE class (irreversible / merge-to-master / QA/PROD deploy / auth / money / hardened / scope-creep). Otherwise escalate to JROM, never auto-answer. The screenshot's "merge to master" case is ALWAYS-ESCALATE → would be escalated, not auto-answered.
**Counterfactual:** without the guardrail, overmind might auto-merge to master — unacceptable per trust-defaults ALWAYS-ESCALATE.
**Surfaced to JROM** in-session for objection; proceeding with the guardrail as default.
