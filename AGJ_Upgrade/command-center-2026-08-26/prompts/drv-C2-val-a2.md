# [driver] C2 — THE COMMIT UNDER TEST IS `217ae6b85937426415ba9c150cb58a1161973816`

Analyse EXACTLY that commit: `git show 217ae6b85937426415ba9c150cb58a1161973816`, `git diff 217ae6b85937426415ba9c150cb58a1161973816^..217ae6b85937426415ba9c150cb58a1161973816`.
**Do NOT use `git rev-parse HEAD`** — HEAD moves when anyone commits, including the coordinator writing its own artifacts, and judging the wrong commit has already FAILed a slice whose work was correct. Report `commit=217ae6b85937426415ba9c150cb58a1161973816`.

## The change under test (produced by the driver, not reported by the implementer)
```
[C2] Fix AgentSolicitService update nulls, due datetime, tests


 src/services/agent-solicit-service.ts     | 10 +++----
 tests/unit/agent-reminder-service.spec.ts | 45 +++++++++++++++++++++----------
 2 files changed, 36 insertions(+), 19 deletions(-)
```
```diff
diff --git a/src/services/agent-solicit-service.ts b/src/services/agent-solicit-service.ts
index ef78342..d1ee7e5 100644
--- a/src/services/agent-solicit-service.ts
+++ b/src/services/agent-solicit-service.ts
@@ -142,8 +142,8 @@ export class AgentSolicitService {
 
     const folderGroup = updates.folder_group ?? existing.folder_group;
     const cadenceMinutes = updates.cadence_minutes ?? existing.cadence_minutes;
-    const repeatLimit = updates.repeat_limit ?? existing.repeat_limit;
-    const nextFire = updates.next_fire ?? existing.next_fire;
+    const repeatLimit = updates.repeat_limit !== undefined ? updates.repeat_limit : existing.repeat_limit;
+    const nextFire = updates.next_fire !== undefined ? updates.next_fire : existing.next_fire;
     const solicitMessage = updates.solicit_message ?? existing.solicit_message;
     const active = updates.active ?? existing.active;
 
@@ -184,14 +184,14 @@ export class AgentSolicitService {
   }
 
   getDueReminders(): AgentSolicitReminderWithRecipients[] {
-    const nowIso = new Date().toISOString();
     const reminders = this.db
       .prepare(
         `SELECT * FROM agent_solicit_reminders
-         WHERE active = 1 AND next_fire IS NOT NULL AND next_fire <= ?
+         WHERE active = 1 AND next_fire IS NOT NULL
+         AND datetime(next_fire) <= datetime('now')
          AND (repeat_limit IS NULL OR repeat_count < repeat_limit)`
       )
-      .all(nowIso) as AgentSolicitReminder[];
+      .all() as AgentSolicitReminder[];
 
     return reminders.map((r) => ({
       ...r,
diff --git a/tests/unit/agent-reminder-service.spec.ts b/tests/unit/agent-reminder-service.spec.ts
index cae9b2c..cc1a168 100644
--- a/tests/unit/agent-reminder-service.spec.ts
+++ b/tests/unit/agent-reminder-service.spec.ts
@@ -74,13 +74,18 @@ describe("AgentSolicitService C2", () => {
   });
 
   it("lists active reminders with recipients projection", () => {
-    service.create({
+    const reminder = service.create({
       user_id: userId,
       folder_group: "g1",
       cadence_minutes: 15,
+      next_fire: "2026-01-01T00:00:00.000Z",
+      repeat_limit: 5,
       active: 1,
-      recipients: [{ agent_name: "a1" }],
+      recipients: [{ agent_name: "inc", include: 1 }, { agent_name: "skip", include: 0 }],
     });
+    // Simulate repeat progress via second path
+    db.prepare("UPDATE agent_solicit_reminders SET repeat_count = 2 WHERE id = ?").run(reminder.id);
+
     service.create({
       user_id: userId,
       folder_group: "g2",
@@ -91,8 +96,17 @@ describe("AgentSolicitService C2", () => {
 
     const active = service.listActive(userId);
     expect(active).toHaveLength(1);
-    expect(active[0].folder_group).toBe("g1");
-    expect(active[0].recipients).toHaveLength(1);
+    const r = active[0];
+    expect(r.folder_group).toBe("g1");
+    expect(r.cadence_minutes).toBe(15);
+    expect(r.next_fire).toBe("2026-01-01T00:00:00.000Z");
+    expect(r.repeat_limit).toBe(5);
+    expect(r.repeat_count).toBe(2);
+    expect(r.recipients).toHaveLength(2);
+    expect(r.recipients.find(x => x.agent_name === "skip")?.include).toBe(0);
+    // remaining = 5 - 2 = 3
+    const remaining = (r.repeat_limit ?? 0) - r.repeat_count;
+    expect(remaining).toBe(3);
   });
 
   it("updates reminder cadence and recipients immediately", () => {
@@ -100,11 +114,15 @@ describe("AgentSolicitService C2", () => {
       user_id: userId,
       folder_group: "g1",
       cadence_minutes: 30,
+      repeat_limit: 5,
+      next_fire: "2026-01-01T00:00:00.000Z",
       recipients: [{ agent_name: "a1", include: 1 }],
     });
 
     const updated = service.update(reminder.id, {
       cadence_minutes: 90,
+      repeat_limit: null,
+      next_fire: null,
       recipients: [
         { agent_name: "a1", include: 0 },
         { agent_name: "a2", include: 1 },
@@ -112,6 +130,8 @@ describe("AgentSolicitService C2", () => {
     });
 
     expect(updated?.cadence_minutes).toBe(90);
+    expect(updated?.repeat_limit).toBeNull();
+    expect(updated?.next_fire).toBeNull();
     expect(updated?.recipients).toHaveLength(2);
     expect(updated?.recipients.find(r => r.agent_name === "a1")?.include).toBe(0);
   });
@@ -133,14 +153,12 @@ describe("AgentSolicitService C2", () => {
   });
 
   it("getDueReminders returns due reminders respecting repeat limit", () => {
-    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
-    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
-
+    // Use SQLite datetime format to catch lexical bug
     const due = service.create({
       user_id: userId,
       folder_group: "due",
       cadence_minutes: 30,
-      next_fire: past,
+      next_fire: "2000-01-01 00:00:00",
       repeat_limit: null,
       recipients: [{ agent_name: "a1" }],
     });
@@ -149,7 +167,7 @@ describe("AgentSolicitService C2", () => {
       user_id: userId,
       folder_group: "future",
       cadence_minutes: 30,
-      next_fire: future,
+      next_fire: "2099-01-01 23:59:59",
       recipients: [{ agent_name: "a2" }],
     });
 
@@ -157,7 +175,7 @@ describe("AgentSolicitService C2", () => {
       user_id: userId,
       folder_group: "limited",
       cadence_minutes: 30,
-      next_fire: past,
+      next_fire: "2000-01-01 00:00:00",
       repeat_limit: 1,
       recipients: [{ agent_name: "a3" }],
     });
@@ -172,13 +190,11 @@ describe("AgentSolicitService C2", () => {
   });
 
   it("advanceReminder increments next_fire and repeat_count", () => {
-    const now = new Date();
-    const nextFire = new Date(now.getTime() - 1000).toISOString();
     const reminder = service.create({
       user_id: userId,
       folder_group: "advance",
       cadence_minutes: 30,
-      next_fire: nextFire,
+      next_fire: "2026-01-01T00:00:00.000Z",
       repeat_limit: null,
       recipients: [{ agent_name: "a1" }],
     });
@@ -186,7 +202,8 @@ describe("AgentSolicitService C2", () => {
     const advanced = service.advanceReminder(reminder.id);
     expect(advanced).not.toBeNull();
     expect(advanced?.repeat_count).toBe(1);
-    expect(new Date(advanced!.next_fire!).getTime()).toBeGreaterThan(new Date(nextFire).getTime());
+    // Literal expectation for cadence discrimination
+    expect(advanced?.next_fire).toBe("2026-01-01T00:30:00.000Z");
   });
 
   it("advanceReminder deactivates when repeat limit reached", () => {
```

# tiller validator — standing contract
(This section is identical in every validator brief. Your specific work is in THE SLICE below.)
- **STANDING (north 2026-08-07):** the path in the slice `tests` column (below) is the test file THAT THIS SLICE MUST AUTHOR, then run green. It is an OUTPUT of the slice, not a precondition. A missing spec file is NEVER a reason to block — write the spec, make it pass, only then report DONE.
- test cmd: **use the `tests` command from YOUR slice row BELOW, exactly as written** — it is the authority. Do NOT substitute a build/test command the project does not have: if the row's command is a plain `node -e ...` one-liner, run that and nothing else. Only run `npm run build` / `npm ci` if the row asks for it or the repo demonstrably has that script. A missing script you were never asked to run is NOT a blocker.
- **YOUR TEST MUST NOT COMPUTE ITS EXPECTED VALUE FROM THE MECHANISM UNDER TEST** (north D-082). The expected value comes from a LITERAL, a FIXTURE, or a SECOND PATH that does not share the code under test. An assertion that asks the thing it is testing what to expect passes whatever that thing does, including wrong, and proves nothing.
  **Concretely: supply an input the mechanism would NOT choose on its own, then assert the output honours it** — a routing selection that is deliberately not the health-ranked winner; a value read back through the public path rather than raw SQL; a host deliberately different from the default. **If you cannot say what would make your test FAIL, it is not a test yet** — say so in your callback rather than reporting DONE on it.
- IF (and only if) your row's command is vitest: `npx vitest run <the focused spec> --minWorkers=1 --maxWorkers=4` — the pool-agnostic worker cap is MANDATORY on EVERY vitest run (incl. any full-suite check); uncapped Vitest thrashes/OOMs this box and kills every tmux session including live runs.
- E2E/UI/browser commands (Playwright etc.): ALWAYS wrap them as `timeout --signal=TERM --kill-after=15s 180s <command>` — a webServer/browser teardown can hang forever and freeze this seat; TERM alone may not kill an unresponsive child, so --kill-after SIGKILLs it. ANY nonzero exit (124 timeout, 137 killed, OR a real test failure) is a **FAIL, never a PASS** — fail closed; never infer a pass from partial output. If you pipe through `tee`, set `-o pipefail` (or read `${PIPESTATUS[0]}`) so the pipe cannot mask the failure.

You are the VALIDATOR. **Write NO product code** (verifier != fixer). You judge, independently.

---

# THE SLICE — C2 (run command-center-2026-08-26)

## Scope (do ONLY this)
Services layer: `AgentSolicitService` CRUD and due-state for preset/custom cadence, stop-after-N or unlimited, immediate include/skip, persisted active-reminder projections.

## Acceptance criteria — the TEXT is the contract, the id is only its name
- **C2** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)
- **C3** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)
- **C4** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)
- **C6** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)

**If a criterion above does not describe the work in Scope, SAY SO rather than implementing toward it.** That is a PLAN_DEFECT and reporting it is worth more than an attempt spent satisfying the wrong thing — one such criterion rode six slices and failed five attempts across three model tiers before a human noticed.
**And if a criterion states an OUTCOME but not a MECHANISM, say which mechanism you are choosing, in your callback.** "Tests must fail when the clause is violated" is an outcome; HOW a test discriminates is the mechanism, and three slices in one run burned attempts because the criterion resolved perfectly and still did not say what to build. Naming your choice costs one line and makes a wrong choice visible at the gate instead of at attempt 3.

## Focused tests
`node scripts/cc-run-isolated.mjs --slice C2 -- npx vitest run tests/unit/agent-reminder-service.spec.ts --minWorkers=1 --maxWorkers=4`

## Emit ONE metric line (non-gating, ignored by every gate)
After you have read this brief and the sources/tests you need, and BEFORE your first edit, echo exactly:
```
[TILLER-METRIC-V1] run=command-center-2026-08-26 batch=C2 attempt=1 role=validator
  marker=DRV-C2-24 event=context_ready ts_ns=$(date +%s%N) head=$(git rev-parse HEAD)
```
Run it as shell so the timestamp and HEAD are real. If you forget it, nothing breaks and nothing fails — it is measurement, not a gate.

## Emit protocol (MANDATORY — verifier≠fixer, write NO product code)
Validate C2 independently against its ACs; run the focused tests. ALSO perform a standard-tier RED-TEAM adversarial pass over the diff (distinct lenses); PASS only if it survives. Verify each evidence file EXISTS on disk before PASS. Then append to /home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/callbacks.md:
`[projcore callback] validator C2 STATUS: DONE — <PASS|FAIL> <one line: what changed, max 100 chars>`
then on the NEXT line (plain shell append, NOT emit-status):

## ON A FAIL, WRITE THE PRESCRIPTION (MANDATORY)
Write **`/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/validation/C2-fix-a2.md`** (absolute — do NOT resolve it against your cwd) before your callback.
**One block per finding that is NOT A CLEAN PASS — including PARTIAL. If N things failed or partially failed, write N blocks** — numbered, in the order you would fix them. Do NOT collapse them to the most important one. Only a lens that passed CLEANLY gets no block:
```
FINDING 1 of <N>
WHAT FAILED: <the specific assertion/behaviour, and where>
THE FIX: <the concrete change that would make this pass>
WHY THE LAST ATTEMPT MISSED IT: <one line, optional>

FINDING 2 of <N>
WHAT FAILED: ...
THE FIX: ...
```
**A finding you leave out can cost a FULL ATTEMPT CYCLE to rediscover** — an implementer turn, a validator turn and the callback latency — to learn something already written on disk. A strong seat sometimes infers past the omission; do not rely on the next seat being that seat. The gate id below stays singular because it names ONE gate; your prescription must not.
**NAME A MECHANISM, NOT AN OUTCOME.** A call, a path, a specimen, a structure, a flag — not the property the change should have. *"Tests must fail when the clause is violated"* is an OUTCOME and is worth nothing to the next seat; *"the negative specimen's NAME must contradict its shape"* is a mechanism and closed the slice. That distinction is not stylistic: a slice spent FOUR attempts each inventing a different mechanism for one question — zero-arg call, bytecode scan, object() sentinel, MagicMock sentinel — while the fix sat unwritten, and closed on the first attempt that had it. **The next implementer sees this file VERBATIM and sees your callback line only as a summary; if the fix is not in the file, it does not reach them.**
`[VERDICT-V1] run=command-center-2026-08-26 batch=C2 attempt=2 marker=DRV-C2-24 verdict=<PASS|FAIL> req=<ids> defect_class=<none on a PASS. On a FAIL pick ONE: TEST_NOT_DISCRIMINATING | IMPL_INCOMPLETE | INTERCEPTION_GAP | ALIAS_BYPASS | PLAN_DEFECT | REQUIREMENTS_STRATEGY_DEFECT — or a SHORT_UPPER_SNAKE name of your own if none fit. **Never emit the literal word CLASS**: it is a placeholder, not a value> failed_gate=<none on a PASS; on a FAIL, the ONE gate id that failed — NOT a list of gates you ran> commit=<HEAD sha> redteam=standard-clean evidence=<path:sha256,...>`
## ⚠ EVIDENCE HASHES — GENERATE, NEVER HAND-TYPE (mandatory)
A hand-typed 64-char sha256 gets garbled and fails the gate. Build the `evidence=` value with a SHELL command and paste its EXACT output, e.g.:
`sha256sum <file1> <file2> ... | awk '{print $2":"$1}' | paste -sd,`
Paths are relative to the REPO ROOT for code (`tests/...`, `src/...`) or run-dir-relative for validation artifacts (`plan/.../validation/...`). Do NOT type any hash by hand. For a user-visible req, evidence MUST include a screenshot + a DOM/aria file under `validation/`.
