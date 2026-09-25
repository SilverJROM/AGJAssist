# capability-matrix — xmac contract probe A0.1

Probe timestamp: 2026-09-25T12:21:51Z
Run: projcore-run-2026-09-25
Slice: A0.1

Control rule: an UNKNOWN verdict is not green control behavior.

## configured hosts
### configured hosts
- command: `awk '-F|' '!/^[[:space:]]*#/ && NF {print $1}' /home/agjrom/.config/agent-protocols/xmac/machines.conf`
- ts: 2026-09-25T12:21:51Z
- exit: 0
- verdict: VERIFIED
- raw:
```
stdout_bytes=19
stdout:
gpu
hdd
gpu2
media
stderr:
(0 bytes)
```

## host: gpu

### service-user permissions
- command: `awk '-F|' -v n=gpu '$1==n{print; exit}' /home/agjrom/.config/agent-protocols/xmac/machines.conf`
- ts: 2026-09-25T12:21:51Z
- exit: 0
- verdict: VERIFIED
- raw:
```
stdout_bytes=258
stdout:
gpu|192.168.254.174|a8:a1:59:9b:80:95|agjrom|1x RTX PRO 4500 32GB + 2x RTX PRO 4000 Blackwell 24GB, ~80GB total (hostname jromhost)|nvidia-smi --query-compute-apps=pid,process_name --format=csv,noheader 2>/dev/null; who 2>/dev/null | grep -v 192.168.254.140
stderr:
(0 bytes)
```

### exact argv/subcommands
- command: `xmac.sh status gpu ; xmac.sh leases`
- ts: 2026-09-25T12:21:51Z
- exit: 0
- verdict: VERIFIED
- raw:
```
status_spy:
2026-09-25T12:21:51Z	status	gpu
leases_spy:
2026-09-25T12:21:51Z	leases
```

### exit codes
- command: `xmac.sh status gpu ; xmac.sh leases`
- ts: 2026-09-25T12:21:51Z
- exit: 0
- verdict: VERIFIED
- raw:
```
status_command=xmac.sh status gpu
status_exit=0
leases_command=xmac.sh leases
leases_exit=0
status_stdout:
gpu    192.168.254.174  UP    leases=(none)                 1x RTX PRO 4500 32GB + 2x RTX PRO 4000 Blackwell 24GB, ~80GB total (hostname jromhost)  [woken by xmac]
status_stderr:
(0 bytes)
leases_stdout:
xmac: no leases held
leases_stderr:
(0 bytes)
```

### stdout/stderr shape
- command: `xmac.sh status gpu`
- ts: 2026-09-25T12:21:51Z
- exit: 0
- verdict: VERIFIED
- raw:
```
stdout_bytes=164
stderr_bytes=0
stdout:
gpu    192.168.254.174  UP    leases=(none)                 1x RTX PRO 4500 32GB + 2x RTX PRO 4000 Blackwell 24GB, ~80GB total (hostname jromhost)  [woken by xmac]
stderr:
(0 bytes)
leases_stdout_bytes=21
leases_stderr_bytes=0
leases_stdout:
xmac: no leases held
leases_stderr:
(0 bytes)
```

### guard ordering
- command: `sed -n 148,169p /home/agjrom/.config/agent-protocols/lib/xmac.sh`
- ts: 2026-09-25T12:21:51Z
- exit: 0
- verdict: VERIFIED
- raw:
```
stdout_bytes=949
stdout:
  # GUARD 1 — leases. Another agent is mid-job on this box.
  local n; n="$(lease_count "$NAME")"
  if [ "$n" -gt 0 ] && [ -z "$force" ]; then
    die "$NAME has $n active lease(s): $(lease_list "$NAME" | tr '\n' ' ')
  Someone is using it. Release the leases, or pass --force if you know they are stale."
  fi

  # GUARD 2 — is it actually idle? A lease is a claim; this is the machine's own opinion.
  if [ -n "$BUSY" ] && [ -z "$force" ]; then
    local busy; busy="$(rsh "$BUSY" 20)"
    if [ -n "$busy" ]; then
      die "$NAME reports BUSY — refusing to power off:
$(echo "$busy" | sed 's/^/    /')
  Pass --force to override."
    fi
  fi

  # GUARD 3 — xmac only powers off what xmac started, unless forced. JROM may be sitting at that box.
  if [ ! -f "$WOKE/$NAME" ] && [ -z "$force" ]; then
    die "$NAME was not started by xmac, so xmac will not turn it off.
  It may be in use by JROM directly. Pass --force to override."
  fi
stderr:
(0 bytes)
```

### xmac log format
- command: `grep -m 1 ' by=' /home/agjrom/.xmac/xmac.log ; grep -m 1 ' ERROR ' /home/agjrom/.xmac/xmac.log`
- ts: 2026-09-25T12:21:51Z
- exit: 0
- verdict: VERIFIED
- raw:
```
by_exit=0
by_line:
2026-08-19T23:03:18Z DOWN gpu force=1 by=agjrom@tmux:lokalAI2-465
error_exit=0
error_line:
2026-08-02T11:42:08Z ERROR hdd has no MAC in the registry, so it cannot be woken.
```

### concurrent-call behavior
- command: `grep -n -E 'flock|mutex|LOCKFILE' /home/agjrom/.config/agent-protocols/lib/xmac.sh`
- ts: 2026-09-25T12:21:51Z
- exit: 1
- verdict: UNKNOWN
- raw:
```
grep_exit=1
stdout_bytes=0
stderr_bytes=0
stdout:
(0 bytes)
stderr:
(0 bytes)
dispatcher:
case "${1:-}" in
  status)    shift; cmd_status "${1:-}" ;;
  up)        shift; [ $# -ge 1 ] || die "usage: xmac up <name>"; cmd_up "$1" ;;
  down)      shift; [ $# -ge 1 ] || die "usage: xmac down <name> [--force]"; cmd_down "$1" "${2:-}" ;;
  claim)     shift; cmd_claim "$@" ;;
  release)   shift; cmd_release "$@" ;;
  leases)    cmd_leases ;;
  bootstrap) shift; [ $# -ge 1 ] || die "usage: xmac bootstrap <name>"; cmd_bootstrap "$1" ;;
  run)       shift; cmd_run "$@" ;;
  *) sed -n '3,20p' "$0" | sed 's/^# \?//'; exit 2 ;;
```

### force semantics
- command: `sed -n 142,172p /home/agjrom/.config/agent-protocols/lib/xmac.sh`
- ts: 2026-09-25T12:21:51Z
- exit: 0
- verdict: VERIFIED
- raw:
```
stdout_bytes=1374
stdout:
cmd_down() {
  local force=""; [ "${2:-}" = "--force" ] && force=1
  load "$1"
  is_up || { echo "xmac: $NAME is already down"; rm -f "$WOKE/$NAME"; return 0; }
  [ "$USER_" = "UNKNOWN" ] && die "$NAME has no ssh_user in the registry — refusing to power it off blind."

  # GUARD 1 — leases. Another agent is mid-job on this box.
  local n; n="$(lease_count "$NAME")"
  if [ "$n" -gt 0 ] && [ -z "$force" ]; then
    die "$NAME has $n active lease(s): $(lease_list "$NAME" | tr '\n' ' ')
  Someone is using it. Release the leases, or pass --force if you know they are stale."
  fi

  # GUARD 2 — is it actually idle? A lease is a claim; this is the machine's own opinion.
  if [ -n "$BUSY" ] && [ -z "$force" ]; then
    local busy; busy="$(rsh "$BUSY" 20)"
    if [ -n "$busy" ]; then
      die "$NAME reports BUSY — refusing to power off:
$(echo "$busy" | sed 's/^/    /')
  Pass --force to override."
    fi
  fi

  # GUARD 3 — xmac only powers off what xmac started, unless forced. JROM may be sitting at that box.
  if [ ! -f "$WOKE/$NAME" ] && [ -z "$force" ]; then
    die "$NAME was not started by xmac, so xmac will not turn it off.
  It may be in use by JROM directly. Pass --force to override."
  fi

  echo "xmac: powering off $NAME ($IP)"; logp "DOWN $NAME force=${force:-0}"
  rsh 'sudo -n systemctl poweroff' 15 || rsh 'sudo -n poweroff' 15 || true
stderr:
(0 bytes)
```

## host: hdd

### service-user permissions
- command: `awk '-F|' -v n=hdd '$1==n{print; exit}' /home/agjrom/.config/agent-protocols/xmac/machines.conf`
- ts: 2026-09-25T12:21:51Z
- exit: 0
- verdict: VERIFIED
- raw:
```
stdout_bytes=281
stdout:
hdd|192.168.254.169|18:c0:4d:c1:01:37|agjrom|HDD / data server (hostname datasvr, ~47TB)|who 2>/dev/null | grep -v 192.168.254.140; ss -tn state established '( sport = :2049 or sport = :445 )' 2>/dev/null | tail -n +2; pgrep -a -f '[r]sync|[b]org|[r]estic|[d]uplicity' 2>/dev/null
stderr:
(0 bytes)
```

### exact argv/subcommands
- command: `xmac.sh status hdd ; xmac.sh leases`
- ts: 2026-09-25T12:21:51Z
- exit: 0
- verdict: VERIFIED
- raw:
```
status_spy:
2026-09-25T12:21:51Z	status	hdd
leases_spy:
2026-09-25T12:21:52Z	leases
```

### exit codes
- command: `xmac.sh status hdd ; xmac.sh leases`
- ts: 2026-09-25T12:21:51Z
- exit: 0
- verdict: VERIFIED
- raw:
```
status_command=xmac.sh status hdd
status_exit=0
leases_command=xmac.sh leases
leases_exit=0
status_stdout:
hdd    192.168.254.169  DOWN  leases=(none)                 HDD / data server (hostname datasvr, ~47TB)
status_stderr:
(0 bytes)
leases_stdout:
xmac: no leases held
leases_stderr:
(0 bytes)
```

### stdout/stderr shape
- command: `xmac.sh status hdd`
- ts: 2026-09-25T12:21:51Z
- exit: 0
- verdict: VERIFIED
- raw:
```
stdout_bytes=104
stderr_bytes=0
stdout:
hdd    192.168.254.169  DOWN  leases=(none)                 HDD / data server (hostname datasvr, ~47TB)
stderr:
(0 bytes)
leases_stdout_bytes=21
leases_stderr_bytes=0
leases_stdout:
xmac: no leases held
leases_stderr:
(0 bytes)
```

### guard ordering
- command: `sed -n 148,169p /home/agjrom/.config/agent-protocols/lib/xmac.sh`
- ts: 2026-09-25T12:21:52Z
- exit: 0
- verdict: VERIFIED
- raw:
```
stdout_bytes=949
stdout:
  # GUARD 1 — leases. Another agent is mid-job on this box.
  local n; n="$(lease_count "$NAME")"
  if [ "$n" -gt 0 ] && [ -z "$force" ]; then
    die "$NAME has $n active lease(s): $(lease_list "$NAME" | tr '\n' ' ')
  Someone is using it. Release the leases, or pass --force if you know they are stale."
  fi

  # GUARD 2 — is it actually idle? A lease is a claim; this is the machine's own opinion.
  if [ -n "$BUSY" ] && [ -z "$force" ]; then
    local busy; busy="$(rsh "$BUSY" 20)"
    if [ -n "$busy" ]; then
      die "$NAME reports BUSY — refusing to power off:
$(echo "$busy" | sed 's/^/    /')
  Pass --force to override."
    fi
  fi

  # GUARD 3 — xmac only powers off what xmac started, unless forced. JROM may be sitting at that box.
  if [ ! -f "$WOKE/$NAME" ] && [ -z "$force" ]; then
    die "$NAME was not started by xmac, so xmac will not turn it off.
  It may be in use by JROM directly. Pass --force to override."
  fi
stderr:
(0 bytes)
```

### xmac log format
- command: `grep -m 1 ' by=' /home/agjrom/.xmac/xmac.log ; grep -m 1 ' ERROR ' /home/agjrom/.xmac/xmac.log`
- ts: 2026-09-25T12:21:52Z
- exit: 0
- verdict: VERIFIED
- raw:
```
by_exit=0
by_line:
2026-08-19T23:03:18Z DOWN gpu force=1 by=agjrom@tmux:lokalAI2-465
error_exit=0
error_line:
2026-08-02T11:42:08Z ERROR hdd has no MAC in the registry, so it cannot be woken.
```

### concurrent-call behavior
- command: `grep -n -E 'flock|mutex|LOCKFILE' /home/agjrom/.config/agent-protocols/lib/xmac.sh`
- ts: 2026-09-25T12:21:52Z
- exit: 1
- verdict: UNKNOWN
- raw:
```
grep_exit=1
stdout_bytes=0
stderr_bytes=0
stdout:
(0 bytes)
stderr:
(0 bytes)
dispatcher:
case "${1:-}" in
  status)    shift; cmd_status "${1:-}" ;;
  up)        shift; [ $# -ge 1 ] || die "usage: xmac up <name>"; cmd_up "$1" ;;
  down)      shift; [ $# -ge 1 ] || die "usage: xmac down <name> [--force]"; cmd_down "$1" "${2:-}" ;;
  claim)     shift; cmd_claim "$@" ;;
  release)   shift; cmd_release "$@" ;;
  leases)    cmd_leases ;;
  bootstrap) shift; [ $# -ge 1 ] || die "usage: xmac bootstrap <name>"; cmd_bootstrap "$1" ;;
  run)       shift; cmd_run "$@" ;;
  *) sed -n '3,20p' "$0" | sed 's/^# \?//'; exit 2 ;;
```

### force semantics
- command: `sed -n 142,172p /home/agjrom/.config/agent-protocols/lib/xmac.sh`
- ts: 2026-09-25T12:21:52Z
- exit: 0
- verdict: VERIFIED
- raw:
```
stdout_bytes=1374
stdout:
cmd_down() {
  local force=""; [ "${2:-}" = "--force" ] && force=1
  load "$1"
  is_up || { echo "xmac: $NAME is already down"; rm -f "$WOKE/$NAME"; return 0; }
  [ "$USER_" = "UNKNOWN" ] && die "$NAME has no ssh_user in the registry — refusing to power it off blind."

  # GUARD 1 — leases. Another agent is mid-job on this box.
  local n; n="$(lease_count "$NAME")"
  if [ "$n" -gt 0 ] && [ -z "$force" ]; then
    die "$NAME has $n active lease(s): $(lease_list "$NAME" | tr '\n' ' ')
  Someone is using it. Release the leases, or pass --force if you know they are stale."
  fi

  # GUARD 2 — is it actually idle? A lease is a claim; this is the machine's own opinion.
  if [ -n "$BUSY" ] && [ -z "$force" ]; then
    local busy; busy="$(rsh "$BUSY" 20)"
    if [ -n "$busy" ]; then
      die "$NAME reports BUSY — refusing to power off:
$(echo "$busy" | sed 's/^/    /')
  Pass --force to override."
    fi
  fi

  # GUARD 3 — xmac only powers off what xmac started, unless forced. JROM may be sitting at that box.
  if [ ! -f "$WOKE/$NAME" ] && [ -z "$force" ]; then
    die "$NAME was not started by xmac, so xmac will not turn it off.
  It may be in use by JROM directly. Pass --force to override."
  fi

  echo "xmac: powering off $NAME ($IP)"; logp "DOWN $NAME force=${force:-0}"
  rsh 'sudo -n systemctl poweroff' 15 || rsh 'sudo -n poweroff' 15 || true
stderr:
(0 bytes)
```

## host: gpu2

### service-user permissions
- command: `awk '-F|' -v n=gpu2 '$1==n{print; exit}' /home/agjrom/.config/agent-protocols/xmac/machines.conf`
- ts: 2026-09-25T12:21:52Z
- exit: 0
- verdict: VERIFIED
- raw:
```
stdout_bytes=235
stdout:
gpu2|192.168.254.179|f0:2f:74:da:24:62|agjrom|2x RTX PRO 4000 Blackwell 24GB, ~48GB total (hostname jromnet)|nvidia-smi --query-compute-apps=pid,process_name --format=csv,noheader 2>/dev/null; who 2>/dev/null | grep -v 192.168.254.140
stderr:
(0 bytes)
```

### exact argv/subcommands
- command: `xmac.sh status gpu2 ; xmac.sh leases`
- ts: 2026-09-25T12:21:52Z
- exit: 0
- verdict: VERIFIED
- raw:
```
status_spy:
2026-09-25T12:21:52Z	status	gpu2
leases_spy:
2026-09-25T12:21:52Z	leases
```

### exit codes
- command: `xmac.sh status gpu2 ; xmac.sh leases`
- ts: 2026-09-25T12:21:52Z
- exit: 0
- verdict: VERIFIED
- raw:
```
status_command=xmac.sh status gpu2
status_exit=0
leases_command=xmac.sh leases
leases_exit=0
status_stdout:
gpu2   192.168.254.179  UP    leases=(none)                 2x RTX PRO 4000 Blackwell 24GB, ~48GB total (hostname jromnet)
status_stderr:
(0 bytes)
leases_stdout:
xmac: no leases held
leases_stderr:
(0 bytes)
```

### stdout/stderr shape
- command: `xmac.sh status gpu2`
- ts: 2026-09-25T12:21:52Z
- exit: 0
- verdict: VERIFIED
- raw:
```
stdout_bytes=123
stderr_bytes=0
stdout:
gpu2   192.168.254.179  UP    leases=(none)                 2x RTX PRO 4000 Blackwell 24GB, ~48GB total (hostname jromnet)
stderr:
(0 bytes)
leases_stdout_bytes=21
leases_stderr_bytes=0
leases_stdout:
xmac: no leases held
leases_stderr:
(0 bytes)
```

### guard ordering
- command: `sed -n 148,169p /home/agjrom/.config/agent-protocols/lib/xmac.sh`
- ts: 2026-09-25T12:21:52Z
- exit: 0
- verdict: VERIFIED
- raw:
```
stdout_bytes=949
stdout:
  # GUARD 1 — leases. Another agent is mid-job on this box.
  local n; n="$(lease_count "$NAME")"
  if [ "$n" -gt 0 ] && [ -z "$force" ]; then
    die "$NAME has $n active lease(s): $(lease_list "$NAME" | tr '\n' ' ')
  Someone is using it. Release the leases, or pass --force if you know they are stale."
  fi

  # GUARD 2 — is it actually idle? A lease is a claim; this is the machine's own opinion.
  if [ -n "$BUSY" ] && [ -z "$force" ]; then
    local busy; busy="$(rsh "$BUSY" 20)"
    if [ -n "$busy" ]; then
      die "$NAME reports BUSY — refusing to power off:
$(echo "$busy" | sed 's/^/    /')
  Pass --force to override."
    fi
  fi

  # GUARD 3 — xmac only powers off what xmac started, unless forced. JROM may be sitting at that box.
  if [ ! -f "$WOKE/$NAME" ] && [ -z "$force" ]; then
    die "$NAME was not started by xmac, so xmac will not turn it off.
  It may be in use by JROM directly. Pass --force to override."
  fi
stderr:
(0 bytes)
```

### xmac log format
- command: `grep -m 1 ' by=' /home/agjrom/.xmac/xmac.log ; grep -m 1 ' ERROR ' /home/agjrom/.xmac/xmac.log`
- ts: 2026-09-25T12:21:52Z
- exit: 0
- verdict: VERIFIED
- raw:
```
by_exit=0
by_line:
2026-08-19T23:03:18Z DOWN gpu force=1 by=agjrom@tmux:lokalAI2-465
error_exit=0
error_line:
2026-08-02T11:42:08Z ERROR hdd has no MAC in the registry, so it cannot be woken.
```

### concurrent-call behavior
- command: `grep -n -E 'flock|mutex|LOCKFILE' /home/agjrom/.config/agent-protocols/lib/xmac.sh`
- ts: 2026-09-25T12:21:52Z
- exit: 1
- verdict: UNKNOWN
- raw:
```
grep_exit=1
stdout_bytes=0
stderr_bytes=0
stdout:
(0 bytes)
stderr:
(0 bytes)
dispatcher:
case "${1:-}" in
  status)    shift; cmd_status "${1:-}" ;;
  up)        shift; [ $# -ge 1 ] || die "usage: xmac up <name>"; cmd_up "$1" ;;
  down)      shift; [ $# -ge 1 ] || die "usage: xmac down <name> [--force]"; cmd_down "$1" "${2:-}" ;;
  claim)     shift; cmd_claim "$@" ;;
  release)   shift; cmd_release "$@" ;;
  leases)    cmd_leases ;;
  bootstrap) shift; [ $# -ge 1 ] || die "usage: xmac bootstrap <name>"; cmd_bootstrap "$1" ;;
  run)       shift; cmd_run "$@" ;;
  *) sed -n '3,20p' "$0" | sed 's/^# \?//'; exit 2 ;;
```

### force semantics
- command: `sed -n 142,172p /home/agjrom/.config/agent-protocols/lib/xmac.sh`
- ts: 2026-09-25T12:21:52Z
- exit: 0
- verdict: VERIFIED
- raw:
```
stdout_bytes=1374
stdout:
cmd_down() {
  local force=""; [ "${2:-}" = "--force" ] && force=1
  load "$1"
  is_up || { echo "xmac: $NAME is already down"; rm -f "$WOKE/$NAME"; return 0; }
  [ "$USER_" = "UNKNOWN" ] && die "$NAME has no ssh_user in the registry — refusing to power it off blind."

  # GUARD 1 — leases. Another agent is mid-job on this box.
  local n; n="$(lease_count "$NAME")"
  if [ "$n" -gt 0 ] && [ -z "$force" ]; then
    die "$NAME has $n active lease(s): $(lease_list "$NAME" | tr '\n' ' ')
  Someone is using it. Release the leases, or pass --force if you know they are stale."
  fi

  # GUARD 2 — is it actually idle? A lease is a claim; this is the machine's own opinion.
  if [ -n "$BUSY" ] && [ -z "$force" ]; then
    local busy; busy="$(rsh "$BUSY" 20)"
    if [ -n "$busy" ]; then
      die "$NAME reports BUSY — refusing to power off:
$(echo "$busy" | sed 's/^/    /')
  Pass --force to override."
    fi
  fi

  # GUARD 3 — xmac only powers off what xmac started, unless forced. JROM may be sitting at that box.
  if [ ! -f "$WOKE/$NAME" ] && [ -z "$force" ]; then
    die "$NAME was not started by xmac, so xmac will not turn it off.
  It may be in use by JROM directly. Pass --force to override."
  fi

  echo "xmac: powering off $NAME ($IP)"; logp "DOWN $NAME force=${force:-0}"
  rsh 'sudo -n systemctl poweroff' 15 || rsh 'sudo -n poweroff' 15 || true
stderr:
(0 bytes)
```

## host: media

### service-user permissions
- command: `awk '-F|' -v n=media '$1==n{print; exit}' /home/agjrom/.config/agent-protocols/xmac/machines.conf`
- ts: 2026-09-25T12:21:52Z
- exit: 0
- verdict: VERIFIED
- raw:
```
stdout_bytes=373
stdout:
media|192.168.254.182|d8:5e:d3:a2:96:d4|agjrom|RTX 3090 24GB, LLM-bench + Qwen media-edit server (hostname dbtrain)|nvidia-smi --query-compute-apps=pid,process_name --format=csv,noheader 2>/dev/null; who 2>/dev/null | grep -v 192.168.254.140; pgrep -a -f '[h]f download|[h]f_transfer|[w]get.*\.(safetensors|gguf|bin|ckpt)|[c]url.*\.(safetensors|gguf|bin|ckpt)' 2>/dev/null
stderr:
(0 bytes)
```

### exact argv/subcommands
- command: `xmac.sh status media ; xmac.sh leases`
- ts: 2026-09-25T12:21:52Z
- exit: 0
- verdict: VERIFIED
- raw:
```
status_spy:
2026-09-25T12:21:52Z	status	media
leases_spy:
2026-09-25T12:21:53Z	leases
```

### exit codes
- command: `xmac.sh status media ; xmac.sh leases`
- ts: 2026-09-25T12:21:52Z
- exit: 0
- verdict: VERIFIED
- raw:
```
status_command=xmac.sh status media
status_exit=0
leases_command=xmac.sh leases
leases_exit=0
status_stdout:
media  192.168.254.182  DOWN  leases=(none)                 RTX 3090 24GB, LLM-bench + Qwen media-edit server (hostname dbtrain)
status_stderr:
(0 bytes)
leases_stdout:
xmac: no leases held
leases_stderr:
(0 bytes)
```

### stdout/stderr shape
- command: `xmac.sh status media`
- ts: 2026-09-25T12:21:52Z
- exit: 0
- verdict: VERIFIED
- raw:
```
stdout_bytes=129
stderr_bytes=0
stdout:
media  192.168.254.182  DOWN  leases=(none)                 RTX 3090 24GB, LLM-bench + Qwen media-edit server (hostname dbtrain)
stderr:
(0 bytes)
leases_stdout_bytes=21
leases_stderr_bytes=0
leases_stdout:
xmac: no leases held
leases_stderr:
(0 bytes)
```

### guard ordering
- command: `sed -n 148,169p /home/agjrom/.config/agent-protocols/lib/xmac.sh`
- ts: 2026-09-25T12:21:53Z
- exit: 0
- verdict: VERIFIED
- raw:
```
stdout_bytes=949
stdout:
  # GUARD 1 — leases. Another agent is mid-job on this box.
  local n; n="$(lease_count "$NAME")"
  if [ "$n" -gt 0 ] && [ -z "$force" ]; then
    die "$NAME has $n active lease(s): $(lease_list "$NAME" | tr '\n' ' ')
  Someone is using it. Release the leases, or pass --force if you know they are stale."
  fi

  # GUARD 2 — is it actually idle? A lease is a claim; this is the machine's own opinion.
  if [ -n "$BUSY" ] && [ -z "$force" ]; then
    local busy; busy="$(rsh "$BUSY" 20)"
    if [ -n "$busy" ]; then
      die "$NAME reports BUSY — refusing to power off:
$(echo "$busy" | sed 's/^/    /')
  Pass --force to override."
    fi
  fi

  # GUARD 3 — xmac only powers off what xmac started, unless forced. JROM may be sitting at that box.
  if [ ! -f "$WOKE/$NAME" ] && [ -z "$force" ]; then
    die "$NAME was not started by xmac, so xmac will not turn it off.
  It may be in use by JROM directly. Pass --force to override."
  fi
stderr:
(0 bytes)
```

### xmac log format
- command: `grep -m 1 ' by=' /home/agjrom/.xmac/xmac.log ; grep -m 1 ' ERROR ' /home/agjrom/.xmac/xmac.log`
- ts: 2026-09-25T12:21:53Z
- exit: 0
- verdict: VERIFIED
- raw:
```
by_exit=0
by_line:
2026-08-19T23:03:18Z DOWN gpu force=1 by=agjrom@tmux:lokalAI2-465
error_exit=0
error_line:
2026-08-02T11:42:08Z ERROR hdd has no MAC in the registry, so it cannot be woken.
```

### concurrent-call behavior
- command: `grep -n -E 'flock|mutex|LOCKFILE' /home/agjrom/.config/agent-protocols/lib/xmac.sh`
- ts: 2026-09-25T12:21:53Z
- exit: 1
- verdict: UNKNOWN
- raw:
```
grep_exit=1
stdout_bytes=0
stderr_bytes=0
stdout:
(0 bytes)
stderr:
(0 bytes)
dispatcher:
case "${1:-}" in
  status)    shift; cmd_status "${1:-}" ;;
  up)        shift; [ $# -ge 1 ] || die "usage: xmac up <name>"; cmd_up "$1" ;;
  down)      shift; [ $# -ge 1 ] || die "usage: xmac down <name> [--force]"; cmd_down "$1" "${2:-}" ;;
  claim)     shift; cmd_claim "$@" ;;
  release)   shift; cmd_release "$@" ;;
  leases)    cmd_leases ;;
  bootstrap) shift; [ $# -ge 1 ] || die "usage: xmac bootstrap <name>"; cmd_bootstrap "$1" ;;
  run)       shift; cmd_run "$@" ;;
  *) sed -n '3,20p' "$0" | sed 's/^# \?//'; exit 2 ;;
```

### force semantics
- command: `sed -n 142,172p /home/agjrom/.config/agent-protocols/lib/xmac.sh`
- ts: 2026-09-25T12:21:53Z
- exit: 0
- verdict: VERIFIED
- raw:
```
stdout_bytes=1374
stdout:
cmd_down() {
  local force=""; [ "${2:-}" = "--force" ] && force=1
  load "$1"
  is_up || { echo "xmac: $NAME is already down"; rm -f "$WOKE/$NAME"; return 0; }
  [ "$USER_" = "UNKNOWN" ] && die "$NAME has no ssh_user in the registry — refusing to power it off blind."

  # GUARD 1 — leases. Another agent is mid-job on this box.
  local n; n="$(lease_count "$NAME")"
  if [ "$n" -gt 0 ] && [ -z "$force" ]; then
    die "$NAME has $n active lease(s): $(lease_list "$NAME" | tr '\n' ' ')
  Someone is using it. Release the leases, or pass --force if you know they are stale."
  fi

  # GUARD 2 — is it actually idle? A lease is a claim; this is the machine's own opinion.
  if [ -n "$BUSY" ] && [ -z "$force" ]; then
    local busy; busy="$(rsh "$BUSY" 20)"
    if [ -n "$busy" ]; then
      die "$NAME reports BUSY — refusing to power off:
$(echo "$busy" | sed 's/^/    /')
  Pass --force to override."
    fi
  fi

  # GUARD 3 — xmac only powers off what xmac started, unless forced. JROM may be sitting at that box.
  if [ ! -f "$WOKE/$NAME" ] && [ -z "$force" ]; then
    die "$NAME was not started by xmac, so xmac will not turn it off.
  It may be in use by JROM directly. Pass --force to override."
  fi

  echo "xmac: powering off $NAME ($IP)"; logp "DOWN $NAME force=${force:-0}"
  rsh 'sudo -n systemctl poweroff' 15 || rsh 'sudo -n poweroff' 15 || true
stderr:
(0 bytes)
```

## gateway-spy log

Read back from the argv spy sink after the probe's xmac invocations. The probe does not author this log.

```
2026-09-25T12:21:51Z	status	gpu
2026-09-25T12:21:51Z	leases
2026-09-25T12:21:51Z	status	hdd
2026-09-25T12:21:52Z	leases
2026-09-25T12:21:52Z	status	gpu2
2026-09-25T12:21:52Z	leases
2026-09-25T12:21:52Z	status	media
2026-09-25T12:21:53Z	leases
```

