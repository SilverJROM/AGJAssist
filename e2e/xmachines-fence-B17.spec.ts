import { test } from '@playwright/test';
import { FENCE_ID, ACCEPTANCE_IDS } from './xmachines-fence-B17.manifest.mjs';
import { guardedCheck } from './xmachines-fence-helpers.mjs';

// ---------------------------------------------------------------------------
// Fence B17 — INTEGRATION: sampled reading. One bounded poll discovers the GPU
// inventory, the value it produces is visibly marked as measured rather than
// assumed, and a persisted threshold breach becomes one alert.
// Contributors: B2, B4, B11.
//
// THIS JOURNEY IS AUTHORED RED ON PURPOSE. It defines what would prove B17; it
// implements none of it and contains no product code. It is red today because
// B2/B4/B11 have not landed: the app serves no xmachines GPU poll record, the
// GPU view marks nothing as measured, and there is no alerts read path at all.
//
// ONE SEPARATELY-NAMED TEST PER CONTRIBUTOR, so a red CLOSE can name WHICH
// contributor broke composition in `failing_units`. A single test asserting all
// three ids is unattributable — the validator would have to answer
// fault_class=plan failing_units=(none) and the fence could never requeue.
//   test_b2_...   E1a — one bounded nvidia-smi query discovers the inventory
//   test_b4_...   B3a — a measured value is visibly marked measured
//   test_b11_...  I1a — a persisted threshold breach creates one alert
//
// Every assertion below is carried over unchanged from the single-test version
// of this file; nothing was dropped and no condition was relaxed. The only
// edits are (a) the split itself, and (b) the origin now resolves to the app's
// own port so each check reaches a real HTTP server and fails on a real
// response instead of on connect ECONNREFUSED (a connect error is red for the
// wrong reason — env, not capability).
// ---------------------------------------------------------------------------

// The app's canonical local port, matching fence A17. The default Playwright
// baseURL (3210) has nothing listening, so a journey left on it would go red on
// connect rather than on the capability. FENCE_ORIGIN overrides for a deployed
// target.
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
// single-test version's `results.length !== ACCEPTANCE_IDS.length` check, which
// no one test can make on its own any more.
const COVERED: Record<string, string> = { E1a: 'B2', B3a: 'B4', I1a: 'B11' };
test('test_split_covers_every_acceptance_id_exactly_once', async () => {
  const covered = Object.keys(COVERED).sort();
  const expected = [...ACCEPTANCE_IDS].sort();
  if (JSON.stringify(covered) !== JSON.stringify(expected)) {
    throw new Error(`fence ${FENCE_ID}: per-contributor tests cover ${JSON.stringify(covered)}, contract acceptance_ids are ${JSON.stringify(expected)}`);
  }
});

// ---------------------------------------------------------------------------
// B2 — the bounded nvidia-smi poll behind the GPU inventory read path.
// Owns: E1a
// ---------------------------------------------------------------------------
test('test_b2_bounded_poll_discovers_the_current_gpu_inventory_at_poll_time', async ({ request }) => {
  const results: boolean[] = [];

  // E1a — one bounded nvidia-smi query discovers the current GPU inventory at poll time.
  results.push(await guardedCheck('E1a', 'B2', async () => {
    const res = await request.get(url('/api/xmachines/machines/gpu'), { failOnStatusCode: false });
    const body = await res.json().catch(() => ({}));
    if (!(res.status() === 200 && body.uuid && body.polled_at)) {
      throw new Error(`expected a polled GPU inventory record, got status=${res.status()} body=${JSON.stringify(body)}`);
    }
  }));

  finish('B17/B2', results, 1);
});

// ---------------------------------------------------------------------------
// B4 — the provenance marking in the GPU view.
// Owns: B3a
// ---------------------------------------------------------------------------
test('test_b4_a_measured_value_is_visibly_marked_measured', async ({ page }) => {
  const results: boolean[] = [];

  // B3a — a measured value is visibly marked measured.
  results.push(await guardedCheck('B3a', 'B4', async () => {
    await page.goto(url('/#/xmachines/gpu'), { waitUntil: 'domcontentloaded' });
    const marker = page.locator('[data-provenance="measured"]').first();
    await marker.waitFor({ state: 'visible', timeout: 5000 });
  }));

  finish('B17/B4', results, 1);
});

// ---------------------------------------------------------------------------
// B11 — the persisted threshold-breach alert store and its read path.
// Owns: I1a
// ---------------------------------------------------------------------------
test('test_b11_a_persisted_thermal_threshold_breach_creates_one_alert', async ({ request }) => {
  const results: boolean[] = [];

  // I1a — a persisted thermal threshold breach creates one alert.
  results.push(await guardedCheck('I1a', 'B11', async () => {
    const res = await request.get(url('/api/xmachines/alerts?limit=1'), { failOnStatusCode: false });
    const body = await res.json().catch(() => ({}));
    if (!(res.status() === 200 && Array.isArray(body.alerts))) {
      throw new Error(`expected an alerts list, got status=${res.status()} body=${JSON.stringify(body)}`);
    }
  }));

  finish('B17/B11', results, 1);
});
