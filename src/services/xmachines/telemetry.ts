export interface MachineTelemetry {
  name: string;
  state: 'up' | 'down' | 'synthetic';
  cpuTemp: number;
  gpuTemp: number;
  powerWatts: number;
  uptime: string;
  provenance: string;
  sampleAge: string;
}

export class SyntheticTelemetry {
  private machines = ['gpu', 'hdd', 'gpu2', 'media'];

  generate(): MachineTelemetry[] {
    return this.machines.map((name) => ({
      name,
      state: 'synthetic',
      cpuTemp: 45 + Math.floor(Math.random() * 20),
      gpuTemp: 50 + Math.floor(Math.random() * 30),
      powerWatts: 150 + Math.floor(Math.random() * 200),
      uptime: 'synthetic',
      provenance: 'fake',
      sampleAge: '0s',
    }));
  }

  forMachine(name: string): MachineTelemetry {
    const base = this.generate().find((m) => m.name === name);
    return base ?? {
      name,
      state: 'synthetic',
      cpuTemp: 0,
      gpuTemp: 0,
      powerWatts: 0,
      uptime: 'synthetic',
      provenance: 'fake',
      sampleAge: '0s',
    };
  }
}
