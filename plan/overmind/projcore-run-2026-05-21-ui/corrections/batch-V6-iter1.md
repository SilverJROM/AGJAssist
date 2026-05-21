# Correction — V6 iter 1 (RU8 gap)

PASS on normal-path freeze/resume (verified: register w/ processing → ended_at null; /tasks all-done → ended_at stamped + task_log; add pending → ended_at cleared). PRESERVE all of that.

GAP: the ended_at freeze logic runs in setTasks/setStatus but NOT in register(). So a workflow REGISTERED with all tasks already 'done' (e.g. lkcamp, lkvc — registered post-completion) never gets ended_at stamped → its UI elapsed ticks forever instead of freezing. RU8 says "once all tasks done, elapsed stops" — must hold regardless of HOW the row reached all-done.

FIX (small, exactly this):
- In OvermindService.register(), after building the row's tasks, apply the SAME ended_at rule as setTasks: if tasks non-empty AND every task.state==='done' (or status would be completed) → set ended_at=now; else ended_at=null. Reuse the existing helper/logic (don't duplicate — extract a small private computeEndedAt(tasks, status, prevEndedAt) used by register + setTasks + setStatus if not already shared).
- Keep upsert behavior; on re-register, recompute ended_at from the new tasks.

Tests: add a service test — register with all-done tasks → ended_at set; register with a pending task → ended_at null.
Gate: targeted tests + npx tsc + npm run build.

Append callback FIRST [projcore callback] V6 DONE <note> (after fix), THEN STATUS: DONE -- reason. Correction iter 1.
