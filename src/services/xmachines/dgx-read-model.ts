import fs from 'node:fs';
import type { DgxNode, MachineTelemetry } from './telemetry.js';

// Reads the DGX poller's fixture (~/.xmac/xm-dgx.json) and produces one machine
// entry per serving pair (DGX A, DGX B). These are remote GB10 boxes reached over
// SSH tunnels: read-only, no power control, and "unknown" (not "down") when the
// tunnel is unreachable. A GB10's model lives in the 128 GB unified memory and is
// always resident, so VRAM is always near-full — "in use" keys off a resident model
// (memory) OR active compute (util), never off power alone.

interface DgxNodeFixture {
  reachable?: boolean;
  gpuName?: string;
  gpuTempC?: number;
  gpuPowerW?: number;
  gpuUtil?: number;
  clockMHz?: number;
  memUsedMB?: number;
  memTotalMB?: number;
  uptime?: string;
  host?: string;
  label?: string;
}

interface DgxPairFixture {
  displayName?: string;
  model?: string;
  route?: string;
  state?: string;
  nodes?: DgxNodeFixture[];
  health?: { ok?: boolean; requestsRunning?: number } | null;
  provenance?: string;
  freshness?: string;
  sampleAge?: string;
}

const DGX_BUSY_UTIL_PCT = 15;

function finite(n: unknown): number | undefined {
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

function nodeInUse(n: DgxNode): boolean {
  const memFrac = typeof n.memUsedMB === 'number' && typeof n.memTotalMB === 'number' && n.memTotalMB > 0
    ? n.memUsedMB / n.memTotalMB
    : 0;
  return memFrac >= 0.5 || (typeof n.gpuUtil === 'number' && n.gpuUtil >= DGX_BUSY_UTIL_PCT);
}

function pairToTelemetry(name: string, p: DgxPairFixture): MachineTelemetry {
  const nodes: DgxNode[] = (Array.isArray(p.nodes) ? p.nodes : []).map((n) => ({
    label: typeof n.label === 'string' ? n.label : '',
    host: typeof n.host === 'string' ? n.host : undefined,
    reachable: n.reachable === true,
    gpuName: typeof n.gpuName === 'string' ? n.gpuName : undefined,
    gpuTempC: finite(n.gpuTempC),
    gpuPowerW: finite(n.gpuPowerW),
    gpuUtil: finite(n.gpuUtil),
    clockMHz: finite(n.clockMHz),
    memUsedMB: finite(n.memUsedMB),
    memTotalMB: finite(n.memTotalMB),
    uptime: typeof n.uptime === 'string' ? n.uptime : undefined,
  }));
  const reachable = nodes.filter((n) => n.reachable);
  const temps = reachable.map((n) => n.gpuTempC).filter((t): t is number => typeof t === 'number');
  const powers = reachable.map((n) => n.gpuPowerW).filter((w): w is number => typeof w === 'number');
  const totalWatts = powers.length ? Math.round(powers.reduce((a, b) => a + b, 0)) : null;
  const hottest = temps.length ? Math.max(...temps) : 0;
  const state: MachineTelemetry['state'] = p.state === 'unknown' ? 'unknown' : 'up';
  const model = typeof p.model === 'string' ? p.model : '';
  const hosts = nodes.map((n) => n.host || n.label).filter(Boolean).join(' + ');
  const req = finite(p.health?.requestsRunning);

  return {
    name,
    state,
    offline: false,
    cpuTemp: 0,
    gpuTemp: hottest,
    powerWatts: totalWatts ?? 0,
    uptime: reachable[0]?.uptime ?? '',
    provenance: typeof p.provenance === 'string' ? p.provenance : 'live-ssh (tunnel)',
    sampleAge: typeof p.sampleAge === 'string' ? p.sampleAge : '0s',
    freshness: typeof p.freshness === 'string' ? p.freshness : (state === 'unknown' ? 'unreachable' : 'fresh'),
    displayName: typeof p.displayName === 'string' ? p.displayName : name,
    roleHint: model + (hosts ? ` · ${hosts}` : ''),
    gpuCount: reachable.length,
    gpusBusy: reachable.filter(nodeInUse).length,
    noPowerControl: true,
    dgx: {
      model,
      route: typeof p.route === 'string' ? p.route : '',
      requestsRunning: req,
      serviceOk: typeof p.health?.ok === 'boolean' ? p.health.ok : undefined,
      nodes,
    },
    telemetry: {
      gpuTempMax: temps.length ? hottest : null,
      powerWatts: totalWatts,
      uptime: reachable[0]?.uptime ?? null,
    },
  };
}

export function dgxFleetFromEnv(env: NodeJS.ProcessEnv): MachineTelemetry[] {
  const file = env.XMACHINES_DGX_FIXTURE?.trim();
  if (!file) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
  const out: MachineTelemetry[] = [];
  for (const [name, pair] of Object.entries(parsed as Record<string, DgxPairFixture>)) {
    if (pair && typeof pair === 'object') out.push(pairToTelemetry(name, pair));
  }
  return out;
}
