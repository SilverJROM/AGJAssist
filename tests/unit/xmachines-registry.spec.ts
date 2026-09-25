import { describe, it, expect } from 'vitest';
import { parseStatusOutput, buildRegistry, readMachinesConf } from '../../src/services/xmachines/registry.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SAMPLE_STATUS = `
gpu 192.168.254.174 UP leases=(agjrom) role=gpu [woken by xmac]
hdd 192.168.254.169 DOWN leases=() role=storage
gpu2 192.168.254.175 UP leases=(agjrom)
media 192.168.254.170 UP leases=()
`;

describe('xmachines registry parser', () => {
  it('parses status names and state into registry model', () => {
    const machines = parseStatusOutput(SAMPLE_STATUS);
    expect(machines).toHaveLength(4);
    const byName = Object.fromEntries(machines.map(m => [m.name, m]));
    expect(byName.gpu).toBeDefined();
    expect(byName.gpu.state).toBe('up');
    expect(byName.gpu.ip).toBe('192.168.254.174');
    expect(byName.gpu.wokenByXmac).toBe(true);
    expect(byName.hdd.state).toBe('down');
  });

  it('role text from status is kept as hint', () => {
    const machines = parseStatusOutput(SAMPLE_STATUS);
    const gpu = machines.find(m => m.name === 'gpu')!;
    expect(gpu.roleHint).toMatch(/role=gpu/);
  });

  it('buildRegistry merges machines.conf role as hint', () => {
    const confPath = path.join(os.tmpdir(), `machines-${Date.now()}.conf`);
    const confContent = [
      'gpu|192.168.254.174|...|...|storage|busy=1',
      'hdd|192.168.254.169|...|...|archive|busy=0',
      'gpu2|192.168.254.175|...|...|compute|busy=1',
      'media|192.168.254.170|...|...|media|busy=0',
      'extra|10.0.0.1|...|...|extra-role|busy=1'
    ].join('\n');
    fs.writeFileSync(confPath, confContent, 'utf8');
    const registry = buildRegistry(SAMPLE_STATUS, confPath);
    const byName = Object.fromEntries(registry.map(m => [m.name, m]));
    expect(byName.gpu.roleHint).toBe('storage');
    expect(byName.extra).toBeUndefined();
    fs.rmSync(confPath);
  });

  it('admits a fifth machine without code change via status', () => {
    const extendedStatus = SAMPLE_STATUS + 'extra 10.0.0.1 UP leases=() role=extra\n';
    const machines = parseStatusOutput(extendedStatus);
    expect(machines).toHaveLength(5);
    expect(machines.find(m => m.name === 'extra')?.state).toBe('up');
  });

  it('readMachinesConf parses role hint from conf', () => {
    const confPath = path.join(os.tmpdir(), `machines-${Date.now()}.conf`);
    const confContent = 'gpu|192.168.254.174|a|b|roleA|busy|check\n';
    fs.writeFileSync(confPath, confContent, 'utf8');
    const map = readMachinesConf(confPath);
    expect(map.get('gpu')?.role).toBe('roleA');
    fs.rmSync(confPath);
  });
});
