F1  CRITICAL  Force is a single-token remote kill switch
  WHERE:       D3, H1, I5
  MECHANISM:   `--force` can bypass active lease, GPU-busy, and not-woken-by-xmac—the three protections preventing workload loss and an unrecoverable remote shutdown. A browser confirm is client-side friction, not authorization; a stolen owner JWT can call the endpoint directly.
  FIX:         Decide whether force is permitted from the web at all. If retained, require recent step-up authentication, a single-use expiring challenge bound to machine/action, typed hostname and reason, explicit display of each bypassed guard, and a policy identifying non-bypassable guards. Block force when recovery is unverified unless physical-recovery risk is explicitly acknowledged.

F2  CRITICAL  The interview never established the acceptable force boundary
  WHERE:       Interview, D3, I5, Out-of-scope xmac semantics
  MECHANISM:   “Everything” and “owner-only” do not answer whether a public-tunnel UI may bypass leases, active compute, dependency protection, or WoL recoverability. Planning would silently make the highest-risk product decision.
  FIX:         Ask JROM one explicit decision before planning: no UI force, or UI force with an enumerated bypassable/non-bypassable guard list, step-up method, required warning, and acceptable physical-rescue/workload-loss risk.

F3  CRITICAL  Critical-service and data dependencies are outside every shutdown guard
  WHERE:       C4, D2, D3, effort north-star “glimmer/signal”
  MECHANISM:   xmac’s known guards cover leases, detected busy processes, and wake provenance—not the fleet dependency graph. An idle glimmer/signal service, an unleased agent, storage clients of `.169`, database writes, mounts, or another AGJAssist dependency can be destroyed while all three guards are green.
  FIX:         Inventory dependencies for each machine and define shutdown policy. Show impacted services/clients in the confirmation; require dependable lease adoption for jobs; add non-bypassable protection or an explicit maintenance-mode exception for critical dependencies and active storage consumers.

F4  CRITICAL  Passive polling is not guaranteed by ping-gating
  WHERE:       F3, D2, F2
  MECHANISM:   Ping followed by an auto-waking wrapper is a TOCTOU race: the box can go down after ping and be awakened by the subsequent command. The exact telemetry command path is unspecified, and the browser poller, sampler, detail view, alerts, SMART, and UPS paths could each implement it differently.
  FIX:         Define one read-only collector path that is structurally incapable of emitting WoL and never invokes `xmac run` or another auto-waking action. Route every collector through it. Test each entry point with a gateway spy proving zero wake calls, plus a DOWN-box observation across a full sampler cycle.

F5  HIGH  CSRF, replay, and stolen-token controls are missing
  WHERE:       A2, D1-D3, H1
  MECHANISM:   “Owner JWT” and “localhost-origin-aware” do not specify cookie versus bearer transport, SameSite behavior, Origin validation through the tunnel, token lifetime/revocation, replay resistance, or XSS exposure. A valid stolen token apparently grants repeated force operations.
  FIX:         Specify POST-only mutations, strict external Host/Origin allowlists, CSRF protection appropriate to the JWT transport, secure cookie/CSP rules, short-lived and revocable sessions, recent-auth requirements, and single-use action challenges. Add tests for missing/foreign Origin, replay, expired/revoked token, and stolen ordinary session attempting force.

F6  HIGH  “Localhost-origin-aware” is undefined behind the public tunnel
  WHERE:       H1
  MECHANISM:   The backend may see the tunnel as a localhost peer while the browser Origin is public. Treating peer address, `X-Forwarded-*`, or “localhost” as trust can either reject legitimate traffic or let forged proxy headers bypass checks.
  FIX:         Specify loopback binding, the exact trusted proxy hop, canonical public origin/host, which forwarded headers are trusted, and rejection of direct or forged-host requests. Verify with requests through and outside the tunnel path.

F7  HIGH  Shelling to xmac lacks an execution-security contract
  WHERE:       Foundational decision, D1-D3, H1
  MECHANISM:   Machine names, action names, force flags, paths, environment, output, and timeouts cross a shell boundary. Without an exact contract, command injection, PATH substitution, wrong `$HOME`, hung children, output exhaustion, or execution as an overprivileged pm2 user remain possible.
  FIX:         Require an absolute gateway path; fixed allowlisted machine/action mappings; argv-based execution without a shell; minimal environment; bounded stdout/stderr; hard timeout and process-tree cancellation; SSH host-key verification; least-privilege service permissions; and tests proving arbitrary names/flags cannot reach argv.

F8  HIGH  UI guard state is stale and cannot be the safety boundary
  WHERE:       C4, D2
  MECHANISM:   Busy/lease information is a poll-time snapshot. A job can start after the UI enables OFF, or finish after it disables OFF. Conversely, hiding or disabling the button does not protect the backend endpoint.
  FIX:         Every OFF request must invoke xmac’s guards at execution time and use its exit status as authoritative. Return structured per-guard results, update the UI from that result, and test state changes between display and click. Require workloads to acquire leases before becoming destructive-to-interrupt.

F9  HIGH  Concurrent actions can cause wake storms and contradictory commands
  WHERE:       D1-D3, F1-F2
  MECHANISM:   Multiple tabs, retries, double taps, alerts, or replay can issue repeated WoL packets or overlapping ON/OFF/FORCE operations. No action serialization, idempotency, or cooldown is required.
  FIX:         Add a server-side per-machine mutex/state machine, idempotency keys, duplicate-request coalescing, bounded retry/cooldown, per-owner and global action rate limits, and conflict responses. Test double-click, two tabs, timeout retry, ON-during-OFF, and OFF-during-ON.

F10  HIGH  “UP/DOWN” and successful power actions have no trustworthy oracle
  WHERE:       B1, D1, D2, I1
  MECHANISM:   Ping failure can mean host down, network failure, firewall, suspend, or booting. Ping success does not prove telemetry or service readiness. A clicked button, zero exit code, or UI state change does not prove physical transition.
  FIX:         Define `DOWN`, `STARTING`, `UP`, `DEGRADED`, `STOPPING`, `UNREACHABLE`, and `ERROR`, with timeouts. Success must combine gateway outcome with repeated independent reachability/readiness observations over a defined interval; timeout must become an explicit failure, not DOWN.

F11  HIGH  Audit requirements omit denied attempts and actual outcomes
  WHERE:       D3, D4, H1
  MECHANISM:   “Every power action” could mean only accepted commands. An audit row may be written before execution and still imply success, omit bypassed guards, or be editable with ordinary application data.
  FIX:         Audit request, authorization result, pre-action state, guard results, force reason, exact allowlisted target/action, gateway exit status, observed final state, actor/session ID, request ID, source, and timestamps. Include denied/replayed/rate-limited attempts. Make records append-only and show pending/succeeded/failed—not merely “command issued.”

F12  HIGH  Local verification can accidentally control the production fleet
  WHERE:       K1, D1-D3
  MECHANISM:   A local `:3101` instance may inherit the real registry, owner token, SSH credentials, and xmac path. Playwright exercising OFF/FORCE could therefore shut down live `.174`, `.179`, `.182`, or `.169` even though production AGJAssist was not restarted.
  FIX:         Local/test mode must default to a non-actuating fake gateway and synthetic telemetry, with real control impossible without an explicit server-side arm configuration. Any physical E2E test needs a named sacrificial target, maintenance approval, workload/lease check, recovery plan, and restoration evidence.

F13  HIGH  J1 does not prevent shared-mock false-greens
  WHERE:       J1
  MECHANISM:   Signal and a fence can both consume the same canned fixture or mock and agree on the same wrong behavior. Tests can pass while the production parser fails, the wrong machine is addressed, polling invokes wake, auth is absent, or xmac failure is displayed as success.
  FIX:         Mandate independent-oracle fences for: zero actuation on unauthorized requests; zero wake calls from every polling path; exact allowlisted gateway argv; all three guard refusals; partial/hung telemetry; idempotency/concurrency; audit outcome; stable state transition; and UI values compared with an independently captured live/contract fixture. Require mutation cases for each invariant.

F14  HIGH  A real power-off fence is undefined and potentially unsafe
  WHERE:       D1, D2, J1, K1
  MECHANISM:   “Power action reflected in xmac” can pass by asserting invocation, while “box went down” can mistake packet loss for shutdown. Running the stronger test against working fleet machines can destroy live work.
  FIX:         Provide a controlled xmac simulator for routine fences and a separately approved physical acceptance procedure. The physical oracle must record preconditions, gateway result, stable loss of reachability, later successful cold wake/readiness, and restored service—not merely a click, mock call, or single failed ping.

F15  HIGH  Self-detection has no partial-failure model
  WHERE:       C1, E1
  MECHANISM:   `nvidia-smi` can be absent, permission-denied, hung, return `N/A`, report a lost GPU, or supply only some fields. The criteria allow implementations to collapse these into “no GPU,” zero, or stale-good data.
  FIX:         Define collector deadlines and per-field nullable status. Distinguish `no NVIDIA GPU`, `tool unavailable`, `driver error`, `timeout`, `device lost`, `unsupported field`, and `stale last-known`. Show these states in the UI and test each independently.

F16  HIGH  GPU churn can corrupt rows and history
  WHERE:       C1, E1, F4
  MECHANISM:   Separate `nvidia-smi -L` and metrics calls can observe different inventories mid-poll. Index-based rows make a removed or reordered card inherit another card’s name and historical series.
  FIX:         Key GPUs by stable UUID, attach all fields to that identity, timestamp a coherent sample, reconcile additions/removals atomically, and preserve removed-device history as retired. Test add, remove, reorder, and disappearance between discovery and metrics collection.

F17  MED  “Self-detect” is NVIDIA-only but its supported boundary is unstated
  WHERE:       E1, north-star D3
  MECHANISM:   `nvidia-smi` cannot detect AMD/Intel accelerators, and a new NVIDIA card may still require a supported driver. “No code or config change” is therefore not universally true.
  FIX:         Either state “supported NVIDIA GPUs visible to the installed driver” explicitly, or define a provider interface with NVIDIA/AMD/Intel discovery and an `unsupported accelerator detected` state. Do not represent an unsupported vendor as GPU-free.

F18  MED  Sensor absence is conflated with sensor failure
  WHERE:       C2, E2, I1
  MECHANISM:   An empty `sensors` result can mean no exposed fan, missing command, permission failure, parser drift, module failure, or timeout. “Absent gracefully” could hide broken monitoring, and fan-fail alerts cannot distinguish stopped fans from unavailable sensors.
  FIX:         Model `not exposed`, `unsupported`, `collector failed`, and measured values separately. Define stable sensor identity, label normalization, Tctl/Tdie selection, RPM-zero semantics, stale handling, and which exposed fans are expected to spin.

F19  HIGH  Uptime and total on-hours are not derivable as claimed
  WHERE:       C3, I4
  MECHANISM:   `xmac.log` cannot establish a power-session when a machine was manually booted, rebooted without WoL, logs rotated, or the app started observing late. Thirty-minute samples cannot reconstruct historical total on-hours exactly.
  FIX:         Define power-session as known/unknown with provenance. Persist observed state transitions prospectively, label sampled on-hours as estimated, define gap/restart behavior, and never infer “since xmac wake” unless a matching wake and current boot identity are proven.

F20  MED  Telemetry freshness and stale-value behavior are missing
  WHERE:       B1-B3, C1-C4, F1-F4
  MECHANISM:   A last-good temperature or power value can remain visible after the collector fails or the machine goes down, creating a false healthy state. Aggregate semantics are also undefined.
  FIX:         Show sample timestamp/age and provenance per machine; impose stale/expired thresholds; clear or visibly gray expired live readings; retain historical values only in history; and define aggregates explicitly, such as maximum GPU temperature and sum of measured GPU watts.

F21  MED  Sampler scheduling and lifecycle are underspecified
  WHERE:       F2
  MECHANISM:   A naïve interval can overlap hung polls, duplicate jobs after reload/cluster startup, drift indefinitely, or write duplicate samples. It also has no retention, backfill, or restart behavior.
  FIX:         Require single-leader scheduling, no-overlap locking, per-host deadlines, deterministic sample buckets, uniqueness/idempotency, restart recovery, retention/downsampling limits, and sampler health/last-run visibility.

F22  MED  Alert acceptance is non-deterministic
  WHERE:       B2, I1
  MECHANISM:   Thermal thresholds, warning/critical hysteresis, fan-fail rules, wake deadline/retry count, dedupe key/window, recovery messages, and delivery-failure behavior are unspecified. Almost any alert implementation could pass.
  FIX:         Define per-signal thresholds and hysteresis, minimum persistence, `won’t-wake` deadline, dedupe and re-notify windows, recovery notification, missing-sensor treatment, Telegram delivery result, and an alert history visible to the owner.

F23  HIGH  SMART and NUT requirements silently require privileged, hardware-specific access
  WHERE:       I2, I3, H1
  MECHANISM:   SMART may require root capabilities and controller-specific commands; filesystem free space is not per physical disk. NUT may be absent, remote, or permission-restricted. “Where a source exists” is vacuous and can pass by finding none.
  FIX:         Record the expected disks/controllers/mounts and NUT endpoint per host; define least-privilege read commands, timeouts, unsupported/unavailable UI states, RAID/NVMe handling, and explicit expected-present versus expected-absent acceptance cases.

F24  MED  Power and cost estimates are not reproducible
  WHERE:       B3, G1, G2, I4
  MECHANISM:   No per-box baseline, PSU-efficiency curve, CPU-power source, uncertainty, tariff, currency, timezone, or integration rule is defined. A visually prefixed `~` can mask an arbitrary number.
  FIX:         Version the estimation formula and calibration inputs; expose provenance and assumptions in the UI; define behavior when CPU power is unavailable; label uncertainty; and specify kWh integration across DOWN/unknown gaps plus tariff, currency, and effective dates.

F25  HIGH  The “UI-provable” claim is false for multiple criteria
  WHERE:       A1-A2, C3-C4, D1-D4, E1, F1-F3, G1-G2, H1-H2, I1, I3, I5, J1, K1-K2, Promotion Cleanup
  MECHANISM:   The running UI cannot prove `KNOWN_EXACT`, middleware on every route, physical power state, xmac/log provenance, DB writes, no hidden wake call, source formulas, schema additivity, future metering replacement, Telegram receipt, branch/deploy history, pm2 uptime causality, socket absence, mutation-test behavior, or filesystem cleanup.
  FIX:         Split evidence classes: UI screenshots for rendering; HTTP auth/Origin matrices for routes; gateway spy plus independent host oracle for power/passivity; CLI-to-UI comparisons for telemetry; DB/schema checks for persistence; Telegram receipt for alerts; Git/socket/pm2 evidence for delivery; mutation reports for J1; and an allowlisted cleanup manifest with before/after bytes.

F26  HIGH  Several criteria are bundles that can pass partially
  WHERE:       A1-A2, B1, C1-C4, D2-D4, F1-F2, G1-G2, I1-I5, J1, K1-K2
  MECHANISM:   Examples: A1 combines two shells, a tile, routing, and deployment topology; C3 combines three clocks plus cost input; D2 combines three guards, disabled UI, reason text, and real busy workload; I2 combines SMART, disk temperatures, and filesystem capacity. One green result can conceal failed siblings.
  FIX:         Split each behavior into atomic IDs with one observable each—for example D2a lease, D2b GPU-busy, D2c wake provenance, D2d execution-time recheck, D2e rendered reason. Require the matrix and fences to report every child independently.

F27  MED  WoL-safe is informational when it needs a defined safety effect
  WHERE:       I5, D2-D3
  MECHANISM:   “Cold-wake verified?” has no method, timestamp, expiry, or consequence. A stale green indicator can survive NIC/BIOS/network changes, and force can ignore the not-woken guard.
  FIX:         Define how cold-wake is verified, record last successful test and boot identity, set an expiry, show stale/unknown distinctly, and decide whether false/stale blocks ordinary OFF and/or force.

F28  HIGH  The gateway contract is assumed rather than accepted
  WHERE:       Foundational decision, C4, D1-D4, Out-of-scope xmac changes
  MECHANISM:   Requirements assume pm2 can execute the stated path, parse guard reasons, attribute logs, distinguish outcomes, and safely use `--force`. No versioned exit-code/output contract is stated. The blanket ban on xmac changes may prevent structured errors, idempotency, or security hardening needed by this feature.
  FIX:         Add a pre-planning xmac contract probe covering service-user permissions, exact subcommands/argv, exit codes, stdout/stderr, timeout behavior, guard ordering, log location/format, concurrent calls, and force semantics. Permit a separately reviewed xmac hardening change if the contract lacks a required safety property.

F29  HIGH  Unverified assumptions are presented as implementation facts
  WHERE:       C3-C4, G1-G2, I1-I5, K1
  MECHANISM:   Not established by the supplied ground truth: xmac logs are sufficient for power-session/on-hours; every workload holds a lease; busy-check covers glimmer/signal and non-GPU work; pm2 can read logs/SSH/sensors/SMART/NUT; CPU package power exists; baseline/PSU values are credible; NUT exists; cold wake has been tested; audit and notify paths expose the required contracts.
  FIX:         Before planning, create a per-host capability/evidence table with `VERIFIED`, `ABSENT`, or `UNKNOWN`, including probe command, service identity, timestamp, raw result, and fallback UI. No `UNKNOWN` capability may silently become a green acceptance result.

TOP-3 MUST-FIX: F1/F2 force-policy and step-up boundary; F3 dependency-aware shutdown protection; F4 passive collection structurally incapable of waking a machine.

MISSING-ENTIRELY: Explicit threat model; force-policy decision; dependency/critical-service inventory; per-machine action state machine and rate limits; local-test actuation isolation; versioned xmac CLI contract; telemetry failure/staleness model; stable device identity; independent physical power oracle; per-route negative authorization matrix; history retention/sampler-health policy; recovery/rollback procedure after failed shutdown or failed wake.
