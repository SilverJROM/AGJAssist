# Decision: Migration CLI Commit Guard

Date: 2026-06-01

## Decision

Use a TS CLI at `src/tools/propose-overmind-projects.ts` with pure exported helpers and a guarded `--commit` mode that requires an explicit owner JWT.

## Rationale

- TS keeps the implementation inside the existing app build and `DatabaseService` access pattern.
- Pure helpers make fixture testing direct without starting the server.
- Dry-run output is the review surface JROM needs before creating project rows.
- Explicit owner JWT avoids minting credentials or reusing loopback lifecycle auth, matching the project mutation route.
- The CLI checks that the DB path exists before opening it, avoiding accidental creation of an empty SQLite database.
- Commit preflights current projects and stops on 409/403 so collisions are reported instead of silently producing partial state.
