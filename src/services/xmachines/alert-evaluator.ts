export type Severity = 'normal' | 'warning' | 'critical';

export interface SamplePoint {
  machine: string;
  t1: number;
  t2: number;
  cpu: number;
  fan: number;
}

export interface WakeStatus {
  machine: string;
  up: boolean;
  lastSeen: number;
}

export interface Alert {
  machine: string;
  type: 'thermal' | 'fan-fail' | 'won\'t-wake';
  level?: Severity;
}

const GPU_WARN = 80;
const GPU_CRIT = 90;
const GPU_HYST = 3;
const CPU_WARN = 85;
const CPU_CRIT = 95;
const FAN_FAIL_TEMP = 60;
const WAKE_TIMEOUT = 180_000;

export class AlertEvaluator {
  private wakes = new Map<string, number>();
  private lastSeverity = new Map<string, Severity>();
  private lastFanFail = new Map<string, number>();
  private lastThermal = new Map<string, number>();

  recordWake(machine: string, ts: number) {
    this.wakes.set(machine, ts);
  }

  evaluateSamples(samples: SamplePoint[]): Alert[] {
    const alerts: Alert[] = [];
    for (const s of samples) {
      const avgGpu = (s.t1 + s.t2) / 2;
      const prev = this.lastSeverity.get(s.machine) ?? 'normal';
      let severity: Severity = 'normal';

      const up = avgGpu >= GPU_CRIT;
      const warn = avgGpu >= GPU_WARN;
      if (up) severity = 'critical';
      else if (warn) severity = 'warning';

      if (prev === 'critical' && severity !== 'critical') {
        if (avgGpu > GPU_CRIT - GPU_HYST) severity = 'critical';
      }
      if (prev === 'warning' && severity !== 'warning') {
        if (avgGpu > GPU_WARN - GPU_HYST) severity = 'warning';
      }

      const counts = this.lastThermal.get(s.machine) ?? 0;
      if (severity !== 'normal') {
        const newCount = counts + 1;
        this.lastThermal.set(s.machine, newCount);
        if (newCount >= 2) {
          const now = Date.now();
          const last = this.lastFanFail.get(s.machine) ?? 0;
          if (now - last > 30 * 60 * 1000) {
            alerts.push({ machine: s.machine, type: 'thermal', level: severity });
            this.lastFanFail.set(s.machine, now);
          }
        }
      } else {
        this.lastThermal.set(s.machine, 0);
      }

      if (s.fan === 0 && avgGpu > FAN_FAIL_TEMP) {
        const now = Date.now();
        const last = this.lastFanFail.get(s.machine) ?? 0;
        if (now - last > 30 * 60 * 1000) {
          alerts.push({ machine: s.machine, type: 'fan-fail' });
          this.lastFanFail.set(s.machine, now);
        }
      }

      this.lastSeverity.set(s.machine, severity);
    }
    return alerts;
  }

  evaluateWakeStatus(statuses: WakeStatus[]): Alert[] {
    const alerts: Alert[] = [];
    const now = Date.now();
    for (const s of statuses) {
      const wake = this.wakes.get(s.machine);
      if (!s.up && wake && now - wake > WAKE_TIMEOUT) {
        alerts.push({ machine: s.machine, type: 'won\'t-wake' });
      }
    }
    return alerts;
  }
}
