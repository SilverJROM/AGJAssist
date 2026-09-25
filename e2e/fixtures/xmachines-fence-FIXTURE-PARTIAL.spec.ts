import { test } from '@playwright/test';
import { acceptLine } from '../xmachines-fence-helpers.mjs';

// Harness self-test fixture only (tests/unit/xmachines-fence-harness.spec.ts).
// Accepts exactly one of a two-id fixture row and never mentions the other
// id at all (neither accept nor reject), so the runner's collected-vs-
// acceptance_ids set comparison (J1e) has to be the thing that catches it —
// deleting that comparison would let this fixture report a false PASS.
test('xmachines fence FIXTURE-PARTIAL — accepts only P1, never mentions P2', async () => {
  acceptLine('P1', 'host-state');
});
