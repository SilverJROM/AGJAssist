import { FakeGateway, RealXmacGateway, type XmacGateway } from './gateway.js';
import { ReadOnlyCollector } from './readonly-collector.js';

export interface XmachinesRuntime {
  armed: boolean;
  gateway: XmacGateway;
  telemetry: ReadOnlyCollector;
}

// Arm is process configuration. Request fields are not an input to this function.
export function resolveXmachinesRuntime(serverEnv: NodeJS.ProcessEnv = process.env): XmachinesRuntime {
  const armed = serverEnv.XMACHINES_ARM === '1';
  return {
    armed,
    gateway: armed ? new RealXmacGateway() : new FakeGateway(),
    telemetry: new ReadOnlyCollector(),
  };
}

const CLIENT_ARM_HEADER = 'xmachines_arm';
const CLIENT_ARM_HEADER_ALT = 'x-xmachines-arm';

function recordHasArm(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  return Object.prototype.hasOwnProperty.call(value, 'XMACHINES_ARM');
}

export function callCarriesClientArm(parts: {
  query?: unknown;
  body?: unknown;
  headers?: Record<string, unknown> | null;
}): boolean {
  if (recordHasArm(parts.query) || recordHasArm(parts.body)) return true;
  const headers = parts.headers;
  if (!headers) return false;
  return headers[CLIENT_ARM_HEADER] !== undefined
    || headers['XMACHINES_ARM'] !== undefined
    || headers[CLIENT_ARM_HEADER_ALT] !== undefined;
}
