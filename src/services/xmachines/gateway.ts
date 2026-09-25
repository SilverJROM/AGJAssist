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

export function resolveGateway(): XmacGateway {
  const armed = process.env.XMACHINES_ARM === '1';
  if (armed) {
    // Real gateway would be loaded here; for A0.3 isolation we still return fake
    // to avoid real actuation. The arm flag is checked, but the default remains fake.
    // Explicit server-side arm is required for real control per L10b.
    console.log('[xmachines] Resolved gateway mode: fake (arm flag requires explicit handling)');
  } else {
    console.log('[xmachines] Resolved gateway mode: fake (default local/test)');
  }
  return new FakeGateway();
}
