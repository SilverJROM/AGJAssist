# project_specs.md Protocol (Shared)

**Location:** `~/.claude/agents/PROJECT_SPECS_PROTOCOL.md`
**Used by:** all agents — `[lead]`, `[fast_lead]`, `[coord]`, `[projcore]`, `[mockup]`, `[dev]`, `[qa]`, `[reviewer]`, `[arch]`, `[sysarch]`, `[deployer]` (plus codex equivalents)

`project_specs.md` lives at the **repo root** of every project. It is the architectural source of truth — invariants, conventions, deploy commands, environment maps, per-module summaries, hardening expectations. When `og-requirements.md` is silent or contradicts an existing rule, this is what you reach for.

**Project-specific details belong here, not in agent prompts.** If you find yourself wanting to bake `pm2 restart`, env URLs, deploy scripts, framework quirks, or stack details into a global agent prompt — stop. Put them in `project_specs.md` and have the agent read them.

---

## Phase 1 (Requirements) — verify it exists

If `project_specs.md` does NOT exist and the repo has real code, stop and tell the user:

> *"I can't start a plan without `project_specs.md`. This doc is the architectural source of truth I check for contradictions. Should I bootstrap one from the current codebase + your knowledge? It's a short conversation."*

Do not proceed to planning until it exists.

---

## During requirements discussion

Read the relevant sections of `project_specs.md` before each round of questions. When the user describes something that **contradicts** an existing rule, raise it immediately:

```
⚠️ Contradicts `project_specs.md` §X.X — existing rule: "[quote]".
New request: "[paraphrase]".
Short analysis: "[what changes if we apply the new rule]".
Recommendation: "[adopt new / keep existing / hybrid]".
Which way?
```

The user decides whether to (a) update `project_specs.md` to the new rule, or (b) override only within the current plan's `og-requirements.md`.

Every contradiction must be resolved **during planning**, not deferred. The user is available during planning; that is the time to surface these.

When a rule is updated as part of plan kickoff, commit the change with a `changelog.md` entry (most recent on top, dated, explaining what changed and why).

---

## During autonomous execution

Once the user has given the green light:

- **Finish what you started.** Do not stop autonomously over ambiguity you should have caught during planning. That was your responsibility.
- **Decide with `project_specs.md` + `og-requirements.md` in hand.** When a scenario surfaces that both are silent on:
  - Apply a reasonable default derived from observed codebase patterns + prior precedent.
  - Note the decision in the active batch's `changes.md`: *"Spec was silent on X; applied Y; surface to user at next checkin."*
  - Continue.
- **If the decision could break the app** (corrupts data, loses money, breaks multi-tenancy, opens a security hole): pick the safest interpretation, note it prominently in the batch artifact, continue. Do not stop.
- **At end of autonomous execution**, deliver a summary listing every in-flight decision made without the user present, so the user can audit them. One line per decision with reference to the batch artifact.

**Failure mode:** anything that should have been caught during planning but wasn't, that became a problem during autonomous execution, is the lead's failure. Never blame the user for "not telling me."

---

## Universal `project_specs.md` template

When bootstrapping for a new project:

```markdown
# <Project Name>

**Repo:** <git url>
**Stack:** <languages / frameworks / infra>
**Type:** <SaaS / CLI / library / ...>
**projcore_session:** <legacy-logical-project-label>  <!-- legacy/informational only; Overmind project parent_session is authoritative -->

> Purpose: what lives in `changelog.md` vs here.

## Index
- [1. Current Status & Milestones](#1-current-status--milestones)
- [2. Architecture](#2-architecture)
- [3. Tenancy / Data Boundaries](#3-tenancy--data-boundaries)
- [4. Roles & Permissions](#4-roles--permissions)
- [5. Data Conventions](#5-data-conventions)
- [6. UI Conventions](#6-ui-conventions)
- [7. Error Handling Conventions](#7-error-handling-conventions)
- [8. Seeding & Migrations](#8-seeding--migrations)
- [9. Testing Expectations](#9-testing-expectations)
- [10. Deployment](#10-deployment)
- [11. Feature Modules](#11-feature-modules)
- [12. Known Legacy Quirks](#12-known-legacy-quirks)
- [13. Gaps / Open Questions](#13-gaps--open-questions)
- [14. Stack & Specialty (agent specialization)](#14-stack--specialty-agent-specialization)  <!-- OPTIONAL, lazy-bootstrapped -->


## 1. Current Status & Milestones
<Phases / milestones / status table.>

## 2. Architecture
<Frontend, API, DB, storage, cache, jobs, auth. Short bullets each.>

## 3. Tenancy / Data Boundaries
<Single-tenant: one line. Multi-tenant: row-level vs schema-level isolation, group/org structure, shared-vs-scoped data rules, canonical query patterns.>

## 4. Roles & Permissions
<Table: role | scope | typical powers. Scope-enforcement helpers. Segregation-of-duties flags.>

## 5. Data Conventions
<IDs, money, dates/times, encryption, nullability, effective-dating, anything non-obvious.>

## 6. UI Conventions
<Patterns, filter bars, modals vs pages, theming, framework quirks, accessibility.>

## 7. Error Handling Conventions
<Error codes/shape. CAS / retry patterns. DB quirks. Input validation.>

## 8. Seeding & Migrations
<Naming, idempotency, special patterns, scaffold markers.>

## 9. Testing Expectations
<Mandatory per-batch. When to write E2E. Known infra gaps. Hardening scripts if used (`scripts/check-hardening.sh`, `plan/hardening/`).>

## 10. Deployment
<Project-specific deploy details go HERE — never in agent prompts. Suggested subsections:>
<- 10.1 Local development (dev server commands, ports, hot-reload, fixture setup, smoke-curl URLs)>
<- 10.2 Environments (per-env tables for frontend/backend/DB names, custom domains, URLs)>
<- 10.3 Deploy commands (per-env, with explicit flags. Note any broken/avoided wrappers.)>
<- 10.4 Gate protocol (numbered list — branch clean → typecheck → build → migrate → deploy → verify → smoke)>
<- 10.5 Promote pipeline (cross-env script if any; the script is the runbook)>
<- 10.6 Config cross-check (any pre-deploy YAML/manifest validation rules)>
<- 10.7 Known gotchas (broken commands, deduplication quirks, CDN caching, hash collisions)>
<- 10.8 Rollback protocol (how to revert worker, frontend, DB; backup locations)>

## 11. Feature Modules
<One subsection per module. 1-3 paragraphs each. Descriptive, not prescriptive.>

## 12. Known Legacy Quirks
<Table: quirk | reality | impact. Non-obvious schema/code mismatches.>

## 13. Gaps / Open Questions
<Open decisions the user needs to weigh in on. Updated whenever a new gap surfaces.>

## 14. Stack & Specialty (agent specialization)

> **OPTIONAL section.** Each subsection is optional — missing fields default to "Web UI + Playwright + git" behavior. Agents proceed on defaults and infer/build missing fields lazily during work. Never blocks pipeline.

### Interface
- Primary: <Web UI | API | Telegram bot | CLI | Worker>
- Secondary: <list, or "none">

### Validation toolset (per interface)
- Web UI → Playwright (config: e2e/playwright.config.ts, baseURL=...)
- API → curl + assertion script
- Telegram bot → fixture-backed conversation runs
- CLI → command output + exit code

### Build / dev commands (pointers to § 10 Local development)
- Frontend dev: ...
- Worker dev: ...
- Tests: ...

### Per-agent guidance

- **[lead]:** project orchestration quirks, batch sizing notes
- **[fast_lead]:** smoke verify method per interface, default DEV URL pattern, project gotchas, hardened modules pointer
- **[arch] / [sysarch]:** stack-knowledge file pointer (references/stacks/<stack>.md), tenancy pattern, schema conventions, migration pattern, allowed/forbidden architectural pivots
- **[coord]:** default tmux session pattern, default Target env, Tier 2 smoke method
- **[projcore]:** per-module test command pattern, full E2E capstone command, module list for atomic gating; `projcore_session` is legacy/informational if present
- **[mockup]:** `applicable: yes | no` (no = route to /lead Phase 1b), mockup home location, state service pattern, JSON fixture location, backend-bypass marker
- **[dev] / [elitedev01]:** bug-reproduce interface, code conventions pointer, stack-knowledge file (SHARED with arch), remote deploy audit script, TS-### test scenarios location
- **[qa] / $tester / $testkeeper:** test framework + config, scenario library location, bug-fix regression policy, per-module test selector pattern, interface-specific evidence shape, login fixture
- **[reviewer]:** hardening check script, migration cross-check pattern, project-specific review checklist additions
- **[deployer]:** deploy mechanism, promote pipeline script (if any), smoke verify method per interface, rollback mechanism, hardening check script pointer, known deploy gotchas
- **[migrator-cf] / [promoter]** (CF projects only): env tables, lokal.yaml location, wrangler config, rollback procedure
- **[gapfiller] / [bsconsult]** (when used): spec.md location, TS-### convention pointer, business-domain hints
- **[jromhead]** (when used): screenshot evidence location, retention policy
- **[webdesign]** (when used): design tokens location, component library pointer, a11y baseline
- **[bugfix]:** standard reproduce + fix flow (or "n/a — use $fast-lead")
- **[flm]:** default dossier template, standard audience (deferred until 2nd project needs it)

---

*For history of why rules changed and when, see `changelog.md` (most recent on top).*
```

Length target: ≤600 lines per project. If a section grows past ~100 lines, split it into a dedicated doc and reference it.

---

## Green-project bootstrap flow

When a user asks you to start a plan on a repo with no `project_specs.md`:

1. Stop planning. Tell the user the rule.
2. If they agree, **capture header fields first** (Repo / Stack / Type). These are quick (under a minute total). `projcore_session:` may remain present in older specs, but it is legacy/informational; Overmind project `parent_session` is authoritative.
3. Then walk through the 13 template sections in order. 5–15 minutes per section max.
4. For sections you can auto-derive (stack, modules, architecture): read the code and propose a draft, ask user to confirm.
5. For business-judgment sections (roles, conventions): ask the user directly.
6. Once header fields + all 13 sections are filled, commit `project_specs.md` + a `changelog.md` bootstrap entry. Then proceed to the user's actual plan.

**Mid-life bootstrap (`project_specs.md` exists but a required field is missing):** don't trigger the full 13-section interview. Ask one focused question for the missing field, write it inline, continue. Do not ask for `projcore_session:` as a required field; it is legacy/informational only.

### Critical sections — the v3 pipeline depends on these

These sections are non-negotiable for the team to function. If the user wants to skip any, either bootstrap a minimum viable version or stop and tell them why you can't proceed:

| Section | Needed by | What breaks without it |
|---------|-----------|------------------------|
| **§ 2 Architecture** | `[arch]`, `[dev]` | arch can't honor stack constraints; dev guesses |
| **§ 3 Tenancy / Data Boundaries** | `[arch]`, `[dev]` | new tables get tenancy wrong |
| **§ 4 Roles & Permissions** | `[arch]`, `[dev]`, `[qa]` | RBAC tests miss cases; mutations forget scope checks |
| **§ 5 Data Conventions** | `[dev]`, `[arch]` | money/date/ID conventions drift |
| **§ 6 UI Conventions** | `[dev]`, `[qa]` | qa Playwright selectors fail; dev breaks visual conventions |
| **§ 7 Error Handling** | `[dev]`, `[reviewer]` | error codes drift; reviewer can't enforce conventions |
| **§ 8 Seeding & Migrations** | `[dev]`, `[arch]` | migration patterns drift; idempotency lost |
| **§ 9 Testing Expectations** | `[dev]`, `[qa]` | self-verification commands unknown; E2E coverage rules unclear |
| **§ 10 Deployment** (all subsections) | `[deployer]`, `[qa]` | deployer cannot deploy; post-deploy smoke has no URL |
| **§ 10.1 Local development** | `[qa]`, `[dev]` | qa has no dev URL/port; dev can't reproduce bugs |
| **Overmind project `parent_session`** | `[projcore]`, overmind | JROM-owned Overmind project field used as the authoritative parent identity for run registration and nudges. Legacy `projcore_session:` headers may remain in older specs for context, but projcore no longer reads them as the source of truth. |

Sections 11 (Feature Modules), 12 (Legacy Quirks), 13 (Gaps) can be lighter on day 1 and grow over time. The first 10 must be solid before the v3 pipeline can run autonomously.

**§ 14 Stack & Specialty is OPTIONAL.** Missing or empty → agents default to "Web UI + Playwright + git" behavior. Populate lazily when an agent needs project-specific per-agent guidance that doesn't fit elsewhere. Never blocks pipeline. Bootstrap rule: lazy — fields added when first needed, never upfront.

### The `projcore_session:` header in detail

`projcore_session:` is now **legacy/informational**. The authoritative parent identity lives on the JROM-owned Overmind project as `parent_session`, created and managed through `/api/overmind/projects`. Projcore registers a run with `overmind.sh register --run-dir <abs>` and Overmind derives the project and parent session from the run directory.

1. **Older specs may still declare the legacy label** (header block, right after `**Type:**`):
   ```markdown
   **projcore_session:** hris-d
   ```
   Keep it only as historical context; do not bootstrap or require it.
2. **JROM manages the active parent session in Overmind Projects.** Create/update the project through the dashboard/API so its `app_path` contains the run directory and its `parent_session` names the coordinator parent.
3. **Projcore at Phase 0** calls `overmind.sh register --run-dir <abs>` only. If no matching project exists, Overmind returns `no-project-for-run-dir` and projcore stops for JROM to create the project.
4. **Bootstrap if missing:** no action. Missing `projcore_session:` is valid.

Why changed: project identity is now project-as-source-of-truth. Projcore cannot set its own label or parent; it attaches to a JROM-created project instead.
