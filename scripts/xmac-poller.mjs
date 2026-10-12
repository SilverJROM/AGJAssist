#!/usr/bin/env node
// Read-only fleet poller for xMachines. Replaces the xmac pollers lost in the
// move to hpsvr02: every POLL_MS it reaches each machine over SSH (the app host
// locally) and atomically rewrites the files the app reads:
//   ~/.xmac/xm-status.txt     — `xmac.sh status` lines (name ip UP|DOWN leases=() role)
//   ~/.xmac/xm-telemetry.json — per-machine metric rows (fleet-read-model.ts)
//   ~/.xmac/xm-dgx.json       — DGX serving pairs (dgx-read-model.ts)
// Machines come from XMAC_CONF (machines.conf). It never powers anything on or off.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOME = os.homedir();
const OUT_DIR = process.env.XMAC_DIR || path.join(HOME, '.xmac');
const CONF = process.env.XMAC_CONF || path.join(HOME, '.config/agent-protocols/xmac/machines.conf');
const POLL_MS = Number(process.env.XMAC_POLL_MS || 30000);
const LOCAL_IPS = new Set(Object.values(os.networkInterfaces()).flat().map((i) => i?.address).filter(Boolean));

// DGX pairs: ssh aliases from ~/.ssh/config (tunnelled through vultr01).
const DGX_PAIRS = {
  dgxA: { displayName: 'DGX A', route: 'dgx12', nodes: [['DGX1', 'dgx1'], ['DGX2', 'dgx2']] },
  dgxB: { displayName: 'DGX B', route: 'dgx34', nodes: [['DGX3', 'dgx3'], ['DGX4', 'dgx4']] },
};

// One remote round-trip per machine; each section is tagged so parsing is positional-free.
const PROBE = String.raw`
echo "HOST $(hostname)"
echo "UPTIME $(uptime -p | sed 's/^up //')"
cpu=""
for h in /sys/class/hwmon/hwmon*; do
  case "$(cat $h/name 2>/dev/null)" in k10temp|coretemp|zenpower) cpu=$(cat $h/temp1_input 2>/dev/null); break;; esac
done
if [ -z "$cpu" ]; then
  for z in /sys/class/thermal/thermal_zone*; do
    case "$(cat $z/type 2>/dev/null)" in x86_pkg_temp|acpitz) cpu=$(cat $z/temp 2>/dev/null); break;; esac
  done
fi
echo "CPU $cpu"
echo "MEM $(free -m | awk '/^Mem:/{print $3, $2}')"
command -v nvidia-smi >/dev/null && nvidia-smi --query-gpu=temperature.gpu,power.draw,utilization.gpu,memory.used,memory.total,name --format=csv,noheader,nounits 2>/dev/null | sed 's/^/GPU /'
true`;
const DGX_HEALTH = `curl -s -m 4 http://127.0.0.1:8000/v1/models 2>/dev/null | head -c 4000; echo; echo "RUNNING $(curl -s -m 4 http://127.0.0.1:8000/metrics 2>/dev/null | awk '/^vllm:num_requests_running/{s+=$2} END{print s+0}')"`;

function run(cmd, args, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0 && out.includes('HOST '), out }); });
    child.on('error', () => { clearTimeout(timer); resolve({ ok: false, out: '' }); });
  });
}

function ssh(target, script, timeoutMs) {
  return run('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=6', target, script], timeoutMs);
}

function probe(target, isLocal, extra = '', timeoutMs = 15000) {
  const script = PROBE + (extra ? `\n${extra}` : '');
  return isLocal ? run('bash', ['-c', script], timeoutMs) : ssh(target, script, timeoutMs);
}

function num(s) {
  const n = Number(String(s ?? '').trim());
  return Number.isFinite(n) && String(s ?? '').trim() !== '' ? n : undefined;
}

function parseProbe(out) {
  const r = { gpus: [] };
  for (const line of out.split('\n')) {
    const [tag, ...rest] = line.split(' ');
    const val = rest.join(' ').trim();
    if (tag === 'HOST') r.host = val;
    else if (tag === 'UPTIME') r.uptime = val;
    else if (tag === 'CPU') { const m = num(val); if (m !== undefined) r.cpuTemp = Math.round(m / 1000); }
    else if (tag === 'MEM') { const [used, total] = val.split(' ').map(num); r.memUsedMB = used; r.memTotalMB = total; }
    else if (tag === 'GPU') {
      const [temp, power, util, memUsed, memTotal, ...name] = val.split(',').map((x) => x.trim());
      r.gpus.push({ temp: num(temp), power: num(power), util: num(util), memUsed: num(memUsed), memTotal: num(memTotal), name: name.join(',') });
    } else if (tag === 'RUNNING') r.requestsRunning = num(val);
    else if (line.startsWith('{')) { try { r.models = JSON.parse(line); } catch { /* not serving */ } }
  }
  return r;
}

function readConf() {
  const rows = [];
  for (const raw of fs.readFileSync(CONF, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const cols = line.split('|');
    if (cols.length < 6) continue;
    rows.push({ name: cols[0].trim(), ip: cols[1].trim(), user: cols[3].trim() || 'agjrom', role: cols[4].trim() });
  }
  return rows;
}

function writeAtomic(file, content) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

function compact(values) {
  return values.filter((v) => typeof v === 'number');
}

async function pollLan(machines) {
  const results = await Promise.all(machines.map(async (m) => {
    const local = LOCAL_IPS.has(m.ip);
    const res = await probe(`${m.user}@${m.ip}`, local);
    return { m, local, ok: res.ok, data: res.ok ? parseProbe(res.out) : null };
  }));
  const status = [];
  const telemetry = {};
  for (const { m, local, ok, data } of results) {
    status.push(`${m.name}  ${m.ip}  ${ok ? 'UP' : 'DOWN'}  leases=(none)  ${m.role}`);
    if (!ok) continue;
    telemetry[m.name] = {
      gpuTempsC: compact(data.gpus.map((g) => g.temp)),
      gpuPowerWatts: compact(data.gpus.map((g) => g.power)),
      gpuUtil: compact(data.gpus.map((g) => g.util)),
      gpuMemUsed: compact(data.gpus.map((g) => g.memUsed)),
      uptime: data.uptime || '',
      ...(data.cpuTemp !== undefined ? { cpuTemp: data.cpuTemp } : {}),
      provenance: local ? 'local' : 'live-ssh',
      freshness: 'fresh',
      sampleAge: '0s',
    };
  }
  return { status, telemetry };
}

async function pollDgx() {
  const out = {};
  await Promise.all(Object.entries(DGX_PAIRS).map(async ([key, pair]) => {
    const nodes = await Promise.all(pair.nodes.map(async ([label, alias], i) => {
      // The first node of a pair fronts the serving endpoint; ask it for model + load.
      const res = await probe(alias, false, i === 0 ? DGX_HEALTH : '', 30000);
      const d = res.ok ? parseProbe(res.out) : null;
      const g = d?.gpus[0];
      return {
        label,
        host: d?.host || alias,
        reachable: res.ok,
        gpuName: g?.name,
        gpuTempC: g?.temp,
        gpuPowerW: g?.power,
        gpuUtil: g?.util,
        // GB10 reports no VRAM (unified memory) — use system memory instead.
        memUsedMB: g?.memUsed ?? d?.memUsedMB,
        memTotalMB: g?.memTotal ?? d?.memTotalMB,
        uptime: d?.uptime,
        _health: d,
      };
    }));
    const front = nodes[0]._health;
    const model = front?.models?.data?.[0]?.id ?? '';
    const anyUp = nodes.some((n) => n.reachable);
    out[key] = {
      displayName: pair.displayName,
      model,
      route: pair.route,
      state: anyUp ? 'up' : 'unknown',
      nodes: nodes.map(({ _health, ...n }) => n),
      health: front?.models ? { ok: true, requestsRunning: front.requestsRunning } : (anyUp ? { ok: false } : null),
      provenance: 'live-ssh (tunnel)',
      freshness: anyUp ? 'fresh' : 'unreachable',
      sampleAge: '0s',
    };
  }));
  return out;
}

async function cycle() {
  const started = Date.now();
  try {
    const [{ status, telemetry }, dgx] = await Promise.all([pollLan(readConf()), pollDgx()]);
    fs.mkdirSync(OUT_DIR, { recursive: true });
    writeAtomic(path.join(OUT_DIR, 'xm-status.txt'), `${status.join('\n')}\n`);
    writeAtomic(path.join(OUT_DIR, 'xm-telemetry.json'), `${JSON.stringify(telemetry, null, 2)}\n`);
    writeAtomic(path.join(OUT_DIR, 'xm-dgx.json'), `${JSON.stringify(dgx, null, 2)}\n`);
    const up = status.filter((l) => / UP /.test(l)).length;
    const dgxUp = Object.values(dgx).filter((p) => p.state === 'up').length;
    console.log(`${new Date().toISOString()} lan ${up}/${status.length} up, dgx ${dgxUp}/${Object.keys(dgx).length} up (${Date.now() - started}ms)`);
  } catch (err) {
    console.error(`${new Date().toISOString()} poll failed: ${err?.message ?? err}`);
  }
}

let running = false;
async function tick() {
  if (running) return; // a slow DGX tunnel must not stack cycles
  running = true;
  try { await cycle(); } finally { running = false; }
}

await tick();
if (!process.argv.includes('--once')) setInterval(tick, POLL_MS);
