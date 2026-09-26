import { afterEach, describe, expect, it, vi } from 'vitest';
import { AlertEvaluator, type SamplePoint } from '../../src/services/xmachines/alert-evaluator.js';

const START = new Date('2026-09-26T12:00:00.000Z');
const DEDUPE_MS = 30 * 60 * 1000;

function at(ms: number) {
  vi.useFakeTimers();
  vi.setSystemTime(ms);
}

function sample(over: Partial<SamplePoint> = {}): SamplePoint {
  return { machine: 'gpu', t1: 40, t2: 40, cpu: 40, fan: 1200, ...over };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('xmachines-alert-evaluator', () => {
  it('persisted thermal breach creates one alert', () => {
    at(START.getTime());
    const ev = new AlertEvaluator();
    const alerts = ev.evaluateSamples([
      sample({ t1: 81, t2: 82, cpu: 70, fan: 50 }),
      sample({ t1: 82, t2: 83, cpu: 72, fan: 50 }),
    ]);
    const thermal = alerts.filter(a => a.type === 'thermal');
    expect(thermal.length).toBe(1);
    expect(thermal[0].level).toBe('warning');
  });

  it('a GPU sample at 90C renders critical after two samples', () => {
    at(START.getTime());
    const ev = new AlertEvaluator();
    const alerts = ev.evaluateSamples([
      sample({ t1: 90, t2: 90, cpu: 40, fan: 1200 }),
      sample({ t1: 90, t2: 90, cpu: 40, fan: 1200 }),
    ]);
    expect(alerts).toEqual([{ machine: 'gpu', type: 'thermal', level: 'critical' }]);
  });

  it('GPU critical still appears after a persisted warning', () => {
    at(START.getTime());
    const ev = new AlertEvaluator();
    const warning = ev.evaluateSamples([
      sample({ t1: 82, t2: 82, cpu: 40, fan: 1200 }),
      sample({ t1: 82, t2: 82, cpu: 40, fan: 1200 }),
    ]);
    expect(warning).toEqual([{ machine: 'gpu', type: 'thermal', level: 'warning' }]);
    const critical = ev.evaluateSamples([
      sample({ t1: 91, t2: 91, cpu: 40, fan: 1200 }),
      sample({ t1: 91, t2: 91, cpu: 40, fan: 1200 }),
    ]);
    expect(critical).toEqual([{ machine: 'gpu', type: 'thermal', level: 'critical' }]);
  });

  it('GPU critical holds at 88C and clears to warning at 86C', () => {
    at(START.getTime());
    const ev = new AlertEvaluator();
    expect(ev.evaluateSamples([
      sample({ t1: 91, t2: 91 }),
      sample({ t1: 91, t2: 91 }),
    ])).toEqual([{ machine: 'gpu', type: 'thermal', level: 'critical' }]);
    expect(ev.evaluateSamples([
      sample({ t1: 88, t2: 88 }),
      sample({ t1: 88, t2: 88 }),
    ])).toEqual([]);
    expect(ev.evaluateSamples([
      sample({ t1: 86, t2: 86 }),
      sample({ t1: 86, t2: 86 }),
    ])).toEqual([{ machine: 'gpu', type: 'thermal', level: 'warning' }]);
  });

  it('GPU warning holds at 78C through the 3C band and re-notifies after 30 minutes', () => {
    at(START.getTime());
    const ev = new AlertEvaluator();
    expect(ev.evaluateSamples([
      sample({ t1: 80, t2: 80 }),
      sample({ t1: 80, t2: 80 }),
    ])).toEqual([{ machine: 'gpu', type: 'thermal', level: 'warning' }]);
    expect(ev.evaluateSamples([
      sample({ t1: 78, t2: 78 }),
      sample({ t1: 78, t2: 78 }),
    ])).toEqual([]);
    at(START.getTime() + DEDUPE_MS);
    expect(ev.evaluateSamples([sample({ t1: 78, t2: 78 })])).toEqual([]);
    at(START.getTime() + DEDUPE_MS + 1);
    expect(ev.evaluateSamples([sample({ t1: 78, t2: 78 })])).toEqual([
      { machine: 'gpu', type: 'thermal', level: 'warning' },
    ]);
  });

  it('two CPU samples at 85C with a cool GPU render warning', () => {
    at(START.getTime());
    const ev = new AlertEvaluator();
    const alerts = ev.evaluateSamples([
      sample({ t1: 50, t2: 50, cpu: 85, fan: 100 }),
      sample({ t1: 50, t2: 50, cpu: 85, fan: 100 }),
    ]);
    expect(alerts).toEqual([{ machine: 'gpu', type: 'thermal', level: 'warning' }]);
  });

  it('two CPU samples at 95C with a cool GPU render critical', () => {
    at(START.getTime());
    const ev = new AlertEvaluator();
    const alerts = ev.evaluateSamples([
      sample({ t1: 50, t2: 50, cpu: 95, fan: 100 }),
      sample({ t1: 50, t2: 50, cpu: 95, fan: 100 }),
    ]);
    expect(alerts).toEqual([{ machine: 'gpu', type: 'thermal', level: 'critical' }]);
  });

  it('CPU 90C is warning and CPU 82C is silent so the thresholds are 85 and 95', () => {
    at(START.getTime());
    const warn = new AlertEvaluator();
    expect(warn.evaluateSamples([
      sample({ t1: 50, t2: 50, cpu: 90, fan: 100 }),
      sample({ t1: 50, t2: 50, cpu: 90, fan: 100 }),
    ])).toEqual([{ machine: 'gpu', type: 'thermal', level: 'warning' }]);
    const silent = new AlertEvaluator();
    expect(silent.evaluateSamples([
      sample({ t1: 50, t2: 50, cpu: 82, fan: 100 }),
      sample({ t1: 50, t2: 50, cpu: 82, fan: 100 }),
    ])).toEqual([]);
  });

  it('CPU severity alerts only after that same severity persists for two samples', () => {
    at(START.getTime());
    const ev = new AlertEvaluator();
    expect(ev.evaluateSamples([sample({ t1: 50, t2: 50, cpu: 85, fan: 100 })])).toEqual([]);
    expect(ev.evaluateSamples([sample({ t1: 50, t2: 50, cpu: 95, fan: 100 })])).toEqual([]);
    expect(ev.evaluateSamples([sample({ t1: 50, t2: 50, cpu: 95, fan: 100 })])).toEqual([
      { machine: 'gpu', type: 'thermal', level: 'critical' },
    ]);
  });

  it('CPU critical outranks a GPU warning', () => {
    at(START.getTime());
    const ev = new AlertEvaluator();
    expect(ev.evaluateSamples([
      sample({ t1: 82, t2: 82, cpu: 95, fan: 1200 }),
      sample({ t1: 82, t2: 82, cpu: 95, fan: 1200 }),
    ])).toEqual([{ machine: 'gpu', type: 'thermal', level: 'critical' }]);
  });

  it('fan at 0 RPM for two samples while GPU temperature exceeds 60C creates one fan-fail alert', () => {
    at(START.getTime());
    const ev = new AlertEvaluator();
    const alerts = ev.evaluateSamples([
      sample({ t1: 65, t2: 67, cpu: 60, fan: 0 }),
      sample({ t1: 67, t2: 68, cpu: 62, fan: 0 }),
    ]);
    const fan = alerts.filter(a => a.type === 'fan-fail');
    expect(fan.length).toBe(1);
    expect(alerts.filter(a => a.type === 'thermal')).toEqual([]);
  });

  it('one failing fan sample stays silent, and a cleared streak must reach two again', () => {
    at(START.getTime());
    const ev = new AlertEvaluator();
    expect(ev.evaluateSamples([
      sample({ t1: 70, t2: 70, cpu: 40, fan: 0 }),
    ]).filter(a => a.type === 'fan-fail')).toEqual([]);
    expect(ev.evaluateSamples([
      sample({ t1: 70, t2: 70, cpu: 40, fan: 800 }),
    ]).filter(a => a.type === 'fan-fail')).toEqual([]);
    expect(ev.evaluateSamples([
      sample({ t1: 70, t2: 70, cpu: 40, fan: 0 }),
    ]).filter(a => a.type === 'fan-fail')).toEqual([]);
    expect(ev.evaluateSamples([
      sample({ t1: 70, t2: 70, cpu: 40, fan: 0 }),
    ])).toEqual([{ machine: 'gpu', type: 'fan-fail' }]);
  });

  it('fan at 0 RPM with GPU at 60C does not fan-fail', () => {
    at(START.getTime());
    const ev = new AlertEvaluator();
    expect(ev.evaluateSamples([
      sample({ t1: 60, t2: 60, cpu: 40, fan: 0 }),
      sample({ t1: 60, t2: 60, cpu: 40, fan: 0 }),
    ])).toEqual([]);
  });

  it('thermal and fan-fail on the same machine both alert inside one window', () => {
    at(START.getTime());
    const ev = new AlertEvaluator();
    const first = ev.evaluateSamples([
      sample({ t1: 82, t2: 82, cpu: 40, fan: 0 }),
      sample({ t1: 82, t2: 82, cpu: 40, fan: 0 }),
    ]);
    expect(first).toEqual([
      { machine: 'gpu', type: 'thermal', level: 'warning' },
      { machine: 'gpu', type: 'fan-fail' },
    ]);
    expect(ev.evaluateSamples([
      sample({ t1: 82, t2: 82, cpu: 40, fan: 0 }),
      sample({ t1: 82, t2: 82, cpu: 40, fan: 0 }),
    ])).toEqual([]);
    at(START.getTime() + DEDUPE_MS + 1);
    expect(ev.evaluateSamples([
      sample({ t1: 82, t2: 82, cpu: 40, fan: 0 }),
    ])).toEqual([
      { machine: 'gpu', type: 'thermal', level: 'warning' },
      { machine: 'gpu', type: 'fan-fail' },
    ]);
  });

  it('WAKE with no verified UP after 180 seconds creates one won\'t-wake alert', () => {
    at(START.getTime());
    const ev = new AlertEvaluator();
    const wakeAt = START.getTime() - 200 * 1000;
    ev.recordWake('gpu', wakeAt);
    const alerts = ev.evaluateWakeStatus([{ machine: 'gpu', up: false, lastSeen: wakeAt }]);
    expect(alerts.filter(a => a.type === 'won\'t-wake')).toEqual([
      { machine: 'gpu', type: 'won\'t-wake' },
    ]);
    expect(ev.evaluateWakeStatus([{ machine: 'gpu', up: false, lastSeen: wakeAt }])).toEqual([]);
  });

  it('won\'t-wake stays silent at 180 seconds, alerts once it exceeds that, and dedupes per machine', () => {
    at(START.getTime());
    const ev = new AlertEvaluator();
    ev.recordWake('gpu', START.getTime() - 180_000);
    ev.recordWake('hdd', START.getTime() - 180_001);
    ev.recordWake('nas', START.getTime() - 200_000);
    expect(ev.evaluateWakeStatus([
      { machine: 'gpu', up: false, lastSeen: START.getTime() - 180_000 },
      { machine: 'nas', up: true, lastSeen: START.getTime() - 200_000 },
      { machine: 'hdd', up: false, lastSeen: START.getTime() - 180_001 },
    ])).toEqual([{ machine: 'hdd', type: 'won\'t-wake' }]);
    at(START.getTime() + 1);
    expect(ev.evaluateWakeStatus([
      { machine: 'gpu', up: false, lastSeen: START.getTime() - 180_000 },
    ])).toEqual([{ machine: 'gpu', type: 'won\'t-wake' }]);
    expect(ev.evaluateWakeStatus([
      { machine: 'gpu', up: false, lastSeen: START.getTime() - 180_000 },
    ])).toEqual([]);
    at(START.getTime() + 1 + DEDUPE_MS);
    expect(ev.evaluateWakeStatus([
      { machine: 'gpu', up: false, lastSeen: START.getTime() - 180_000 },
    ])).toEqual([]);
    at(START.getTime() + 1 + DEDUPE_MS + 1);
    expect(ev.evaluateWakeStatus([
      { machine: 'gpu', up: false, lastSeen: START.getTime() - 180_000 },
    ])).toEqual([{ machine: 'gpu', type: 'won\'t-wake' }]);
  });
});
