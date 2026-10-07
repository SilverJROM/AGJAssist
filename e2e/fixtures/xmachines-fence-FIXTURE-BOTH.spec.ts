import { test } from '@playwright/test';
import { acceptLine, rejectLine } from '../xmachines-fence-helpers.mjs';

test('overlap accept and reject for same id', async () => {
  acceptLine('Q1', 'host-state');
  rejectLine('Q1', 'UNIT-BOTH', 'same id also rejected');
});
