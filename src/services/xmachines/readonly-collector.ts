import { SyntheticTelemetry, type MachineTelemetry } from './telemetry.js';

export class ReadOnlyCollector {
  private readonly telemetry = new SyntheticTelemetry();

  generate(): MachineTelemetry[] {
    return this.telemetry.generate();
  }

  forMachine(name: string): MachineTelemetry | undefined {
    return this.telemetry.forMachine(name);
  }
}
