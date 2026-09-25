import { test } from '@playwright/test';
import { FENCE_ID, ACCEPTANCE_IDS } from './xmachines-fence-D14.manifest.mjs';
import { guardedCheck } from './xmachines-fence-helpers.mjs';

// Phase checkpoint D14 — section render fence.
// Scaffolding only (A0.2 must not implement product behavior): the routes
// below do not exist yet, so every check here is expected to REJECT until
// the owning slices (D1/D7) ship the real UI.

test(`xmachines fence ${FENCE_ID} — section render`, async ({ page }) => {
  const results: boolean[] = [];

  // A1e — a fresh #/xmachines load renders the xmachines section rather than the landing page.
  results.push(await guardedCheck('A1e', async () => {
    await page.goto('/#/xmachines', { waitUntil: 'domcontentloaded' });
    const section = page.locator('[data-section="xmachines"]').first();
    await section.waitFor({ state: 'visible', timeout: 5000 });
  }));

  // D2e — the UI renders the exact normal-Off refusal reason.
  results.push(await guardedCheck('D2e', async () => {
    await page.goto('/#/xmachines/gpu', { waitUntil: 'domcontentloaded' });
    const offButton = page.locator('[data-action="power-off"]').first();
    await offButton.click({ timeout: 5000 });
    const refusal = page.locator('[data-refusal-reason]').first();
    await refusal.waitFor({ state: 'visible', timeout: 5000 });
    const text = (await refusal.textContent()) || '';
    if (!text.trim()) {
      throw new Error('expected a non-empty rendered refusal reason');
    }
  }));

  if (results.length !== ACCEPTANCE_IDS.length || results.some((ok) => !ok)) {
    throw new Error(`fence ${FENCE_ID}: one or more acceptance ids failed — see [FENCE-REJECT-V1] lines above`);
  }
});
