import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readMachinesConf } from './registry.js';
import { resolveProtectedRole } from './protected-roles.js';

/** Same result shape as the app-side busy preflight (`ok` / `output` / `error`). */
export interface BusyPreflightResult {
  ok: boolean;
  output: string;
  error: string;
}

/** Seam whose `collect` output is the busy-check boundary the model renders. */
export interface BusyCheckCollector {
  collect(machine: string): BusyPreflightResult;
}

export interface BusyDetail {
  machine: string;
  busyCheckOutput: string;
  leaseNames: string[];
  protectedRole?: string;
  isBusy: boolean;
  isLeased: boolean;
  isProtected: boolean;
  /** Product-owned Off refusal. Built from the busy output, leases, and protected role. */
  refusalExplanation: string;
}

function xmacStateDir(): string {
  return process.env.XMAC_STATE?.trim() || path.join(os.homedir(), '.xmac');
}

function readActiveLeaseNames(machine: string): string[] {
  const dir = path.join(xmacStateDir(), 'leases', machine);
  try {
    return fs.readdirSync(dir).filter((name) => !name.startsWith('.'));
  } catch {
    return [];
  }
}

/**
 * Runs the machines.conf `busyCheck` for this machine and returns its stdout.
 * An empty check is idle. The command is local — remote SSH stays on the
 * action-coordinator preflight. Callers point XMAC_CONF at a fixture command.
 */
export function collectConfiguredBusyCheck(machine: string): BusyPreflightResult {
  const busyCheck = readMachinesConf().get(machine)?.busyCheck ?? '';
  if (!busyCheck) return { ok: true, output: '', error: '' };

  const result = spawnSync('bash', ['-c', busyCheck], {
    timeout: 8000,
    encoding: 'utf8',
    env: process.env,
  });
  if (result.error) {
    return { ok: false, output: '', error: result.error.message };
  }
  if (result.status === null) {
    return { ok: false, output: '', error: 'timeout' };
  }
  const output = (result.stdout ?? '').trim();
  if (result.status !== 0 && output === '') {
    return { ok: false, output: '', error: 'busy-check-failed' };
  }
  return { ok: true, output, error: '' };
}

function buildRefusalExplanation(
  busyCheckOutput: string,
  leaseNames: readonly string[],
  protectedRole: string | undefined,
): string {
  const parts: string[] = [];
  if (busyCheckOutput) parts.push(`busy: ${busyCheckOutput}`);
  if (leaseNames.length > 0) parts.push(`leases: ${leaseNames.join(', ')}`);
  if (protectedRole) parts.push(`protected-role: ${protectedRole}`);
  return parts.join('; ');
}

export class BusyDetailModel {
  constructor(private readonly collector: BusyCheckCollector = { collect: collectConfiguredBusyCheck }) {}

  build(machine: string): BusyDetail {
    const preflight = this.collector.collect(machine);
    const busyCheckOutput = preflight.output.trim();
    const leaseNames = readActiveLeaseNames(machine);
    const protectedRefusal = resolveProtectedRole(machine);
    const protectedRole = protectedRefusal?.role;
    const isBusy = busyCheckOutput.length > 0;
    const isLeased = leaseNames.length > 0;
    const isProtected = !!protectedRefusal;

    return {
      machine,
      busyCheckOutput,
      leaseNames,
      protectedRole,
      isBusy,
      isLeased,
      isProtected,
      refusalExplanation: buildRefusalExplanation(busyCheckOutput, leaseNames, protectedRole),
    };
  }
}

export function buildBusyDetail(machine: string, collector?: BusyCheckCollector): BusyDetail {
  return new BusyDetailModel(collector).build(machine);
}
