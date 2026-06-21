# batch-B6 decisions (R7 + NS1/NS3 ship)

- Followed brief verbatim: 1.BACKUP (timestamped .bak printed) 2. normalize.mjs 3.npm run build 4.pm2 restart agjassist 5. all 4 verifies (a-d) before declaring DONE.
- Chose tsx import of deriveBaseName (from parent-session-resolver.ts) rather than replicate: keeps logic single-source, exact match to runtime (per brief "SAME logic", "import it via tsx").
- normalize.mjs is pure one-shot ESM script (better-sqlite3 + imported fn); prints tables; updates iff differs; touches updated_at; idempotent (re-run = 0 updates).
- No source edits (resolver/guard/routes/app frozen); purely DATA fix + ship.
- DB backup before ANY write; rollback documented (cp .bak + optional restart).
- pm2 only touched agjassist (others ignored).
- Verify (c) used live tsx call + cross-checked against `tmux list-sessions` output (group match for parents).
- Old "no-session" in pm2 log tail are pre-restart history (old stored names); post-restart lines show clean "listening" + "watcher started".
- All (a-d) passed → DONE.
- Artifacts + normalize.mjs committed only (no .db/.bak).
- Autonomous calls: the DB normalize UPDATEs + pm2 restart (logged per contract).
