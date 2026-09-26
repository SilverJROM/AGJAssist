// CLI text the collector read. Parsing this, not a pre-chewed health field, is the panel input.
export interface DiskCliPayload {
  smartCtl: string;
  filesystem: string;
}

export interface DiskCliReader {
  readDiskCli(machine: string): DiskCliPayload;
}

export interface HddDiskRow {
  device: string;
  health: string;
  temperatureC: string;
}

export interface HddFilesystemRow {
  mount: string;
  total: string;
  used: string;
  available: string;
}

export interface HddPanelSurface {
  machine: string;
  html: string;
  disks: HddDiskRow[];
  filesystems: HddFilesystemRow[];
}

interface ParsedDisk {
  device: string;
  health: string;
  temperatureRaw: number | null;
}

interface ParsedFilesystem {
  mount: string;
  total: string;
  used: string;
  available: string;
}

const SECTION_HEADER = /^===\s+(\S+)\s+===\s*$/;
const HEALTH_RESULT = /SMART overall-health self-assessment test result:\s*(\S+)/;
const HEALTH_TOKEN = /^[A-Za-z0-9_-]+$/;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// smartctl -A puts the normalized VALUE early and the RAW_VALUE eight tokens
// after the attribute name. The panel shows RAW, so a normalized 100 cannot pass as 41.
function temperatureRaw(line: string): number | null {
  const parts = line.trim().split(/\s+/);
  const nameAt = parts.indexOf('Temperature_Celsius');
  if (nameAt < 0) return null;
  const raw = parts[nameAt + 8];
  if (raw === undefined || !/^\d+$/.test(raw)) return null;
  return Number(raw);
}

function parseSmartCtl(smartCtl: string): ParsedDisk[] {
  const disks: ParsedDisk[] = [];
  let current: ParsedDisk | null = null;
  for (const line of smartCtl.split(/\r?\n/)) {
    const header = line.match(SECTION_HEADER);
    if (header) {
      current = { device: header[1], health: '', temperatureRaw: null };
      disks.push(current);
      continue;
    }
    if (!current) continue;
    if (current.health === '') {
      const health = line.match(HEALTH_RESULT);
      if (health && HEALTH_TOKEN.test(health[1])) current.health = health[1];
    }
    if (current.temperatureRaw === null) {
      const raw = temperatureRaw(line);
      if (raw !== null) current.temperatureRaw = raw;
    }
  }
  return disks;
}

function parseFilesystem(filesystem: string): ParsedFilesystem[] {
  const rows: ParsedFilesystem[] = [];
  for (const line of filesystem.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    const useAt = parts.findIndex((part) => /^\d+%$/.test(part));
    if (useAt < 3) continue;
    const mount = parts.slice(useAt + 1).join(' ');
    if (!mount.startsWith('/')) continue;
    const total = parts[useAt - 3];
    const used = parts[useAt - 2];
    const available = parts[useAt - 1];
    if (!/^\d+$/.test(total) || !/^\d+$/.test(used) || !/^\d+$/.test(available)) continue;
    rows.push({ mount, total, used, available });
  }
  return rows;
}

export interface ParsedNutStatus {
  batteryChargePct: number | null;
  runtimeSeconds: number | null;
  loadPct: number | null;
}

// NUT status text is `key: value` lines. The first exact key wins.
// A longer key such as battery.charge.low must not satisfy battery.charge.
function nutNumber(raw: string, key: string): number | null {
  const prefix = `${key}:`;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(prefix)) continue;
    const value = trimmed.slice(prefix.length).trim();
    if (!/^\d+(?:\.\d+)?$/.test(value)) return null;
    return Number(value);
  }
  return null;
}

export function parseNutStatus(raw: string): ParsedNutStatus {
  return {
    batteryChargePct: nutNumber(raw, 'battery.charge'),
    runtimeSeconds: nutNumber(raw, 'battery.runtime'),
    loadPct: nutNumber(raw, 'ups.load'),
  };
}

function healthText(health: string): string {
  return health === '' ? 'unavailable' : health;
}

function temperatureText(raw: number | null): string {
  return raw === null ? 'unavailable' : `${raw} C`;
}

function renderHtml(machine: string, disks: HddDiskRow[], filesystems: HddFilesystemRow[]): string {
  const diskHtml = disks.map((disk) => (
    `<div class="disk-row" data-disk="${escapeHtml(disk.device)}">` +
    `<span class="disk-id">${escapeHtml(disk.device)}</span>` +
    `<span class="smart-health">${escapeHtml(disk.health)}</span>` +
    `<span class="disk-temp">${escapeHtml(disk.temperatureC)}</span>` +
    `</div>`
  )).join('');
  const fsHtml = filesystems.map((row) => (
    `<div class="fs-row" data-mount="${escapeHtml(row.mount)}">` +
    `<span class="fs-mount">${escapeHtml(row.mount)}</span>` +
    `<span class="fs-total">${escapeHtml(row.total)}</span>` +
    `<span class="fs-used">${escapeHtml(row.used)}</span>` +
    `<span class="fs-available">${escapeHtml(row.available)}</span>` +
    `</div>`
  )).join('');
  return `<div class="hdd-panel" data-machine="${escapeHtml(machine)}">${diskHtml}${fsHtml}</div>`;
}

// Entry the hdd panel renders. It reads the collector's disk CLI, then parses it.
export function renderHddDiskPanel(reader: DiskCliReader, machine: string): HddPanelSurface {
  const cli = reader.readDiskCli(machine);
  const parsedDisks = parseSmartCtl(cli.smartCtl);
  const parsedFilesystems = parseFilesystem(cli.filesystem);
  const disks = parsedDisks.map((disk) => ({
    device: disk.device,
    health: healthText(disk.health),
    temperatureC: temperatureText(disk.temperatureRaw),
  }));
  const filesystems = parsedFilesystems.map((row) => ({ ...row }));
  return {
    machine,
    html: renderHtml(machine, disks, filesystems),
    disks,
    filesystems,
  };
}
