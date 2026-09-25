// Shared stdout-line protocol for xmachines phase-checkpoint journeys.
// A journey never authors its own verdict: it only emits one line per
// acceptance id it actually asserted (ACCEPT) or explicitly failed (REJECT,
// naming the contributing unit). e2e/run-xmachines-fence.mjs (the runner, a
// separate process) is the sole place that turns these observed lines into
// a verdict.

export const FENCE_STUB = process.env.FENCE_STUB || '';

// True only when this exact contributing unit is the one being disabled by
// the caller's negative control (FENCE_STUB=<unit>). Every other unit's
// checks run unaffected, so a stub only ever changes ONE acceptance id's
// outcome between an unstubbed and a stubbed run of the same journey.
export function stubbed(unit) {
  return FENCE_STUB !== '' && FENCE_STUB === unit;
}

export function acceptLine(id, via = 'host-state') {
  console.log(`[FENCE-ACCEPT-V1] id=${id} via=${via}`);
}

export function rejectLine(id, unit, reason) {
  console.log(`[FENCE-REJECT-V1] id=${id} unit=${unit} reason=${String(reason).replace(/\s+/g, ' ').slice(0, 300)}`);
}

// Runs `fn`; emits ACCEPT on success, REJECT (naming `unit`) on failure.
// If `unit` is the currently-stubbed contributor, `fn` is never called —
// the stub disables the CONTRIBUTING UNIT, not the assertion, so the
// journey observes a genuinely forced-out collaborator rather than
// short-circuiting its own check.
// Never throws — the caller decides how a rejection affects the overall
// test outcome, so one failed acceptance id does not prevent the rest of
// the fence's ids from being observed in the same run.
export async function guardedCheck(id, unit, fn, via = 'host-state') {
  try {
    if (stubbed(unit)) {
      throw new Error(`stub FENCE_STUB=${FENCE_STUB} disables contributing unit ${unit}`);
    }
    await fn();
    acceptLine(id, via);
    return true;
  } catch (error) {
    rejectLine(id, unit, error?.message || String(error));
    return false;
  }
}
