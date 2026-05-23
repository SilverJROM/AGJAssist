# Validation — W3 (WU3) — PASS
- tsc clean; service+route tests 18 green incl critical "display_name survives re-register + setTasks". Schema v16 (display_name) live-migrated.
- JWT POST /api/overmind/workflows/:id/name; UI rename control; display_name ?? label in cards/Telegram/notifications.
- LIVE: set display_name then re-register → preserved; label stayed code-name. WU3 VERIFIED.
