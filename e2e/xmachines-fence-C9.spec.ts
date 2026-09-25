import { test } from '@playwright/test';
import { FENCE_ID, ACCEPTANCE_IDS } from './xmachines-fence-C9.manifest.mjs';
import { guardedCheck } from './xmachines-fence-helpers.mjs';

// Phase checkpoint C9 — power POST fence.
// Scaffolding only (A0.2 must not implement product behavior): the routes
// below do not exist yet, so every check here is expected to REJECT until
// the owning slices (C3/C4/C5/L15) ship the real endpoints.

test(`xmachines fence ${FENCE_ID} — power POST`, async ({ request }) => {
  const results: boolean[] = [];

  // L15b — every power POST requires an idempotency key.
  results.push(await guardedCheck('L15b', async () => {
    const res = await request.post('/api/xmachines/machines/gpu/power/off', {
      data: {},
      failOnStatusCode: false,
    });
    if (!(res.status() === 400 || res.status() === 428)) {
      throw new Error(`expected a request without an Idempotency-Key to be refused, got status=${res.status()}`);
    }
  }));

  // I5c — a stale or never-verified WoL-safe state routes Off through the force challenge.
  results.push(await guardedCheck('I5c', async () => {
    const res = await request.post('/api/xmachines/machines/gpu/power/off', {
      data: {},
      headers: { 'idempotency-key': 'xmachines-fence-c9-i5c', 'x-fence-stub': 'stale-wol' },
      failOnStatusCode: false,
    });
    const body = await res.json().catch(() => ({}));
    if (!(res.status() >= 400 && String(body.route || '').includes('force-challenge'))) {
      throw new Error(`expected stale WoL-safe Off to route through a force challenge, got status=${res.status()} body=${JSON.stringify(body)}`);
    }
  }));

  // L3a — full force is a separate action from normal Off.
  results.push(await guardedCheck('L3a', async () => {
    const offRes = await request.post('/api/xmachines/machines/gpu/power/off', {
      data: {},
      headers: { 'idempotency-key': 'xmachines-fence-c9-l3a-off' },
      failOnStatusCode: false,
    });
    const forceRes = await request.post('/api/xmachines/machines/gpu/power/force', {
      data: {},
      headers: { 'idempotency-key': 'xmachines-fence-c9-l3a-force' },
      failOnStatusCode: false,
    });
    if (forceRes.status() === 404) {
      throw new Error('expected a dedicated /power/force route distinct from /power/off, got 404');
    }
    if (offRes.status() === forceRes.status()) {
      const offBody = await offRes.json().catch(() => ({}));
      const forceBody = await forceRes.json().catch(() => ({}));
      if (JSON.stringify(offBody) === JSON.stringify(forceBody)) {
        throw new Error('expected /power/off and /power/force to produce distinguishable outcomes');
      }
    }
  }));

  if (results.length !== ACCEPTANCE_IDS.length || results.some((ok) => !ok)) {
    throw new Error(`fence ${FENCE_ID}: one or more acceptance ids failed — see [FENCE-REJECT-V1] lines above`);
  }
});
