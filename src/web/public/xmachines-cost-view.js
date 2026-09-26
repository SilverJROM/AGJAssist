function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function displayAmount(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  return '';
}

function isOfflineMachine(machine) {
  return !!(machine && (machine.offline === true || machine.state === 'down'));
}

function powerStateLabel(machine) {
  if (!machine) return '';
  if (isOfflineMachine(machine)) return 'offline';
  return machine.state != null ? String(machine.state) : '';
}

function fieldSpan(testId, text) {
  if (text == null || text === '') return '';
  return ` <span data-testid="${testId}">${escapeHtml(text)}</span>`;
}

// Cost fields are never printed. Down machines show offline and no live metrics.
function isExpiredSample(sampleAge) {
  if (!sampleAge || typeof sampleAge !== 'string') return false;
  const m = sampleAge.match(/^(\d+)s$/);
  if (!m) return false;
  return parseInt(m[1], 10) > 300;
}

// Same bands as the alert evaluator. Hysteresis holds on the way down only.
const GPU_WARN_C = 80;
const GPU_CRIT_C = 90;
const GPU_HYST_C = 3;
const CPU_WARN_C = 85;
const CPU_CRIT_C = 95;
const SEVERITY_STATE_KEY = 'xmachines-severity-v1';
const severityMemory = { byName: {} };

function severityRank(level) {
  if (level === 'critical') return 2;
  if (level === 'warning') return 1;
  return 0;
}

function classifyGpu(prevGpu, gpu) {
  let severity = 'normal';
  if (gpu >= GPU_CRIT_C) severity = 'critical';
  else if (gpu >= GPU_WARN_C) severity = 'warning';
  if (prevGpu === 'critical' && severity !== 'critical' && gpu > GPU_CRIT_C - GPU_HYST_C) severity = 'critical';
  if (prevGpu === 'warning' && severity === 'normal' && gpu > GPU_WARN_C - GPU_HYST_C) severity = 'warning';
  return severity;
}

function classifyCpu(cpu) {
  if (cpu >= CPU_CRIT_C) return 'critical';
  if (cpu >= CPU_WARN_C) return 'warning';
  return 'normal';
}

// A rise waits for two samples of the new level. A fall that has already
// passed the hysteresis band clears on that sample. Page reloads are samples,
// so the book lives in localStorage rather than module memory.
function stepSeverity(prev, gpu, cpu) {
  const prevGpu = prev.lastGpu === 'warning' || prev.lastGpu === 'critical' ? prev.lastGpu : 'normal';
  const gpuLevel = gpu == null ? prevGpu : classifyGpu(prevGpu, gpu);
  const cpuLevel = cpu == null ? 'normal' : classifyCpu(cpu);
  const candidate = severityRank(gpuLevel) >= severityRank(cpuLevel) ? gpuLevel : cpuLevel;
  const displayed = prev.displayed === 'warning' || prev.displayed === 'critical' ? prev.displayed : 'normal';
  let streakCount = 1;
  let nextDisplayed = displayed;
  if (candidate === displayed) {
    streakCount = candidate === 'normal' ? 0 : (prev.streakSeverity === candidate ? (prev.streakCount || 0) + 1 : 1);
  } else if (severityRank(candidate) < severityRank(displayed)) {
    streakCount = candidate === 'normal' ? 0 : 1;
    nextDisplayed = candidate;
  } else {
    streakCount = prev.streakSeverity === candidate ? (prev.streakCount || 0) + 1 : 1;
    nextDisplayed = streakCount >= 2 ? candidate : displayed;
  }
  return {
    lastGpu: gpu == null ? prevGpu : gpuLevel,
    streakSeverity: candidate,
    streakCount,
    displayed: nextDisplayed,
  };
}

function severityStore() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch {}
  return null;
}

function readSeverityBook() {
  const store = severityStore();
  if (!store) return severityMemory;
  try {
    const raw = store.getItem(SEVERITY_STATE_KEY);
    if (!raw) return { byName: {} };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.byName || typeof parsed.byName !== 'object') return { byName: {} };
    return parsed;
  } catch {
    return { byName: {} };
  }
}

function writeSeverityBook(book) {
  const store = severityStore();
  if (!store) {
    severityMemory.byName = book.byName;
    return;
  }
  try { store.setItem(SEVERITY_STATE_KEY, JSON.stringify(book)); } catch {}
}

function displayedSeverity(machine, book) {
  if (!machine || isOfflineMachine(machine)) return null;
  const name = machine.name != null ? String(machine.name) : '';
  if (!name) return null;
  const gpu = typeof machine.gpuTemp === 'number' && Number.isFinite(machine.gpuTemp) ? machine.gpuTemp : null;
  const cpu = typeof machine.cpuTemp === 'number' && Number.isFinite(machine.cpuTemp) ? machine.cpuTemp : null;
  const prev = book.byName[name] || { lastGpu: 'normal', streakSeverity: 'normal', streakCount: 0, displayed: 'normal' };
  const next = stepSeverity(prev, gpu, cpu);
  book.byName[name] = next;
  return next.displayed;
}

function severityChip(level) {
  if (level !== 'critical' && level !== 'warning' && level !== 'normal') return '';
  const background = level === 'critical' ? '#f85149' : level === 'warning' ? '#d29922' : '#8b949e';
  return ` <span data-testid="xmachines-severity" data-severity="${level}" style="display:inline-block;margin-left:8px;padding:2px 6px;border-radius:6px;font-size:12px;font-weight:600;background:${background};color:#fff">${level}</span>`;
}

function markSpan(machine, testId, text, kind) {
  if (!text) return '';
  const word = kind === 'estimated' ? 'approx' : 'measured';
  return ` <span data-testid="${testId}">${escapeHtml(text)}</span> <span data-testid="xmachines-measurement" data-measurement="${kind}">${word}</span>`;
}

function liveMetricSpans(machine) {
  if (!machine || isOfflineMachine(machine)) return '';
  const isStale = isExpiredSample(machine.sampleAge);
  const styleAttr = isStale ? ' style="opacity:0.5;"' : '';
  const tempVal = typeof machine.gpuTemp === 'number' ? `${machine.gpuTemp}°C` : '';
  const powerVal = typeof machine.powerWatts === 'number' ? `${machine.powerWatts} W` : '';
  const powerIsMeasured = machine.telemetry && machine.telemetry.powerWatts != null;
  const uptime = typeof machine.uptime === 'string' ? machine.uptime : '';
  const powerSpan = markSpan(machine, 'xmachines-power-draw', powerVal, powerIsMeasured ? 'measured' : 'estimated');
  const tempSpan = ` <span data-testid="xmachines-gpu-temp"${styleAttr}>${escapeHtml(tempVal)}</span>`;
  const uptimeSpan = ` <span data-testid="xmachines-uptime"${styleAttr}>${escapeHtml(uptime)}</span>`;
  const ageSpan = typeof machine.sampleAge === 'string' ? ` <span data-testid="xmachines-sample-age" data-sample-age>${escapeHtml(machine.sampleAge)}</span>` : '';
  const provSpan = typeof machine.provenance === 'string' ? ` <span data-testid="xmachines-provenance" data-provenance>${escapeHtml(machine.provenance)}</span>` : '';
  return `${tempSpan}${powerSpan}${uptimeSpan}${ageSpan}${provSpan}`;
}

function serviceSpans(machine) {
  if (!machine) return '';
  const freshness = typeof machine.freshness === 'string' ? machine.freshness : '';
  const provenance = typeof machine.provenance === 'string' ? machine.provenance : '';
  const busy = machine.busy && typeof machine.busy.busyCheckOutput === 'string' ? machine.busy.busyCheckOutput : '';
  const leases = machine.busy && Array.isArray(machine.busy.leaseNames) && machine.busy.leaseNames.length
    ? machine.busy.leaseNames.join(', ')
    : '';
  return `${fieldSpan('xmachines-freshness', freshness)}${fieldSpan('xmachines-provenance', provenance)}${fieldSpan('xmachines-busy', busy)}${fieldSpan('xmachines-leases', leases)}`;
}

// Registry role text is a hint only. It is not the card's accessible name.
function roleHintSpan(machine) {
  const role = machine && typeof machine.roleHint === 'string' ? machine.roleHint.trim() : '';
  if (!role) return '';
  return `<span data-testid="xmachines-role-hint" class="xm-role-hint" style="display:block;font-size:12px;font-weight:400;opacity:0.72">${escapeHtml(role)}</span>`;
}

// Fleet overview prints name and power state. Cost fields on a machine are ignored.
export function renderFleetOverview(payload) {
  const machines = payload && Array.isArray(payload.machines) ? payload.machines : [];
  const severityBook = readSeverityBook();
  const items = machines.map((machine) => {
    const name = escapeHtml(machine && machine.name != null ? machine.name : '');
    const state = escapeHtml(powerStateLabel(machine));
    const stateHtml = fieldSpan('xmachines-power-state', state);
    const severity = severityChip(displayedSeverity(machine, severityBook));
    const isStale = machine && !isOfflineMachine(machine) && isExpiredSample(machine.sampleAge);
    const cardStyle = isStale ? 'opacity:0.6;' : '';
    const extra = `${liveMetricSpans(machine)}${serviceSpans(machine)}${roleHintSpan(machine)}`;
    const tail = extra ? ` ${extra}` : '';
    return `<li data-testid="xmachines-fleet-card" aria-label="${name} ${state}" style="display:block;margin:0 0 12px;padding:12px 14px;border:1px solid #30363d;border-radius:12px;list-style:none;${cardStyle}">${name}${stateHtml}${severity}${tail}</li>`;
  }).join('');
  writeSeverityBook(severityBook);
  return `<section class="xm-fleet" data-testid="xmachines-fleet-overview" role="region" aria-label="Fleet overview" style="max-width:420px;font:16px/1.4 system-ui,sans-serif"><h1 style="font-size:20px;margin:0 0 12px">Fleet overview</h1><ul style="list-style:none;padding:0;margin:0">${items}</ul></section>`;
}

function renderReadout(machine) {
  if (!machine) return '';
  const hasModel = machine.state != null || machine.offline != null || machine.freshness || machine.telemetry || machine.busy;
  if (!hasModel) return '';
  const state = powerStateLabel(machine);
  const stateHtml = state ? `<p data-testid="xmachines-power-state">${escapeHtml(state)}</p>` : '';
  return `<div data-testid="xmachines-read-model">${stateHtml}${liveMetricSpans(machine)}${serviceSpans(machine)}</div>`;
}

// Detail is the only surface that shows PHP cost, the tariff flag, and the short-burst caveat.
export function renderMachineCostDetail(payload) {
  const machine = payload && payload.machine ? payload.machine : {};
  const cost = payload && payload.cost ? payload.cost : {};
  const name = escapeHtml(machine.name ?? '');
  const phpAmount = escapeHtml(displayAmount(cost.costPhp));
  const kwhAmount = escapeHtml(displayAmount(cost.kwh));
  const placeholder = cost.isPlaceholder === true;
  const flag = placeholder ? 'placeholder tariff' : 'configured tariff';
  const flagAria = placeholder ? 'Tariff is a placeholder' : 'Tariff is configured';
  const caveat = escapeHtml(typeof cost.caveat === 'string' ? cost.caveat : '');
  const offButton = machine.name != null
    ? `<button type="button" data-testid="xmachines-off-button" aria-label="Turn ${name} off">Turn Off</button>`
    : '';
  return `<section class="xm-detail" data-testid="xmachines-machine-detail" role="region" aria-label="Machine detail"><h1 class="xm-detail-name">${name}</h1>${renderReadout(machine)}<p data-testid="xmachines-cost-kwh" aria-label="Integrated kilowatt hours">${kwhAmount} kWh</p><p data-testid="xmachines-cost-php" aria-label="Energy cost in PHP">PHP ${phpAmount}</p><p data-testid="xmachines-tariff-flag" aria-label="${flagAria}">${flag}</p><p data-testid="xmachines-cost-caveat" aria-label="Short burst caveat">${caveat}</p>${renderWolSafety(payload && payload.wolSafety)}${offButton}${renderNormalOffRefusal(payload && payload.offRefusal)}</section>`;
}

function defaultIdempotencyKey() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {}
  return 'xm-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

// The real normal-Off action: POSTs the app's own power/off route and merges a
// rejection into the payload so renderMachineCostDetail can show it. Shared by
// the app UI and by tests, so a browser-driven click exercises the exact same
// request/merge mechanism the deployed detail page uses — not a stand-in for it.
export async function handleMachineDetailClick(event, payload, options = {}) {
  const target = event && event.target && typeof event.target.closest === 'function'
    ? event.target.closest('[data-testid="xmachines-off-button"]')
    : null;
  if (!target) return payload;
  if (event && typeof event.preventDefault === 'function') event.preventDefault();
  const name = payload && payload.machine && payload.machine.name;
  if (!name) return payload;
  const fetchImpl = options.fetch || (typeof fetch !== 'undefined' ? fetch : null);
  if (!fetchImpl) return payload;
  const idempotencyKey = typeof options.idempotencyKey === 'function' ? options.idempotencyKey() : defaultIdempotencyKey();
  const res = await fetchImpl(`/api/xmachines/machines/${encodeURIComponent(name)}/power/off`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  let body = null;
  try { body = await res.json(); } catch {}
  if (res.ok || !body) return payload;
  return { ...payload, offRefusal: body };
}

// Exact normal-Off refusal. Absent on read payloads, so existing detail markup is unchanged.
export function renderNormalOffRefusal(refusal) {
  if (!refusal || typeof refusal !== 'object') return '';
  const reason = typeof refusal.reason === 'string' ? refusal.reason : '';
  const detail = typeof refusal.detail === 'string' ? refusal.detail : '';
  if (!reason && !detail) return '';
  const exact = detail || reason;
  return `<div data-testid="xmachines-off-refusal-block" role="group" aria-label="Normal Off refusal"><p data-testid="xmachines-off-refusal" role="alert" aria-label="${escapeHtml(exact)}">${escapeHtml(exact)}</p><p data-testid="xmachines-off-refusal-reason" aria-label="${escapeHtml(reason)}">${escapeHtml(reason)}</p></div>`;
}

function renderWolSafety(wolSafety) {
  if (!wolSafety || typeof wolSafety !== 'object') return '';
  const status = wolSafety.status;
  let label = '';
  let aria = '';
  if (status === 'never-verified') {
    label = 'never verified';
    aria = 'WoL safety never verified';
  } else if (status === 'stale') {
    label = 'stale';
    aria = 'WoL safety stale';
  } else if (status === 'verified') {
    label = 'verified';
    aria = 'WoL safety verified';
  } else {
    return '';
  }
  const warningText = typeof wolSafety.warning === 'string' ? wolSafety.warning.trim() : '';
  const warning = warningText && status !== 'verified'
    ? `<p data-testid="xmachines-wol-warning" role="alert" aria-label="${escapeHtml(warningText)}">${escapeHtml(warningText)}</p>`
    : '';
  const times = status === 'verified'
    ? `<p data-testid="xmachines-wol-last-wake" aria-label="Last WAKE">${escapeHtml(wolSafety.lastWake ?? '')}</p><p data-testid="xmachines-wol-verified-up" aria-label="Verified UP">${escapeHtml(wolSafety.verifiedUp ?? '')}</p>`
    : '';
  return `<div data-testid="xmachines-wol-safety" role="group" aria-label="WoL safety"><p data-testid="xmachines-wol-status" aria-label="${aria}">${label}</p>${times}${warning}</div>`;
}
