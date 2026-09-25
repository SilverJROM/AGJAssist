import { test } from '@playwright/test';
import { acceptLine } from '../xmachines-fence-helpers.mjs';

// Harness self-test fixture only (tests/unit/xmachines-fence-harness.spec.ts).
// Emits an id (V9) that is absent from the fixture row's acceptance_ids (V1
// only). The extra half of J1e's set equality is the only check that can
// catch this; deleting extra.length > 0 lets the run fall through to the
// journey-exit-code PASS.
test('xmachines fence FIXTURE-EXTRA — accepts V1 and uncontracted V9', async () => {
  acceptLine('V1', 'host-state');
  acceptLine('V9', 'host-state');
});
