import { test } from '@playwright/test';
import { rejectLine } from '../xmachines-fence-helpers.mjs';

// Harness self-test fixture only (tests/unit/xmachines-fence-harness.spec.ts).
// Deliberately rejects its one acceptance id and collects nothing else,
// identically regardless of FENCE_STUB (it never reads it) — so an
// --expect-red run against this fixture can never show the id green in an
// unstubbed baseline. Exercises the attempt-2 regression: an early return
// on --expect-red used to report PASS/fault_class=none for exactly this
// all-rejected shape.
test('xmachines fence FIXTURE-EXPECT-RED-STATIC — always rejects Y1', async () => {
  rejectLine('Y1', 'FIXTURE-UNIT', 'deliberately rejected regardless of stub');
});
