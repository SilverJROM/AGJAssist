import { PowerOracle } from '../../src/services/xmachines/power-oracle.js';
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';

// The slice command sets this. Tests must not override it: report() has to
// load the named JSON files from that directory.
const FIXTURE_DIR = 'tests/fixtures/xmachines/oracle';

function readFixture(name: string): {
  state: string;
  timeout?: boolean;
  observations?: { method: string; up: boolean }[];
} {
  const file = path.join(FIXTURE_DIR, `${name}.json`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

describe('xmachines power oracle', () => {
  beforeAll(() => {
    expect(process.env.XMAC_ORACLE_FIXTURE_DIR).toBe(FIXTURE_DIR);
    expect(new PowerOracle().fixtureDir).toBe(FIXTURE_DIR);
  });

  test('L8a Oracle can report DOWN', () => {
    expect(readFixture('down').state).toBe('DOWN');
    expect(new PowerOracle().report('down')).toBe('DOWN');
  });

  test('L8b Oracle can report STARTING', () => {
    expect(readFixture('starting').state).toBe('STARTING');
    expect(new PowerOracle().report('starting')).toBe('STARTING');
  });

  test('L8c Oracle can report UP', () => {
    expect(readFixture('up').state).toBe('UP');
    expect(new PowerOracle().report('up')).toBe('UP');
  });

  test('L8d Oracle can report DEGRADED', () => {
    expect(readFixture('degraded').state).toBe('DEGRADED');
    expect(new PowerOracle().report('degraded')).toBe('DEGRADED');
  });

  test('L8e Oracle can report STOPPING', () => {
    expect(readFixture('stopping').state).toBe('STOPPING');
    expect(new PowerOracle().report('stopping')).toBe('STOPPING');
  });

  test('L8f Oracle can report UNREACHABLE', () => {
    expect(readFixture('unreachable').state).toBe('UNREACHABLE');
    expect(new PowerOracle().report('unreachable')).toBe('UNREACHABLE');
  });

  test('L8g Oracle can report ERROR', () => {
    expect(readFixture('error').state).toBe('ERROR');
    expect(new PowerOracle().report('error')).toBe('ERROR');
  });

  test('L8h A power transition timeout ends in ERROR rather than DOWN', () => {
    const fixture = readFixture('timeout-error');
    expect(fixture.state).toBe('DOWN');
    expect(fixture.timeout).toBe(true);
    expect(new PowerOracle().report('timeout-error')).toBe('ERROR');
  });

  test('L8j Success requires repeated independent reachability observations', () => {
    const up = readFixture('up');
    expect(up.observations?.map((observation) => observation.method)).toEqual(['ping', 'ssh']);
    expect(up.observations?.every((observation) => observation.up)).toBe(true);
    expect(new PowerOracle().report('up')).toBe('UP');

    const single = readFixture('up-one-observation');
    expect(single.state).toBe('UP');
    expect(single.observations).toEqual([{ method: 'ping', up: true }]);
    expect(() => new PowerOracle().report('up-one-observation')).toThrow(
      /repeated independent reachability/,
    );
  });
});
