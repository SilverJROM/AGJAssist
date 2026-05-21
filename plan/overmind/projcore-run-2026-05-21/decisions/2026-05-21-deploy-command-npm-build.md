---
date: 2026-05-21
project: AGJAssist
type: process-correction
source: projcore
priority: medium
search_hooks: [deploy, build, static, npm-run-build, dist, frontend, pm2]
---

**Defect:** projcore was deploying smokes with bare `npx tsc` + `pm2 restart`. AGJAssist serves static frontend from `dist/web/public`, which is populated ONLY by the copy step in `npm run build` (`tsc -p tsconfig.json && cp -r src/web dist/`). Bare `tsc` rebuilds backend but never copies static assets, so the served frontend was stale (old app.js, missing overmind-helpers.js → 404 in A7 smoke).

**Correction:** the deploy/smoke command is **`npm run build`** (tsc + copy static) then `pm2 restart agjassist`. Backend-only smokes (A1-A6b) were unaffected (dist/index.js + dist/services are tsc outputs); only A7's static frontend surfaced it.

**Lesson:** read project_specs.md deploy line literally — "tsc -> COPY STATIC FILES -> pm2 restart". The copy step is load-bearing for any frontend change.
