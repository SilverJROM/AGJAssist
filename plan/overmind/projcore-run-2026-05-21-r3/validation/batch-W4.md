# Validation — W4 (WU4) — PASS
- tsc clean; service+route+helper tests 30 green. Schema v17 (overmind_task_history table+index) live-migrated.
- LIVE: task change inserts history row; deleting the workflow row → history SURVIVED (persistent archive). Active/Completed/History tabs, grouped-by-workflow newest-first.
- WU4 VERIFIED.
