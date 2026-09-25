import { test } from '@playwright/test';
import { FENCE_ID, ACCEPTANCE_IDS } from './xmachines-fence-B17.manifest.mjs';
import { guardedCheck } from './xmachines-fence-helpers.mjs';

// Phase checkpoint B17 — sampled reading fence.
// Scaffolding only (A0.2 must not implement product behavior): the routes
// below do not exist yet, so every check here is expected to REJECT until
// the owning slices (B1/B2/B3/I1) ship the real endpoints.

test(`xmachines fence ${FENCE_ID} — sampled reading`, async ({ request, page }) => {
  const results: boolean[] = [];

  // E1a — one bounded nvidia-smi query discovers the current GPU inventory at poll time.
  results.push(await guardedCheck('E1a', 'B2', async () => {
    const res = await request.get('/api/xmachines/machines/gpu', { failOnStatusCode: false });
    const body = await res.json().catch(() => ({}));
    if (!(res.status() === 200 && body.uuid && body.polled_at)) {
      throw new Error(`expected a polled GPU inventory record, got status=${res.status()} body=${JSON.stringify(body)}`);
    }
  }));

  // B3a — a measured value is visibly marked measured.
  results.push(await guardedCheck('B3a', 'B4', async () => {
    await page.goto('/#/xmachines/gpu', { waitUntil: 'domcontentloaded' });
    const marker = page.locator('[data-provenance="measured"]').first();
    await marker.waitFor({ state: 'visible', timeout: 5000 });
  }));

  // I1a — a persisted thermal threshold breach creates one alert.
  results.push(await guardedCheck('I1a', 'B11', async () => {
    const res = await request.get('/api/xmachines/alerts?limit=1', { failOnStatusCode: false });
    const body = await res.json().catch(() => ({}));
    if (!(res.status() === 200 && Array.isArray(body.alerts))) {
      throw new Error(`expected an alerts list, got status=${res.status()} body=${JSON.stringify(body)}`);
    }
  }));

  if (results.length !== ACCEPTANCE_IDS.length || results.some((ok) => !ok)) {
    throw new Error(`fence ${FENCE_ID}: one or more acceptance ids failed — see [FENCE-REJECT-V1] lines above`);
  }
});
