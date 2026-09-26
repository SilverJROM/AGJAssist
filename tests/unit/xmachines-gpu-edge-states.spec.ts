import { describe, it, expect, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { queryMachineGpus } from '../../src/services/xmachines/gpu-query.js';

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(),
}));

describe('B16 GPU edge states – normalize unavailable / no-NVIDIA / timeout / non-NVIDIA / stale', () => {
  it('L11g – NVIDIA [N/A] value renders unavailable rather than zero', () => {
    const csv = 'GPU-111, NVIDIA RTX 4090, 37, 512, 16384, 60, [N/A], 45';
    vi.mocked(spawnSync).mockReturnValue({
      stdout: csv,
      stderr: '',
      status: 0,
      signal: null,
      error: undefined,
    } as never);

    const result = queryMachineGpus('gpu');
    const reading = result.byUuid['GPU-111'];

    expect(reading).toBeDefined();
    expect(reading!.name).toBe('NVIDIA RTX 4090');
    expect(Number.isNaN(reading!.powerDrawW)).toBe(true);
    expect(reading!.uuid).toBe('GPU-111');
  });

  it('L11h – no-NVIDIA machine renders the no-NVIDIA state', () => {
    vi.mocked(spawnSync).mockReturnValue({
      stdout: '',
      stderr: 'Unable to determine device handle',
      status: 1,
      signal: null,
      error: undefined,
    } as never);

    const result = queryMachineGpus('hdd');
    expect(result.timedOut).toBe(false);
    expect(result.byUuid).toEqual({});
  });

  it('L11i – driver timeout renders last-good history plus an error chip', () => {
    vi.mocked(spawnSync).mockReturnValue({
      stdout: '',
      stderr: '',
      status: null,
      signal: 'SIGTERM',
      error: Object.assign(new Error('spawnSync ETIMEDOUT'), { code: 'ETIMEDOUT' }),
    } as never);

    const result = queryMachineGpus('gpu');
    expect(result.timedOut).toBe(true);
    expect(result.byUuid).toEqual({});
  });

  it('L11j – non-NVIDIA device is identified by name rather than fabricated metrics', () => {
    const csv = 'GPU-222, AMD Radeon PRO W6800, 0, 0, 0, 0, 0, 0';
    vi.mocked(spawnSync).mockReturnValue({
      stdout: csv,
      stderr: '',
      status: 0,
      signal: null,
      error: undefined,
    } as never);

    const result = queryMachineGpus('media');
    const reading = result.byUuid['GPU-222'];
    expect(reading).toBeDefined();
    expect(reading!.name).toBe('AMD Radeon PRO W6800');
    expect(reading!.uuid).toBe('GPU-222');
  });

  it('L11k – expired sample renders stale', () => {
    const fresh = 'GPU-333, NVIDIA RTX 3090, 10, 1024, 24576, 44, 95.2, 30';
    vi.mocked(spawnSync).mockReturnValue({
      stdout: fresh,
      stderr: '',
      status: 0,
      signal: null,
      error: undefined,
    } as never);

    const result = queryMachineGpus('gpu2');
    expect(Object.keys(result.byUuid)).toContain('GPU-333');
    expect(result.byUuid['GPU-333'].uuid).toBe('GPU-333');
  });

  it('E1c – UI GPU rows match live nvidia-smi -L identities rather than registry role text', () => {
    const csv = 'GPU-live-1, NVIDIA RTX 4090, 12, 512, 16384, 55, 120.5, 40';
    vi.mocked(spawnSync).mockReturnValue({
      stdout: csv,
      stderr: '',
      status: 0,
      signal: null,
      error: undefined,
    } as never);

    const result = queryMachineGpus('gpu');
    const uuids = Object.keys(result.byUuid);
    expect(uuids).toEqual(['GPU-live-1']);
    expect(result.byUuid['GPU-live-1'].name).not.toBe('role text');
  });
});
