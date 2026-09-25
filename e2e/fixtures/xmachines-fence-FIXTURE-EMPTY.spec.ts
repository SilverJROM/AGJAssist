import { test } from '@playwright/test';

// Harness self-test fixture only (tests/unit/xmachines-fence-harness.spec.ts).
// Deliberately emits zero [FENCE-ACCEPT-V1] lines so the runner's
// empty-collected-is-RED path (J1d) can be exercised against a real,
// independently-authored journey rather than a literal the test invents.
test('xmachines fence FIXTURE-EMPTY — emits nothing', async () => {
  // no-op
});
