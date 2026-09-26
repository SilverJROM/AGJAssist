import { test } from '@playwright/test';
import { FENCE_ID, ACCEPTANCE_IDS } from './xmachines-fence-C9.manifest.mjs';
import { guardedCheck } from './xmachines-fence-helpers.mjs';

// ---------------------------------------------------------------------------
// Fence C9 — INTEGRATION: one power POST is composed by the idempotency-key
// gate, the WoL-safe staleness router and the separate full-force action.
// Contributors: C3, C4, C5.
//
// THIS JOURNEY IS AUTHORED RED ON PURPOSE. It defines what would prove C9; it
// implements none of it and contains no product code. It is red today because
// C3/C4/C5 have not landed: the app serves no power POST at all
// (POST /api/xmachines/machines/:name/power/off and .../power/force both
// answer 404), so there is no idempotency gate to refuse a keyless request,
// no force-challenge route for a stale WoL-safe Off, and no dedicated force
// action distinct from Off. It goes green, unchanged, the moment those land.
//
// ONE SEPARATELY-NAMED TEST PER CONTRIBUTOR, so a red CLOSE can name WHICH
// contributor broke composition in `failing_units`. A single test asserting
// all three ids is unattributable — the validator would have to answer
// fault_class=plan failing_units=(none) and the fence could never requeue.
//   test_c3_...  L15b — every power POST requires an idempotency key
//   test_c4_...  I5c  — stale/never-verified WoL-safe Off routes to force challenge
//   test_c5_...  L3a  — full force is a separate action from normal Off
//
// Every assertion below is carried over unchanged from the single-test version
// of this file; nothing was dropped and no condition was relaxed. The only
// edits are (a) the split itself, and (b) the origin now resolves to the app's
// own port so each check reaches a real HTTP server and fails on a real
// response instead of on connect ECONNREFUSED (a connect error is red for the
// wrong reason — env, not capability), matching fence A17.
// ---------------------------------------------------------------------------

// The app's canonical local port. The xmachines routes hard-refuse any other
// Host (`host_not_allowed`), so a fence pointed elsewhere could never observe
// a decision at all. FENCE_ORIGIN overrides for a deployed target.
const ORIGIN = (process.env.FENCE_ORIGIN || 'http://127.0.0.1:3101').replace(/\/$/, '');
const url = (p: string) => `${ORIGIN}${p}`;

function finish(fenceTest: string, results: boolean[], expected: number): void {
  if (results.length !== expected) {
    throw new Error(`${fenceTest}: expected ${expected} acceptance checks, ran ${results.length}`);
  }
  if (results.some((ok) => !ok)) {
    throw new Error(`${fenceTest}: one or more acceptance ids failed — see the [FENCE-REJECT-V1] lines above`);
  }
}

// Structural guard on the split itself: the three per-contributor tests below
// must between them cover exactly the row's acceptance ids. Kept from the
// single-test version's `results.length !== ACCEPTANCE_IDS.length` check,
// which no one test can make on its own any more.
const COVERED: Record<string, string> = { L15b: 'C3', I5c: 'C4', L3a: 'C5' };
test('test_split_covers_every_acceptance_id_exactly_once', async () => {
  const covered = Object.keys(COVERED).sort();
  const expected = [...ACCEPTANCE_IDS].sort();
  if (JSON.stringify(covered) !== JSON.stringify(expected)) {
    throw new Error(`fence ${FENCE_ID}: per-contributor tests cover ${JSON.stringify(covered)}, contract acceptance_ids are ${JSON.stringify(expected)}`);
  }
});

// ---------------------------------------------------------------------------
// C3 — the power POST idempotency-key gate.
// Owns: L15b
// ---------------------------------------------------------------------------
test('test_c3_power_post_without_an_idempotency_key_is_refused', async ({ request }) => {
  const results: boolean[] = [];

  // L15b — every power POST requires an idempotency key.
  results.push(await guardedCheck('L15b', 'C3', async () => {
    const res = await request.post(url('/api/xmachines/machines/gpu/power/off'), {
      data: {},
      failOnStatusCode: false,
    });
    if (!(res.status() === 400 || res.status() === 428)) {
      throw new Error(`expected a request without an Idempotency-Key to be refused, got status=${res.status()}`);
    }
  }));

  finish('C9/C3', results, 1);
});

// ---------------------------------------------------------------------------
// C4 — the WoL-safe staleness router on Off.
// Owns: I5c
// ---------------------------------------------------------------------------
test('test_c4_stale_wol_safe_off_routes_through_the_force_challenge', async ({ request }) => {
  const results: boolean[] = [];

  // I5c — a stale or never-verified WoL-safe state routes Off through the force challenge.
  results.push(await guardedCheck('I5c', 'C4', async () => {
    const res = await request.post(url('/api/xmachines/machines/gpu/power/off'), {
      data: {},
      headers: { 'idempotency-key': 'xmachines-fence-c9-i5c', 'x-fence-stub': 'stale-wol' },
      failOnStatusCode: false,
    });
    const body = await res.json().catch(() => ({}));
    if (!(res.status() >= 400 && String(body.route || '').includes('force-challenge'))) {
      throw new Error(`expected stale WoL-safe Off to route through a force challenge, got status=${res.status()} body=${JSON.stringify(body)}`);
    }
  }));

  finish('C9/C4', results, 1);
});

// ---------------------------------------------------------------------------
// C5 — full force as its own action, distinguishable from Off.
// Owns: L3a
// ---------------------------------------------------------------------------
test('test_c5_full_force_is_a_separate_action_from_normal_off', async ({ request }) => {
  const results: boolean[] = [];

  // L3a — full force is a separate action from normal Off.
  results.push(await guardedCheck('L3a', 'C5', async () => {
    const offRes = await request.post(url('/api/xmachines/machines/gpu/power/off'), {
      data: {},
      headers: { 'idempotency-key': 'xmachines-fence-c9-l3a-off' },
      failOnStatusCode: false,
    });
    const forceRes = await request.post(url('/api/xmachines/machines/gpu/power/force'), {
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

  finish('C9/C5', results, 1);
});
