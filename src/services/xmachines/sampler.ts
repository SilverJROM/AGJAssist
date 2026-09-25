import { resolveXmachinesRuntime } from './runtime.js';

// Read boundary for the server sampler. Schedule and persistence belong to later rows.
export function sampleFleet(serverEnv: NodeJS.ProcessEnv = process.env) {
  return resolveXmachinesRuntime(serverEnv).telemetry.generate();
}
