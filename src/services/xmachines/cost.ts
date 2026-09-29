import type Database from 'better-sqlite3';

export interface CostConfig {
  tariffPhpPerKwh: number;
  isPlaceholder: boolean;
}

export interface EnergyReading {
  powerWatts: number;
  sampleTime: string;
}

export const DEFAULT_TARIFF = 1.0;
export const BURSTS_CAVEAT = 'bursts shorter than 30 minutes may be missed';

export function getCostConfig(db: Database.Database | null): CostConfig {
  if (!db) {
    return { tariffPhpPerKwh: DEFAULT_TARIFF, isPlaceholder: true };
  }
  try {
    const row = db.prepare("SELECT value FROM xm_config WHERE key = 'xm_cost_tariff_ph_p_per_kwh'").get() as { value: string } | undefined;
    if (!row) {
      return { tariffPhpPerKwh: DEFAULT_TARIFF, isPlaceholder: true };
    }
    const parsed = Number(row.value);
    const isPlaceholder = row.value.toLowerCase().includes('placeholder') || !Number.isFinite(parsed);
    return { tariffPhpPerKwh: Number.isFinite(parsed) ? parsed : DEFAULT_TARIFF, isPlaceholder: isPlaceholder || parsed === 0 };
  } catch {
    return { tariffPhpPerKwh: DEFAULT_TARIFF, isPlaceholder: true };
  }
}

export function integrateKwhFromSamples(samples: readonly EnergyReading[]): number {
  if (!samples.length) return 0;
  const intervalHours = 10 / 60; // must match the sampler cadence (10-min) in index.ts
  let total = 0;
  for (const s of samples) {
    if (!Number.isFinite(s.powerWatts)) continue;
    total += s.powerWatts * intervalHours / 1000;
  }
  return total;
}

export function calculateEnergyCost(kwh: number, cfg: CostConfig): { kwh: number; costPhp: number; tariff: number; isPlaceholder: boolean } {
  const costPhp = Math.round(kwh * cfg.tariffPhpPerKwh * 100) / 100;
  return { kwh, costPhp, tariff: cfg.tariffPhpPerKwh, isPlaceholder: cfg.isPlaceholder };
}

export function buildCostDetail(kwh: number, cfg: CostConfig): { kwh: number; costPhp: number; tariffFlag: string; caveat: string } {
  const { costPhp } = calculateEnergyCost(kwh, cfg);
  return {
    kwh,
    costPhp,
    tariffFlag: cfg.isPlaceholder ? 'placeholder' : 'configured',
    caveat: BURSTS_CAVEAT,
  };
}

export interface CostWindow {
  from: string;
  to: string;
}

export interface MachineCost {
  machine: string;
  kwh: number;
  costPhp: number;
  currency: 'PHP';
  tariffPhpPerKwh: number;
  isPlaceholder: boolean;
  tariffFlag: string;
  caveat: string;
}

type SampleRow = { power_watts: number | null; sample_time: string };

// Product path: the displayed cost is the persisted xm_samples feed for one machine.
export function loadMachineEnergyCost(
  db: Database.Database,
  machine: string,
  window?: CostWindow,
): MachineCost {
  const rows = (window
    ? db.prepare(`
        SELECT power_watts, sample_time
        FROM xm_samples
        WHERE machine_name = ? AND sample_time >= ? AND sample_time < ?
        ORDER BY sample_time, id
      `).all(machine, window.from, window.to)
    : db.prepare(`
        SELECT power_watts, sample_time
        FROM xm_samples
        WHERE machine_name = ?
        ORDER BY sample_time, id
      `).all(machine)) as SampleRow[];

  const samples: EnergyReading[] = rows.map((row) => ({
    powerWatts: typeof row.power_watts === 'number' ? row.power_watts : Number.NaN,
    sampleTime: row.sample_time,
  }));
  const cfg = getCostConfig(db);
  const detail = buildCostDetail(integrateKwhFromSamples(samples), cfg);
  return {
    machine,
    kwh: detail.kwh,
    costPhp: detail.costPhp,
    currency: 'PHP',
    tariffPhpPerKwh: cfg.tariffPhpPerKwh,
    isPlaceholder: cfg.isPlaceholder,
    tariffFlag: detail.tariffFlag,
    caveat: detail.caveat,
  };
}
