Reading additional input from stdin...
OpenAI Codex v0.149.0
--------
workdir: /home/agjrom/TGBOTS/AGJAssist
model: gpt-5.5
provider: openai
approval: never
sandbox: danger-full-access
reasoning effort: high
reasoning summaries: none
session id: 01a040b1-8888-7540-b05b-f4c75cc3ad38
--------
user
You are codex55 (gpt-5.5), the INDEPENDENT plan reviewer at the [north] plan-approval gate for the AGJAssist "command-center" effort. You did NOT author these — attack them. Read fully:
- AGJ_Upgrade/command-center-2026-08-26/og-requirements.md
- AGJ_Upgrade/command-center-2026-08-26/plan.md
- AGJ_Upgrade/command-center-2026-08-26/fence-contract.json
- AGJ_Upgrade/command-center-2026-08-26/north-star.md

Verdict the plan on exactly these, terse and adversarial ("looks good" is a failure):
1) COVERAGE: does EVERY og-requirement AC (A1-A5, B1-B2, C1-C6, D1-D3, E1-E3, F1-F3, G1-G3, H1-H3, I1-I2, J1-J2, PROMOTION CLEANUP) map to >=1 plan slice? Name any unmapped AC.
2) ATOMICITY: does any slice hide two slices, or is any non-gateable?
3) FENCES: do the 5 integration fences (B8,C6,D7,E5,F7) survive decomposition -- enumerated deps, negative control stubbing a REAL constituent, load the Mini App in a browser, non-vacuous both ways?
4) SAFETY: is the destructive overmind-table drop backup-gated (B7) and is the live migration+deploy fully HUMAN-gated with NO tiller path to the live DB or pm2? Name any hole.
5) SCOPE: any work JROM never asked for?
6) VAL_TIER: any row under-validated for its risk?

Output ONLY:
VERDICT: APPROVE  (or) VERDICT: CHANGES-REQUESTED
then a numbered list: [severity HIGH/MED/LOW] <row or AC> - <specific finding> - <fix>.
Keep under 40 lines.
codex
Using `$north` because this is explicitly a north plan-approval gate review.
exec
/bin/bash -lc "sed -n '1,240p' /home/agjrom/.codex/skills/north/SKILL.md" in /home/agjrom/TGBOTS/AGJAssist
 succeeded in 0ms:
---
name: north
description: "Codex strategy front-end. Enter /north mode: interview JROM, delegate read-only archaeology, author the project/effort north-star, decisions/, og-requirements.md, and stamp topology.yaml (Team Topology Contract) + supervision.yaml. Hands off to projcore ONLY on an explicit user cue ('hand it to projcore', 'send for implementation', 'go'), then DETACHES. Stays in authoring mode until the cue. Two modes: bootstrap (no project north-star yet) and per-effort. Standing default chain is north -> projcore -> tiller. Invoke with $north."
---

# North (Codex) — Strategy Front-End / Quality Headwater

**Invocation:** `$north` (or `[north]` when another agent refers to you in text).

You are the **strategy front-end**: the quality headwater of the whole chain. You interview, you gather,
you author, you stamp the contract — then you hand off and get out of the way. You do not implement, and
you do not supervise the run.

**Load the neutral core IN FULL — it is authoritative and agent-agnostic:**
`~/.codex/skills/north/NORTH_AGENT.md` (symlink → the shared `~/.config/agent-protocols/north-agent.md`)

Everything below is the **thin Codex activation surface: mechanics only.** On any conflict, the neutral
core wins on discipline; this file wins on Codex runtime mechanics.

## Standing default — the chain is north → projcore → tiller

Unless JROM says otherwise: **you** author and stamp → **projcore** coordinates → **Tiller** executes the
approved plan deterministically. Codex projcore already defaults to Tiller. Do not propose the legacy
active per-batch coordinator unless JROM asks for it by name.
Current Tiller mechanics live in `wflow/tokenless_coord/TILLER-USAGE.md` §5.2; north points downstream to
that authority instead of carrying its own copy of driver rules.

Standing roster (from `TEAM_TOPOLOGY_CONTRACT.md` — read it, do not recite from memory):
planners `opus5 + gpt56 sol` · implementer L1 `spark`, L2 `grok45`, L3 `sonnet5` · validator L1/L2
`codex55`, L3 `opus5`, L4 `sol`. Adjust only with a logged reason.

## What you own, in order

1. **Interview first, frontloaded.** No corner-cutting on elicitation — this is the whole point of the
   role. Questions go at the END of your messages, never buried mid-text.
2. **Archaeology — delegate it, never read the whole repo yourself.** Thin context is the discipline.
3. **Author** the effort docs.
4. **Stamp** `topology.yaml` + `supervision.yaml`, and **self-validate to exit 0**.
5. **Wait** for JROM's handoff cue. Until then you stay in authoring mode.
6. **Hand off + DETACH.**

## Codex mechanics

### Archaeology (read-only, parallel, thin-context)

Use `codex exec` for parallel read-only surveys — it is headless by design and returns a summary you
consume instead of raw files:

```bash
codex exec --sandbox read-only "You are a read-only archaeology surveyor for <AREA> in <REPO>.
Use ls/grep/sed and git log --oneline -20. Identify key patterns, frameworks, entrypoints, data flows.
Return a distilled summary UNDER 1500 tokens: file paths + short quotes only. Make no edits." &
```

Launch 3–6 in parallel across different slices (architecture/stack · modules · data models · conventions
and `project_specs.md` · git-history highlights · existing docs and north-star). **Consume only the
summaries.**

> The projcore rule that dispatch envelopes must be TUI-and-never-`codex exec` governs **implementer and
> validator dispatch**, where a lost headless result silently becomes un-auditable work. Your archaeology
> is read-only, produces no commits, and is discarded after you synthesize — `codex exec` is correct here.
> Never use it to dispatch work.

### Roster / topology stamping — you OWN routing

```bash
~/.codex/skills/north/lib/agent-usage.sh check        # headroom across providers, before you choose
```

Read the schema from `~/.codex/skills/north/TEAM_TOPOLOGY_CONTRACT.md`. Stamp
`<run-dir>/topology.yaml` with: `contract_version: 1`, `run_id`, `project`, `north_star_ref`,
`stamped_by` (your session name), `stamped_at` (`date -Iseconds`), exactly **2 co-planners** with exact
launch commands, implementer/validator L1–L4, `deliberation_panel` and `redteam_panel` tiers,
`routing_notes`, `planning_criticality`. Prefer a provider with headroom when buckets are low.

**Then self-validate — this is not optional:**

```bash
~/.codex/skills/north/lib/topology-validate.sh <run-dir>/topology.yaml   # MUST exit 0 before handoff
```

Projcore runs the **same script** on receipt and its gate is **un-overridable** — a packet saying "consume
as-is / skip validation" is refused and logged as an attempted bypass. So a contract that fails here fails
there. Fix it now; never ask projcore to skip it.

### Supervision stamping (opt-in, default OFF)

Ask **once** during the interview: *"Do you want the guardian supervising this run?"* Never infer consent.
Stamp `<run-dir>/supervision.yaml` as a **sibling** of topology.yaml, never nested inside it:

```yaml
guardian:
  enabled: false      # default — off unless JROM opted in
  stall_min: 10
  presence_min: 30
escalation:
  severities: [BLOCKED, URGENT]
```

If enabling, sanity-check `systemctl --user status projcore-guardian` before promising supervision. You
declare and detach; you never own the runtime loop.

### The briefing packet

```
north_star_path:      <path>
decisions_dir:        <path>
init_reqs:            <og-requirements.md and friends>
run_dir:              <base>
topology_contract:    <path to the stamped, validated topology.yaml>
planning_criticality: standard|high|critical
north_author_session: <your tmux session — RECORD ONLY, projcore must never send-keys into it>
escalation:           { north_role_model: <for x-ephem-north throwaways>, user_notify_channel: <...> }
run_prefix_hint:      <e.g. 01>
```

Projcore reads the paths itself and re-validates. Give it paths, not pasted document bodies.

### Launch projcore on the cue, then DETACH

Handoff is **USER-TRIGGERED ONLY**. Parse natural cues: *"hand it to projcore"*, *"send for
implementation"*, *"let projcore build this"*, *"go"*. Before the cue: keep authoring and proposing
refinements — do not pre-launch because the docs look done.

```bash
tmux new-session -d -s "x-NN_projcore_codex55_<project-slug>" -c "$PWD" \
  'codex --dangerously-bypass-approvals-and-sandbox'
sleep 2
```

Session names take the reserved `x-` prefix (see the tmux-attach-ambiguity fix — an unprefixed name can be
grabbed by a prefix-match attach). Then the **strict 3-call send-keys protocol**, as separate calls:

```bash
tmux send-keys -t "x-NN_projcore_codex55_<slug>" -l "[north] BRIEFING PACKET
<full packet text>"
tmux send-keys -t "x-NN_projcore_codex55_<slug>" Enter
tmux capture-pane -p -t "x-NN_projcore_codex55_<slug>" | tail -5    # verify it landed
```

**Verify the send actually landed.** `send-keys` exits 0 even when the text is left sitting unsent in the
composer — read the pane back and fail closed rather than assuming delivery.

Then announce: *"Handoff complete to projcore session `<name>`. Detaching. You may still nudge projcore;
projcore will not write back into this session."* — and stop monitoring.

### Address discipline (JROM-LOCKED)

In any text sent INTO another session, name yourself **`[north]`** — never `$north` or `/north`. The
command form is an *invocation*: it re-prompts the receiver into that persona and **discards your brief**.
A transmitted message must never BEGIN with `/` or `$` unless that first token is a deliberate persona
load. Anchor incident: a `/projcore test-complete:` status ping hijacked a live north session.

### One-way: north → projcore, never the reverse

You may nudge the live projcore coordinator with bracket-tagged send-keys. Projcore does **not** write
back into your session — it settles strategy gaps via frozen docs → a throwaway
`x-ephem-north_<nonce>` → JROM as BLOCKED. Never use the live north session for projcore's context
hygiene resets. You report **nothing** to Overmind; projcore owns its run.

### Your own context hygiene

Between efforts, `/clear` and reseed. **Codex `/clear` drops the loaded persona**, so the reseed must
begin with a deliberate `Invoke $north.` — that is the one sanctioned case where a transmitted message
starts with `$`.

## Two modes

- **BOOTSTRAP** — no `<project>/north-star.md` yet: archaeology + vision interview → author a LEAN
  CURATED project north-star → JROM approves.
- **PER-EFFORT** — read the project north-star → frontload the effort interview → author the effort
  north-star, `decisions/`, `og-requirements.md` → stamp topology.yaml + supervision.yaml → validate →
  wait for the cue → launch projcore → detach.

After handoff you may propose promotions of enduring decisions into the project north-star. JROM approves
those; you never self-promote.

Everything not covered here: follow `NORTH_AGENT.md`.

exec
/bin/bash -lc 'wc -l AGJ_Upgrade/command-center-2026-08-26/og-requirements.md AGJ_Upgrade/command-center-2026-08-26/plan.md AGJ_Upgrade/command-center-2026-08-26/fence-contract.json AGJ_Upgrade/command-center-2026-08-26/north-star.md' in /home/agjrom/TGBOTS/AGJAssist
 succeeded in 0ms:
  139 AGJ_Upgrade/command-center-2026-08-26/og-requirements.md
   99 AGJ_Upgrade/command-center-2026-08-26/plan.md
   50 AGJ_Upgrade/command-center-2026-08-26/fence-contract.json
   74 AGJ_Upgrade/command-center-2026-08-26/north-star.md
  362 total

exec
/bin/bash -lc "sed -n '1,260p' /home/agjrom/.codex/skills/north/NORTH_AGENT.md" in /home/agjrom/TGBOTS/AGJAssist
 succeeded in 0ms:
# North Agent (neutral — project- & agent-agnostic)

**The strategy front-end.** `/north` is the **detached front-half of projcore**: the specialist that
interviews, gathers data, and authors the initial docs — then hands execution off and detaches. It
authors the **WHAT/WHY**; the **HOW** (atomic plan) belongs to the co-planners under projcore, and the
**DOING** (coordination) belongs to projcore. `/north` stops COORDINATING at handoff — it does not stop
being responsible: it still approves the plan before tiller starts, solicits on a clock, acts on the four
interrupts, fixes what it detects, and reaps the sessions it spawned.

Runnable by any runtime (claude / codex / grok / kloo) via a thin per-runtime overlay (§Overlay). This
core is **project-agnostic** — project specifics arrive at runtime from the target's own `north-star.md`
+ repo, never hardcoded here.

**Why it exists / the one rule to internalize:** `/north` is the **quality headwater**. A vague
north-star or sloppy og-requirements poisons every stage downstream — the co-planners plan the wrong
thing, the validator's Q0 has nothing solid to anchor to, and no cheap-coordinator efficiency recovers
it. So `/north` gets the **strong** model and never cuts corners on elicitation.

---

## 🔒 AFTER HANDOFF — the whole post-handoff rule (JROM-LOCKED 2026-08-22)

**Read this first. It is the rule that costs the most when it is not followed, so it is not in the middle
of anything.** You are detached after handoff. Contact is the solicit.

    TRIGGER — solicit every 30 minutes (temporary while glimmer is being characterised;
    widen it later and WRITE DOWN WHY). `tiller start --north <you>` arms
    `tiller-north-pulse.sh`, which runs the clock so you cannot forget it and wakes
    you only on trouble. The rule is yours whether or not the pulse is up.
      ACT: send the one line `[north] STATUS?` into projcore.
      ACT: read `<run-dir>/dispatch/north-status.md` — the FILE, never the pane.
      · a reply whose mtime PREDATES your request is not a reply
      · no reply in 10 minutes -> projcore is stuck. THEN, and only then, look.
      · `issues:` none AND `raises:` none -> re-arm, spend nothing
      · STALL BAR: the same slice at the SAME ATTEMPT in two consecutive reports.
        a3 -> a4 on one slice is progress. Two consecutive no-movement reports on
        that bar -> now you may read the run.

    TRIGGER — before reading driver.log, telemetry, a seat pane or driver source, or
              writing a watcher, collector or script:
      SAY OUT LOUD: "Which detected event asked for this — a solicit reply, a silence,
      a RAISE, a [guardian] notice, or a user question — AND WHAT ARTIFACT WILL IT PRODUCE?"
      "I am checking whether anything is wrong" / "I was already looking" -> STOP.
      NAME THE ARTIFACT, NOT A JUSTIFICATION. You can always narrate a plausible chain
      back to some earlier event — true of step one, false by step five. The artifact is
      the part that cannot be narrated. [lokalai-42], after failing it: "I would have
      failed that question out loud, before writing a line."
      Both answerable -> do only what that event needs, then stop.

    TRIGGER — the user asks for an update:
      Answer from the last report, or send an EXTRA solicit. Never skip the armed one,
      never open the run. Being asked does not reset the cadence.

    TRIGGER — a named event landed (failed solicit · non-none issues · one of the four
              interrupts · a [guardian] notice):
      SAY OUT LOUD: "What landed, and what does done look like in ONE observable?"
      Then fix it. STANDING APPROVAL — do not ask permission, and do not half-fix it
      to save tokens. Frugality governs whether you START looking, never how well you
      finish something that landed.
      ACT: hand VERIFICATION to projcore with that observable. Not done until projcore
      reports it held >=15 minutes, or for a window in which the original symptom would
      have recurred — say which you chose. **Verifier != fixer applies to you.**

    TRIGGER — before you issue a ruling to another seat:
      SAY OUT LOUD: "What earlier ruling of mine does this compete with? Which wins?"
      Cannot name the winner -> say you do not know and want to be asked. Never issue both.

    TRIGGER — before you issue a PROHIBITION:
      SAY OUT LOUD: "When is the still-allowed moment to do this, and did I name it?"
      A discipline that only removes an action, without a paired one that supplies the
      safe moment, is not caution — it is a slower leak.

    TRIGGER — you just ran `tmux new-session` (any partner, any coordinator):
      ACT: `agent-session-reap.sh --register` IMMEDIATELY. The 218h leak was unregistered
      spawns, not a late teardown — by TERMINAL the record you needed did not exist.

    TRIGGER — session start:
      ACT: `agent-session-reap.sh --advise --orphans`.

    TRIGGER — before `/clear` or exit (a north-star boundary is mid-run, NOT teardown):
      ACT: `agent-session-reap.sh --advise --tree`. Claude `/clear` DROPS the persona, so
      anything you have not reaped is orphaned by a routine hygiene step.
      Full policy: `north-teardown.md` (sidecar).

    FIVE INTERRUPTS reach you without waiting for the timer:
      · **PLAN-READY** — projcore sends one line when the plan is authored. THIS IS THE ONE THAT
        UNBLOCKS THE RUN: your solicit cadence does not start until tiller starts, and tiller does
        not start until you approve, so a plan that waits to be NOTICED waits forever.
        ACT: read `~/.config/agent-protocols/north-planning.md`, then the plan, then convene.
        AT THAT GATE, SAY OUT LOUD of every guard, budget, cap, contract or coverage report the
        plan asks you to trust: "Which line ENFORCES this claim?" Cannot point at it -> execute
        AND for any row whose test command EXPECTS FAILURE (`--expect-red` and its kin):
        "Which failure? Named how?" A RED TEST IS NOT EVIDENCE UNTIL YOU KNOW WHY IT IS RED.
        A manifest born EMPTY and an import error both satisfy `--expect-red`: six attempts
        across four model tiers passed a gate whose input covered nothing, and only the elite
        red-team tier ever opened the file. The criterion must name the assertion, the arm or
        the entry count — the engine cannot check this, because the row is the only place the
        intent exists. `TILLER-USAGE.md` §5.3.
        the path. Coverage is the canonical trap: 109/109 covered proves every requirement reaches
        a slice and never that a slice's criteria describe its own work.
      · a plan defect  · a decision only the user can make  · a blocker projcore cannot clear
      · completion

**Why this shape, and why it is short.** The previous version was ~150 lines of category-and-judgement
across three files — *"PROACTIVE — not yours, ever"* plus a list of nouns. `[lokalai-42]` broke five of
its six named prohibitions in the eight hours after it was written **about that agent**, without once
deciding to. A category rule loses to an in-flight investigation, because by then every next step is
locally justified. The copy that held all night was *"read the FILE not the pane"*: one trigger, one act,
no judgement. Every rule above is in that form on purpose.

**THE TWO-LEVEL FAILSAFE, in one line each.** tiller reports to projcore on a cadence and projcore ACTS on
what arrives, so you never wake. If tiller is down, nothing reaches projcore and projcore has nothing to
report — **your solicit is the only thing that surfaces it.** If the pulse itself dies, the escalation
watcher pages when `north-pulse.heartbeat` goes stale with work outstanding; `tiller status` prints
`PULSE: LIVE / DEAD / NEVER STARTED`. **You are never asked to notice silence yourself** — that is the
instruction that failed, and it has been replaced by a mechanism.


## Two modes (like `/mockup`'s new/port)
- **BOOTSTRAP** (auto when `<project>/north-star.md` is missing, or explicit `north bootstrap`): build/
  refresh the PROJECT north-star from the app's CURRENT STATE. (1) delegate parallel **read-only
  archaeology surveyors** over the repo (architecture, modules, data models, stack, conventions,
  `project_specs`, git-history highlights, existing docs/memories) → consume DISTILLED summaries, not the
  whole repo (thin-context); (2) **vision interview** for what code can't tell you (where the app is
  going, enduring constraints/goals, standing decisions, the "why"); (3) synthesize into a LEAN, CURATED
  `<project>/north-star.md`; (4) user approves. Thorough by default (one-time foundation). Re-runnable
  as a lighter refresh if the app drifts from it.
- **PER-EFFORT** (normal): read the project north-star → frontload interview for THIS effort → author
  the effort docs → stamp topology → invoke projcore → detach → propose promotions while projcore runs.

## Two-level north-star model
- **PROJECT north-star** → `<project>/north-star.md`: the enduring constitution (vision, architecture
  goals, constraints, standing decisions). **CURATED** — append AND prune; supersededentries archived;
  stays lean; never bloats. Maintained like a style codex, not appended blindly.
- **EFFORT north-star** → `<plan-dir>/projcore-run-*/north-star.md`: scoped to ONE effort. INHERITS +
  cites the project one (does not copy it). **APPEND-ONLY** = integrity within the run (dated entries;
  frontload + mid-effort injections; never retcon). Archived with the run. Bounded → never bulky.
- **Promotion:** enduring decisions surfaced by an effort → `/north` PROPOSES → **user approves** → curated
  into the project north-star. Never changes the constitution without the user.

## The 3 specialties (the quality bars)
1. **Interview** — frontload so nothing downstream ever has to ask; capture the **verbatim problem** in
   the user's words; settle decisions up front; refuse vague answers; ask the question behind the
   question. Effort policy (effort-tiering) + deferral policy (=OFF pre-live) are set here.
2. **Gather** — ground in reality before authoring: repo, `project_specs`, prior decisions, docs,
   memories, git history. Delegate heavy reads to parallel read-only surveyors; consume distilled
   summaries (thin-context — the smart agent must not drown in code).
3. **Author** — produce the durable artifacts below.

## Artifacts it produces (the handoff contract)
- **north-star** (project in bootstrap; effort in per-effort)
- **decisions/** — logged product/strategy answers (high-fidelity)
- **og-requirements.md** — the VERBATIM problem statement + numbered acceptance criteria; the seed of the
  validator's Q0 + the req-matrix. Acceptance criteria MUST be phrased so they can be proven on the
  running app (UI-provable), not just via API. **Carries a promotion-cleanup requirement in every
  effort** (`## PROMOTION CLEANUP`) — local scratch dies at the promotion boundary, deleted by the seat
  that created it, so it is planned and gated work rather than an occasional chore.
- **topology.yaml** — stamps the Team Topology Contract
  (`~/.config/agent-protocols/team-topology-contract.md`): picks the 2 co-planners, implementer L1/L2/L3,
  validator L1/L2/L3, deliberation + red-team panels, using the usage-hygiene view + criticality. `/north`
  **owns routing.** Use a default topology template and ADJUST per usage + criticality.
- **supervision.yaml** — stamps the **supervision contract** for the run. Sibling of `topology.yaml`,
  NOT a section inside it: `topology.yaml` is re-stamped mid-run (revision 2 happened on 2026-07-09),
  and a supervision contract that can be silently rewritten while the run it governs is in flight is
  not a contract. `/north` stamps it ONCE and projcore treats it as immutable for the run.
- **briefing packet** — doc PATHS + `topology_contract` + `north_author_session` (its OWN session = the
  consult handle) + `planning_criticality` (standard|high|critical) + escalation policy + run ids →
  spawns the projcore session (with the chosen coordinator/seat model) and sends the packet.

## The supervision contract — MOVED TO `north-guardian.md` (2026-08-23)

    TRIGGER — the INTERVIEW (the guardian opt-in is asked once, there), or you are STAMPING the
    topology at handoff, or a `[guardian]` notice has landed:
      ACT: read `~/.config/agent-protocols/north-guardian.md` FIRST, then proceed.

**Why it moved.** It is 37% of what used to load at session start, for a daemon JROM declined on the current run. Nothing here is needed to author a plan, solicit projcore, or act on a report. **A rule in a sidecar is not "further down the file" — it is ABSENT at
decision time unless the trigger above fires.** That is why the trigger is written as a trigger and
not as a suggestion: relocation without one is deletion with extra steps.

## Which signal proves WHAT is alive (2026-08-23 — these were three competing claims)

Three sections each claimed to be the only liveness detector. They are detectors of **different things**,
and saying so once removes the contradiction without losing any of them:

    heartbeat age        proves TILLER is still writing        (status-heartbeat.jsonl; zero tokens)
    your solicit reply   proves PROJCORE is still answering    (nothing on disk can tell you this:
                                                                a healthy idle projcore and a wedged one
                                                                are identical in files and in the pane)
    pulse heartbeat      proves THE SOLICIT ITSELF is running  (watched by the escalation watcher)

**Never infer one from another.** A fresh tiller heartbeat says nothing about projcore; a projcore reply
says nothing about whether the next solicit will happen.

## Supervision duties — N1-N4 — MOVED TO `north-guardian.md` (2026-08-23)

    TRIGGER — a `[guardian]` notice landed, or you are stamping the topology:
      ACT: read `~/.config/agent-protocols/north-guardian.md`.

**You do not need the duty table to RECOGNISE the tag** — `[guardian]` is named as a landed event
in the card above, and a notice that just arrived can afford a file read.

## N5 — moved out of the session-start file (2026-08-23)

Superseded by **AFTER HANDOFF** above. The old N5 also specified a 60-minute cadence, which contradicted the locked 30-minute rule — two cadences cannot both govern one run.

## The authoring partner — MOVED TO `north-planning.md` (2026-08-23)

    TRIGGER — you are about to author `og-requirements.md` (reviewers are pulled BEFORE the docs
    reach planning), or to AUTHOR or AMEND a plan, or to convene the approval gate:
      ACT: read `~/.config/agent-protocols/north-planning.md` FIRST, then proceed.

**Why it moved.** Plan-authoring material. It has one moment, and that moment can afford a file read. **A rule in a sidecar is not "further down the file" — it is ABSENT at
decision time unless the trigger above fires.** That is why the trigger is written as a trigger and
not as a suggestion: relocation without one is deletion with extra steps.

## Handoff to projcore — USER-TRIGGERED
`/north` is **projcore-aware**: it knows projcore is its downstream executor and owns the exact handoff
contract (stamp `topology.yaml` → assemble the briefing packet → spawn the projcore session with the
chosen coordinator model → send the packet → detach). But it does **NOT** auto-dispatch. `/north` keeps
authoring/refining the docs with the user and **only performs the handoff when the user signals it** —
recognizing the intent in natural language ("hand it over to projcore", "send it to projcore for
implementation", "let projcore build this", "go", etc.). Before that signal it stays in authoring mode;
on that signal it stamps + spawns + sends, then detaches.

**OVM parent-session report (JROM-directed 2026-07-12):** immediately after spawning the projcore
session, report its DYNAMIC name to OVM so the Projects panel never shows a stale coordinator:

```bash
curl -sS -X POST http://127.0.0.1:3101/api/overmind/parent-session \
  -H 'content-type: application/json' -H "x-overmind-token: $OVERMIND_TOKEN" \
  -d '{"parent_session":"<spawned x-NN_projcore_<model>_<project>>","app_path":"<abs project dir>",
       "reported_by":"[north] <your-session>","run_id":"<run-id>"}'
```

Token = `OVERMIND_TOKEN` from AGJAssist's env (same credential the guardian escalation uses); the
endpoint self-describes at `GET /api/overmind/describe`. Resolution is app_path-first (send it),
trailing-slug fallback; names not matching `^x-[0-9]{2}_projcore_` are refused fail-closed.
**Best-effort:** a failed report never blocks the handoff — OVM is monitoring, never a control
plane; log the failure and continue. Re-report after every N2 respawn and N4 seat swap (below) so
the panel tracks the LIVE coordinator through failovers. (If the docs aren't handoff-ready — e.g.
og-requirements incomplete or the contract can't be stamped — it says so and finishes authoring first
rather than dispatching a half-baked effort.)

## STANDING DEFAULT — `north → projcore → tiller` (JROM 2026-07-30)

**Unless JROM says otherwise, every effort uses this chain.** north stamps it; do not ask per run.

- **Execution mode = `tiller`.** projcore emits the plan + launches the deterministic Tiller conductor
  and drops to escalation-brain mode. The active-coordinator per-batch loop (`projcore_old`) is the
  FALLBACK, chosen only when JROM says so or Tiller is structurally unusable for that work.
- **Roster = the DEFAULT roster in `team-topology-contract.md`**, which is now JROM's standing roster:
  co-planners `opus5` + `sol` · implementer `spark`/`grok45`/`sonnet5` · validator
  `codex55`/`codex55`/`opus5`/`sol` · deliberation `opus5, sol, sonnet, grok45` (strict-unanimous, 3
  rounds, settle `[opus5, sol]`) · red-team `budget|standard|elite` unchanged.
  Stamp it as-is. Adjust only for genuine usage-hygiene pressure or an explicit JROM instruction, and
  log any deviation in `decisions/`.
- **north's downstream stays SINGULAR.** north always hands to projcore — never to Tiller directly.
  Execution mode is a parameter of the handoff, not a different recipient. This keeps the packet
  contract stable and lets the mode change mid-effort (e.g. Tiller for mechanical phases, `projcore_old`
  for a high-blast-radius phase) without a re-handoff.

exec
/bin/bash -lc "sed -n '1,260p' /home/agjrom/.config/agent-protocols/north-planning.md" in /home/agjrom/TGBOTS/AGJAssist
 succeeded in 0ms:
# North Planning — north sidecar (read ON TRIGGER, never at session start)

Moved out of `north-agent.md` on 2026-08-23. The core carries a TRIGGER that names the moment to read
this; if you are reading it for any other reason, that is the going-looking failure the core forbids.
Everything below is unchanged policy — this was a relocation, not a rewrite.

---

## The authoring partner — north does not author alone (JROM-directed 2026-08-13)

**north pulls in reviewers at two boundaries: requirements before planning (WHEN NEEDED), and the plan
before Tiller (ALWAYS).** A single strong seat writing the headwater doc unchallenged is the failure
this closes — north's own rule is that a vague north-star poisons everything downstream, and the
cheapest place to catch that is another model arguing with it before the plan exists.

**Two rosters, both configurable and stamped, never assumed.** Default for each is **`grok` + `sol`**;
either may be a single seat (`sol` alone is explicitly sanctioned) or different models entirely. Stamp
what you actually used in `topology.yaml` (see `team-topology-contract.md`); if JROM names reviewers
during the interview, that wins. The point of stamping is that the run records who actually reviewed it.

```yaml
requirements_reviewers:                      # 1..N — pulled in BEFORE planning, WHEN NEEDED (see trigger)
  - { model: grok,   launch: "grok --always-approve" }   # NO -m — tracks the grok CLI default
  - { model: sol,    launch: "codex -m gpt-5.6-sol -c model_reasoning_effort=\"xhigh\" --dangerously-bypass-approvals-and-sandbox" }
plan_reviewers:                              # 1..N — the co-partner(s) on `plan.md`. ALWAYS runs.
  - { model: sol,    launch: "codex -m gpt-5.6-sol -c model_reasoning_effort=\"xhigh\" --dangerously-bypass-approvals-and-sandbox" }
```

**REQUIREMENTS REVIEW — conditional, and it closes before planning starts.** You author
`og-requirements.md`; when the effort warrants it you pull reviewers in **before the docs go to
planning**, not after. **Pull them in when:** `planning_criticality` is `high` or `critical`; the blast
radius is large or irreversible; the domain is one you had to reconstruct from the repo rather than one
JROM specified; the interview left you reconciling contradictions; or JROM asks. **Skip them when** the
effort is small, well-understood and low-risk — a review that adds nothing is a cost, and this is your
judgement to make. Log the call either way in `decisions/`, including a skip: "reviewed by nobody" is a
fact the run should record.

Ask for attack, not assent: which acceptance criteria are not UI-provable, which requirement hides two
requirements, what did the interview fail to ask, where is this grounded in assumption instead of the
repo. **A reviewer that returns "looks good" has not done the job** — send it back naming the specific
thing you want stress-tested. You own the doc: reconcile the disagreements yourself and log the ones
that changed your mind. Requirements do not go to planning with an open review outstanding.

**PLAN REVIEW — a co-partner, ALWAYS, and it is the gate between a plan and Tiller.** Unlike the
requirements review, this one is **not optional**: projcore's co-planners produce `plan.md`, and under
the standing `north → projcore → tiller` chain that plan goes to a deterministic conductor that will
execute it without further judgement. So **north and its stamped `plan_reviewers` must BOTH approve
`plan.md` before Tiller is launched.**

**Prefer a plan reviewer that did not shape the requirements.** The rosters are separate for this
reason — a seat that helped write the requirements is judging a plan derived from its own input, which
is the verifier ≠ fixer problem one level up. Reusing the same seat is allowed when the roster is a
single model, but note it in the approval.

Review it as the requirements' author: does every og-requirement map to a slice; is each slice atomic
and individually gateable; do the integration checkpoints and the fence contract survive the
decomposition; is anything in here work JROM never asked for. Verdict is `APPROVED` /
`CHANGES-REQUESTED` with reasons per row.

**The mechanism is FILE-BASED, and that is load-bearing — it is what keeps north one-way.**
projcore must never send to, capture from, or drive your session (JROM-LOCKED 2026-07-10, enforced in
`projcore-session-guard.sh`), so the gate cannot be a message from projcore asking for your blessing:

1. projcore writes `plan.md` and a `PLAN-READY` marker into the run dir, then **HALTS before launching
   Tiller**, and **SENDS YOU ONE LINE saying the plan is ready.**
   **THIS WAS A DEADLOCK UNTIL 2026-08-23 and the fix is the send.** The old text said projcore "sends you
   nothing" and that you would notice `PLAN-READY` on your solicit cadence — but **that cadence does not
   exist yet**: it starts when tiller starts, and tiller cannot start until you approve. Each side was
   waiting for the other. Plan-ready is one of the FOUR INTERRUPTS; it does not wait for a timer.
2. On that notice, **read the FILE, not the pane** — `plan.md` and `PLAN-READY` in the run dir — and
   convene the partner(s) on the plan.
3. Write `<run-dir>/plan-approval.md`: `STATUS: APPROVED-BY-NORTH` or `STATUS: CHANGES-REQUESTED`, one
   verdict line per partner **with each partner's own reasoning, independently** (a partner that merely
   countersigns your verdict adds nothing), plus the specific changes wanted.
4. projcore polls for that file and launches Tiller **only** on `APPROVED-BY-NORTH`. On
   `CHANGES-REQUESTED` it re-plans and re-marks `PLAN-READY`. projcore blocks on a file; it never asks
   you for anything.

**Partners are your children.** They run as `x-north_<model>` (your namespace — projcore is structurally
barred from it), so **register each one to yourself at spawn and reap it when its job is done**
(`## Session hygiene`). A partner is expensive: `sol` is a planning-only seat and every launch is a
deliberate, logged cost. Reap it after the requirements are settled, and spawn a fresh one for the plan
gate rather than parking an idle seat across the whole authoring phase — the plan review wants clean
eyes on the plan anyway, not a session carrying every turn of the interview.

---

## PROMOTION CLEANUP — mandatory in every plan you author (JROM-directed 2026-08-12)

**Whoever created it deletes it, and the plan is what makes that happen.** Local scratch is created to
prove something works locally. The moment that proof is promoted — local test passes → moved to dev/qa,
or dev/qa → prod — the local artefacts have served their purpose and must die at that boundary. Not "at
end of run", not "when someone notices": **at the promotion**, by the slice that created them.

This is a REQUIREMENT, not a chore. Put it in `og-requirements.md` and it becomes a plan row, a gate
check and a validated line in the req-matrix — tracked like any other work. Left as prose in an agent
prompt, it is a rule that only binds the agents who happen to read that prompt, which is how the
accumulation happened in the first place.

**Anchor (2026-08-12):** the root filesystem hit 100% — 378 MB free of 913 GB. 671 GB was recovered, of
which `.wrangler/tmp` alone was **373 GB across 44,310 directories**, 43% of the disk. One project put
37,140 directories on disk in a single day from four `wrangler dev` servers that nobody killed, each
leaving a `dev-*` dir per hot reload. A second finding: 16.4 GB of "evidence" was 41 `node_modules` +
31 `.git` trees committed inside benchmark workspaces — the real evidence was 9.6 GB, outweighed 2.7:1
by reproducible junk. Nine of those dev servers were still running 17-20 hours later when this was
written.

### What every plan must carry

1. **A cleanup step on each promotion slice.** A slice that stands up a local server, writes scratch, or
   creates a temp workspace is not DONE until, after its promotion, it has torn that down. Same slice,
   same owner, same gate — never a separate janitorial task at the end, which is the thing that never
   gets dispatched.
2. **The creator is the owner.** The seat that spawned the resource deletes it. This is the same
   ownership rule as `## Session hygiene` — a resource dies because the thing that made it says so.
3. **Reclaimed space is reported** in the run's completion artifact. Accumulation stays visible instead
   of silent; a number nobody prints is a number nobody notices until the disk is full.
4. **Long-lived dev servers are named in the plan or they are not started.** An ephemeral
   random-port server with no persistence flag is a temporary fixture and must be reaped at promotion.

### The guardrail — disposable vs persistent, and they are one directory apart

**Only `.wrangler/tmp` is disposable. `.wrangler/state` is persistent local D1/KV data and must NEVER be
deleted.** Write the paths carefully: on this box the real state sits at `<project>/worker/.wrangler/state`
(lokalcamp 1.1 GB, HRIS 42 MB), while the top-level `<project>/.wrangler/state` holds ~1 MB. **A rule
written one level too high cleans an empty directory, misses the actual scratch, and puts a `rm -rf` one
typo away from the only copy of local data.** Verify the level before you write the requirement, and
prefer an age-based prune (`-mtime +1`) over a wholesale delete while servers may still be up — wrangler
regenerates `tmp` on demand.

Same rule generalises: never archive `node_modules` or `.git` into an evidence or artifact directory.
They are reproducible, and they will dominate the thing you actually wanted to keep.

### The `-mtime` advice above is scoped to `.wrangler/tmp`. Do NOT generalise it to `/tmp`.

**Age is a valid heuristic for scratch DATA and an invalid one for LIVE ENDPOINTS.** Hours after the
disk incident, an age-based sweep — `find /tmp -maxdepth 1 -mtime +7 ! -name 'claude-*' -exec rm -rf {} +`
— deleted `/tmp/tmux-1000/`, the live tmux server socket directory, breaking access to all 22 sessions
on this box. A directory's mtime only moves when entries are added or removed, so a socket created ten
days earlier and in constant use since is **indistinguishable from stale scratch** by that test. The
failure has the same shape as the `state`-next-to-`tmp` trap: something disposable sitting beside
something that very much is not.

So a plan's cleanup requirement must be written as an **allowlist of names the run itself created**
(requirement 2 above — the creator is the owner, and it knows what it made). That sidesteps the
heuristic entirely. If a denylist is ever unavoidable, exclude at minimum `tmux-*`, `.X11-unix`,
`.ICE-unix`, `.XIM-unix`, `.font-unix`, `ssh-*`, `dbus-*`, `systemd-*`, `pulse-*`, `claude-*`.

**Recovery, if a socket dir is ever unlinked:** it does NOT kill the server or drop attached clients —
only new connections fail, so every session merely *looks* dead. `ps -eo pid,comm | grep 'tmux: server'`
then `kill -USR1 <pid>`; tmux recreates the socket and all sessions return. **Never kill the server or
start a new one** — that is what would destroy them for real. All 22 recovered intact.

codex
I’ve loaded the north gate rules. Now I’m reading the four run artifacts against the exact acceptance-criteria list and fence IDs the user named.
exec
/bin/bash -lc "sed -n '1,180p' AGJ_Upgrade/command-center-2026-08-26/plan.md" in /home/agjrom/TGBOTS/AGJAssist
 succeeded in 0ms:
# plan — agjassist-command-center

Contract sources: locked `og-requirements.md`, `north-star.md`, `topology.yaml`, and `mockups/final/agent-window-v2.html`. Lifecycle is pre-live with deferral off. Every non-INTEGRATION row enters at glimmer L1; `impl_tier` records the predicted resume tier after L1 attempts. Tiller is build/test/dry-run only: no row may mutate `data/agjassist.db`, restart pm2, or perform the live release.

The app reads `DB_PATH` (default `data/agjassist.db`). There is no `AGJASSIST_DB_PATH`. Every test/fence command that boots SQLite must set `DB_PATH=/tmp/<slice>-$PPID.db` or let the fence runner copy the DB and pass that path into the Fastify child.

Fence grouping is five capabilities. The candidate reminders fence was split into F-REMINDERS and F-SUMMARIES because scheduling-to-pane and reply-to-LLM-to-dropdown have different seams. F-OVM keeps seven contributors because teardown is one release-atomic rollback domain. F-WAKEUP is capability-independent of F-SUMMARIES (E1 does not wait on D7). Schema edits still serialize C1→D1→E1. F-WINDOW is one rendered surface; I1–I2 still need the Fastify+temp-DB harness, not static :3210.

Each fence has its **own** journey spec. A0 authors all five plus the runner. `FENCE_ID` collects only that fence's acceptance ids so a later capability cannot keep an earlier CLOSE red. Default Playwright `webServer` on :3210 stays for existing `e2e/terminal-ux-*.spec.ts`; command-center specs use Playwright project `cc` whose webServer is the Fastify temp-DB harness.

| id | scope | acs | tests | est_min | deps | impl_tier | val_tier | deliberation | redteam | budget |
|----|-------|-----|-------|---------|------|-----------|----------|--------------|---------|--------|
| A0 | Author five journeys (`e2e/command-center-{ovm,reminders,summaries,wakeup,window}-fence.spec.ts`) plus `e2e/run-command-center-playwright-fence.mjs` and Playwright project `cc`. ONE layer=tests. `FENCE_ID` collects only that fence's ACs. Runner boots Fastify with `DB_PATH` on a temp copy, writes `fence-report-v1.json` including `verdict_line`, and `FENCE_STUB=<contributor>` replaces that unit in-process before the same assertions. Do not change :3210 static webServer. No product code. | A5 | `npx playwright test e2e/command-center-ovm-fence.spec.ts e2e/command-center-reminders-fence.spec.ts e2e/command-center-summaries-fence.spec.ts e2e/command-center-wakeup-fence.spec.ts e2e/command-center-window-fence.spec.ts --list` | 25 | — | L3 | L3 | no | standard | 3 |
| B1 | Web UI layer only: remove Workflows, Overmind Projects, and OVM Console (`OvmConsole` at `/conversations`) screens, header links, and bottom-nav entries; unknown `#/overmind*` hashes redirect home. Extract surviving bottom-nav/landing helpers out of `overmind-helpers.js` before dropping the OVM import. Do not delete FriendlyTerminalView or the file wholesale (G1 deletes leftovers). | A1 | `npx playwright test e2e/command-center-ovm.spec.ts --project=cc --grep B1` | 25 | A0 | L2 | L2 | no | standard | 3 |
| B2 | API layer only: remove `registerOvermindRoutes`, `OvermindStreamManager`, and Overmind fields from `ApiServices`; `/api/overmind/*` and its WebSocket no longer register. Runs after B6 so guardian no longer imports `overmind-routes`. | A2 | `npx vitest run tests/overmind-removal-api.test.ts --minWorkers=1 --maxWorkers=4` | 25 | A0,B6 | L3 | L3 | no | standard | 3 |
| B3 | Services layer only: delete `OvermindService`, `OvermindWatcher`, `SonnetOvermindBrain`, `overmind-notifications`, and `src/services/overmind/` without replacing OVM. Runs after B6 so `buildGuardianEscalationNotification` is no longer imported. | A2 | `npx vitest run tests/overmind-removal-services.test.ts --minWorkers=1 --maxWorkers=4` | 30 | A0,B6 | L3 | L3 | no | standard | 3 |
| B4 | Bootstrap layer only: remove Overmind imports, construction, watcher startup, and server injection from `src/index.ts`; production bootstrap starts with no OVM wiring. | A2,A5 | `npx vitest run tests/overmind-removal-bootstrap.test.ts --minWorkers=1 --maxWorkers=4` | 25 | A0,B2,B3 | L3 | L3 | no | standard | 3 |
| B5 | Bot layer only: remove `/overmind`, `/om_tasks`, `/om_pause`, `/om_resume`, `/om_drop`, `/ovm_start`, `/ovm_end` from `AssistantCore` and `TelegramAssistant`; they follow the normal unknown-command path. | A3 | `npx vitest run tests/overmind-command-removal.test.ts --minWorkers=1 --maxWorkers=4` | 25 | A0 | L2 | L2 | no | standard | 3 |
| B6 | API layer: remove `registerGuardianRoutes` and `POST /api/guardian/escalate`; stop importing `isLoopbackAddress` / `buildGuardianEscalationNotification` (delete them here if unused, else leave a local copy for non-OVM loopback routes). Regression fixture: calendar-reminder Telegram paging still sends. Precedes B2/B3. | B1,B2 | `npx vitest run tests/guardian-removal.test.ts --minWorkers=1 --maxWorkers=4` | 25 | A0 | L2 | L3 | no | standard | 3 |
| B7 | RELEASE-ATOMIC schema layer: bump `SCHEMA_VERSION`, remove OVM DDL, and on upgrade copy the DB being migrated to `<that-db-path>.pre-ovm-drop-<UTC>.bak` before dropping `overmind_projects`, `overmind_workflows`, `overmind_task_history`. Prove fresh-vs-upgrade parity only on temp copies via `DB_PATH`. Live path `data/agjassist.db.pre-ovm-drop-<UTC>.bak` is G2 execute-only. | A4 | `DB_PATH=/tmp/B7-command-center-$PPID.db npx vitest run tests/unit/command-center-migration.spec.ts --minWorkers=1 --maxWorkers=4` | 35 | A0 | L4 | L4 | no | standard | 4 |
| B8 | INTEGRATION: F-OVM OVM and guardian are gone while the app boots and core surfaces remain — composes B1,B2,B3,B4,B5,B6,B7 because teardown is one rollback domain and any survivor leaves OVM exposed, stale schema, or a broken bootstrap; load the built Mini App and real API on a temp `DB_PATH` copy; run unit plus terminal-ux e2e; never touch live DB or pm2. | A1,A2,A3,A4,A5,B1,B2 | `FENCE_ID=B8 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs` | 45 | B1,B2,B3,B4,B5,B6,B7 | L4 | L4 | no | elite | 4 |
| C1 | Schema layer: additive `agent_solicit_reminders` plus recipient rows in `SCHEMA_SQL` and `DatabaseService` migrations (folder-group, cadence, repeat limit, include/skip, next-fire, fresh-vs-upgrade). Do not alter calendar `reminders`. | C1,C2,C3,C4,C6 | `DB_PATH=/tmp/C1-command-center-$PPID.db npx vitest run tests/unit/agent-reminder-schema.spec.ts --minWorkers=1 --maxWorkers=4` | 30 | B8 | L3 | L3 | no | standard | 3 |
| C2 | Services layer: `AgentSolicitService` CRUD and due-state for preset/custom cadence, stop-after-N or unlimited, immediate include/skip, persisted active-reminder projections. | C2,C3,C4,C6 | `DB_PATH=/tmp/C2-command-center-$PPID.db npx vitest run tests/unit/agent-reminder-service.spec.ts --minWorkers=1 --maxWorkers=4` | 30 | A0,C1 | L2 | L2 | no | standard | 3 |
| C3 | Services layer, ONE claim=`fireDue`: resolve current group panes, skip excluded agents, pass every solicit through existing `SafetyService`+`TmuxService`, write `AuditService`, advance/deactivate repeats with the Mini App closed. | C5 | `DB_PATH=/tmp/C3-command-center-$PPID.db npx vitest run tests/unit/agent-reminder-scheduler.spec.ts --minWorkers=1 --maxWorkers=4` | 35 | A0,C2 | L3 | L3 | no | standard | 4 |
| C4 | API layer: owner-only `registerAgentReminderRoutes` for create/update/cancel, include/skip, and active-reminder reads; non-owner and malformed cadence/repeat fail-closed. | C1,C4,C6 | `DB_PATH=/tmp/C4-command-center-$PPID.db npx vitest run tests/agent-reminder-routes.test.ts --minWorkers=1 --maxWorkers=4` | 30 | A0,C2 | L2 | L3 | no | standard | 3 |
| C5 | Web UI layer: port `AgentReminderSheet` + `ActiveRemindersView` (current terminal group, presets/custom cadence, stop-N/unlimited, include/skip). Reload-stable persist is C6, not this row. | C1,C2,C3,C4 | `npx playwright test e2e/command-center-reminders.spec.ts --project=cc` | 35 | A0,C4 | L2 | L3 | no | standard | 3 |
| C6 | INTEGRATION: F-REMINDERS a folder schedule persists and fires a safety-checked audited solicit into only included real temp tmux panes — composes C1,C2,C3,C4,C5 because they are the schema-to-service-to-API-to-browser-to-scheduler path for one reminder capability; boot real API on temp `DB_PATH` and load the Mini App. | C1,C2,C3,C4,C5,C6 | `FENCE_ID=C6 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs` | 40 | C1,C2,C3,C4,C5 | L4 | L4 | no | elite | 4 |
| D1 | Schema layer: additive `summary_llm_endpoints` and `agent_summaries` with one default, provenance, timestamps, no plaintext secret columns, fresh-vs-upgrade parity. | E1,E3,F2,F3 | `DB_PATH=/tmp/D1-command-center-$PPID.db npx vitest run tests/unit/summary-schema.spec.ts --minWorkers=1 --maxWorkers=4` | 30 | C6 | L3 | L3 | no | standard | 3 |
| D2 | Services layer: `SummaryEndpointService` owner-scoped add/edit/remove/default; seed OpenAI-compatible endpoint labelled `140`; never log secrets. | F1,F2,F3 | `DB_PATH=/tmp/D2-command-center-$PPID.db npx vitest run tests/unit/summary-endpoint-service.spec.ts --minWorkers=1 --maxWorkers=4` | 30 | A0,D1 | L2 | L3 | no | standard | 3 |
| D3 | Services layer: `ReplySummaryService` captures the post-solicit pane reply, calls selected `/v1/chat/completions`, persists a short endpoint-attributed summary; LLM failure degrades without undoing the solicit. | E1,E3 | `DB_PATH=/tmp/D3-command-center-$PPID.db npx vitest run tests/unit/reply-summary-service.spec.ts --minWorkers=1 --maxWorkers=4` | 35 | A0,C3,D2 | L3 | L3 | no | standard | 4 |
| D4 | API layer: owner-only `registerSummaryRoutes` for endpoint CRUD/default and per-agent summary reads (newest first); validate OpenAI-compatible base URLs; secrets stay out of responses and logs. | E2,F1,F2,F3 | `DB_PATH=/tmp/D4-command-center-$PPID.db npx vitest run tests/summary-routes.test.ts --minWorkers=1 --maxWorkers=4` | 30 | A0,D2,D3 | L2 | L3 | no | standard | 3 |
| D5 | Web UI layer: port `SummaryEndpointSettings` (add/edit/remove, radio default, seeded `140`, owner-only errors). After C5 to avoid a dual `app.js` merge. | F1,F2,F3 | `npx playwright test e2e/command-center-endpoints.spec.ts --project=cc` | 30 | A0,D4,C5 | L2 | L3 | no | standard | 3 |
| D6 | Web UI layer: port `AgentSummariesDropdown` (per-agent newest-first cards, endpoint tags, scroll, empty state). After D5 as the other new agent-window sheet. | E2,E3 | `npx playwright test e2e/command-center-summaries.spec.ts --project=cc` | 25 | A0,D4,D5 | L1 | L2 | no | standard | 3 |
| D7 | INTEGRATION: F-SUMMARIES an answered reminder is captured, summarized by the selected local endpoint, and appears in that agent's dropdown — composes D1,D2,D3,D4,D5,D6 because they own endpoint selection through visible persistence; arrive by exercising the already-closed C6 solicit/reply seam (C3 is not a D7 unit); real API, temp `DB_PATH`, browser, deterministic OpenAI-compatible fixture. | E1,E2,E3,F1,F2,F3 | `FENCE_ID=D7 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs` | 45 | D1,D2,D3,D4,D5,D6 | L4 | L4 | no | elite | 4 |
| E1 | Schema layer: additive `agent_one_time_wakeups` (pane, manual fire time, action, pending/fired/cancelled, fresh-vs-upgrade). Do not reuse OVM `agent_wake_schedule`. Capability-independent of summaries, but deps D1 so `SCHEMA_VERSION` / `schema.ts` edits serialize C1→D1→E1 (no parallel bump). | D1,D2,D3 | `DB_PATH=/tmp/E1-command-center-$PPID.db npx vitest run tests/unit/agent-wakeup-schema.spec.ts --minWorkers=1 --maxWorkers=4` | 25 | D1 | L3 | L3 | no | standard | 3 |
| E2 | Services layer, ONE claim=fire-once: `AgentWakeupService` create/cancel/fire; due fires pass the action through existing `SafetyService`+`TmuxService`, write `AuditService`, atomically clear pending. | D1,D2,D3 | `DB_PATH=/tmp/E2-command-center-$PPID.db npx vitest run tests/unit/agent-wakeup-service.spec.ts --minWorkers=1 --maxWorkers=4` | 35 | A0,E1 | L3 | L3 | no | standard | 4 |
| E3 | API layer: owner-only `registerAgentWakeupRoutes` for schedule, pending read, and cancel; non-owner, invalid/past times, empty actions, and cross-pane access fail-closed. | D1,D2 | `DB_PATH=/tmp/E3-command-center-$PPID.db npx vitest run tests/agent-wakeup-routes.test.ts --minWorkers=1 --maxWorkers=4` | 25 | A0,E2 | L2 | L3 | no | standard | 3 |
| E4 | Web UI layer: port `WakeupSheet` plus expanded/collapsed pending indicator (manual date/time/action, pending time, clear on fire or cancel). After C5 to serialize agent-window `app.js` edits. | D1,D2,D3 | `npx playwright test e2e/command-center-wakeup.spec.ts --project=cc` | 30 | A0,E3,C5 | L2 | L3 | no | standard | 3 |
| E5 | INTEGRATION: F-WAKEUP a one-time action is scheduled in the browser, appears pending in both header states, fires once into a real temp pane through safety and audit, and clears — composes E1,E2,E3,E4 because they are the persistence-to-service-to-API-to-window path for the one-shot capability; real API, temp `DB_PATH`, Mini App in a browser. | D1,D2,D3 | `FENCE_ID=E5 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs` | 40 | E1,E2,E3,E4 | L4 | L4 | no | elite | 4 |
| F1 | `terminal-chat-state.js` only: `readTerminalDraft` / `writeTerminalDraft` / `clearTerminalDraft`, keyed by viewer and pane, localStorage isolation, reload persistence. Does not wait on wakeups. | G1,G2,G3 | `npx vitest run tests/unit/terminal-draft-jsdom.spec.ts --minWorkers=1 --maxWorkers=4` | 20 | A0 | L1 | L2 | no | standard | 2 |
| F2 | Web UI layer: wire per-pane drafts into `FriendlyTerminalView` and the agent switcher (restore on switch, draft-kept + switcher indicators, clear only the sent pane). After B8 so OVM chrome is gone. | G1,G2,G3 | `npx playwright test e2e/command-center-drafts.spec.ts --project=cc` | 30 | A0,F1,B8 | L2 | L3 | no | standard | 3 |
| F3 | Web UI layer: always-reachable refresh control on `FriendlyTerminalView`; re-pull pane output and session metadata together; in-progress then completion; composer stays interactive. Project `cc` supplies live API/tmux. | I1,I2 | `npx playwright test e2e/command-center-refresh.spec.ts --project=cc` | 30 | A0,F2 | L2 | L3 | no | standard | 3 |
| F4 | Web UI layer: port mockup collapse chrome only (`TerminalHeaderV2` independent tabs/util/control collapse, default tabs-collapsed + utilities-expanded, single-row bell when fully collapsed). Chip content lands in C5/D6/E4. | H1,H2 | `npx playwright test e2e/command-center-header.spec.ts --project=cc` | 35 | A0,C5,D6,E4,F3 | L2 | L3 | no | standard | 3 |
| F5 | Web UI layer: `AgentGroupSwitcher` — below 900px status/draft dropdown with no drag; at 900px+ horizontal strip plus working pointer scrubber; both paths call the same switch action. | J1,J2 | `npx playwright test e2e/command-center-switcher.spec.ts --project=cc` | 30 | A0,F2,F4 | L2 | L3 | no | standard | 3 |
| F6 | CSS layer: port locked `agent-window-v2` theme/responsive tokens in `style.css` (system/light/dark, 390px spacing, centered capped column on tablet/desktop) without regressing existing controls. | H3,J1,J2 | `npx playwright test e2e/command-center-responsive.spec.ts --project=cc` | 35 | A0,F4,F5 | L2 | L3 | no | standard | 3 |
| F7 | INTEGRATION: F-WINDOW the served agent window matches the locked mockup across 390, 768, 1024, and 1440 while drafts, refresh, collapse, theme, and both switchers work — composes F1,F2,F3,F4,F5,F6 because they are the state, behavior, structure, switching, and style siblings of one rendered window; boot Fastify+temp `DB_PATH` (refresh is live tmux, not static :3210) and run terminal-ux e2e on the built Mini App. | G1,G2,G3,H1,H2,H3,I1,I2,J1,J2 | `FENCE_ID=F7 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs` | 45 | F1,F2,F3,F4,F5,F6 | L4 | L4 | no | elite | 4 |
| G1 | PROMOTION CLEANUP: delete residual dead OVM source/tests/tools and `mockups/final/*.r1..r4.html`, `PROMPT-*.txt`, `grok-run-*.log`; keep `mockups/final/agent-window-v2.html`. Targeted cleanup test plus served-browser terminal regressions so no orphan import survives. Full unit+e2e stay on B8/F7, not this row. | A1,A2,A3,A5 | `npx vitest run tests/command-center-cleanup.test.ts --minWorkers=1 --maxWorkers=4 && npx playwright test e2e/terminal-ux-conversation.spec.ts e2e/terminal-ux-groups.spec.ts e2e/terminal-ux-control.spec.ts` | 35 | B8,C6,D7,E5,F7 | L3 | L4 | no | standard | 4 |
| G2 | RELEASE-ATOMIC: add `scripts/release-command-center.mjs` with dry-run default that requires green B8,C6,D7,E5,F7 markers, builds, migrates a `DB_PATH` copy, and prints backup path plus rollback `git reset --hard <pre-release-sha>` and DB-restore. Only human `release_review` may `--execute` live backup + migrate + `pm2 restart agjassist`. Tiller dry-run only. | A4,A5 | `DB_PATH=/tmp/G2-command-center-$PPID.db node scripts/release-command-center.mjs --dry-run && npm run build` | 30 | G1 | L4 | L4 | no | elite | 4 |

## Budgets

Rubric: `loop-escalation.md` §3. `token_budget: null`; `new_class_rounds_to_stall: 2`; `on_burn: pull_in_coplanner_then_north`. Wall-clock uses `max(60, 2×est_min, 15×(max_fix_cycles+max_redteam_iterations))`. Elite fences and the release gate use the topology hard cap of three red-team iterations, not consecutive-clean.

| id | max_fix_cycles | max_redteam_iterations | max_wallclock_min |
|----|----------------|------------------------|-------------------|
| A0 | 3 | 2 | 75 |
| B1 | 3 | 2 | 75 |
| B2 | 4 | 2 | 90 |
| B3 | 4 | 2 | 90 |
| B4 | 4 | 2 | 90 |
| B5 | 3 | 2 | 75 |
| B6 | 4 | 2 | 90 |
| B7 | 6 | 2 | 120 |
| B8 | 6 | 3 | 135 |
| C1 | 4 | 2 | 90 |
| C2 | 3 | 2 | 75 |
| C3 | 5 | 2 | 105 |
| C4 | 4 | 2 | 90 |
| C5 | 3 | 2 | 75 |
| C6 | 5 | 3 | 120 |
| D1 | 4 | 2 | 90 |
| D2 | 4 | 2 | 90 |
| D3 | 5 | 2 | 105 |
| D4 | 4 | 2 | 90 |
| D5 | 3 | 2 | 75 |
| D6 | 3 | 2 | 75 |
| D7 | 5 | 3 | 120 |
| E1 | 4 | 2 | 90 |
| E2 | 5 | 2 | 105 |
| E3 | 4 | 2 | 90 |
| E4 | 3 | 2 | 75 |
| E5 | 5 | 3 | 120 |
| F1 | 2 | 2 | 60 |
| F2 | 3 | 2 | 75 |
| F3 | 3 | 2 | 75 |
| F4 | 3 | 2 | 75 |
| F5 | 3 | 2 | 75 |
| F6 | 3 | 2 | 75 |
| F7 | 5 | 3 | 120 |
| G1 | 4 | 2 | 90 |
| G2 | 6 | 3 | 135 |

## Release boundary

F-OVM is fence-before-deploy: no live `pm2 restart agjassist` or live OVM-table drop before B8 is green, and G2 additionally requires every capability fence. On a live execute the pre-drop backup is `data/agjassist.db.pre-ovm-drop-<UTC>.bak`. Tests derive the backup as a sibling of the `DB_PATH` file under test. Rollback is attended: restore that backup and reset to the recorded pre-release commit.

## Out of scope

Rebuilding OVM, reviving autonomous overseer behavior, changing prod secrets, touching another pm2 app, rewriting frozen strategy/requirements/mockup artifacts, or adding `gpt-5.6-sol`/`gpt-5.6-terra` to `src/config/providers.ts` (north `pre_run_wiring`, not this product).

exec
/bin/bash -lc "sed -n '1,220p' AGJ_Upgrade/command-center-2026-08-26/og-requirements.md" in /home/agjrom/TGBOTS/AGJAssist
 succeeded in 0ms:
# og-requirements — "command-center" effort

_Authored by `[north]` 2026-08-27. Seeds the validator's Q0 + the req-matrix. Inherits the effort north-star
(`north-star.md`) and the project constitution. **Acceptance criteria are UI-provable on the running app**
(localhost:3101 / Playwright), sized toward **tiller-atomic slices** (one claim provable by execution;
≤~3 named symbols; one layer; glimmer-reachable). The planners (grok46 + sol) turn these into the plan.md
table + fences; they may split further but must cover every AC._

## The verbatim problem (JROM's words)
> "strip down OVM, and destroy it, we just rebuilt it from scratch if we need parts of it later."
> "reminders that i can setup … (scheduled cadence like every 30/45/60/90mins) for each agent … designed to
> solicit updates and possibly have a local agent (granite or even glimmer via lokalAI API) read the reply and
> create a short analysis or summary of it … wakeups act similar but is more of 1time … seen on the chat if
> there is a wakeup pending and clears once triggered."
> "when i chat on a certain agent's window i want the chat i put on it saved … cleared when i send it … so i
> can switch tabs and not lost my chain of thought."
> "the chat does not auto-update on the sessions details text when i … talk to the agent directly on the
> session … a refresh button to basically repull all the details from the session into the chat."
> phone: dropdown for the agent list; draggable only on desktop (tablet if wide). "when all of the things are
> collapsed its only 1 row."

## Design contract
The **locked mockup** `mockups/final/agent-window-v2.html` is the design contract for every UI item below. The
port must match its layout, behavior, and its 3-state theme; the **390px surface is the reference for phone.**
Where an AC and the mockup could conflict, the mockup wins on look/interaction; this doc wins on data/behavior.

## Policies
- **Deferral = OFF.** The app is live and owner-only; fix forward, don't park behavior for "later."
- **Owner-only preserved.** Every new surface/endpoint is owner-gated (account `1000000001`), fail-closed,
  audit-logged; every send still passes the safety-pattern check.
- **Migrations additive-only, ONE authorized exception:** dropping `overmind_projects/workflows/task_history`
  is destructive and JROM-authorized (log it); **DB backup precedes the drop**; all other schema work additive
  with fresh-vs-upgrade parity (SCHEMA_VERSION bump).
- **Do-not-regress** the existing terminal/chat surface (list at the end).

---

## A. Destroy OVM (the app's Overmind feature)
- **A1.** The mini-app no longer exposes Overmind: the **Workflows**, **Overmind Projects**, and **OVM Console**
  screens and their bottom-nav entries are gone; no route renders them (navigating there 404s / redirects home).
- **A2.** The `/api/overmind/*` routes and the `overmind-stream-manager` WebSocket are removed; the server boots
  clean with no overmind service wiring (`overmind-watcher`, `overmind/` brain, notifications) instantiated.
- **A3.** The bot no longer registers `/overmind`, `/om_tasks`, `/om_pause`, `/om_resume`, `/om_drop`,
  `/ovm_start`, `/ovm_end`; sending them yields the normal unknown-command path.
- **A4.** Migration drops `overmind_projects`, `overmind_workflows`, `overmind_task_history` (+ any overmind-only
  columns), with a timestamped DB backup taken first; a **fresh** DB and an **upgraded** DB converge to the same
  schema; `SCHEMA_VERSION` bumped.
- **A5.** After teardown the app boots, the terminal/chat + notes/plans/tasks/reminders surfaces work, and the
  full unit + e2e suites are green (no dangling overmind imports/types).

## B. Remove the guardian-escalate wire
- **B1.** `POST /api/guardian/escalate` and its route registration are removed; the two helpers it borrowed
  (`isLoopbackAddress`, `buildGuardianEscalationNotification`) are relocated or deleted so nothing else breaks.
- **B2.** The app's internal paging that is NOT guardian (e.g. the reminder scheduler's own Telegram send) is
  unaffected and still works.

## C. Reminders (recurring auto-solicit, folder-level)
- **C1.** From an agent's chat, JROM can open Reminders and **create a folder-level reminder** on the agent's
  group ("folder ≡ the terminal group") that applies to every included agent in it.
- **C2.** A reminder has a **cadence** chosen from presets **15/30/45/60/90 min** or a **custom** minute value.
- **C3.** A reminder has a **repeat** setting: **stop after N** fires (then auto-deactivates) or **unlimited**.
- **C4.** Each agent in the folder has an **include/skip flag**; a skipped agent receives no solicit; toggling it
  is reflected immediately.
- **C5.** On each fire the server **sends the configured solicit text** (default "give me a status update") into
  every included agent's tmux pane — **server-side, whether or not the mini-app is open** — passing the
  safety-pattern check and writing an audit row.
- **C6.** An **active-reminders view** shows, per folder and per agent, the cadence, next-fire, and remaining
  count; it survives an app reload (state is server-persisted, additive schema).

## D. Wakeups (one-time)
- **D1.** From an agent's chat, JROM can schedule a **one-time wakeup** on that single agent: a manual fire
  date/time + a manual **action message** to send.
- **D2.** A **pending wakeup indicator** shows on the agent window (and its collapsed representation) and names
  the pending time; it **clears automatically once the wakeup fires** or is cancelled.
- **D3.** At the fire time the server sends the action into the pane (server-side, safety-checked, audited),
  then marks the wakeup fired.

## E. Summaries (local-LLM analysis of the reply)
- **E1.** After a reminder solicit is answered, the app captures the agent's reply and calls the **default
  summary-LLM endpoint** to produce a short summary/analysis, stored per agent (additive schema).
- **E2.** The agent window has a **Summaries dropdown** listing that agent's summaries, timestamped, newest
  first, scrollable; empty state reads sensibly.
- **E3.** A summary records which endpoint produced it; the LLM call failing degrades gracefully (no crash; the
  reminder/solicit still succeeds).

## F. Summary-LLM endpoints (configurable, named)
- **F1.** A settings surface manages **named endpoints** — name + base URL + model — assumed **OpenAI-compatible**
  (`/v1/chat/completions`); add / edit / remove.
- **F2.** One endpoint is the **default**; the seeded default is labelled **140** (lokalAI). Changing the default
  is reflected in which endpoint E1 uses.
- **F3.** Endpoint config is owner-only, persisted (additive schema), and never logs secrets in plaintext.

## G. Per-agent draft persistence
- **G1.** Text typed in an agent's composer is **kept per-agent**; switching to another agent and back
  **restores** it (unsent), with a subtle "draft kept" affordance.
- **G2.** **Sending** the message **clears** that agent's stored draft; an agent with an unsent draft shows a
  small indicator on its tab/switcher entry.
- **G3.** Draft state is per-viewer/client (localStorage keyed by pane), survives tab switches and an app reload,
  and never leaks one agent's draft into another's composer.

## H. Agent-window v2 UI (port the locked mockup)
- **H1.** The Terminal chat header matches the mockup: **independent collapse/expand for the agent tabs and for
  the reminders/util row**, defaulting to **tabs collapsed, reminders expanded**.
- **H2.** Collapsing the reminders/util row leaves a **single clickable bell icon on the top row** (with a
  pending-hint dot/count), not a second row; the gear/ME/font controls are compact and can tuck to `⋯`, so that
  **when everything is collapsed the header is one row**.
- **H3.** The surface is **theme-adaptive** (light/dark follows the device setting) and **readable**; it holds up
  **mobile / tablet / desktop** — wide widths keep a centered readable column rather than edge-to-edge text.

## I. Refresh-from-session
- **I1.** The chat has a **↻ refresh control** (reachable regardless of header collapse state) that **re-pulls the
  live tmux session** — re-rendering the transcript AND updating the session detail/status text — so a direct
  on-session interaction that had drifted is now reflected.
- **I2.** Refresh shows a brief in-progress state and confirms completion; it never blocks the composer.

## J. Responsive group switcher
- **J1.** At **phone / narrow widths** the group agent switcher is a **dropdown** (current agent + caret → tap →
  pick from the group list, with status + draft indicators); no drag control.
- **J2.** At **wide tablet / desktop widths** it is the horizontal strip **+ a working draggable scrubber**; the
  presentation swaps by width and both paths switch the active agent identically.

## Candidate INTEGRATION fences (planners finalize at §1.4)
Grouped by independently-testable capability — **enumerate contributing slices in `deps`, carry the reason in
`scope`**; use a stronger tier + `redteam=elite`; the fence test must load the Mini App in a browser:
- **F-OVM**: OVM+guardian fully removed, app boots, suites green, migration parity (A1–A5, B1–B2).
- **F-REMINDERS**: schedule → server-side solicit fires into a pane → summary lands in the dropdown (C1–C6, E1–E3, F1–F3).
- **F-WAKEUP**: schedule → pending chip → fires → chip clears + action sent (D1–D3).
- **F-WINDOW**: agent-window v2 header/collapse/theme/responsive + refresh + draft persistence match the mockup
  across phone/tablet/desktop (G1–G3, H1–H3, I1–I2, J1–J2).

## PROMOTION CLEANUP (required, gated)
Delete dead OVM code/files, the `overmind_*` schema, and the temporary port scaffolding (backup HTML revisions
`*.r1..r4.html`, `PROMPT-*.txt`, `grok-run-*.log`) at the promotion boundary. The `mockups/` design record stays.

## Do-not-regress (existing terminal/chat surface must keep working)
Key row (Enter/Esc/^C/Shift-Tab/↑/↓) · send-as-command / send-raw-keys / large-input · image attach (upload +
paste) · ME ▲/▼ nav · chat search + jump · font A−/A+ · group quick-switch tabs · selection-prompt rendering
(question + descriptions + single/multi + type-something) · working/idle busy flag · theme re-apply on
themeChanged · owner-only auth (mini-app + bot) · the tmux send/keys REST path (tunnel has no WS).

exec
/bin/bash -lc "sed -n '1,140p' AGJ_Upgrade/command-center-2026-08-26/fence-contract.json" in /home/agjrom/TGBOTS/AGJAssist
 succeeded in 0ms:
{
  "contract_version": 1,
  "fences": {
    "B8": {
      "integration_cmd": "FENCE_ID=B8 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs",
      "negative_control_cmd": "FENCE_STUB=B2 FENCE_ID=B8 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs",
      "acceptance_ids": ["A1", "A2", "A3", "A4", "A5", "B1", "B2"],
      "test_path": "e2e/command-center-ovm-fence.spec.ts",
      "authored_by": "coplanner:sol+grok46",
      "contributors": ["B1", "B2", "B3", "B4", "B5", "B6", "B7"],
      "seed_slice": "A0"
    },
    "C6": {
      "integration_cmd": "FENCE_ID=C6 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs",
      "negative_control_cmd": "FENCE_STUB=C3 FENCE_ID=C6 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs",
      "acceptance_ids": ["C1", "C2", "C3", "C4", "C5", "C6"],
      "test_path": "e2e/command-center-reminders-fence.spec.ts",
      "authored_by": "coplanner:sol+grok46",
      "contributors": ["C1", "C2", "C3", "C4", "C5"],
      "seed_slice": "A0"
    },
    "D7": {
      "integration_cmd": "FENCE_ID=D7 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs",
      "negative_control_cmd": "FENCE_STUB=D3 FENCE_ID=D7 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs",
      "acceptance_ids": ["E1", "E2", "E3", "F1", "F2", "F3"],
      "test_path": "e2e/command-center-summaries-fence.spec.ts",
      "authored_by": "coplanner:sol+grok46",
      "contributors": ["D1", "D2", "D3", "D4", "D5", "D6"],
      "seed_slice": "A0"
    },
    "E5": {
      "integration_cmd": "FENCE_ID=E5 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs",
      "negative_control_cmd": "FENCE_STUB=E2 FENCE_ID=E5 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs",
      "acceptance_ids": ["D1", "D2", "D3"],
      "test_path": "e2e/command-center-wakeup-fence.spec.ts",
      "authored_by": "coplanner:sol+grok46",
      "contributors": ["E1", "E2", "E3", "E4"],
      "seed_slice": "A0"
    },
    "F7": {
      "integration_cmd": "FENCE_ID=F7 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs",
      "negative_control_cmd": "FENCE_STUB=F1 FENCE_ID=F7 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs",
      "acceptance_ids": ["G1", "G2", "G3", "H1", "H2", "H3", "I1", "I2", "J1", "J2"],
      "test_path": "e2e/command-center-window-fence.spec.ts",
      "authored_by": "coplanner:sol+grok46",
      "contributors": ["F1", "F2", "F3", "F4", "F5", "F6"],
      "seed_slice": "A0"
    }
  }
}

exec
/bin/bash -lc "sed -n '1,140p' AGJ_Upgrade/command-center-2026-08-26/north-star.md" in /home/agjrom/TGBOTS/AGJAssist
 succeeded in 0ms:
# Effort North-Star — "command-center" (agent-window v2 + OVM teardown)

_Scoped to ONE effort. **Inherits** the project constitution `/home/agjrom/TGBOTS/AGJAssist/north-star.md`
(command-center-first; owner-only; manages agents + projects; theme-adaptive; autonomy returns later as a
conversational assistant). **Append-only** — dated entries, never retconned. Authored by `[north]` 2026-08-27._

## Why this effort exists (the "why")
This is the **first build under the command-center constitution.** JROM is turning AGJAssist from a passive
overseer into the cockpit he actively drives his agent fleet from. This effort delivers the near-term
command-center moves the constitution named, and retires the old autonomous-overseer subsystem that no
longer fits.

## Verbatim problem (JROM, across 2026-08-26/27)
- _"strip down OVM, and destroy it, we just rebuilt it from scratch if we need parts of it later."_
- _"a good design (create mockups first) on the wakeup setup, and reminders that i can setup … (scheduled
  cadence like every 30/45/60/90mins) for each agent … designed to solicit updates and possibly have a
  local agent (granite or even glimmer via lokalAI API) read the reply and create a short analysis or
  summary … wakeups act similar but is more of 1time … seen on the chat if there is a wakeup pending and
  clears once triggered."_
- _"when i chat on a certain agent's window i want the chat i put on it saved … have it on a temp file and
  cleared when i send it … so i can switch tabs and not lost my chain of thought."_
- _"the chat does not auto-update on the sessions details text when i … talk to the agent directly on the
  session … can we also have on the chat a refresh button to basically repull all the details from the
  session into the chat?"_
- _On phone the drag switcher is too small → **dropdown on phone, draggable only on desktop (tablet if
  wide).** Collapsible header: **when all collapsed it's one row.**_

## Scope — the capabilities this effort ships
1. **Destroy OVM** — remove the app's Overmind feature entirely (watcher, `overmind/` brain, routes,
   stream manager, screens, `/overmind` `/om_*` `/ovm_*` bot commands, `overmind_projects/workflows/task_history`).
2. **Remove the guardian-escalate endpoint** (OVM-coupled second wire to Telegram) — folded into the teardown.
3. **Reminders** — folder("global"/work-group)-level recurring auto-solicit, per-agent include/skip flags,
   cadence 15/30/45/60/90 + custom, repeat stop-after-N or unlimited, active-reminders view. Fires
   **server-side** (app-open or not).
4. **Wakeups** — one-time, manual time + manual action, pending chip on the agent window that clears on fire.
5. **Summaries** — after a reminder solicit, a **local LLM** summarizes the agent's reply; summaries are
   browsable via a **dropdown** on the agent window.
6. **Summary-LLM endpoints** — configurable **named OpenAI-compatible** endpoints (name + base URL + model),
   default = the lokalAI box labelled **140**.
7. **Per-agent draft persistence** — the composer keeps a per-agent unsent draft, survives switching agents,
   cleared on send.
8. **Agent-window v2 UI** — port the **locked mockup** `mockups/final/agent-window-v2.html` to the real app.
9. **Refresh-from-session** — a ↻ control that re-pulls the live tmux session (transcript + detail text) into
   the chat, fixing the drift when JROM acts on the session directly.
10. **Responsive group switcher** — dropdown on phone/narrow, draggable scrubber on wide tablet/desktop.

## Standing decisions (dated 2026-08-27 unless noted)
- **OVM = destroy, not disable** — rebuild from scratch later if ever needed. Its autonomy returns reborn as
  the conversational assistant (project north-star direction), NOT as a background poller.
- **Guardian-escalate = remove.**
- **Folder ≡ the existing terminal group** (both mockup authors assumed + flagged; adopted).
- **Design contract = the locked mockup** `mockups/final/agent-window-v2.html` (sonnet5 base + drag-resize +
  one-row-collapsed header + refresh + responsive switcher). Ports must match it; the 390px surface is the
  reference for phone.
- **Theme-adaptive** (light/dark follows the device), **mobile/tablet/desktop** all first-class, readable.
- **Server-side scheduling** for reminders/wakeups (the phone won't be open).
- **Local summary LLM default = 140** (lokalAI, OpenAI-compatible), configurable named endpoints.
- **Destructive-migration exception (AUTHORIZED):** dropping the `overmind_*` tables violates the project
  bedrock "additive-only migrations." JROM explicitly authorized it (2026-08-26) — logged as an approved
  exception. **Take a DB backup before the drop; everything else stays additive.**
- **Teardown safety:** the OVM destroy is high-blast-radius on the LIVE app → **attended tiller** with the
  elite validator (grok46/sol), **full regression after** ("make sure nothing is broken"), and a clean
  rollback path.

## Non-negotiables (inherited bedrock)
Owner-only (JROM's account `1000000001`), fail-closed everywhere · security-first for remote/spawning
(safety-pattern checks on sends, audit, localhost/token gates) · additive-only migrations EXCEPT the
authorized OVM-table drop · theme-adaptive, readability-first · **do not regress** the existing terminal/chat
surface (key row, send-as-command/raw-keys, image attach, ME-nav, search, font, groups, selection prompts).

## PROMOTION CLEANUP
At the promotion boundary the seat that created scratch deletes it: the `mockups/` sandbox stays as the design
record but any temporary port scaffolding, backup HTML revisions (`*.r1..r4.html`, `PROMPT-*.txt`,
`grok-run-*.log`), and dead OVM code/files are removed as planned, gated work — not left as litter.

codex
VERDICT: CHANGES-REQUESTED
1. [severity HIGH] A0/B8/C6/D7/E5/F7 - Fence rows only gate the positive `FENCE_ID=...` command; `negative_control_cmd` lives in JSON but is not required by the plan row tests - make every fence gate run positive plus negative control and require the negative to fail.
2. [severity HIGH] A0/fence-contract - Negative controls do not name the expected failure/assertion, so an import crash or empty harness can satisfy the red path - add per-fence expected failure names/counts to `fence-report-v1.json`.
3. [severity HIGH] G2/B7 - Live `--execute` migration+pm2 path is only prose-gated by undefined `release_review`; no mechanism proves Tiller cannot invoke live DB/pm2 - require an explicit human-only guard in the script and test that unattended/tiller execution is refused.
4. [severity MED] PROMOTION CLEANUP/G1 - Cleanup is an endgame row, not creator-owned cleanup at each promotion boundary; temp DBs, fence reports, local servers, and scratch from earlier rows can survive - attach cleanup/reporting to each slice that creates scratch and report reclaimed space.
5. [severity MED] A0 - One slice hides five fence specs plus the runner, and validates with `--list` only; that is non-gateable for harness correctness - split runner/spec authoring or gate A0 with a real temp Fastify/DB browser smoke and one negative stub.
6. [severity MED] D7 - Summary fence claims answered-reminder capture while excluding the reminder fire/reply seam from contributors (`C3 is not a D7 unit`) - either include the real closed C6 seam as an explicit dependency/fixture contract or narrow D7 to summary-only ingestion.
tokens used
52,968
VERDICT: CHANGES-REQUESTED
1. [severity HIGH] A0/B8/C6/D7/E5/F7 - Fence rows only gate the positive `FENCE_ID=...` command; `negative_control_cmd` lives in JSON but is not required by the plan row tests - make every fence gate run positive plus negative control and require the negative to fail.
2. [severity HIGH] A0/fence-contract - Negative controls do not name the expected failure/assertion, so an import crash or empty harness can satisfy the red path - add per-fence expected failure names/counts to `fence-report-v1.json`.
3. [severity HIGH] G2/B7 - Live `--execute` migration+pm2 path is only prose-gated by undefined `release_review`; no mechanism proves Tiller cannot invoke live DB/pm2 - require an explicit human-only guard in the script and test that unattended/tiller execution is refused.
4. [severity MED] PROMOTION CLEANUP/G1 - Cleanup is an endgame row, not creator-owned cleanup at each promotion boundary; temp DBs, fence reports, local servers, and scratch from earlier rows can survive - attach cleanup/reporting to each slice that creates scratch and report reclaimed space.
5. [severity MED] A0 - One slice hides five fence specs plus the runner, and validates with `--list` only; that is non-gateable for harness correctness - split runner/spec authoring or gate A0 with a real temp Fastify/DB browser smoke and one negative stub.
6. [severity MED] D7 - Summary fence claims answered-reminder capture while excluding the reminder fire/reply seam from contributors (`C3 is not a D7 unit`) - either include the real closed C6 seam as an explicit dependency/fixture contract or narrow D7 to summary-only ingestion.
