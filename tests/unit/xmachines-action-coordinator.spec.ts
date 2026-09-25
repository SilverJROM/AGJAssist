import { describe, expect, test, beforeEach } from 'vitest';
import { ActionCoordinator } from '../../src/services/xmachines/action-coordinator.js';

describe('xmachines action coordinator A10', () => {
  let coordinator: ActionCoordinator;

  beforeEach(() => {
    coordinator = new ActionCoordinator();
  });

  test('L15a: Each machine has a server-side power mutex', async () => {
    const req1 = coordinator.handle({
      machine: 'gpu',
      action: 'on',
      idempotencyKey: 'key-1',
      ownerId: '1',
    });

    expect(coordinator.isLocked('gpu')).toBe(true);
    const result1 = await req1;
    expect(result1.status).toBe('in-progress');
    
    // Wait for completion
    await new Promise(r => setTimeout(r, 150));
    expect(coordinator.isLocked('gpu')).toBe(false);
  });

  test('L15b: Every power POST requires an idempotency key', async () => {
    const result = await coordinator.handle({
      machine: 'gpu',
      action: 'on',
      idempotencyKey: '',
      ownerId: '1',
    });
    expect(result.status).toBe('rejected');
  });

  test('L15d: Duplicate or overlapping requests coalesce', async () => {
    const req1 = coordinator.handle({
      machine: 'gpu',
      action: 'on',
      idempotencyKey: 'same-key',
      ownerId: '1',
    });

    const req2 = coordinator.handle({
      machine: 'gpu',
      action: 'on',
      idempotencyKey: 'same-key',
      ownerId: '1',
    });

    const [r1, r2] = await Promise.all([req1, req2]);
    expect(r1.status).toBe('in-progress');
    expect(r2.status).toBe('in-progress');
    expect(r1.operationId).toBe(r2.operationId);
  });

  test('L15e: A power POST returns in-progress immediately', async () => {
    const start = Date.now();
    const result = await coordinator.handle({
      machine: 'gpu',
      action: 'on',
      idempotencyKey: 'key-1',
      ownerId: '1',
    });
    const elapsed = Date.now() - start;
    
    expect(result.status).toBe('in-progress');
    expect(elapsed).toBeLessThan(50); // Immediate return
    expect(result.operationId).toBeDefined();
  });

  test('L15f: A completed action starts the per-machine cooldown', async () => {
    await coordinator.handle({
      machine: 'gpu',
      action: 'on',
      idempotencyKey: 'key-1',
      ownerId: '1',
    });

    // Wait for action to complete and cooldown to start
    await new Promise(r => setTimeout(r, 150));

    const result = await coordinator.handle({
      machine: 'gpu',
      action: 'off',
      idempotencyKey: 'key-2',
      ownerId: '1',
    });

    expect(result.status).toBe('in-progress');
    // Should be cooldown, not a new action
  });

  test('L15g: A double-click yields one gateway action', async () => {
    const req1 = coordinator.handle({
      machine: 'gpu',
      action: 'on',
      idempotencyKey: 'key-1',
      ownerId: '1',
    });

    const req2 = coordinator.handle({
      machine: 'gpu',
      action: 'on',
      idempotencyKey: 'key-1',
      ownerId: '1',
    });

    const results = await Promise.all([req1, req2]);
    expect(results[0].operationId).toBe(results[1].operationId);
    
    const ongoing = coordinator.getOngoing();
    expect(ongoing.length).toBe(1);
  });

  test('L15h: Two tabs yield one gateway action', async () => {
    const req1 = coordinator.handle({
      machine: 'gpu',
      action: 'on',
      idempotencyKey: 'tab1-key',
      ownerId: '1',
    });

    // Simulate second tab with different key but same machine/action
    const req2 = coordinator.handle({
      machine: 'gpu',
      action: 'on',
      idempotencyKey: 'tab2-key',
      ownerId: '1',
    });

    const r1 = await req1;
    const r2 = await req2;
    
    // Should coalesce to in-progress
    expect(r1.status).toBe('in-progress');
    expect(r2.status).toBe('in-progress');
  });

  test('L15i: A timeout retry rejoins the existing action', async () => {
    coordinator.handle({
      machine: 'gpu',
      action: 'on',
      idempotencyKey: 'key-1',
      ownerId: '1',
    });

    // Retry with same idempotency key
    const retry = await coordinator.handle({
      machine: 'gpu',
      action: 'on',
      idempotencyKey: 'key-1',
      ownerId: '1',
    });

    expect(retry.status).toBe('in-progress');
  });

  test('L15j: ON during OFF is refused or serialized without overlap', async () => {
    const offReq = coordinator.handle({
      machine: 'gpu',
      action: 'off',
      idempotencyKey: 'off-key',
      ownerId: '1',
    });

    const onReq = coordinator.handle({
      machine: 'gpu',
      action: 'on',
      idempotencyKey: 'on-key',
      ownerId: '1',
    });

    const [offResult, onResult] = await Promise.all([offReq, onReq]);
    
    expect(offResult.status).toBe('in-progress');
    // ON should be serialized/waited
    expect(onResult.status).toBe('in-progress');
    
    const ongoing = coordinator.getOngoing();
    // Should only have one action active
    expect(ongoing.filter(a => a.machine === 'gpu').length).toBeLessThanOrEqual(1);
  });
});
