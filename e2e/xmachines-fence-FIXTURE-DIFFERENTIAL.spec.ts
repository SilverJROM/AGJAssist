import { test } from '@playwright/test';
import { guardedCheck } from './xmachines-fence-helpers.mjs';

// Harness self-test fixture only (tests/unit/xmachines-fence-harness.spec.ts).
// Empty body always succeeds, so unstubbed it ACCEPTs Z1 and under
// FENCE_STUB=FIXTURE-UNIT guardedCheck rejects before calling the body.
// That is the --expect-red happy path: green in run A, red in run B.
test('xmachines fence FIXTURE-DIFFERENTIAL — Z1 succeeds unless FIXTURE-UNIT is stubbed', async () => {
  await guardedCheck('Z1', 'FIXTURE-UNIT', async () => {});
});
