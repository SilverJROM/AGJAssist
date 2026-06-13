# Batch A1b Changes

Feature statement: agent setup definitions can now be exported to and re-imported from a deterministic, hand-editable markdown document while keeping the DB as the source of truth.

## Code Changes

### `src/services/agent-assignment-service.ts`

Why:
- Added `exportMarkdown()` to serialize agents, role defaults, and project role bindings into one `.md` document.
- Added `importMarkdown()` to parse that document and upsert agents by name, role defaults by role, and role bindings by `(project_id, role)`.
- Kept schema, CRUD methods, and `resolveProjectRole()` behavior unchanged.

Details:
- Export format uses three markdown pipe tables: `Agents`, `Role Defaults`, and `Project Role Bindings`.
- Bindings use stable agent names rather than DB ids so exported files can move between databases.
- Import validates providers, roles, project ids, table headers, and agent references before/while applying data in a transaction.

### `tests/unit/agent-assignment-service.spec.ts`

Why:
- Added round-trip coverage for seed DB -> markdown export -> fresh DB import.
- Added idempotency coverage for importing the same markdown twice.

Details:
- Assertions compare the outcome state, including agent definitions, role defaults, and `resolveProjectRole()` source plus agent name.
- Row-count assertions verify repeat import does not create duplicate agents, defaults, or bindings.

## Commits

- Atomic commit subject: `[batch-A1b] .md export/import for agent setups | scenarios: A1b`
- Final commit hash is reported in the DONE status; this artifact is included in that same atomic commit.

## Autonomous Decisions

None. The markdown shape and service-level scope were approved in the A1b plan handshake.
