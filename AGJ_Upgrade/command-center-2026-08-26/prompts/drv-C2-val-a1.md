# [driver] C2 — THE COMMIT UNDER TEST IS `90df357522aa119c41380ae903ac019c05e323b1`

Analyse EXACTLY that commit: `git show 90df357522aa119c41380ae903ac019c05e323b1`, `git diff 90df357522aa119c41380ae903ac019c05e323b1^..90df357522aa119c41380ae903ac019c05e323b1`.
**Do NOT use `git rev-parse HEAD`** — HEAD moves when anyone commits, including the coordinator writing its own artifacts, and judging the wrong commit has already FAILed a slice whose work was correct. Report `commit=90df357522aa119c41380ae903ac019c05e323b1`.

## The change under test (produced by the driver, not reported by the implementer)
```
[C2] AgentSolicitService CRUD and due-state


 src/services/agent-solicit-service.ts     | 230 ++++++++++++++++++++++++++++++
 tests/unit/agent-reminder-service.spec.ts | 206 ++++++++++++++++++++++++++
 2 files changed, 436 insertions(+)
```
```diff
diff --git a/src/services/agent-solicit-service.ts b/src/services/agent-solicit-service.ts
new file mode 100644
index 0000000..ef78342
--- /dev/null
+++ b/src/services/agent-solicit-service.ts
@@ -0,0 +1,230 @@
+import { DatabaseService } from "../db/database.js";
+
+export interface AgentSolicitReminder {
+  id: number;
+  user_id: number;
+  folder_group: string;
+  cadence_minutes: number;
+  repeat_limit: number | null;
+  repeat_count: number;
+  next_fire: string | null;
+  solicit_message: string;
+  active: number;
+  created_at: string;
+  updated_at: string;
+}
+
+export interface AgentSolicitRecipient {
+  id: number;
+  reminder_id: number;
+  agent_name: string;
+  include: number;
+  created_at: string;
+}
+
+export interface AgentSolicitReminderWithRecipients extends AgentSolicitReminder {
+  recipients: AgentSolicitRecipient[];
+}
+
+export class AgentSolicitService {
+  constructor(private readonly db: DatabaseService) {}
+
+  create(params: {
+    user_id: number;
+    folder_group: string;
+    cadence_minutes: number;
+    repeat_limit?: number | null;
+    solicit_message?: string;
+    next_fire?: string | null;
+    recipients?: { agent_name: string; include?: number }[];
+    active?: number;
+  }): AgentSolicitReminderWithRecipients {
+    if (params.cadence_minutes <= 0) {
+      throw new Error("cadence_minutes must be > 0");
+    }
+
+    const solicitMessage = params.solicit_message ?? "give me a status update";
+    const repeatLimit = params.repeat_limit ?? null;
+    const nextFire = params.next_fire ?? null;
+    const active = params.active ?? 1;
+
+    const reminder = this.db
+      .prepare(
+        `INSERT INTO agent_solicit_reminders
+         (user_id, folder_group, cadence_minutes, repeat_limit, repeat_count, next_fire, solicit_message, active)
+         VALUES (?, ?, ?, ?, 0, ?, ?, ?)
+         RETURNING *`
+      )
+      .get(
+        params.user_id,
+        params.folder_group,
+        params.cadence_minutes,
+        repeatLimit,
+        nextFire,
+        solicitMessage,
+        active
+      ) as AgentSolicitReminder;
+
+    if (params.recipients && params.recipients.length > 0) {
+      for (const r of params.recipients) {
+        this.db
+          .prepare(
+            `INSERT INTO agent_solicit_recipients (reminder_id, agent_name, include)
+             VALUES (?, ?, ?)`
+          )
+          .run(reminder.id, r.agent_name, r.include ?? 1);
+      }
+    }
+
+    return {
+      ...reminder,
+      recipients: this.listRecipients(reminder.id),
+    };
+  }
+
+  list(userId: number): AgentSolicitReminderWithRecipients[] {
+    const reminders = this.db
+      .prepare(
+        `SELECT * FROM agent_solicit_reminders WHERE user_id = ? ORDER BY id`
+      )
+      .all(userId) as AgentSolicitReminder[];
+
+    return reminders.map((r) => ({
+      ...r,
+      recipients: this.listRecipients(r.id),
+    }));
+  }
+
+  listActive(userId: number): AgentSolicitReminderWithRecipients[] {
+    const reminders = this.db
+      .prepare(
+        `SELECT * FROM agent_solicit_reminders WHERE user_id = ? AND active = 1 ORDER BY id`
+      )
+      .all(userId) as AgentSolicitReminder[];
+
+    return reminders.map((r) => ({
+      ...r,
+      recipients: this.listRecipients(r.id),
+    }));
+  }
+
+  getById(id: number): AgentSolicitReminderWithRecipients | null {
+    const reminder = this.db
+      .prepare(`SELECT * FROM agent_solicit_reminders WHERE id = ?`)
+      .get(id) as AgentSolicitReminder | null;
+    if (!reminder) return null;
+    return {
+      ...reminder,
+      recipients: this.listRecipients(id),
+    };
+  }
+
+  update(
+    id: number,
+    updates: {
+      folder_group?: string;
+      cadence_minutes?: number;
+      repeat_limit?: number | null;
+      next_fire?: string | null;
+      solicit_message?: string;
+      active?: number;
+      recipients?: { agent_name: string; include?: number }[];
+    }
+  ): AgentSolicitReminderWithRecipients | null {
+    const existing = this.db
+      .prepare(`SELECT * FROM agent_solicit_reminders WHERE id = ?`)
+      .get(id) as AgentSolicitReminder | null;
+    if (!existing) return null;
+
+    if (updates.cadence_minutes !== undefined && updates.cadence_minutes <= 0) {
+      throw new Error("cadence_minutes must be > 0");
+    }
+
+    const folderGroup = updates.folder_group ?? existing.folder_group;
+    const cadenceMinutes = updates.cadence_minutes ?? existing.cadence_minutes;
+    const repeatLimit = updates.repeat_limit ?? existing.repeat_limit;
+    const nextFire = updates.next_fire ?? existing.next_fire;
+    const solicitMessage = updates.solicit_message ?? existing.solicit_message;
+    const active = updates.active ?? existing.active;
+
+    this.db
+      .prepare(
+        `UPDATE agent_solicit_reminders
+         SET folder_group = ?, cadence_minutes = ?, repeat_limit = ?, next_fire = ?, solicit_message = ?, active = ?, updated_at = datetime('now')
+         WHERE id = ?`
+      )
+      .run(folderGroup, cadenceMinutes, repeatLimit, nextFire, solicitMessage, active, id);
+
+    if (updates.recipients !== undefined) {
+      this.db.prepare(`DELETE FROM agent_solicit_recipients WHERE reminder_id = ?`).run(id);
+      for (const r of updates.recipients) {
+        this.db
+          .prepare(
+            `INSERT INTO agent_solicit_recipients (reminder_id, agent_name, include)
+             VALUES (?, ?, ?)`
+          )
+          .run(id, r.agent_name, r.include ?? 1);
+      }
+    }
+
+    return this.getById(id);
+  }
+
+  delete(id: number): boolean {
+    const result = this.db.prepare(`DELETE FROM agent_solicit_reminders WHERE id = ?`).run(id);
+    return result.changes > 0;
+  }
+
+  listRecipients(reminderId: number): AgentSolicitRecipient[] {
+    return this.db
+      .prepare(
+        `SELECT * FROM agent_solicit_recipients WHERE reminder_id = ? ORDER BY id`
+      )
+      .all(reminderId) as AgentSolicitRecipient[];
+  }
+
+  getDueReminders(): AgentSolicitReminderWithRecipients[] {
+    const nowIso = new Date().toISOString();
+    const reminders = this.db
+      .prepare(
+        `SELECT * FROM agent_solicit_reminders
+         WHERE active = 1 AND next_fire IS NOT NULL AND next_fire <= ?
+         AND (repeat_limit IS NULL OR repeat_count < repeat_limit)`
+      )
+      .all(nowIso) as AgentSolicitReminder[];
+
+    return reminders.map((r) => ({
+      ...r,
+      recipients: this.listRecipients(r.id),
+    }));
+  }
+
+  advanceReminder(id: number): AgentSolicitReminder | null {
+    const reminder = this.db
+      .prepare(`SELECT * FROM agent_solicit_reminders WHERE id = ?`)
+      .get(id) as AgentSolicitReminder | null;
+    if (!reminder || !reminder.next_fire) return null;
+
+    const nextFireDate = new Date(reminder.next_fire);
+    const next = new Date(nextFireDate.getTime() + reminder.cadence_minutes * 60 * 1000);
+    const nextFireIso = next.toISOString();
+
+    const newRepeatCount = reminder.repeat_count + 1;
+    this.db
+      .prepare(
+        `UPDATE agent_solicit_reminders
+         SET repeat_count = ?, next_fire = ?, updated_at = datetime('now')
+         WHERE id = ?`
+      )
+      .run(newRepeatCount, nextFireIso, id);
+
+    // Deactivate if repeat limit reached
+    if (reminder.repeat_limit !== null && newRepeatCount >= reminder.repeat_limit) {
+      this.db
+        .prepare(`UPDATE agent_solicit_reminders SET active = 0, updated_at = datetime('now') WHERE id = ?`)
+        .run(id);
+    }
+
+    return this.db.prepare(`SELECT * FROM agent_solicit_reminders WHERE id = ?`).get(id) as AgentSolicitReminder;
+  }
+}
diff --git a/tests/unit/agent-reminder-service.spec.ts b/tests/unit/agent-reminder-service.spec.ts
new file mode 100644
index 0000000..cae9b2c
--- /dev/null
+++ b/tests/unit/agent-reminder-service.spec.ts
@@ -0,0 +1,206 @@
+import { describe, it, expect, beforeEach, afterEach } from "vitest";
+import { DatabaseService } from "../../src/db/database.js";
+import { AgentSolicitService } from "../../src/services/agent-solicit-service.js";
+import fs from "node:fs";
+import os from "node:os";
+import path from "node:path";
+
+const tempDirs: string[] = [];
+
+function tempDb(name: string): string {
+  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agjassist-agent-reminder-service-"));
+  tempDirs.push(dir);
+  return path.join(dir, name);
+}
+
+afterEach(() => {
+  for (const dir of tempDirs.splice(0)) {
+    fs.rmSync(dir, { recursive: true, force: true });
+  }
+});
+
+describe("AgentSolicitService C2", () => {
+  let db: DatabaseService;
+  let service: AgentSolicitService;
+  let userId: number;
+
+  beforeEach(() => {
+    const dbPath = tempDb("test.sqlite");
+    db = new DatabaseService(dbPath);
+    service = new AgentSolicitService(db);
+    db.prepare("INSERT INTO users (telegram_id, role) VALUES (12345, 'owner')").run();
+    userId = (db.prepare("SELECT id FROM users WHERE telegram_id = 12345").get() as { id: number }).id;
+  });
+
+  afterEach(() => {
+    db.close();
+  });
+
+  it("creates reminder with preset cadence and recipients", () => {
+    const reminder = service.create({
+      user_id: userId,
+      folder_group: "group-a",
+      cadence_minutes: 30,
+      repeat_limit: null,
+      solicit_message: "give me a status update",
+      next_fire: "2026-01-01T00:00:00.000Z",
+      recipients: [
+        { agent_name: "agent-1", include: 1 },
+        { agent_name: "agent-2", include: 0 },
+      ],
+    });
+
+    expect(reminder.id).toBeGreaterThan(0);
+    expect(reminder.folder_group).toBe("group-a");
+    expect(reminder.cadence_minutes).toBe(30);
+    expect(reminder.repeat_limit).toBeNull();
+    expect(reminder.recipients).toHaveLength(2);
+    expect(reminder.recipients.find(r => r.agent_name === "agent-1")?.include).toBe(1);
+    expect(reminder.recipients.find(r => r.agent_name === "agent-2")?.include).toBe(0);
+  });
+
+  it("creates reminder with custom cadence and stop-after-N", () => {
+    const reminder = service.create({
+      user_id: userId,
+      folder_group: "group-b",
+      cadence_minutes: 45,
+      repeat_limit: 5,
+      recipients: [{ agent_name: "agent-x" }],
+    });
+
+    expect(reminder.cadence_minutes).toBe(45);
+    expect(reminder.repeat_limit).toBe(5);
+    expect(reminder.repeat_count).toBe(0);
+  });
+
+  it("lists active reminders with recipients projection", () => {
+    service.create({
+      user_id: userId,
+      folder_group: "g1",
+      cadence_minutes: 15,
+      active: 1,
+      recipients: [{ agent_name: "a1" }],
+    });
+    service.create({
+      user_id: userId,
+      folder_group: "g2",
+      cadence_minutes: 60,
+      active: 0,
+      recipients: [{ agent_name: "a2" }],
+    });
+
+    const active = service.listActive(userId);
+    expect(active).toHaveLength(1);
+    expect(active[0].folder_group).toBe("g1");
+    expect(active[0].recipients).toHaveLength(1);
+  });
+
+  it("updates reminder cadence and recipients immediately", () => {
+    const reminder = service.create({
+      user_id: userId,
+      folder_group: "g1",
+      cadence_minutes: 30,
+      recipients: [{ agent_name: "a1", include: 1 }],
+    });
+
+    const updated = service.update(reminder.id, {
+      cadence_minutes: 90,
+      recipients: [
+        { agent_name: "a1", include: 0 },
+        { agent_name: "a2", include: 1 },
+      ],
+    });
+
+    expect(updated?.cadence_minutes).toBe(90);
+    expect(updated?.recipients).toHaveLength(2);
+    expect(updated?.recipients.find(r => r.agent_name === "a1")?.include).toBe(0);
+  });
+
+  it("deletes reminder and cascades recipients", () => {
+    const reminder = service.create({
+      user_id: userId,
+      folder_group: "g1",
+      cadence_minutes: 30,
+      recipients: [{ agent_name: "a1" }],
+    });
+
+    const ok = service.delete(reminder.id);
+    expect(ok).toBe(true);
+    expect(service.getById(reminder.id)).toBeNull();
+
+    const recs = db.prepare("SELECT * FROM agent_solicit_recipients WHERE reminder_id = ?").all(reminder.id);
+    expect(recs).toHaveLength(0);
+  });
+
+  it("getDueReminders returns due reminders respecting repeat limit", () => {
+    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
+    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
+
+    const due = service.create({
+      user_id: userId,
+      folder_group: "due",
+      cadence_minutes: 30,
+      next_fire: past,
+      repeat_limit: null,
+      recipients: [{ agent_name: "a1" }],
+    });
+
+    const notDue = service.create({
+      user_id: userId,
+      folder_group: "future",
+      cadence_minutes: 30,
+      next_fire: future,
+      recipients: [{ agent_name: "a2" }],
+    });
+
+    const limited = service.create({
+      user_id: userId,
+      folder_group: "limited",
+      cadence_minutes: 30,
+      next_fire: past,
+      repeat_limit: 1,
+      recipients: [{ agent_name: "a3" }],
+    });
+    // Simulate repeat exhausted
+    db.prepare("UPDATE agent_solicit_reminders SET repeat_count = 1 WHERE id = ?").run(limited.id);
+
+    const dueList = service.getDueReminders();
+    const ids = dueList.map(r => r.id);
+    expect(ids).toContain(due.id);
+    expect(ids).not.toContain(notDue.id);
+    expect(ids).not.toContain(limited.id);
+  });
+
+  it("advanceReminder increments next_fire and repeat_count", () => {
+    const now = new Date();
+    const nextFire = new Date(now.getTime() - 1000).toISOString();
+    const reminder = service.create({
+      user_id: userId,
+      folder_group: "advance",
+      cadence_minutes: 30,
+      next_fire: nextFire,
+      repeat_limit: null,
+      recipients: [{ agent_name: "a1" }],
+    });
+
+    const advanced = service.advanceReminder(reminder.id);
+    expect(advanced).not.toBeNull();
+    expect(advanced?.repeat_count).toBe(1);
+    expect(new Date(advanced!.next_fire!).getTime()).toBeGreaterThan(new Date(nextFire).getTime());
+  });
+
+  it("advanceReminder deactivates when repeat limit reached", () => {
+    const nextFire = new Date(Date.now() - 1000).toISOString();
+    const reminder = service.create({
+      user_id: userId,
+      folder_group: "limit",
+      cadence_minutes: 30,
+      next_fire: nextFire,
+      repeat_limit: 1,
+      recipients: [{ agent_name: "a1" }],
+    });
+
+    const advanced = service.advanceReminder(reminder.id);
+    expect(advanced?.active).toBe(0);
+  });
+});
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
Write **`/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/validation/C2-fix-a1.md`** (absolute — do NOT resolve it against your cwd) before your callback.
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
`[VERDICT-V1] run=command-center-2026-08-26 batch=C2 attempt=1 marker=DRV-C2-24 verdict=<PASS|FAIL> req=<ids> defect_class=<none on a PASS. On a FAIL pick ONE: TEST_NOT_DISCRIMINATING | IMPL_INCOMPLETE | INTERCEPTION_GAP | ALIAS_BYPASS | PLAN_DEFECT | REQUIREMENTS_STRATEGY_DEFECT — or a SHORT_UPPER_SNAKE name of your own if none fit. **Never emit the literal word CLASS**: it is a placeholder, not a value> failed_gate=<none on a PASS; on a FAIL, the ONE gate id that failed — NOT a list of gates you ran> commit=<HEAD sha> redteam=standard-clean evidence=<path:sha256,...>`
## ⚠ EVIDENCE HASHES — GENERATE, NEVER HAND-TYPE (mandatory)
A hand-typed 64-char sha256 gets garbled and fails the gate. Build the `evidence=` value with a SHELL command and paste its EXACT output, e.g.:
`sha256sum <file1> <file2> ... | awk '{print $2":"$1}' | paste -sd,`
Paths are relative to the REPO ROOT for code (`tests/...`, `src/...`) or run-dir-relative for validation artifacts (`plan/.../validation/...`). Do NOT type any hash by hand. For a user-visible req, evidence MUST include a screenshot + a DOM/aria file under `validation/`.
