import { test } from '@playwright/test';
import { rejectLine } from './xmachines-fence-helpers.mjs';

// Harness self-test fixture only (tests/unit/xmachines-fence-harness.spec.ts).
// Two rejected ids, two distinct units — J1c's classifyByUnitSpread must
// stay on missing_acceptance (size 2 is not > 2).
test('xmachines fence FIXTURE-UNITS-2 — rejects U1 and U2 from two units', async () => {
  rejectLine('U1', 'UNIT-A', 'fixture two-unit specimen');
  rejectLine('U2', 'UNIT-B', 'fixture two-unit specimen');
});
