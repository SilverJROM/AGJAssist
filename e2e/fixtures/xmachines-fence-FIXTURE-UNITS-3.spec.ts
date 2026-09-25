import { test } from '@playwright/test';
import { rejectLine } from '../xmachines-fence-helpers.mjs';

// Harness self-test fixture only (tests/unit/xmachines-fence-harness.spec.ts).
// Three rejected ids, three distinct units — J1c's classifyByUnitSpread
// must declare plan_defect (size 3 is > 2). Paired with UNITS-2 so a
// shifted comparison operand cannot satisfy both.
test('xmachines fence FIXTURE-UNITS-3 — rejects U1 U2 U3 from three units', async () => {
  rejectLine('U1', 'UNIT-A', 'fixture three-unit specimen');
  rejectLine('U2', 'UNIT-B', 'fixture three-unit specimen');
  rejectLine('U3', 'UNIT-C', 'fixture three-unit specimen');
});
