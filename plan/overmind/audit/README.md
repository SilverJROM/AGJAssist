# Overmind Algo-vs-Spark Audit

Cron-driven observer that compares overmind's deterministic session-status classifier
against gpt-5.3-codex (spark) reading the actual tmux panes, then has Opus propose
specific improvements to `src/services/overmind-watcher.ts`.

## Enable (add to crontab)

```
*/10 * * * * cd /home/agjrom/TGBOTS/AGJAssist && /usr/bin/env node plan/overmind/audit/algo-vs-spark-audit.mjs >> plan/overmind/audit/cron.log 2>&1
```

Run `crontab -e` and paste the line above. The script self-gates via `audit-state.json`
and only fires its own logic every 20–30 min (random, 60/40 split). All other cron
fires exit silently in under a second.

## How it works

1. On first run: bootstraps `audit-state.json` (started_at = now, next_fire_at = now, tick_count = 0).
2. On each cron fire: reads state; if `done=true` exits; if before `next_fire_at` exits silently.
3. If 3 days elapsed: runs FINALIZE (Opus analysis + markdown report + TG DONE ping).
4. Otherwise: reads active workflows from DB (read-only), captures parent + child panes via
   `tmux capture-pane`, asks spark for one strict-JSON verdict per workflow, compares with
   the algo's DB-stored status, appends to `audit-log.jsonl`, saves pane sidecar in `panes/`.
5. Schedules next fire (20 min w/ prob 0.6, else 30 min) and updates state.

## Peek progress

```bash
# State and tick count
cat plan/overmind/audit/audit-state.json

# Number of JSONL rows collected
wc -l plan/overmind/audit/audit-log.jsonl

# Last 10 entries
tail -10 plan/overmind/audit/audit-log.jsonl | python3 -m json.tool 2>/dev/null || tail -10 plan/overmind/audit/audit-log.jsonl

# Cron log
tail -40 plan/overmind/audit/cron.log
```

## Interim report (before 3 days)

```bash
node plan/overmind/audit/algo-vs-spark-audit.mjs --render-only
```

Reads the existing `audit-log.jsonl`, builds tallies, invokes Opus, writes
`audit-report-<startdate>.md`. Does NOT update state or schedule a next fire.
The report is overwritten each time you run `--render-only`.

## Kill / stop early

Option A — remove the cron entry:
```bash
crontab -e   # delete the */10 line
```

Option B — mark done immediately (cron fires will then exit silently):
```bash
node -e "
const fs = require('fs');
const f = 'plan/overmind/audit/audit-state.json';
const s = JSON.parse(fs.readFileSync(f));
s.done = true;
fs.writeFileSync(f, JSON.stringify(s, null, 2));
console.log('done=true set');
"
```

## Env vars (all optional)

| Var | Default | Description |
|-----|---------|-------------|
| `AUDIT_DAYS` | `3` | Duration of the audit in days |
| `AUDIT_CADENCE_20_WEIGHT` | `0.6` | Probability of 20-min interval (vs 30-min) |
| `AUDIT_SPARK_CMD` | `codex exec --model gpt-5.3-codex --skip-git-repo-check` | Command to invoke spark |
| `AUDIT_ANALYST_MODEL` | `opus` | Model flag passed to `claude -p --model` for the final analysis |
| `AUDIT_LOG_DIR` | `plan/overmind/audit` | Directory for all audit artifacts |

## Artifacts (auto-created)

```
plan/overmind/audit/
  audit-state.json           # state gate (started_at, next_fire_at, tick_count, done)
  audit-log.jsonl            # one row per session per tick
  audit-summary.json         # tallies written at FINALIZE
  audit-report-<date>.md     # Opus analysis + improvement proposals
  cron.log                   # stdout/stderr from cron (via >> redirect)
  panes/
    <tick_n>-wf<id>.json     # raw pane text per tick/workflow (Opus reads these for evidence)
```
