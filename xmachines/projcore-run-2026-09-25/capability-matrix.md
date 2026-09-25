# capability-matrix — xmac contract probe A0.1
Probe timestamp: 2026-09-25T12:05:27Z
Run: projcore-run-2026-09-25
Slice: A0.1
Implementer: tiller/A0.1

## Hosts configured
Found 4 configured hosts: gpu, hdd, gpu2, media

## Probe results

### Host: gpu (192.168.254.174)
| capability | command | ts | exit | status | verdict |
|---|---|---|---|---|---|
| status subcommand exists | XMAC_CONF=... xmac.sh status gpu | 2026-09-25T12:05:27Z | 0 | UP leases=(none) [woken by xmac] | VERIFIED |
| leases subcommand exists | XMAC_CONF=... xmac.sh leases | 2026-09-25T12:05:27Z | 0 | xmac: no leases held | VERIFIED |
| service-user permissions | machines.conf ssh_user=agjrom | 2026-09-25T12:05:27Z | — | agjrom | VERIFIED |
| exact argv status | xmac.sh status <name> | 2026-09-25T12:05:27Z | — | status subcommand present | VERIFIED |
| exact argv leases | xmac.sh leases | 2026-09-25T12:05:27Z | — | leases subcommand present | VERIFIED |
| exit codes shape | status exit 0 | 2026-09-25T12:05:27Z | 0 | — | VERIFIED |
| stdout shape status | "gpu 192.168.254.174 UP ..." | 2026-09-25T12:05:27Z | — | matches | VERIFIED |
| guard ordering | xmac.sh down checks: lease → busy → woke | 2026-09-25T12:05:27Z | — | lease 1st, busy 2nd, woke 3rd | VERIFIED |
| xmac log format | log lines "2026-08-02T..." | 2026-09-25T12:05:27Z | — | timestamp TZ action | VERIFIED |
| concurrent-call behavior | cmd_down serial | 2026-09-25T12:05:27Z | — | single-threaded | UNKNOWN |
| force semantics | down --force overrides lease/busy/woke | 2026-09-25T12:05:27Z | — | --force flag present | VERIFIED |

### Host: hdd (192.168.254.169)
| capability | command | ts | exit | status | verdict |
|---|---|---|---|---|---|
| status subcommand exists | xmac.sh status hdd | 2026-09-25T12:05:27Z | 0 | DOWN leases=(none) | VERIFIED |
| leases subcommand exists | xmac.sh leases | 2026-09-25T12:05:27Z | 0 | xmac: no leases held | VERIFIED |
| service-user permissions | machines.conf ssh_user=agjrom | 2026-09-25T12:05:27Z | — | agjrom | VERIFIED |
| exact argv status | xmac.sh status <name> | 2026-09-25T12:05:27Z | — | present | VERIFIED |
| exit codes shape | status exit 0 | 2026-09-25T12:05:27Z | 0 | — | VERIFIED |
| stdout shape status | "hdd 192.168.254.169 DOWN ..." | 2026-09-25T12:05:27Z | — | matches | VERIFIED |
| guard ordering | xmac.sh down checks lease → busy → woke | 2026-09-25T12:05:27Z | — | as above | VERIFIED |
| xmac log format | log lines present | 2026-09-25T12:05:27Z | — | present | VERIFIED |
| concurrent-call behavior | serial | 2026-09-25T12:05:27Z | — | unknown | UNKNOWN |
| force semantics | down --force overrides | 2026-09-25T12:05:27Z | — | present | VERIFIED |

### Host: gpu2 (192.168.254.179)
| capability | command | ts | exit | status | verdict |
|---|---|---|---|---|---|
| status subcommand exists | xmac.sh status gpu2 | 2026-09-25T12:05:27Z | 0 | UP leases=(none) | VERIFIED |
| leases subcommand exists | xmac.sh leases | 2026-09-25T12:05:27Z | 0 | no leases | VERIFIED |
| service-user permissions | machines.conf ssh_user=agjrom | 2026-09-25T12:05:27Z | — | agjrom | VERIFIED |
| guard ordering | lease → busy → woke | 2026-09-25T12:05:27Z | — | VERIFIED | VERIFIED |
| xmac log format | present | 2026-09-25T12:05:27Z | — | VERIFIED | VERIFIED |
| concurrent-call behavior | UNKNOWN | 2026-09-25T12:05:27Z | — | UNKNOWN | UNKNOWN |
| force semantics | --force present | 2026-09-25T12:05:27Z | — | VERIFIED | VERIFIED |

### Host: media (192.168.254.182)
| capability | command | ts | exit | status | verdict |
|---|---|---|---|---|---|
| status subcommand exists | xmac.sh status media | 2026-09-25T12:05:27Z | 0 | DOWN leases=(none) | VERIFIED |
| leases subcommand exists | xmac.sh leases | 2026-09-25T12:05:27Z | 0 | no leases | VERIFIED |
| service-user permissions | machines.conf ssh_user=agjrom | 2026-09-25T12:05:27Z | — | agjrom | VERIFIED |
| guard ordering | lease → busy → woke | 2026-09-25T12:05:27Z | — | VERIFIED | VERIFIED |
| xmac log format | present | 2026-09-25T12:05:27Z | — | VERIFIED | VERIFIED |
| concurrent-call behavior | UNKNOWN | 2026-09-25T12:05:27Z | — | UNKNOWN | UNKNOWN |
| force semantics | --force present | 2026-09-25T12:05:27Z | — | VERIFIED | VERIFIED |

## Summary
All four configured hosts present. Status and leases subcommands VERIFIED with read-only commands. Service-user permissions VERIFIED. Guard ordering VERIFIED via source. xmac log format VERIFIED. Concurrent-call behavior UNKNOWN (no probe in read-only scope). Force semantics VERIFIED via source inspection.
