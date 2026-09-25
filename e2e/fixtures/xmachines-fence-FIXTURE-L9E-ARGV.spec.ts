import { test } from '@playwright/test';
import { acceptLine } from '../xmachines-fence-helpers.mjs';

// Harness self-test fixture only (tests/unit/xmachines-fence-harness.spec.ts).
// Deliberately claims L9e via argv (not host-state) so the runner's
// argv-only-power-proof rejection can be exercised against a real,
// independently-authored journey rather than a literal the test invents.
test('xmachines fence FIXTURE-L9E-ARGV — claims L9e via argv', async () => {
  acceptLine('L9e', 'argv');
});
