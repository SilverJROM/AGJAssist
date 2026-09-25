// Shared stdout-line protocol for xmachines phase-checkpoint journeys.
// A journey never authors its own verdict: it only emits one line per
// acceptance id it actually asserted (ACCEPT) or explicitly failed (REJECT).
// e2e/run-xmachines-fence.mjs (the runner, a separate process) is the sole
// place that turns these observed lines into a verdict.

export function acceptLine(id, via = 'host-state') {
  console.log(`[FENCE-ACCEPT-V1] id=${id} via=${via}`);
}

export function rejectLine(id, reason) {
  console.log(`[FENCE-REJECT-V1] id=${id} reason=${String(reason).replace(/\s+/g, ' ').slice(0, 300)}`);
}

// Runs `fn`; emits ACCEPT on success, REJECT on failure. Never throws — the
// caller decides how a rejection affects the overall test outcome, so one
// failed acceptance id does not prevent the rest of the fence's ids from
// being observed in the same run.
export async function guardedCheck(id, fn, via = 'host-state') {
  try {
    await fn();
    acceptLine(id, via);
    return true;
  } catch (error) {
    rejectLine(id, error?.message || String(error));
    return false;
  }
}
