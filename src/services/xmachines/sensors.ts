export interface SensorsParseResult {
  cpuTemps: number[];
  fanRPMs: number[];
}

/**
 * Parse bounded lm-sensors output into discovered CPU temperatures and fan RPMs.
 * Absent fans are represented by an empty array; no fabricated values are emitted.
 */
export function parseLmSensorsOutput(output: string): SensorsParseResult {
  const cpuTemps: number[] = [];
  const fanRPMs: number[] = [];

  if (!output) return { cpuTemps, fanRPMs };

  const lines = output.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('---') || trimmed.toLowerCase().startsWith('adapter:')) continue;

    // CPU temperature lines like "Tctl: +52.0°C" or "Package id 0: +45.0°C"
    if (/:\s*\+?\d+(\.\d+)?°C/.test(trimmed)) {
      const match = trimmed.match(/:\s*\+?(\d+(?:\.\d+)?)°C/);
      if (match) {
        const val = parseFloat(match[1]);
        if (!Number.isNaN(val)) cpuTemps.push(val);
        continue;
      }
    }

    // Fan RPM lines like "fan1: 1200 RPM"
    if (/:\s*\d+\s*RPM/i.test(trimmed)) {
      const match = trimmed.match(/:\s*(\d+)\s*RPM/i);
      if (match) {
        const val = parseInt(match[1], 10);
        if (!Number.isNaN(val)) fanRPMs.push(val);
        continue;
      }
    }
  }

  return { cpuTemps, fanRPMs };
}
