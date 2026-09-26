import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readMachinesConf } from './registry.js';
import { resolveProtectedRole } from './protected-roles.js';

export interface BusyDetail {
  machine: string;
  busyCheckOutput: string;
  leaseNames: string[];
  protectedRole?: string;
  isBusy: boolean;
  isLeased: boolean;
  isProtected: boolean;
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

export class BusyDetailModel {
  build(machine: string, busyOutput: string): BusyDetail {
    const confMap = readMachinesConf();
    const entry = confMap.get(machine);
    const busyCheck = entry?.busyCheck ?? '';

    const leaseNames = readActiveLeaseNames(machine);
    const protectedRefusal = resolveProtectedRole(machine);
    const isBusy = busyOutput.trim().length > 0;
    const isLeased = leaseNames.length > 0;
    const isProtected = !!protectedRefusal;

    return {
      machine,
      busyCheckOutput: busyOutput.trim(),
      leaseNames,
      protectedRole: protectedRefusal?.role,
      isBusy,
      isLeased,
      isProtected,
    };
  }
}

export function buildBusyDetail(machine: string, busyOutput: string): BusyDetail {
  return new BusyDetailModel().build(machine, busyOutput);
}