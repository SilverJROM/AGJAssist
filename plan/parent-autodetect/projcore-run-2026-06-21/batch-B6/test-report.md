# batch-B6 test-report (verifies only — no unit tests per brief scope)

## All acceptance criteria (5(a)-(d)) — PASSED

### (a) HTTP health
Command: `curl -s -o /dev/null -w '%{http_code}' http://localhost:3101/`
Output:
200
Status: PASS

### (b) DB now stores only base names
Command: `sqlite3 data/agjassist.db "SELECT slug,parent_session FROM overmind_projects ORDER BY slug"`
Output:
AGJ|agj
HELM|helm
HRIS Proj|hris
Lokal Proj Mgmt|lokal
ReceiptBOT|rsp
VOICE APP|lkvc
Status: PASS (no numeric suffixes)

### (c) Runtime resolution still reaches live sessions (post-norm)
Command: npx tsx -e ' ... await resolveParentSession for agj/hris/lkvc ... '
Output:
{
  base: 'agj',
  session: 'agj-4',
  baseOut: 'agj',
  method: 'group',
  ambiguous: false
}
{
  base: 'hris',
  session: 'hris-1',
  baseOut: 'hris',
  method: 'group',
  ambiguous: false
}
{
  base: 'lkvc',
  session: 'lkvc-7',
  baseOut: 'lkvc',
  method: 'group',
  ambiguous: false
}
Notes:
- Matches current `tmux list-sessions -F '#{session_name}|#{session_group}'` (agj-4|agj , hris-1|hris , lkvc-7|lkvc)
- Method=group, never returns child (e.g. *-grok sessions correctly excluded)
- Child exclusion + ranking by attached/activity per B1 resolver logic

Status: PASS

### (d) No crash / clean post-restart
Command: `pm2 logs agjassist --lines 10 --nostream`
Recent output (tail includes restart):
[overmind] ... (older pre-norm no-session entries for old names like "hris-23"/"lkvc-24")
...
0|agjassis | AGJAssist API server listening on 0.0.0.0:3101
0|agjassis | Overmind watcher started (30s)
Status: PASS (no errors, clean startup lines present after restart)

## Pre-verify steps also green
- Backup performed + path printed
- normalize.mjs ran (tsx import deriveBaseName) → 5 updates, AFTER table matches expected
- npm run build → exit 0 (tsc clean + web copy)
- pm2 restart + `pm2 list` showed agjassist "online"

## Artifacts
- normalize.mjs (the one-shot used)
- changes.md
- decisions/2026-06-21-b6-db-normalize-ship.md

All per brief. Feature shipped live.
