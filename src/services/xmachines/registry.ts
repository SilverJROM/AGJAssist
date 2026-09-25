import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface RegistryMachine {
  name: string;
  state: 'up' | 'down' | 'unknown';
  ip?: string;
  leases?: string;
  roleHint?: string;
  wokenByXmac?: boolean;
}

export function parseStatusOutput(output: string): RegistryMachine[] {
  if (!output) return [];
  const machines: RegistryMachine[] = [];
  for (const rawLine of output.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    // Expected format from xmac.sh status: name  ip  STATE  leases=(...)  role [ [woken by xmac] ]
    const match = line.match(/^(\S+)\s+(\S+)\s+(UP|DOWN)\s+(leases=\([^\)]*\))\s+(.*)$/);
    if (match) {
      const [, name, ip, stateRaw, leases, rest] = match;
      const wokenByXmac = /\[\s*woken by xmac\s*\]/.test(rest);
      const roleHint = rest.replace(/\[\s*woken by xmac\s*\]/g, '').trim();
      machines.push({
        name,
        state: stateRaw.toLowerCase() as 'up' | 'down',
        ip,
        leases,
        roleHint,
        wokenByXmac,
      });
      continue;
    }
    // Fallback simple split for test fixtures
    const tokens = line.split(/\s+/);
    if (tokens.length >= 3) {
      const name = tokens[0];
      const ip = tokens[1];
      const stateRaw = tokens[2].toUpperCase();
      const state = stateRaw === 'UP' || stateRaw === 'DOWN' ? (stateRaw.toLowerCase() as 'up' | 'down') : 'unknown';
      machines.push({ name, state, ip });
    } else {
      machines.push({ name: line, state: 'unknown' });
    }
  }
  return machines;
}

export function readMachinesConf(confPath?: string): Map<string, { role: string; busyCheck: string }> {
  const defaultPath = path.join(os.homedir(), '.config/agent-protocols/xmac/machines.conf');
  const pathToUse = confPath || process.env.XMAC_CONF || defaultPath;
  const map = new Map<string, { role: string; busyCheck: string }>();
  try {
    const txt = fs.readFileSync(pathToUse, 'utf8');
    for (const line of txt.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const parts = trimmed.split('|');
      if (parts.length < 6) continue;
      const name = parts[0].trim();
      const role = parts[4].trim();
      const busyCheck = parts.slice(5).join('|').trim();
      map.set(name, { role, busyCheck });
    }
  } catch {
    // Missing config is acceptable – return empty map
  }
  return map;
}

export function buildRegistry(statusOutput: string, confPath?: string): RegistryMachine[] {
  const machines = parseStatusOutput(statusOutput);
  const conf = readMachinesConf(confPath);
  return machines.map(m => {
    const entry = conf.get(m.name);
    const roleHint = entry?.role ?? m.roleHint ?? '';
    return { ...m, roleHint };
  });
}
