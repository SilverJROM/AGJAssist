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
const DEDUPE_MS = 30 * 60 * 1000;

const SEVERITY_RANK: Record<Severity, number> = {
  normal: 0,
  warning: 1,
  critical: 2,
};

function higherSeverity(a: Severity, b: Severity): Severity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

export class AlertEvaluator {
  private wakes = new Map<string, number>();
  private lastGpuSeverity = new Map<string, Severity>();
  private thermalStreak = new Map<string, { severity: Severity; count: number }>();
  private fanStreak = new Map<string, number>();
  private lastAlert = new Map<string, number>();

  recordWake(machine: string, ts: number) {
    this.wakes.set(machine, ts);
  }

  /** True when this alert identity has not been emitted inside the 30-minute window. */
  private due(key: string, now: number): boolean {
    const last = this.lastAlert.get(key);
    if (last !== undefined && now - last <= DEDUPE_MS) return false;
    this.lastAlert.set(key, now);
    return true;
  }

  private gpuSeverity(machine: string, avgGpu: number): Severity {
    const prev = this.lastGpuSeverity.get(machine) ?? 'normal';
    let severity: Severity = 'normal';
    if (avgGpu >= GPU_CRIT) severity = 'critical';
    else if (avgGpu >= GPU_WARN) severity = 'warning';

    if (prev === 'critical' && severity !== 'critical' && avgGpu > GPU_CRIT - GPU_HYST) {
      severity = 'critical';
    }
    // Hold warning only on the way down. A rise through 90°C must stay critical.
    if (prev === 'warning' && severity === 'normal' && avgGpu > GPU_WARN - GPU_HYST) {
      severity = 'warning';
    }

    this.lastGpuSeverity.set(machine, severity);
    return severity;
  }

  private cpuSeverity(cpu: number): Severity {
    if (cpu >= CPU_CRIT) return 'critical';
    if (cpu >= CPU_WARN) return 'warning';
    return 'normal';
  }

  evaluateSamples(samples: SamplePoint[]): Alert[] {
    const alerts: Alert[] = [];
    const now = Date.now();
    for (const s of samples) {
      const avgGpu = (s.t1 + s.t2) / 2;
      const severity = higherSeverity(this.gpuSeverity(s.machine, avgGpu), this.cpuSeverity(s.cpu));

      const streak = this.thermalStreak.get(s.machine);
      let count = 0;
      if (severity === 'normal') {
        count = 0;
      } else if (streak && streak.severity === severity) {
        count = streak.count + 1;
      } else {
        count = 1;
      }
      this.thermalStreak.set(s.machine, { severity, count });

      if (severity !== 'normal' && count >= 2) {
        const key = `${s.machine}:thermal:${severity}`;
        if (this.due(key, now)) {
          alerts.push({ machine: s.machine, type: 'thermal', level: severity });
        }
      }

      const fanFailing = s.fan === 0 && avgGpu > FAN_FAIL_TEMP;
      const fanCount = fanFailing ? (this.fanStreak.get(s.machine) ?? 0) + 1 : 0;
      this.fanStreak.set(s.machine, fanCount);
      if (fanCount >= 2) {
        const key = `${s.machine}:fan-fail`;
        if (this.due(key, now)) {
          alerts.push({ machine: s.machine, type: 'fan-fail' });
        }
      }
    }
    return alerts;
  }

  evaluateWakeStatus(statuses: WakeStatus[]): Alert[] {
    const alerts: Alert[] = [];
    const now = Date.now();
    for (const s of statuses) {
      const wake = this.wakes.get(s.machine);
      if (!s.up && wake && now - wake > WAKE_TIMEOUT) {
        const key = `${s.machine}:won't-wake`;
        if (this.due(key, now)) {
          alerts.push({ machine: s.machine, type: 'won\'t-wake' });
        }
      }
    }
    return alerts;
  }
}
