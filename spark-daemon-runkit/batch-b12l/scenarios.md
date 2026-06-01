# B12l Scenarios

## S1 — R12.5 spec-side sync
- Live `~/.claude/agents/projcore.md` no longer asks for a project label / NS-C or reads `projcore_session:` as overmind parent identity.
- Projcore registration examples use `overmind.sh register --run-dir <abs>` only.
- `no-project-for-run-dir` is a stop condition requiring JROM to create an Overmind project.

## S2 — PROJECT_SPECS_PROTOCOL legacy field
- `projcore_session:` is legacy/informational only.
- Overmind project `parent_session` is documented as authoritative.

## S3 — stale overmind expectations
- Tests assert current `overmind:`-prefixed output and expanded watcher/wakeup reminder copy.

## S4 — B12i parent guard fallout
- Tests with fake parent sessions provide valid mocked agent panes when their original intent is not parent-orphan suppression.
- Parent resolution failure degrades to `unknown` and still sends to the coordinator instead of throwing.
