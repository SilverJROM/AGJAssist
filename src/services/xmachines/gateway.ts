import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface XmacGateway {
  status: (name: string) => Promise<{ name: string; state: string; ip?: string }>;
  leases: () => Promise<Array<unknown>>;
  down: (name: string) => Promise<{ actuated: boolean; argv?: string[] }>;
  up: (name: string) => Promise<{ actuated: boolean; argv?: string[] }>;
}

export interface FakeGatewayOptions {
  machines?: string[];
}

export class FakeGateway implements XmacGateway {
  private machines: Set<string>;
  private actuations: Array<{ machine: string; action: string; argv: string[] }> = [];

  constructor(opts: FakeGatewayOptions = {}) {
    const defaultMachines = ['gpu', 'hdd', 'gpu2', 'media'];
    this.machines = new Set(opts.machines ?? defaultMachines);
  }

  async status(name: string) {
    return { name, state: 'synthetic', ip: '0.0.0.0' };
  }

  async leases() {
    return [];
  }

  async down(name: string) {
    const argv = ['down', name];
    this.actuations.push({ machine: name, action: 'down', argv });
    return { actuated: false, argv };
  }

  async up(name: string) {
    const argv = ['up', name];
    this.actuations.push({ machine: name, action: 'up', argv });
    return { actuated: false, argv };
  }

  getActuations() {
    return this.actuations;
  }
}

export class RealXmacGateway implements XmacGateway {
  private async xmac(args: string[]): Promise<void> {
    await execFileAsync('xmac.sh', args);
  }

  async status(name: string) {
    await this.xmac(['status', name]);
    return { name, state: 'unknown' };
  }

  async leases() {
    await this.xmac(['leases']);
    return [];
  }

  async down(name: string) {
    const argv = ['down', name];
    await this.xmac(argv);
    return { actuated: true, argv };
  }

  async up(name: string) {
    const argv = ['up', name];
    await this.xmac(argv);
    return { actuated: true, argv };
  }
}
