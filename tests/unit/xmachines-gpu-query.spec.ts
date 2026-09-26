import { beforeEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { queryMachineGpus } from '../../src/services/xmachines/gpu-query.js';

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(),
}));

const NVIDIA_SMI = 'nvidia-smi';
const NVIDIA_SMI_ARGS = [
  '--query-gpu=uuid,name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,fan.speed',
  '--format=csv,noheader,nounits',
];

// Full csv,noheader,nounits line. Column order is the query field list above.
const MEDIA_STDOUT = [
  'GPU-7f3c-media-a, NVIDIA RTX 4500 Ada, 37, 8192, 32768, 61, 220.5, 48',
  'GPU-91ab-media-b, NVIDIA RTX 4000 Blackwell, 12, 1024, 24576, 44, 95.25, 30',
].join('\n');

function spawnOk(stdout: string) {
  return { stdout, stderr: '', status: 0, signal: null, error: undefined };
}

function spawnCalls() {
  return vi.mocked(spawnSync).mock.calls;
}

describe('B2 UUID GPU query', () => {
  beforeEach(() => {
    vi.mocked(spawnSync).mockReset();
  });

  it('E1a: one bounded nvidia-smi query discovers GPU inventory at poll time', () => {
    vi.mocked(spawnSync).mockReturnValue(spawnOk(MEDIA_STDOUT) as never);

    const result = queryMachineGpus('media');

    expect(result.machine).toBe('media');
    expect(result.timedOut).toBe(false);
    expect(Object.keys(result.byUuid).sort()).toEqual(['GPU-7f3c-media-a', 'GPU-91ab-media-b']);
    expect(spawnCalls()).toHaveLength(1);
    expect(spawnCalls()[0][0]).toBe(NVIDIA_SMI);
    expect(spawnCalls()[0][1]).toEqual(NVIDIA_SMI_ARGS);
    expect(spawnCalls()[0][2]).toMatchObject({ timeout: 8000 });
  });

  it('L11a: GPU identity is keyed by stable UUID', () => {
    const stdout = 'GPU-not-the-name-or-index, Some Other Adapter, 3, 111, 222, 33, 44.5, 7';
    vi.mocked(spawnSync).mockReturnValue(spawnOk(stdout) as never);

    const result = queryMachineGpus('gpu2');

    expect(result.machine).toBe('gpu2');
    expect(result.byUuid['GPU-not-the-name-or-index']).toMatchObject({
      uuid: 'GPU-not-the-name-or-index',
      name: 'Some Other Adapter',
    });
    expect(result.byUuid['0']).toBeUndefined();
    expect(result.byUuid['Some Other Adapter']).toBeUndefined();
    expect(spawnCalls()).toHaveLength(1);
  });

  it('L11b: one GPU query returns identity and all metrics per poll', () => {
    vi.mocked(spawnSync).mockReturnValue(spawnOk(MEDIA_STDOUT) as never);

    const result = queryMachineGpus('media');

    expect(spawnCalls()).toHaveLength(1);
    expect(spawnCalls()[0][0]).toBe(NVIDIA_SMI);
    expect(spawnCalls()[0][1]).toEqual(NVIDIA_SMI_ARGS);
    expect(result.byUuid['GPU-7f3c-media-a']).toEqual({
      uuid: 'GPU-7f3c-media-a',
      name: 'NVIDIA RTX 4500 Ada',
      utilizationGpu: 37,
      memoryUsedMiB: 8192,
      memoryTotalMiB: 32768,
      temperatureC: 61,
      powerDrawW: 220.5,
      fanSpeedPct: 48,
    });
    expect(result.byUuid['GPU-91ab-media-b']).toEqual({
      uuid: 'GPU-91ab-media-b',
      name: 'NVIDIA RTX 4000 Blackwell',
      utilizationGpu: 12,
      memoryUsedMiB: 1024,
      memoryTotalMiB: 24576,
      temperatureC: 44,
      powerDrawW: 95.25,
      fanSpeedPct: 30,
    });
  });

  it('L11c: GPU query terminates at hard 8s timeout', () => {
    vi.mocked(spawnSync).mockReturnValue({
      stdout: 'GPU-should-not-appear, NVIDIA RTX 4090, 1, 2, 3, 4, 5, 6\n',
      stderr: '',
      status: null,
      signal: 'SIGTERM',
      error: Object.assign(new Error('spawnSync ETIMEDOUT'), { code: 'ETIMEDOUT' }),
    } as never);

    const result = queryMachineGpus('hdd');

    expect(spawnCalls()).toHaveLength(1);
    expect(spawnCalls()[0][0]).toBe(NVIDIA_SMI);
    expect(spawnCalls()[0][1]).toEqual(NVIDIA_SMI_ARGS);
    expect(spawnCalls()[0][2]).toMatchObject({ timeout: 8000 });
    expect(result.machine).toBe('hdd');
    expect(result.timedOut).toBe(true);
    expect(result.byUuid).toEqual({});
  });
});
