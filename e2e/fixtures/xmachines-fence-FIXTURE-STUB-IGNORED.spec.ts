import { test } from '@playwright/test';
import { acceptLine } from '../xmachines-fence-helpers.mjs';

// Harness self-test fixture only (tests/unit/xmachines-fence-harness.spec.ts).
// Calls acceptLine directly, never guardedCheck, so FENCE_STUB cannot change
// the outcome: W1 is ACCEPT in both the unstubbed baseline and the stubbed
// run. That is the only shape that reaches fault_class=negative_control_did_not_red
// (id green in A, still green in B).
test('xmachines fence FIXTURE-STUB-IGNORED — always accepts W1, ignores FENCE_STUB', async () => {
  acceptLine('W1', 'host-state');
});
