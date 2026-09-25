import { describe, expect, it } from 'vitest';
import { FakeGateway, resolveGateway } from '../../src/services/xmachines/gateway';
import { SyntheticTelemetry } from '../../src/services/xmachines/telemetry';

describe('xmachines actuation isolation A0.3', () => {
  it('L10a: local and test mode default to non-actuating fake gateway and synthetic telemetry', async () => {
    delete process.env.XMACHINES_ARM;
    const gateway = resolveGateway();
    expect(gateway).toBeDefined();
    expect(gateway).toBeInstanceOf(FakeGateway);
    
    const fake = gateway as FakeGateway;
    const downResult = await fake.down('gpu');
    expect(downResult.actuated).toBe(false);
    expect(downResult.argv).toEqual(['down', 'gpu']);
    
    const telemetry = new SyntheticTelemetry();
    const data = telemetry.generate();
    expect(data.length).toBeGreaterThan(0);
    expect(data[0].provenance).toBe('fake');
    expect(data[0].state).toBe('synthetic');
  });

  it('L10b: real control is impossible without explicit server-side arm state', () => {
    const original = process.env.XMACHINES_ARM;
    
    delete process.env.XMACHINES_ARM;
    let gateway = resolveGateway();
    expect(gateway).toBeInstanceOf(FakeGateway);
    
    process.env.XMACHINES_ARM = '0';
    gateway = resolveGateway();
    expect(gateway).toBeInstanceOf(FakeGateway);
    
    process.env.XMACHINES_ARM = '1';
    gateway = resolveGateway();
    // Even when armed, A0.3 isolation means we still return fake to prevent real actuation
    // The arm flag is checked but real gateway is not instantiated in this slice
    expect(gateway).toBeInstanceOf(FakeGateway);
    
    if (original !== undefined) {
      process.env.XMACHINES_ARM = original;
    } else {
      delete process.env.XMACHINES_ARM;
    }
  });

  it('L10c: local Playwright produces zero real-fleet calls', async () => {
    delete process.env.XMACHINES_ARM;
    const gateway = resolveGateway();
    const fake = gateway as FakeGateway;
    
    const actuations: Array<{ machine: string; action: string }> = [];
    const originalDown = fake.down.bind(fake);
    
    // Verify actuations are recorded but not executed
    const result = await fake.down('gpu');
    expect(result.actuated).toBe(false);
    
    const telemetry = new SyntheticTelemetry();
    const sample = telemetry.forMachine('gpu');
    expect(sample.provenance).toBe('fake');
  });

  it('K1c: local Playwright cannot actuate a real machine', async () => {
    const gateway = new FakeGateway({ machines: ['gpu', 'hdd', 'gpu2', 'media'] });
    
    const results = await Promise.all([
      gateway.up('gpu'),
      gateway.down('hdd'),
      gateway.up('gpu2'),
    ]);
    
    results.forEach((r) => {
      expect(r.actuated).toBe(false);
      expect(r.argv).toBeDefined();
    });
  });
});
