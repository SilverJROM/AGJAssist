import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { renderHddDiskPanel } from '../../src/services/xmachines/disk-telemetry.js';
import { resolveXmachinesRuntime } from '../../src/services/xmachines/runtime.js';

const SDA = '/dev/sda';
const SDB = '/dev/sdb';
const SDA_HEALTH = 'PASSED';
const SDB_HEALTH = 'FAILED';
const SDA_TEMP = '41 C';
const SDB_TEMP = '17 C';
const DECOY_HEALTH = 'DECOY-NOT-RENDERED';
const ARCHIVE = '/mnt/archive';
const ARCHIVE_TOTAL = '47011223344556';
const ARCHIVE_USED = '12000900800700';
const ARCHIVE_AVAILABLE = '35010322543856';
const BOOT = '/boot';
const BOOT_TOTAL = '1073741824';
const BOOT_USED = '268435456';
const BOOT_AVAILABLE = '805306368';

const SMART_CLI = `=== /dev/sda ===
SMART overall-health self-assessment test result: PASSED
194 Temperature_Celsius     0x0022   100   100   000    Old_age   Always       -       41
=== /dev/sdb ===
SMART overall-health self-assessment test result: FAILED
194 Temperature_Celsius     0x0022   088   090   000    Old_age   Always       -       17
`;

const NO_HEALTH_CLI = `=== /dev/sda ===
194 Temperature_Celsius     0x0022   100   100   000    Old_age   Always       -       41
=== /dev/sdb ===
194 Temperature_Celsius     0x0022   088   090   000    Old_age   Always       -       17
`;

const FILESYSTEM_CLI = `Filesystem        1B-blocks         Used    Available Use% Mounted on
/dev/sda2         1073741824    268435456    805306368  25% /boot
/dev/mapper/data  47011223344556  12000900800700  35010322543856  26% /mnt/archive
`;

function documentOf(html: string): Document {
  return new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window.document;
}

function panelFor(machine: string, smartCtl: string, filesystem: string, smartHealth: string) {
  const runtime = resolveXmachinesRuntime({ XMACHINES_ARM: '0' });
  runtime.telemetry.useReadSource({
    readSmart() {
      return { health: smartHealth, availability: 'ok', freshness: 'fresh' };
    },
    readNut() {
      return { battery: '', availability: 'ok', freshness: 'fresh' };
    },
    readDiskCli(requested: string) {
      if (requested !== 'hdd') return { smartCtl: '', filesystem: '' };
      return { smartCtl, filesystem };
    },
  });
  const surface = renderHddDiskPanel(runtime.telemetry, machine);
  return { runtime, surface, doc: documentOf(surface.html) };
}

describe('xmachines-disk-telemetry B9', () => {
  it('I2a hdd panel renders per-disk SMART health from collector CLI', () => {
    const positive = panelFor('hdd', SMART_CLI, FILESYSTEM_CLI, DECOY_HEALTH);
    const sda = positive.doc.querySelector(`[data-disk="${SDA}"] .smart-health`);
    const sdb = positive.doc.querySelector(`[data-disk="${SDB}"] .smart-health`);

    expect(positive.doc.querySelector('.hdd-panel')?.getAttribute('data-machine')).toBe('hdd');
    expect(sda?.textContent).toBe(SDA_HEALTH);
    expect(sdb?.textContent).toBe(SDB_HEALTH);
    expect(sda?.textContent).not.toBe(DECOY_HEALTH);

    const control = panelFor('hdd', NO_HEALTH_CLI, FILESYSTEM_CLI, SDA_HEALTH);
    const controlHealth = control.doc.querySelector(`[data-disk="${SDA}"] .smart-health`)?.textContent;
    expect(controlHealth).toBe('unavailable');
    expect(controlHealth).not.toBe(SDA_HEALTH);

    const otherMachine = panelFor('gpu', SMART_CLI, FILESYSTEM_CLI, SDA_HEALTH);
    expect(otherMachine.doc.querySelector('.smart-health')?.textContent ?? '').not.toBe(SDA_HEALTH);
  });

  it('I2b hdd panel renders the per-disk temperature row', () => {
    const { doc, runtime } = panelFor('hdd', SMART_CLI, FILESYSTEM_CLI, DECOY_HEALTH);
    const sda = doc.querySelector(`[data-disk="${SDA}"]`);
    const sdb = doc.querySelector(`[data-disk="${SDB}"]`);
    const sdaTemp = sda?.querySelector('.disk-temp')?.textContent;
    const sdbTemp = sdb?.querySelector('.disk-temp')?.textContent;
    const genericCpu = runtime.telemetry.forMachine('hdd')?.cpuTemp;

    expect(sda?.querySelector('.disk-id')?.textContent).toBe(SDA);
    expect(sdaTemp).toBe(SDA_TEMP);
    expect(sdb?.querySelector('.disk-id')?.textContent).toBe(SDB);
    expect(sdbTemp).toBe(SDB_TEMP);
    expect(sdaTemp).not.toBe(sdbTemp);
    expect(sdaTemp).not.toBe('100 C');
    expect(sdaTemp).not.toBe(`${genericCpu} C`);
  });

  it('I2c hdd panel renders filesystem free space from df', () => {
    const { doc, surface } = panelFor('hdd', SMART_CLI, FILESYSTEM_CLI, DECOY_HEALTH);
    const archive = doc.querySelector(`[data-mount="${ARCHIVE}"]`);
    const boot = doc.querySelector(`[data-mount="${BOOT}"]`);

    expect(archive?.querySelector('.fs-mount')?.textContent).toBe(ARCHIVE);
    expect(archive?.querySelector('.fs-total')?.textContent).toBe(ARCHIVE_TOTAL);
    expect(archive?.querySelector('.fs-used')?.textContent).toBe(ARCHIVE_USED);
    expect(archive?.querySelector('.fs-available')?.textContent).toBe(ARCHIVE_AVAILABLE);
    expect(archive?.querySelector('.fs-available')?.textContent).not.toBe(BOOT_AVAILABLE);
    expect(boot?.querySelector('.fs-available')?.textContent).toBe(BOOT_AVAILABLE);
    expect(surface.filesystems).toEqual([
      { mount: BOOT, total: BOOT_TOTAL, used: BOOT_USED, available: BOOT_AVAILABLE },
      { mount: ARCHIVE, total: ARCHIVE_TOTAL, used: ARCHIVE_USED, available: ARCHIVE_AVAILABLE },
    ]);
  });
});
