import fs from 'node:fs';
import path from 'node:path';

export type PowerState = 'DOWN' | 'STARTING' | 'UP' | 'DEGRADED' | 'STOPPING' | 'UNREACHABLE' | 'ERROR';

export interface ReachabilityObservation {
  method: string;
  up: boolean;
  at?: string;
}

export interface OracleFixture {
  state: PowerState;
  observations?: ReachabilityObservation[];
  timeout?: boolean;
}

export class PowerOracle {
  readonly fixtureDir: string;
  constructor(fixtureDir?: string) {
    const envDir = process.env.XMAC_ORACLE_FIXTURE_DIR;
    this.fixtureDir = fixtureDir ?? envDir ?? path.join(process.cwd(), 'tests/fixtures/xmachines/oracle');
  }

  private loadFixture(name: string): OracleFixture {
    const file = path.join(this.fixtureDir, `${name}.json`);
    if (!fs.existsSync(file)) {
      throw new Error(`Oracle fixture ${name} not found at ${file}`);
    }
    const raw = fs.readFileSync(file, 'utf-8');
    return JSON.parse(raw) as OracleFixture;
  }

  report(fixtureName: string): PowerState {
    const fixture = this.loadFixture(fixtureName);
    const state = this.validateAndInfer(fixture, fixtureName);
    return state;
  }

  private validateAndInfer(fixture: OracleFixture, name: string): PowerState {
    const { state, observations = [], timeout } = fixture;

    // Repeated independent reachability for UP
    if (state === 'UP') {
      if (observations.length < 2) {
        throw new Error(`UP requires repeated independent reachability observations, got ${observations.length}`);
      }
      const methods = new Set(observations.map(o => o.method));
      if (methods.size < 2 || !observations.every(o => o.up)) {
        throw new Error(`UP observations must be independent and up; fixture ${name} failed`);
      }
      return 'UP';
    }

    // Timeout ends in ERROR rather than DOWN
    if (timeout) {
      return 'ERROR';
    }

    // UNREACHABLE is reporting, never live gateway success
    if (state === 'UNREACHABLE') {
      return 'UNREACHABLE';
    }

    // DEGRADED, STOPPING, STARTING, DOWN, ERROR are reported as-is
    // Never claim live gateway success; fixtures are the source of truth
    return state;
  }
}
