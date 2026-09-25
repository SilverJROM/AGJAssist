import { test } from '@playwright/test';
import { FENCE_ID, ACCEPTANCE_IDS } from './xmachines-fence-A17.manifest.mjs';
import { guardedCheck } from './xmachines-fence-helpers.mjs';

// ---------------------------------------------------------------------------
// Fence A17 — INTEGRATION: one OFF decision consults the busy preflight, the
// protected-role denylist, the owner-off flag and the audit schema before any
// spawn. Contributors: A1, A4, A13, A8.
//
// THIS JOURNEY IS AUTHORED RED ON PURPOSE. It defines what would prove A17; it
// implements none of it and contains no product code. It is red today because
// A1/A4/A13/A8 have not landed: the app serves no xmachines OFF decision that
// can fail closed, no machine row that reports its protected role, and no
// power-audit read path at all.
//
// ONE SEPARATELY-NAMED TEST PER CONTRIBUTOR, so a red CLOSE can name WHICH
// contributor broke composition in `failing_units`. A single test asserting
// all four ids is unattributable — the validator would have to answer
// fault_class=plan failing_units=(none) and the fence could never requeue.
//   test_a1_...   L1e — fail-closed refusal returns "cannot confirm idle"
//   test_a13_...  L2d — a guard-3 refusal is never rewritten into --force
//   test_a4_...   L4a — gpu at .174 is protected while the signal role is live
//   test_a8_...   L7a — audit records the incoming power request
//
// Every assertion below is carried over unchanged from the single-test version
// of this file; nothing was dropped and no condition was relaxed. The only
// edits are (a) the split itself, (b) the origin now resolves to the app's own
// port so each check reaches a real HTTP server and fails on a real response
// instead of on connect ECONNREFUSED (a connect error is red for the wrong
// reason — env, not capability), and (c) L4a also accepts the `{ machine: … }`
// envelope the machines route already returns, which broadens where
// `protected:true` may appear without weakening what must be true.
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

// Structural guard on the split itself: the four per-contributor tests below
// must between them cover exactly the row's acceptance ids. Kept from the
// single-test version's `results.length !== ACCEPTANCE_IDS.length` check,
// which no one test can make on its own any more.
const COVERED: Record<string, string> = { L1e: 'A1', L2d: 'A13', L4a: 'A4', L7a: 'A8' };
test('test_split_covers_every_acceptance_id_exactly_once', async () => {
  const covered = Object.keys(COVERED).sort();
  const expected = [...ACCEPTANCE_IDS].sort();
  if (JSON.stringify(covered) !== JSON.stringify(expected)) {
    throw new Error(`fence ${FENCE_ID}: per-contributor tests cover ${JSON.stringify(covered)}, contract acceptance_ids are ${JSON.stringify(expected)}`);
  }
});

// ---------------------------------------------------------------------------
// A1 — the app-side fail-closed busy preflight.
// Owns: L1e
// ---------------------------------------------------------------------------
test('test_a1_off_fails_closed_with_cannot_confirm_idle_when_busy_is_unprovable', async ({ request }) => {
  const results: boolean[] = [];

  // L1e — fail-closed refusal returns "cannot confirm idle".
  results.push(await guardedCheck('L1e', 'A1', async () => {
    const res = await request.post(url('/api/xmachines/machines/gpu/power/off'), {
      data: {},
      failOnStatusCode: false,
    });
    const body = await res.json().catch(() => ({}));
    if (!(res.status() >= 400 && String(body.reason || '').includes('cannot confirm idle'))) {
      throw new Error(`expected fail-closed "cannot confirm idle" refusal, got status=${res.status()} body=${JSON.stringify(body)}`);
    }
  }));

  finish('A17/A1', results, 1);
});

// ---------------------------------------------------------------------------
// A13 — `xmac down <name> --owner-off`: guard 3 is skipped, never forced.
// Owns: L2d
// ---------------------------------------------------------------------------
test('test_a13_guard3_refusal_is_never_rewritten_into_force', async ({ request }) => {
  const results: boolean[] = [];

  // L2d — a guard-3 refusal is never rewritten into --force.
  results.push(await guardedCheck('L2d', 'A13', async () => {
    const res = await request.post(url('/api/xmachines/machines/gpu/power/off'), {
      data: { force: true },
      failOnStatusCode: false,
    });
    const body = await res.json().catch(() => ({}));
    if (!(res.status() >= 400 && body.action !== 'force')) {
      throw new Error(`expected guard-3 refusal not rewritten into force, got status=${res.status()} body=${JSON.stringify(body)}`);
    }
  }));

  finish('A17/A13', results, 1);
});

// ---------------------------------------------------------------------------
// A4 — the dynamic protected-role resolver (.174 / .179 hard-refused).
// Owns: L4a
// ---------------------------------------------------------------------------
test('test_a4_gpu_at_174_reports_protected_while_the_signal_role_is_live', async ({ request }) => {
  const results: boolean[] = [];

  // L4a — gpu at .174 is protected while the signal role is live.
  results.push(await guardedCheck('L4a', 'A4', async () => {
    const res = await request.get(url('/api/xmachines/machines/gpu'), { failOnStatusCode: false });
    const body = await res.json().catch(() => ({}));
    const isProtected = body.protected === true || body.machine?.protected === true;
    if (!(res.status() === 200 && isProtected)) {
      throw new Error(`expected gpu machine to report protected:true, got status=${res.status()} body=${JSON.stringify(body)}`);
    }
  }));

  finish('A17/A4', results, 1);
});

// ---------------------------------------------------------------------------
// A8 — the append-only power audit.
// Owns: L7a
// ---------------------------------------------------------------------------
test('test_a8_audit_records_the_incoming_power_request', async ({ request }) => {
  const results: boolean[] = [];

  // L7a — audit records the incoming power request.
  results.push(await guardedCheck('L7a', 'A8', async () => {
    const res = await request.get(url('/api/xmachines/audit?limit=1'), { failOnStatusCode: false });
    const body = await res.json().catch(() => ({}));
    if (!(res.status() === 200 && Array.isArray(body.entries) && body.entries.length > 0)) {
      throw new Error(`expected at least one recorded audit entry, got status=${res.status()} body=${JSON.stringify(body)}`);
    }
  }));

  finish('A17/A8', results, 1);
});
