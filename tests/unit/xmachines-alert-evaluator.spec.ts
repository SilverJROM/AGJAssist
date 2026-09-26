import { describe, it, expect } from 'vitest';
import { AlertEvaluator } from '../../src/services/xmachines/alert-evaluator.js';

describe('xmachines-alert-evaluator', () => {
  it('persisted thermal breach creates one alert', () => {
    const ev = new AlertEvaluator();
    const samples = [
      { machine: 'gpu', t1: 81, t2: 82, cpu: 70, fan: 50 },
      { machine: 'gpu', t1: 82, t2: 83, cpu: 72, fan: 50 },
    ];
    const alerts = ev.evaluateSamples(samples);
    const thermal = alerts.filter(a => a.type === 'thermal');
    expect(thermal.length).toBe(1);
    expect(thermal[0].level).toBe('warning');
  });

  it('fan at 0 RPM for two samples while GPU temperature exceeds 60C creates one fan-fail alert', () => {
    const ev = new AlertEvaluator();
    const samples = [
      { machine: 'gpu', t1: 65, t2: 67, cpu: 60, fan: 0 },
      { machine: 'gpu', t1: 67, t2: 68, cpu: 62, fan: 0 },
    ];
    const alerts = ev.evaluateSamples(samples);
    const fan = alerts.filter(a => a.type === 'fan-fail');
    expect(fan.length).toBe(1);
  });

  it('WAKE with no verified UP after 180 seconds creates one won\'t-wake alert', () => {
    const ev = new AlertEvaluator();
    const wakeAt = Date.now() - 200*1000;
    ev.recordWake('gpu', wakeAt);
    const alerts = ev.evaluateWakeStatus([{ machine: 'gpu', up: false, lastSeen: wakeAt }]);
    const won = alerts.filter(a => a.type === 'won\'t-wake');
    expect(won.length).toBe(1);
  });
});
