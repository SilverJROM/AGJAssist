---
date: 2026-05-21
project: AGJAssist + projcore-watcher
type: bug-fix
source: projcore
priority: high
search_hooks: [stuck, frozen, busy-marker, waiting-for, nudge, watcher, detection, lkcamp, hris]
---
**Bug (live, lkcamp + HRIS):** stuck coordinators (frozen pane, empty composer) were NOT detected/nudged because both detection layers treated busy-marker PRESENCE as "active" without checking the pane was actually CHANGING. "Waiting for" matched incidental idle-recap text → falsely "working/busy" forever.
**Fix (both layers):** activity now requires ACTUAL pane CHANGE (hash differs across cycles) OR run_dir mtime advance — not stale marker text.
- Overmind classifier: src/services/overmind-watcher.ts (O6) — working = coord/child hash changed or mtime advanced; child-hash tracking added; all 3 classifiers (overall/parent/child).
- projcore-watcher.sh: busy only if marker AND pane changed; frozen-with-marker → FROZEN-WITH-MARKER idle → exit 5. (Edited directly by projcore.)
**Immediate relief:** manually nudged lkcamp-12 + hris-d-22 (both resumed).
