# batch-B6: Normalize overmind_projects.parent_session to base names + ship to live pm2 (R7)

## Summary
Executed the final data normalization (NS3) + live deployment (NS1) for the parent-session auto-detect feature. All overmind_projects now store base names only (agj, hris, lkvc, rsp, lokal, helm). Resolver + runtime continue to map base → current live group-parent.

## Exact sequence per brief (in order)
1. BACKUP: `cp data/agjassist.db data/agjassist.db.bak-b6-1782026908`
   Printed: /home/agjrom/TGBOTS/AGJAssist/data/agjassist.db.bak-b6-1782026908

2. NORMALIZE: Created + executed `plan/parent-autodetect/projcore-run-2026-06-21/batch-B6/normalize.mjs`
   - Imported `deriveBaseName` via `npx tsx ...` (exact fn, no copy/paste of logic)
   - Used better-sqlite3 (dep) to SELECT/UPDATE
   - UPDATE only when base != stored
   - Printed before→after table + update count
   - 5 rows updated; HELM unchanged
   - Idempotent: re-run → 0 updates

3. BUILD: `npm run build` (tsc -p tsconfig.json && cp -r src/web dist/) → exit 0

4. SHIP: `pm2 restart agjassist`
   - Confirmed via `pm2 list`: agjassist online (new pid, status=online)

5. VERIFY POST-SHIP (all passed):
   - (a) curl ...3101/ → 200
   - (b) sqlite3 SELECT slug,parent_session → all base names
   - (c) tsx resolveParentSession('agj'|'hris'|'lkvc') → live group-parents (agj-4, hris-1, lkvc-7) via "group" method
   - (d) pm2 logs ... --nostream → server listening + watcher started (historical old-suffix "no-session" lines expected pre-norm)

## Before / After (from normalize run)
```
BEFORE
AGJ|agj-4
HELM|helm
HRIS Proj|hris-23
Lokal Proj Mgmt|lokal-5
ReceiptBOT|rsp-0
VOICE APP|lkvc-24

AFTER
AGJ|agj
HELM|helm
HRIS Proj|hris
Lokal Proj Mgmt|lokal
ReceiptBOT|rsp
VOICE APP|lkvc
```

## Rollback plan
- `cp data/agjassist.db.bak-b6-1782026908 data/agjassist.db`
- `pm2 restart agjassist`
- (The .bak is not committed; DB mutation is the autonomous step requiring the backup gate)

## Scope adherence
- ONLY backup + normalize script + build + pm2 agjassist restart + verifies.
- ZERO changes to resolver, brain, guard, routes, app.js or any TS sources (frozen).
- DATA only (parent_session TEXT unchanged).
- No other pm2 processes touched.
- Commit will include only normalize.mjs + *.md artifacts under batch-B6/.

This ships the whole feature live (R7 + prior batches) per north-star NS1.
