I'll attack the requirements against the real app and `xmac` gateway, not the write-up. First I'm reading the effort docs and the power-control and auth paths they depend on.The ordinary Off control is already dead on three of the four boxes, `--force` skips the only guards that still hold, and the test plan cannot see either fact.

```
F1  CRITICAL  Busy-check fail-open plus --force makes a phone confirm enough to cut a live GPU
  WHERE:       D2, D3; "Out of scope — any change to xmac's power semantics"
  MECHANISM:   xmac's guard 2 is `rsh` of the busy snippet with stderr discarded. A timeout, a hung `nvidia-smi`, or any ssh failure yields empty stdout, and empty means idle (`xmac.sh` cmd_down). Guard 3 is already satisfied for `gpu`: `~/.xmac/woke-by-xmac/gpu` has been set since 2026-09-17. So a wedged driver on the one box where normal Off is allowed falls through to `sudo poweroff`. `--force` skips lease, busy, and guard 3 together. D3 puts that flag behind a browser confirm. The out-of-scope line freezes the fail-open in place.
  FIX:         App preflight is fail-closed and is the only thing allowed to invoke `xmac down`: run the busy snippet with a timeout; non-zero, timeout, or unreadable ssh means "busy" and the app does not call down. `--force` is a separate request the server accepts only after F3's challenge, and the confirm text is the probe's stdout (pid, process, lease holder). Narrow the out-of-scope bullet so this wrapper is in scope.

F2  CRITICAL  Guard 3 makes --force the steady-state Off for every box except gpu
  WHERE:       D2 (not-woken-by-xmac), D3
  MECHANISM:   Today the WOKE directory contains only `gpu`. `gpu2` and `media` have no flag. `hdd`'s flag is deleted on every `DOWN-OK`. Ordinary `xmac down` therefore refuses gpu2, media, and hdd whenever they are up. The Off button JROM asked for does nothing there unless the UI sends `--force`, and that same flag also overrides "GPU compute is running" and "a lease is held". The implementer who makes the button work will send `--force` on every guard-3 refusal.
  FIX:         Add an owner-off that skips only guard 3 (lease + fail-closed busy still apply). The UI sends `--force` only when the user is overriding a shown lease or a shown busy process, after F3's challenge. A guard-3 refusal must not be rewritten into `--force`.

F3  CRITICAL  A copied owner bearer replays Off/force for up to 24h; the confirm never reaches the server
  WHERE:       D3, D4, H1, A2
  MECHANISM:   Sessions are bearer JWTs, default 24h (`SESSION_EXPIRY_HOURS`), held in localStorage. `logout` deletes only the session being presented. CORS is `origin: true` with credentials. A foreign form cannot attach this Authorization header; a copied token can, and it is a second session the owner's logout does not kill. D3's confirm is client-side. Nothing rate-limits the new routes (`fastifyRateLimit` is `global: false`). The app does not set `XMAC_CALLER`, so `xmac.log` records `proc:node` while `audit_log` says "owner". `/api/audit` is not `requireOwner`, and the project Activity tab does not render `details`.
  FIX:         Off and force require a one-time server challenge bound to session id + machine + action, approved by the existing Telegram number-match, expiry under 60s, single use. The power row stored and shown on the machine detail view includes session id, source IP, force bit, and the guard text. Add revoke-all-web-sessions. Rate-limit the power routes. Set `XMAC_CALLER` to owner id + session id. Keep the token in the Authorization header.

F4  CRITICAL  The boxes this effort will power off are signal, glimmer, and the hourly archive
  WHERE:       D1–D3, I5; the only mention is topology.yaml `usage_hygiene`, which is not an acceptance criterion
  MECHANISM:   The app runs on minisserver `192.168.254.140`, outside the fleet, so powering off a target does not kill the process. It does kill signal (`.174:8110`) and glimmer (`.179` behind the shim). `xmac.log` already shows the pattern: `2026-09-25T02:56:35Z` media BUSY refusal, `02:56:41Z` `DOWN media force=1`, down 5s later. `hdd` is woken at minute :17 by `archive-transcripts.sh`, which `xmac claim hdd transcript-archive` and later `release` (auto power-off). hdd's busy_check cannot see that job: it strips ssh from `.140` and matches rsync/borg/restic/duplicity, while the archive is local tar + scp. The lease is the only guard, and `--force` skips it. A D1/D2 test that really cycles a box has gpu and gpu2 as the obvious targets, which are the seats grading and writing the test.
  FIX:         Detail view names the protected role (signal, glimmer, transcript-archive) whenever the lease or a known listener is present. Force against a held lease quotes the holder name inside the Telegram challenge. For this run the API refuses down and force for `gpu` and `gpu2`. The live power oracle is one named box, chosen before planning, and it is neither .174 nor .179.

F5  HIGH  Ping-gated polling still wakes a box, and "hdd stayed down" is a confounded oracle
  WHERE:       F2, F3; north-star D1 (backend shells to xmac for status/up/down/leases/busy)
  MECHANISM:   Wake is a magic packet from `xmac up`, which `claim` and `run` both call. Ping and ssh do not wake these NICs (Wake-on: g). F3 only bans `xmac run` when the box is already DOWN. Ping-UP, then the box drops, then a retry through `xmac run`, sends WoL. The 30m sampler is a second caller and is not required to share the reader. `claim` is unmentioned: a lease taken "while the page is open" stops `release` from powering hdd off after the archive, so datasvr stays up. crontab `17 * * * * archive-transcripts.sh` wakes hdd every hour, so a canary defined as "this DOWN box stays DOWN" fails for a reason outside the app. A WoL the BIOS ignores also leaves the box DOWN and passes. Separately, `xmac down` on a single missed ping deletes the WOKE file and returns success (`cmd_down` first branch), which strips gpu's only remaining off-guard without cutting power.
  FIX:         One reader module is the only remote I/O. It may ssh. It must not call `up`, `run`, `claim`, or `release`. A fence fails if that process spawns `wakeonlan` or appends a `WAKE` line whose `XMAC_CALLER` is the app. Ssh or ping failure records stale. The sampler calls that same reader. The app calls `xmac down` only after a successful ssh in the same action, never as a status sync.

F6  HIGH  Self-detect has no identity, no timeout, and no failure states
  WHERE:       E1, E2, C1, B1, G1
  MECHANISM:   Rows are not keyed. GPU index changes when a card is added or removed, so sparklines and the I4 integral splice two devices. Two `nvidia-smi` calls per poll can disagree mid-hotplug. `power.draw` of `[N/A]` parsed as a float renders as a measured `0 W`. Exit 127 on hdd (no binary) is the same UI state as a hung or non-zero driver on a GPU box, which hides a sick card as "no GPU". No timeout: a hung `nvidia-smi` stalls an in-process sampler and is the same hang that empties the busy probe in F1. E1 is NVIDIA-only, so a later non-NVIDIA card is indistinguishable from hdd.
  FIX:         One `nvidia-smi --query-gpu=uuid,name,...` per poll, hard timeout 8s. History key is UUID. `[N/A]` renders "unavailable". Three on-screen states: no NVIDIA device, driver/timeout (last-good values kept, error chip shown), non-NVIDIA adapter listed by name. E1's oracle is a fixture that adds a fifth UUID and shows it with no rebuild.

F7  HIGH  The false-green backstop runs where the machines are not
  WHERE:       J1, K1, D1, D2, F3
  MECHANISM:   K1 proves the effort on a local :3101/static instance and forbids restarting prod. The repo's fence tools (`e2e/static-server.mjs`, `FENCE_STUB`) never exec xmac. Signal and that Playwright fence both pass on "button clicked", "label became Offline", or "mock was spawned with argv down". J1's phrase "reflected in xmac/nvidia-smi" is not observable there. A live cycle of .174 kills the validator grading it (F4). "Break a slice and watch the fence go red" is satisfied by breaking the stub.
  FIX:         UI fence uses a fake fleet and asserts rendered numbers, the refusal string, and the measured-vs-estimated mark. Live fence, on the designated box only, asserts ping loss and an `xmac.log` `DOWN-OK` line carrying the app's `XMAC_CALLER`. A case whose stub exits 0 without that log line is red. D/F/I slices are validator-tier L2. A mock-argv assertion is specified as a fail.

F8  HIGH  Disk and UPS panels either wake hdd or display the wrong source
  WHERE:       I2, I3, G2, F3
  MECHANISM:   hdd is down except during the archive window. SMART that obeys F3 is usually last-known-or-blank; SMART via `xmac run` wakes the box. The array is 6 disks (registry comment); `smartctl` is slow and often needs root, and nothing caps it, so it can sit on the 30s path. I3 is vacuously met by shipping nothing. The registry comment (2026-09-17, not re-checked today) says gpu's KSTAR has no data cable and NUT on that box reads the CyberPower on .140 — house UPS, not the GPU's. G2's "a future meter slots in with no UI change" cannot be exercised in this build.
  FIX:         I2 shows the last sample taken while hdd was already up, per-disk timeout, per-disk error, and it never wakes the box. I3 names the source on the card; gpu shows "KSTAR unmetered" until a cable is verified. Each watt figure carries a source label (`estimate`, `nut:<id>`, `plug:<id>`).

F9  HIGH  Six criteria are bundles; checking off the bundle leaves half of it unbuilt
  WHERE:       D2, C3, F1, A1, I1, G1
  MECHANISM:   D2 is one successful off plus three refusals (lease, busy, not-woken); a disabled button satisfies the sentence and none of the three reasons. "Disabled before click" and "clicked, then error" are different contracts. C3 is OS uptime, plus time since last xmac wake, plus lifetime on-hours, plus a cost. The request was how long the machine has been on. The wake-clock is empty whenever the WOKE file is absent, and there is no tariff. F1 is a 30s visible refresh and a 30m hidden refresh; the second leaves no trace on screen. A1 names Header, the Telegram grid, and `KNOWN_EXACT`. `Dashboard()` cards and the bottom-nav tab list are separate arrays in `app.js`, so the desktop hub can omit the section while A1 passes. `TgApp` mounts only when `Telegram.WebApp.initData` or `agj_has_tg_init_data` is set, which a local K1 browser does not. I1 is thermal, fan-fail, and won't-wake, with dedupe and no numbers, so any threshold is compliant. G1 is a measured nvidia field plus an estimate whose baseline and PSU factor are unnamed.
  FIX:         Split them. D2a off-succeeds, D2b lease refusal, D2c busy refusal, D2d not-woken refusal, each with the reason string on screen. C3 is OS uptime only until a tariff and a second clock are decided. F1a: a visible "updated Ns ago" advances about every 30s while the route is shown. F1b: that stamp does not advance at 30s when `document.hidden` or the route changes. A1 also adds the desktop Dashboard card and a bottom-nav entry, and the Telegram grid is checked with the mini-app flag seeded. I1 states °C thresholds, the fan-fail rule, the won't-wake timeout, and the dedupe window. G1 states the per-box baseline and the PSU factor, in config.

F10  HIGH  These criteria have no on-screen oracle
  WHERE:       A2, B2, D4, E2, F2, F4, H1, J1
  MECHANISM:   A2's written proof is an HTTP status. The users table has a single row, `id=1 role=owner`, so a logged-out browser is the only "non-owner" a test can find, and it never loads the shell. B2 names no threshold, so no chip can be wrong. D4 points at "the existing audit trail", which is the project Activity tab and does not render `details`. E2 ("shows whatever the box exposes") is true of a blank panel. F2's sampler-with-the-app-closed cannot be seen while the app is open. F4 can render an empty polyline. H1 "localhost-origin-aware" is how agent routes decide peer-is-127.0.0.1; applying that here makes the tunnel unable to power a machine. The server binds `0.0.0.0`. J1's "broken slice goes red" is not a UI fact.
  FIX:         A2: a fixture viewer JWT sees no Header link, no dashboard card, no route, and gets 403 on the API. B2: fixture 79°C is neutral and 80°C is warning, thresholds written in the criterion. D4: the detail view shows the power row after the click. E2: a one-fan fixture shows that RPM; a no-chip fixture shows "no board fans". F2: a sampler tick with zero browsers writes a row; reopening shows that timestamp. F4: each point is readable as time + value. H1's oracle is a power POST from `https://agjasst.silverjrom.app` with the owner bearer succeeding, and the same POST with a viewer bearer failing. Leave the loopback check on the agent routes.

F11  MED  30-minute samples cannot support the kWh figure I4 will show
  WHERE:       F2, I4, G1, H2
  MECHANISM:   The sampler stores instantaneous power every 30 minutes. A short job between samples contributes nothing to the integral. I4 still presents kWh and a cost. The new table is unbounded inside the command-center sqlite.
  FIX:         The cost line states the currency, the $/kWh, and "sampled every 30 minutes; bursts shorter than the interval are missing". Keep it off the overview. The migration states a retention cap.

F12  MED  Repeated On starts parallel 180s WoL loops and can stall the one pm2 process
  WHERE:       D1; absent from D/H
  MECHANISM:   `xmac up` resends a magic packet every 20s for up to 180s and blocks the caller (`UP_TIMEOUT` 180, `WAKE_RESEND_SEC` 20). There is no per-machine lock and no idempotency key. A double-tap or a tunnel timeout retry starts a second loop, and an overlapping Off races it. `execSync` of that call inside the Fastify process holds the command center (telegram, login, agents) for the duration.
  FIX:         One in-flight action per machine, idempotency key on the POST, the child detached, the HTTP call returns "in progress" immediately, the button stays pending and a repeat POST returns the same action.

F13  MED  The registry-corrected claim is false, and the WoL badge has nothing to read for gpu2
  WHERE:       north-star "Registry correction landed"; machine table; I5
  MECHANISM:   `machines.conf` line 49 still describes gpu2 as "1x RTX PRO 4500 32GB + 2x RTX PRO 4000". The requirements table says 2× PRO 4000. nvidia-smi was not re-queried in this pass; the two documents already disagree, which is the drift E1 exists to survive. gpu and media have dated cold-wake notes; gpu2's row has none. I5 will become a hardcoded yes/no, and Off is still offered when the badge is empty, so a box that cannot wake can still be shut down.
  FIX:         Either correct the gpu2 role string or drop the "registry corrected" sentence. I5 shows the timestamp of the last `WAKE` that was followed by `UP`, or "never verified". Off on "never verified" uses the F3 challenge and the confirm says the box may stay off.

F14  LOW  B1 freezes the fleet at four names while E1 pretends inventory is discovered
  WHERE:       B1, E1
  MECHANISM:   GPU rows are live; the machine list is "all four". A fifth row added to `machines.conf` never appears. That is a config change of the kind E1 claims to avoid, applied one level up.
  FIX:         The overview lists `xmac.sh status` names. The registry text is a hint under the live GPU name.
```

TOP-3 MUST-FIX: F1 (fail-open busy probe, and `--force` skips what remains), F4 (Off targets signal, glimmer, and the datasvr archive lease), F7 (the fence JROM is trusting cannot see a real power transition).

MISSING-ENTIRELY:
- The decision the interview never asked: with guard 3 intact, ordinary Off works only for a box xmac woke — today that is only `gpu` — and every other box requires `--force`, which also overrides a busy GPU and a held lease. Choose an owner-off that skips only guard 3, or make Telegram step-up the normal Off. That choice is currently unspoken, so the build will pick `--force`.
- Protected-role denylist (signal on .174, glimmer on .179, `transcript-archive` lease on hdd) as product behavior, not a topology comment.
- Server-side one-time Telegram challenge for off/force; revoke-all web sessions; power-route rate limit; `XMAC_CALLER`.
- A named live-test box that is neither .174 nor .179, and a wake oracle based on process spawn and `xmac.log`, because hdd is supposed to wake at :17.
- UUID identity, poll timeout, `[N/A]` rendering, non-NVIDIA state.
- Numbers: °C thresholds, fan-fail rule, won't-wake timeout, dedupe window, currency, $/kWh, estimate baseline, PSU factor, history retention.
- UPS source per machine (gpu's KSTAR is unmetered in the registry notes) and SMART as last-known-while-up.
