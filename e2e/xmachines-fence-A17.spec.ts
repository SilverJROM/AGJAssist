import { test } from '@playwright/test';
import { FENCE_ID, ACCEPTANCE_IDS } from './xmachines-fence-A17.manifest.mjs';
import { guardedCheck } from './xmachines-fence-helpers.mjs';

// Phase checkpoint A17 — safety decision fence.
// Scaffolding only (A0.2 must not implement product behavior): the routes
// below do not exist yet, so every check here is expected to REJECT until
// the owning slices (A1/A2/A4/A13/L7-audit) ship the real endpoints.

test(`xmachines fence ${FENCE_ID} — safety decision`, async ({ request }) => {
  const results: boolean[] = [];

  // L1e — fail-closed refusal returns "cannot confirm idle".
  results.push(await guardedCheck('L1e', 'A1', async () => {
    const res = await request.post('/api/xmachines/machines/gpu/power/off', {
      data: {},
      failOnStatusCode: false,
    });
    const body = await res.json().catch(() => ({}));
    if (!(res.status() >= 400 && String(body.reason || '').includes('cannot confirm idle'))) {
      throw new Error(`expected fail-closed "cannot confirm idle" refusal, got status=${res.status()} body=${JSON.stringify(body)}`);
    }
  }));

  // L2d — a guard-3 refusal is never rewritten into --force.
  results.push(await guardedCheck('L2d', 'A13', async () => {
    const res = await request.post('/api/xmachines/machines/gpu/power/off', {
      data: { force: true },
      failOnStatusCode: false,
    });
    const body = await res.json().catch(() => ({}));
    if (!(res.status() >= 400 && body.action !== 'force')) {
      throw new Error(`expected guard-3 refusal not rewritten into force, got status=${res.status()} body=${JSON.stringify(body)}`);
    }
  }));

  // L4a — gpu at .174 is protected while the signal role is live.
  results.push(await guardedCheck('L4a', 'A4', async () => {
    const res = await request.get('/api/xmachines/machines/gpu', { failOnStatusCode: false });
    const body = await res.json().catch(() => ({}));
    if (!(res.status() === 200 && body.protected === true)) {
      throw new Error(`expected gpu machine to report protected:true, got status=${res.status()} body=${JSON.stringify(body)}`);
    }
  }));

  // L7a — audit records the incoming power request.
  results.push(await guardedCheck('L7a', 'A8', async () => {
    const res = await request.get('/api/xmachines/audit?limit=1', { failOnStatusCode: false });
    const body = await res.json().catch(() => ({}));
    if (!(res.status() === 200 && Array.isArray(body.entries) && body.entries.length > 0)) {
      throw new Error(`expected at least one recorded audit entry, got status=${res.status()} body=${JSON.stringify(body)}`);
    }
  }));

  if (results.length !== ACCEPTANCE_IDS.length || results.some((ok) => !ok)) {
    throw new Error(`fence ${FENCE_ID}: one or more acceptance ids failed — see [FENCE-REJECT-V1] lines above`);
  }
});
