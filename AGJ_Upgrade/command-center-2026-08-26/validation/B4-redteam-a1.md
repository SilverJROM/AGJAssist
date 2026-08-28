# B4 Validator Red-Team A1

commit: 251129b762e17543c14e54be5f12db748dd2237e
verdict: standard-clean

Scope authority: A2 and A5 have no criterion text in the validator brief, so this pass uses the B4 scope text as the contract.

## Lens 1: bootstrap imports

Checked exact commit `src/index.ts` for the removed bootstrap imports: `OvermindService`, `OvermindWatcher`, `SonnetOvermindBrain`, `OvermindStreamManager`, and `POLL_MS`.

Result: clean. None of those imports remain in `src/index.ts`.

## Lens 2: bootstrap construction and startup side effects

Checked exact commit `src/index.ts` for `new OvermindService`, `new OvermindWatcher`, `new SonnetOvermindBrain`, `overmindWatcher.start()`, and the watcher startup log.

Result: clean. The bootstrap no longer constructs or starts the Overmind service/watcher path.

## Lens 3: API server injection from production bootstrap

Checked exact commit `src/index.ts` around `createApiServer(config, { ... })` for `overmindService`, `overmindNotify`, and `overmindStreamManager`.

Result: clean. The production bootstrap no longer injects those Overmind fields into the API server.

## Lens 4: scope-boundary ambiguity

`OvmSessionService` remains in `src/index.ts`, including `overmindToken` configuration and `ovmSessionService` injection. The B4 diff supplied by the driver leaves those lines as context, and adjacent plan rows assign bot `/ovm_*` command removal to B5 and dead OVM cleanup to G1. I am therefore treating B4's "no OVM wiring" phrase as scoped to the explicitly named Overmind service/watcher/API injection mechanism, not as a request to remove `OvmSessionService` in this slice.

Result: clean within B4 scope.

## Test

Focused command passed:

`npx vitest run tests/overmind-removal-bootstrap.test.ts --minWorkers=1 --maxWorkers=4`
