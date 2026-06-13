# Batch A1b Scenarios

## Scenario A1b-1: Export agent setup as deterministic markdown

Given the DB has agents, role defaults, and project role bindings,
When `AgentAssignmentService.exportMarkdown()` is called,
Then the output is one human-readable `.md` document with tables for agents, role defaults, and project role bindings.

Acceptance checks:
- Agents are ordered by name.
- Project role bindings are ordered by project id, then role.
- Defaults and bindings reference agents by stable agent name, not DB id.

## Scenario A1b-2: Import markdown into a fresh DB

Given an exported markdown document and a fresh DB with the referenced projects present,
When `AgentAssignmentService.importMarkdown()` is called,
Then agents are upserted by name, role defaults by role, and role bindings by `(project_id, role)`.

Acceptance checks:
- Imported agents match provider, model, and default effort from the export.
- Imported role defaults resolve to the same agent names as the original DB.
- Imported project role bindings resolve to the same agent names as the original DB.

## Scenario A1b-3: Re-import is idempotent

Given an imported markdown document,
When the same document is imported again,
Then no duplicate agents, defaults, or bindings are created.

Acceptance checks:
- Row counts remain unchanged after the second import.
- `resolveProjectRole()` source and agent outcome still match the original exported state.
