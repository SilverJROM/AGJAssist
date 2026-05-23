# Validation — W5 (WU5) — PASS
- tsc clean; service+helper tests 20 green. Schema v15 (run_started_at + accumulated_ms) live-migrated + backfilled (run_started_at=created_at for existing rows).
- LIVE reset smoke (overmind-r3): re-register → run_started_at advanced to now (current Elapsed ~0), accumulated_ms rolled prior run (~81min/4875488ms), created_at unchanged. Exactly fixes the 1h7m accumulation.
- WU5 VERIFIED.
