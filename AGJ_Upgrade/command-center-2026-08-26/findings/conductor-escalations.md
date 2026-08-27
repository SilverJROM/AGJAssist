
## PARKED+RAISED A0 — attempts=3
- why: PLAN REVIEW REQUIRED — the TOP RUNG failed. budget exhausted. THE QUESTION IS NOT "which model next" — it is: **is the acceptance criterion still true of the product?** Re-read the AC text against what the product actually does now. A criterion that has drifted fails IDENTICALLY at every tier, so a retry or an escalation buys more failures at higher cost. Answer the question before offering an action; RETRY_WITH_DIRECTION is NOT the default here. — REPEATED_FAILURE_SAME_REQUIREMENT (GAP_INTERCEPTION|A5): the same criterion failed the same way on consecutive attempts. Before retrying or escalating a tier, check whether the AC is satisfiable as written; a defective one fails identically at every tier.
- gate_failed: ['verdict=FAIL', 'redteam: need standard-clean, got standard-fail']
- action: BRAIN(projcore)/JROM — re-plan/split or supply a DIRECTION. Conductor will NOT re-grind it this run.
