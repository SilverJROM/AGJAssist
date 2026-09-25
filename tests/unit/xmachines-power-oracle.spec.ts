import { PowerOracle } from '../../src/services/xmachines/power-oracle.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('xmachines power oracle', () => {
  let tmpDir: string;
  let fixtures: Record<string, PowerOracle>;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-'));
    const files = {
      down: { state: 'DOWN' },
      starting: { state: 'STARTING' },
      up: { state: 'UP', observations: [{ method: 'ping', up: true }, { method: 'ssh', up: true }] },
      degraded: { state: 'DEGRADED' },
      stopping: { state: 'STOPPING' },
      unreachable: { state: 'UNREACHABLE' },
      error: { state: 'ERROR' },
      'timeout-error': { state: 'DOWN', timeout: true },
    };
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(tmpDir, `${name}.json`), JSON.stringify(content));
    }
    process.env.XMAC_ORACLE_FIXTURE_DIR = tmpDir;
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('L8a Oracle can report DOWN', () => {
    const oracle = new PowerOracle();
    expect(oracle.report('down')).toBe('DOWN');
  });

  test('L8b Oracle can report STARTING', () => {
    const oracle = new PowerOracle();
    expect(oracle.report('starting')).toBe('STARTING');
  });

  test('L8c Oracle can report UP', () => {
    const oracle = new PowerOracle();
    expect(oracle.report('up')).toBe('UP');
  });

  test('L8d Oracle can report DEGRADED', () => {
    const oracle = new PowerOracle();
    expect(oracle.report('degraded')).toBe('DEGRADED');
  });

  test('L8e Oracle can report STOPPING', () => {
    const oracle = new PowerOracle();
    expect(oracle.report('stopping')).toBe('STOPPING');
  });

  test('L8f Oracle can report UNREACHABLE', () => {
    const oracle = new PowerOracle();
    expect(oracle.report('unreachable')).toBe('UNREACHABLE');
  });

  test('L8g Oracle can report ERROR', () => {
    const oracle = new PowerOracle();
    expect(oracle.report('error')).toBe('ERROR');
  });

  test('L8h A power transition timeout ends in ERROR rather than DOWN', () => {
    const oracle = new PowerOracle();
    expect(oracle.report('timeout-error')).toBe('ERROR');
  });

  test('L8j Success requires repeated independent reachability observations', () => {
    const badTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-bad-'));
    fs.writeFileSync(path.join(badTmp, 'up.json'), JSON.stringify({ state: 'UP', observations: [{ method: 'ping', up: true }] }));
    process.env.XMAC_ORACLE_FIXTURE_DIR = badTmp;
    const oracle = new PowerOracle();
    expect(() => oracle.report('up')).toThrow(/repeated independent reachability/);
    fs.rmSync(badTmp, { recursive: true, force: true });
  });
});
