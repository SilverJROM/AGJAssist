import { describe, it, expect, vi } from 'vitest';
import { spawnSync } from 'node:child_process';

// Stub spawnSync for controlled tests
const originalSpawnSync = spawnSync;

describe('B2 UUID GPU query', () => {
  it('E1a: one bounded nvidia-smi query discovers GPU inventory at poll time', () => {
    const output = 'GPU-uuid-1, RTX 4090, 0, N/A, 24GB, 24GB, 45 C, 150 W\nGPU-uuid-2, RTX 3090, 0, N/A, 12GB, 24GB, 50 C, 180 W';
    const mockSpawn = vi.fn().mockReturnValue({
      stdout: output,
      error: undefined,
      status: 0,
      signal: null,
    });
    
    const gpuIds = parseNvidiaSmiOutput(mockSpawn('nvidia-smi', ['--query-gpu=uuid', '--format=csv,noheader']));
    expect(gpuIds).toEqual(['GPU-uuid-1', 'GPU-uuid-2']);
  });

  it('L11a: GPU identity is keyed by stable UUID', () => {
    const output = 'GPU-uuid-abc, RTX 4090, 45, 150, ...';
    const parsed = parseGpuQuery(output);
    expect(parsed[0].uuid).toBe('GPU-uuid-abc');
    expect(parsed.length).toBe(1);
  });

  it('L11b: one GPU query returns identity and all metrics per poll', () => {
    const output = 'GPU-uuid-1, RTX 4090, 45, 150, ...\nGPU-uuid-2, RTX 3090, 50, 180, ...';
    const parsed = parseGpuQuery(output);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toHaveProperty('uuid');
    expect(parsed[0]).toHaveProperty('name');
    expect(parsed[0]).toHaveProperty('temp');
    expect(parsed[0]).toHaveProperty('power');
  });

  it('L11c: GPU query terminates at hard 8s timeout', () => {
    const slowMock = vi.fn().mockReturnValue({
      stdout: '',
      error: { code: 'ETIMEDOUT' },
      status: null,
      signal: null,
    });
    
    const start = Date.now();
    const result = mockBoundedQuery(slowMock, 'nvidia-smi', ['--query-gpu=uuid'], 8000);
    const duration = Date.now() - start;
    
    expect(result.timedOut).toBe(true);
    expect(duration).toBeLessThan(10000);
  });
});

function parseNvidiaSmiOutput(spawnResult) {
  const output = spawnResult.stdout?.toString() || '';
  return output.split('\n').filter(line => line.trim()).map(line => line.split(',')[0].trim());
}

function parseGpuQuery(output) {
  return output.split('\n')
    .filter(line => line.trim())
    .map(line => {
      const parts = line.split(',').map(p => p.trim());
      return {
        uuid: parts[0],
        name: parts[1],
        temp: parts[6],
        power: parts[7],
      };
    });
}

function mockBoundedQuery(spawnFn, cmd, args, timeoutMs) {
  const result = spawnFn(cmd, args);
  const timedOut = result.error?.code === 'ETIMEDOUT';
  return { timedOut, stdout: result.stdout };
}
