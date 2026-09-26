import { describe, it, expect } from 'vitest';
import { integrateKwhFromSamples, calculateEnergyCost, getCostConfig, buildCostDetail } from '../../src/services/xmachines/cost.js';

describe('xmachines cost integration B13', () => {
  it('I4a integrates kWh from persisted 30-minute samples', () => {
    const samples = [
      { powerWatts: 120, sampleTime: '2026-01-01T00:00:00Z' },
      { powerWatts: 180, sampleTime: '2026-01-01T00:30:00Z' },
    ];
    const kwh = integrateKwhFromSamples(samples);
    // 0.5h * (120+180)/1000 = 0.15 kWh
    expect(kwh).toBeCloseTo(0.15, 3);
  });

  it('I4b cost displays in PHP', () => {
    const cfg = { tariffPhpPerKwh: 10, isPlaceholder: false };
    const res = calculateEnergyCost(2.5, cfg);
    expect(res.costPhp).toBe(25);
  });

  it('I4c default tariff flagged as placeholder', () => {
    const cfg = getCostConfig(null);
    expect(cfg.isPlaceholder).toBe(true);
    expect(cfg.tariffPhpPerKwh).toBe(1);
  });

  it('I4d cost detail states bursts shorter than 30 minutes may be missed', () => {
    const cfg = { tariffPhpPerKwh: 5, isPlaceholder: true };
    const detail = buildCostDetail(1, cfg);
    expect(detail.caveat).toBe('bursts shorter than 30 minutes may be missed');
  });

  it('C3e same sampled on-hours feed cost calculation', () => {
    const cfg = { tariffPhpPerKwh: 9, isPlaceholder: true };
    const samples = [{ powerWatts: 200, sampleTime: '2026-01-01T00:00:00Z' }];
    const kwh = integrateKwhFromSamples(samples);
    const detail = buildCostDetail(kwh, cfg);
    expect(detail.kwh).toBeGreaterThan(0);
    expect(detail.costPhp).toBeGreaterThan(0);
  });
});
