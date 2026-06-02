Batch-B11: estimate-vs-actual tracking + OVM run display

Changed:
- Added `actual_min` to `OvermindTask`.
- Normalized submitted/persisted task timings so estimates stay client-provided and actuals are server-derived.
- In `OvermindService.setTasks`, compute `actual_min` when a task transitions from `processing` to `done`.
- The actual span is the single unambiguous task_log entry matching the completed task through current_task id/label matching, ending at the new done transition timestamp.
- Missing, invalid, or ambiguous task_log matches leave `actual_min: null`.
- Updated workflow task rows in the Overmind run tile to show `est Xm · actual Ym` or `est Xm · actual —`.
- Added subtle over/under styling for completed estimate-vs-actual values.

Artifacts:
- Screenshot: `screenshots/b11-overmind-est-vs-actual.png`
