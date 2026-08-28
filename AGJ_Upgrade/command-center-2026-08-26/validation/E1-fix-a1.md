FINDING 1 of 1
WHAT FAILED: tests/unit/agent-wakeup-schema.spec.ts does not discriminate the full status contract for agent_one_time_wakeups. It never exercises cancelled, the default pending status, or invalid status rejection, so a schema that omits cancelled from the CHECK would still pass.
THE FIX: In tests/unit/agent-wakeup-schema.spec.ts, add a literal public-path DatabaseService test that inserts a wakeup while omitting status and asserts status is pending, inserts another wakeup with status='cancelled' and reads it back, and asserts inserting status='bogus' throws a SQLite constraint error.
WHY THE LAST ATTEMPT MISSED IT: The test covered table existence and pending-to-fired mutation but did not use a specimen for the third allowed enum value.
