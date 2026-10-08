export function escapeHtml(value) {
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
  const powerVal = typeof machine.powerWatts === 'number' ? `${Math.round(machine.powerWatts)} W` : '';
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

function tempClassOf(t) {
  if (typeof t !== 'number' || !Number.isFinite(t)) return '';
  return t < 50 ? 't-cool' : t < 70 ? 't-ok' : t < 80 ? 't-warn' : 't-hot';
}

// "23158/24467 MiB" -> "22.6/23.9 GB" (compact); passes through non-MiB strings.
function compactMem(value) {
  if (typeof value !== 'string') return '';
  const m = value.match(/^\s*([\d.]+)\s*\/\s*([\d.]+)\s*MiB\s*$/i);
  if (!m) return value;
  return `${(parseFloat(m[1]) / 1024).toFixed(1)}/${(parseFloat(m[2]) / 1024).toFixed(1)} GB`;
}

// Owner-set display name, falling back to the machine's canonical name.
function machineDisplayName(machine) {
  const raw = machine && machine.name != null ? String(machine.name) : '';
  return (machine && machine.displayName && String(machine.displayName).trim()) ? String(machine.displayName) : raw;
}

// Fleet overview prints name and power state. Cost fields on a machine are ignored.
// Card layout matches the approved xmachines mockup; every data-testid/attribute the
// tests pin is emitted exactly once (offline cards omit the live-metric nodes).
export function renderFleetOverview(payload) {
  const machines = payload && Array.isArray(payload.machines) ? payload.machines : [];
  const severityBook = readSeverityBook();

  let onCount = 0, offCount = 0, totalW = 0, hotCount = 0;
  machines.forEach((m) => {
    if (isOfflineMachine(m)) offCount += 1; else onCount += 1;
    if (typeof m.powerWatts === 'number' && Number.isFinite(m.powerWatts)) totalW += m.powerWatts;
    if (typeof m.cpuWatts === 'number' && Number.isFinite(m.cpuWatts)) totalW += m.cpuWatts;
  });

  // Order: busy machines first, idle-online next, offline last. Stable within a rank.
  const busyRank = (m) => {
    if (isOfflineMachine(m)) return 2;
    const leaseBusy = !!(m && m.busy && m.busy.isBusy);
    const gpuBusy = typeof m.gpusBusy === 'number' && m.gpusBusy > 0;
    return (leaseBusy || gpuBusy) ? 0 : 1;
  };
  const ordered = machines
    .map((m, i) => ({ m, i }))
    .sort((a, b) => busyRank(a.m) - busyRank(b.m) || a.i - b.i)
    .map((x) => x.m);

  const items = ordered.map((machine) => {
    const rawName = machine && machine.name != null ? String(machine.name) : '';
    const name = escapeHtml(rawName);
    const offline = isOfflineMachine(machine);
    const state = escapeHtml(powerStateLabel(machine));
    const sevLevel = displayedSeverity(machine, severityBook);
    if (sevLevel === 'critical' || sevLevel === 'warning') hotCount += 1;
    const severity = severityChip(sevLevel);
    const isStale = machine && !offline && isExpiredSample(machine.sampleAge);
    const staleStyle = isStale ? ' style="opacity:0.5;"' : '';
    const stripe = offline ? 'var(--xm-off)'
      : sevLevel === 'critical' ? 'var(--xm-hot)'
      : sevLevel === 'warning' ? 'var(--xm-warn)'
      : 'var(--xm-ok)';

    const stateHtml = fieldSpan('xmachines-power-state', state);
    // Two temps on the card: hottest GPU, and the board / inside-case sensor.
    const gpuT = typeof machine.gpuTemp === 'number' && Number.isFinite(machine.gpuTemp) && machine.gpuTemp > 0 ? machine.gpuTemp : null;
    const boardT = typeof machine.boardTemp === 'number' && Number.isFinite(machine.boardTemp) && machine.boardTemp > 0 ? machine.boardTemp : null;
    const ambientT = typeof machine.ambientTemp === 'number' && Number.isFinite(machine.ambientTemp) && machine.ambientTemp > 0 ? machine.ambientTemp : null;
    const boxTemp = boardT != null ? boardT : ambientT;
    const gpuTempVal = gpuT != null ? `${gpuT}°C` : '';
    const boxTempVal = boxTemp != null ? `${boxTemp}°C` : '';
    // Draw = total board power = GPU draw + CPU package power.
    const gpuW = typeof machine.powerWatts === 'number' && Number.isFinite(machine.powerWatts) ? machine.powerWatts : null;
    const cpuW = typeof machine.cpuWatts === 'number' && Number.isFinite(machine.cpuWatts) ? machine.cpuWatts : 0;
    const drawTotal = (gpuW != null || cpuW > 0) ? Math.round((gpuW ?? 0) + cpuW) : null;
    const powerVal = drawTotal != null ? `${drawTotal} W` : '';
    const powerIsMeasured = !!(machine && machine.telemetry && machine.telemetry.powerWatts != null);
    const measWord = powerIsMeasured ? 'measured' : 'approx';
    const measKind = powerIsMeasured ? 'measured' : 'estimated';
    const uptimeVal = typeof machine.uptime === 'string' ? machine.uptime : '';

    // GPUs: how many are busy out of how many answered the poll. Green = some busy,
    // muted = up but idle, amber "none" = box is up but no GPU reported (check driver/cable).
    const gpuCount = typeof machine.gpuCount === 'number' ? machine.gpuCount : null;
    const gpusBusy = typeof machine.gpusBusy === 'number' ? machine.gpusBusy : null;
    const gpuWorking = gpuCount != null ? gpuCount > 0 : (gpuT != null);
    const gpuHasBusy = gpuCount != null && gpuCount > 0 && gpusBusy != null;
    const gpuLabel = gpuCount != null
      ? (gpuCount > 0 ? (gpusBusy != null ? `${gpusBusy}/${gpuCount}` : String(gpuCount)) : 'none')
      : (gpuT != null ? 'ok' : '—');
    const gpuStatKey = gpuHasBusy ? 'GPUs busy' : 'GPUs';
    const gpuColor = !gpuWorking ? 'var(--xm-warn)' : (gpusBusy != null && gpusBusy > 0 ? 'var(--xm-ok)' : 'var(--xm-muted)');

    const powerColor = offline ? 'var(--xm-off)' : (machine.state === 'unknown' ? 'var(--xm-warn)' : 'var(--xm-ok)');
    const powerStat = `<div class="xm-stat"><span class="k">Power</span><span class="v" style="color:${powerColor}">${stateHtml}</span></div>`;
    const gpuStat = offline
      ? `<div class="xm-stat"><span class="k">GPUs</span><span class="v">—</span></div>`
      : `<div class="xm-stat"><span class="k">${gpuStatKey}</span><span class="v"><span data-testid="xmachines-gpu-count"${gpuCount != null ? ` data-gpu-count="${gpuCount}"` : ''}${gpusBusy != null ? ` data-gpu-busy="${gpusBusy}"` : ''} style="color:${gpuColor}">${escapeHtml(gpuLabel)}</span></span></div>`;
    const gpuTempStat = offline
      ? `<div class="xm-stat"><span class="k">GPU temp</span><span class="v">—</span></div>`
      : `<div class="xm-stat"><span class="k">GPU temp</span><span class="v"><span class="xm-tval ${tempClassOf(gpuT)}" data-testid="xmachines-gpu-temp"${staleStyle}>${gpuTempVal ? escapeHtml(gpuTempVal) : '—'}</span></span></div>`;
    const boxTempStat = offline
      ? `<div class="xm-stat"><span class="k">Box temp</span><span class="v">—</span></div>`
      : `<div class="xm-stat"><span class="k">Box temp</span><span class="v"><span class="xm-tval ${tempClassOf(boxTemp)}" data-testid="xmachines-box-temp"${staleStyle}>${boxTempVal ? escapeHtml(boxTempVal) : '—'}</span></span></div>`;
    const drawStat = offline
      ? `<div class="xm-stat"><span class="k">Draw</span><span class="v">—</span></div>`
      : `<div class="xm-stat"><span class="k">Draw</span><span class="v"><span data-testid="xmachines-power-draw">${escapeHtml(powerVal)}</span>${powerVal ? ` <span data-testid="xmachines-measurement" data-measurement="${measKind}" class="xm-est">${measWord}</span>` : ''}</span></div>`;
    const uptimeStat = offline
      ? ''
      : `<div class="xm-stat" style="grid-column:span 2"><span class="k">Uptime</span><span class="v" style="font-size:13px"><span data-testid="xmachines-uptime"${staleStyle}>${escapeHtml(uptimeVal)}</span></span></div>`;

    const ageSpan = (!offline && typeof machine.sampleAge === 'string') ? `<span data-testid="xmachines-sample-age" data-sample-age>${escapeHtml(machine.sampleAge)}</span>` : '';
    const provText = typeof machine.provenance === 'string' ? machine.provenance : '';
    const provSpan = provText ? `<span data-testid="xmachines-provenance" data-provenance>${escapeHtml(provText)}</span>` : '';
    const freshText = typeof machine.freshness === 'string' ? machine.freshness : '';
    const freshSpan = freshText ? `<span data-testid="xmachines-freshness">${escapeHtml(freshText)}</span>` : '';
    const busyText = machine && machine.busy && typeof machine.busy.busyCheckOutput === 'string' ? machine.busy.busyCheckOutput : '';
    const busySpan = busyText ? `<span data-testid="xmachines-busy">${escapeHtml(busyText)}</span>` : '';
    const leasesText = machine && machine.busy && Array.isArray(machine.busy.leaseNames) && machine.busy.leaseNames.length ? machine.busy.leaseNames.join(', ') : '';
    const leasesSpan = leasesText ? `<span data-testid="xmachines-leases">${escapeHtml(leasesText)}</span>` : '';
    const isBusy = !!(machine && machine.busy && machine.busy.isBusy);
    const busyPill = isBusy ? ` <span class="xm-pill busy"><span class="xm-dot"></span>busy</span>` : '';
    const roleHint = roleHintSpan(machine);
    const spark = sparklineMarkup(machine && machine._history, true);

    // Visible meta stays short (freshness/provenance/age). busy/leases carry a
    // raw who/nvidia dump — keep them in the DOM for the tests but never render them.
    const metaBits = [freshSpan, provSpan, ageSpan].filter(Boolean).join('');
    const metaLine = metaBits ? `<div class="xm-cardmeta" style="margin-top:10px;display:flex;flex-wrap:wrap;gap:4px 10px;font-size:11px;color:var(--xm-faint);font-family:var(--xm-mono)">${metaBits}</div>` : '';
    const hiddenHooks = (busySpan || leasesSpan) ? `<span class="xm-hooks">${busySpan}${leasesSpan}</span>` : '';
    const cardOpacity = isStale ? 'opacity:0.6;' : '';

    // Offline machines collapse to a 2-row card: name + a single detail line.
    if (offline) {
      const roleHintRaw = typeof machine.roleHint === 'string' ? machine.roleHint : '';
      return `<li data-testid="xmachines-fleet-card" aria-label="${name} ${state}" class="xm-card xm-card-min" style="--xm-stripe:var(--xm-off);list-style:none">`
        + `<a class="xm-card-link" href="#/xmachines/${encodeURIComponent(rawName)}" style="display:flex;align-items:center;gap:10px;color:inherit;text-decoration:none">`
        + `<div style="min-width:0;flex:1">`
        + `<div class="xm-name" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">${escapeHtml(machineDisplayName(machine))}<span class="xm-pill off" data-testid="xmachines-power-state">${state}</span></div>`
        + `<div class="xm-min-meta" style="margin-top:3px;display:flex;align-items:center;gap:8px;min-width:0;font-size:11px;color:var(--xm-faint);font-family:var(--xm-mono)">`
        + (roleHintRaw ? `<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(roleHintRaw)}</span>` : `<span style="flex:1"></span>`)
        + freshSpan + provSpan
        + `</div>`
        + `</div>`
        + `<span class="xm-chev">›</span>`
        + hiddenHooks
        + `</a></li>`;
    }

    return `<li data-testid="xmachines-fleet-card" aria-label="${name} ${state}" class="xm-card" style="--xm-stripe:${stripe};${cardOpacity}list-style:none">`
      + `<a class="xm-card-link" href="#/xmachines/${encodeURIComponent(rawName)}" style="display:block;color:inherit;text-decoration:none">`
      + `<div class="xm-row1"><div style="min-width:0"><div class="xm-name">${escapeHtml(machineDisplayName(machine))}${busyPill}</div>${roleHint}</div>`
      + `<div style="margin-left:auto;display:flex;gap:6px;align-items:center">${severity}<span class="xm-chev">›</span></div></div>`
      + `<div class="xm-stats">${powerStat}${gpuStat}${gpuTempStat}${boxTempStat}${drawStat}${uptimeStat}</div>`
      + metaLine
      + hiddenHooks
      + `<div class="xm-sparks" style="display:none">${spark}</div>`
      + `</a></li>`;
  }).join('');
  writeSeverityBook(severityBook);

  const summary = machines.length
    ? `<div class="xm-summary">`
      + `<div class="xm-sumchip"><span class="n">${onCount}</span><span class="l">Online</span></div>`
      + `<div class="xm-sumchip"><span class="n">${offCount}</span><span class="l">Off</span></div>`
      + `<div class="xm-sumchip"><span class="n xm-mono">${Math.round(totalW)}<span style="font-size:12px;color:var(--xm-muted)"> W</span></span><span class="l">Fleet draw &#8776;</span></div>`
      + (hotCount ? `<div class="xm-sumchip alert"><span class="n">${hotCount}</span><span class="l">Alert</span></div>` : '')
      + `</div>`
    : '';

  return `<section class="xm-fleet" data-testid="xmachines-fleet-overview" role="region" aria-label="Fleet overview">`
    + `<div class="xm-page-head"><h1>Fleet overview</h1><p>LAN fleet &middot; self-detected &middot; updates every 30s while open</p></div>`
    + summary
    + `<ul class="xm-cards">${items}</ul></section>`;
}

function seriesToPoints(series, width, height) {
  if (!Array.isArray(series) || series.length === 0) return '';
  const values = series.map(s => Number(s.value)).filter(v => Number.isFinite(v));
  if (values.length === 0) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const n = values.length;
  const step = width / (n - 1 || 1);
  const points = values.map((v, i) => {
    const x = Math.round(i * step);
    const y = Math.round(height - ((v - min) / range) * height);
    return `${x},${y}`;
  }).join(' ');
  return points;
}

// Fleet cards omit a sparkline until the series has two plotted points.
// Detail keeps the empty svg so a missing history response still has the nodes.
function sparklineMarkup(history, omitEmpty) {
  const hist = history || {};
  const rows = [
    ['temp', 'temperature sparkline', hist.temperature],
    ['power', 'power sparkline', hist.power],
    ['util', 'utilisation sparkline', hist.utilization],
  ];
  return rows.map(([id, label, series]) => {
    const points = seriesToPoints(series, 120, 30);
    const pairCount = points ? points.split(' ').filter(Boolean).length : 0;
    if (omitEmpty && pairCount < 2) return '';
    const poly = points ? `<polyline points="${points}" fill="none" stroke="currentColor"/>` : '';
    return `<div data-testid="xmachines-sparkline-${id}" aria-label="${label}"><svg width="120" height="30">${poly}</svg></div>`;
  }).join('');
}

function renderReadout(machine, history) {
  if (!machine) return '';
  const hasModel = machine.state != null || machine.offline != null || machine.freshness || machine.telemetry || machine.busy;
  if (!hasModel) return '';
  const state = powerStateLabel(machine);
  const stateHtml = state ? `<p data-testid="xmachines-power-state">${escapeHtml(state)}</p>` : '';
  const cpuVal = typeof machine.cpuTemp === 'number' && Number.isFinite(machine.cpuTemp) ? `${machine.cpuTemp}°C` : '';
  const cpuSpan = cpuVal ? `<span data-testid="xmachines-cpu-temp">${escapeHtml(cpuVal)}</span>` : '';
  const fanRpmText = Array.isArray(machine.fanRpm) && machine.fanRpm.length ? machine.fanRpm.join(', ') : '';
  const fanSpan = fanRpmText ? `<span data-testid="xmachines-fan-rpm">${escapeHtml(fanRpmText)}</span>` : '';
  const sessionDur = machine.powerSession && typeof machine.powerSession.duration === 'number' ? `${machine.powerSession.duration}s` : '';
  const sessionSpan = sessionDur ? `<span data-testid="xmachines-power-session">${escapeHtml(sessionDur)}</span> <span data-testid="xmachines-power-session-provenance">${escapeHtml(machine.powerSession?.provenance ?? '')}</span>` : `<span data-testid="xmachines-power-session">unknown</span>`;
  const onHours = machine.sampledOnHours && typeof machine.sampledOnHours.hours === 'number' ? `${machine.sampledOnHours.hours} h` : '';
  const onHoursSpan = onHours ? `<span data-testid="xmachines-on-hours">${escapeHtml(onHours)}</span> <span data-testid="xmachines-on-hours-provenance">${escapeHtml(machine.sampledOnHours?.label ?? 'estimated')}</span>` : '';
  const roleText = typeof machine.roleHint === 'string' && machine.roleHint.trim() ? machine.roleHint.trim() : '';
  const protectedRoleSpan = roleText ? `<span data-testid="xmachines-protected-role">${escapeHtml(roleText)}</span>` : '';
  const sparkHtml = sparklineMarkup(history, false);
  return `<div data-testid="xmachines-read-model">${stateHtml}${cpuSpan}${fanSpan}${sessionSpan}${onHoursSpan}${protectedRoleSpan}${liveMetricSpans(machine)}${serviceSpans(machine)}${sparkHtml}</div>`;
}

const XM_RANGES = {
  '1h':  { label: '1H',  offsetsMin: [60, 40, 20, 0] },
  '6h':  { label: '6H',  offsetsMin: [360, 240, 120, 0] },
  '24h': { label: '24H', offsetsMin: [1440, 960, 480, 0] },
};

// Format a timestamp as Philippine (Asia/Manila) clock time for an X-axis tick.
// Prepends a short weekday when the tick lands on a different PH day than "now"
// so a 24h span's left edge doesn't read the same clock time as its right edge.
function phAxisTime(d, nowD) {
  try {
    const t = d.toLocaleTimeString('en-US', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' });
    const day = d.toLocaleDateString('en-US', { timeZone: 'Asia/Manila' });
    const nowDay = nowD.toLocaleDateString('en-US', { timeZone: 'Asia/Manila' });
    if (day !== nowDay) {
      const wd = d.toLocaleDateString('en-US', { timeZone: 'Asia/Manila', weekday: 'short' });
      return `${wd} ${t}`;
    }
    return t;
  } catch {
    return '';
  }
}

// The four X-axis tick labels for a range, as actual PH times counted back from now.
function rangeAxisLabels(rc) {
  const offs = rc && Array.isArray(rc.offsetsMin) ? rc.offsetsMin : [30, 20, 10, 0];
  const now = new Date();
  return offs.map((m) => phAxisTime(new Date(now.getTime() - m * 60000), now));
}

function seriesValues(series) {
  if (!Array.isArray(series)) return [];
  return series.map((s) => Number(s && s.value)).filter((v) => Number.isFinite(v));
}

// Time-series line chart (X = time, Y = value). Returns an SVG string.
function lineChart(values, unit, hot, xlabels) {
  if (!Array.isArray(values) || values.length < 2) {
    return `<div class="xm-na" style="padding:20px 0;text-align:center">no history yet for this range</div>`;
  }
  const W = 328, H = 168, padL = 40, padR = 14, padT = 14, padB = 32;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const mn = Math.min(...values), mx = Math.max(...values);
  const room = Math.max(1, (mx - mn) * 0.18);
  let lo = Math.floor(mn - room), hi = Math.ceil(mx + room);
  if (lo === hi) hi = lo + 1;
  const X = (i) => padL + (i * plotW) / (values.length - 1);
  const Y = (v) => padT + plotH - ((v - lo) / (hi - lo)) * plotH;
  const color = hot ? 'var(--xm-hot)' : 'var(--xm-accent)';
  let g = '';
  for (let t = 0; t <= 4; t += 1) {
    const val = lo + ((hi - lo) * t) / 4, yy = Y(val);
    g += `<line class="grid" x1="${padL}" y1="${yy.toFixed(1)}" x2="${(W - padR).toFixed(1)}" y2="${yy.toFixed(1)}"/>`;
    g += `<text x="${(padL - 7).toFixed(1)}" y="${(yy + 3).toFixed(1)}" text-anchor="end" font-size="9">${Math.round(val)}</text>`;
  }
  const N = values.length - 1;
  const labs = (Array.isArray(xlabels) && xlabels.length === 4) ? xlabels : ['-30m', '-20m', '-10m', 'now'];
  const xpos = [0, Math.round(N / 3), Math.round((2 * N) / 3), N];
  labs.forEach((lab, k) => {
    const xx = X(xpos[k]);
    g += `<line class="grid" x1="${xx.toFixed(1)}" y1="${padT}" x2="${xx.toFixed(1)}" y2="${(padT + plotH).toFixed(1)}"/>`;
    g += `<text x="${xx.toFixed(1)}" y="${(H - padB + 15).toFixed(1)}" text-anchor="${k === 0 ? 'start' : k === 3 ? 'end' : 'middle'}" font-size="9">${escapeHtml(lab)}</text>`;
  });
  const pts = values.map((v, i) => [X(i), Y(v)]);
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const area = line + ` L${(W - padR).toFixed(1)} ${(padT + plotH).toFixed(1)} L${padL.toFixed(1)} ${(padT + plotH).toFixed(1)} Z`;
  const last = pts[pts.length - 1];
  const gid = hot ? 'xmgh' : 'xmga';
  return `<svg class="xm-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(unit)} over time">`
    + `<defs><linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".20"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>`
    + g
    + `<line class="axis" x1="${padL}" y1="${padT}" x2="${padL}" y2="${(padT + plotH).toFixed(1)}"/>`
    + `<line class="axis" x1="${padL}" y1="${(padT + plotH).toFixed(1)}" x2="${(W - padR).toFixed(1)}" y2="${(padT + plotH).toFixed(1)}"/>`
    + `<path d="${area}" fill="url(#${gid})"/>`
    + `<path d="${line}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`
    + `<circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="3.6" fill="${color}"/>`
    + `<text class="axttl" x="2" y="${(padT - 3).toFixed(1)}" text-anchor="start" font-size="9.5">${escapeHtml(unit)}</text>`
    + `<text class="axttl" x="${(padL + plotW / 2).toFixed(1)}" y="${(H - 3).toFixed(1)}" text-anchor="middle" font-size="9.5">time →</text>`
    + `</svg>`;
}

// DGX Spark pairs render their own detail: remote GB10 nodes, served model + health,
// no power control / cost / fans / history.
function renderDgxDetail(payload) {
  const machine = payload && payload.machine ? payload.machine : {};
  const dgx = machine.dgx || {};
  const nodes = Array.isArray(dgx.nodes) ? dgx.nodes : [];
  const name = escapeHtml(machineDisplayName(machine));
  const unreachable = machine.state === 'unknown';
  const stateLabel = unreachable ? 'unreachable' : 'up';
  const stateColor = unreachable ? 'var(--xm-warn)' : 'var(--xm-ok)';
  const reqs = typeof dgx.requestsRunning === 'number' ? dgx.requestsRunning : null;
  const serviceLine = reqs != null
    ? `${reqs} request${reqs === 1 ? '' : 's'} running`
    : (dgx.serviceOk === true ? 'healthy' : dgx.serviceOk === false ? 'not responding' : 'status unknown');

  const header = `<div class="xm-dhead">`
    + `<a class="xm-back" href="#/xmachines">‹ All machines</a>`
    + `<div class="xm-name-row"><h1>${name}</h1></div>`
    + `<div class="xm-host">${escapeHtml(dgx.model || '')}${dgx.route ? ` · route ${escapeHtml(dgx.route)}` : ''}</div>`
    + `<div class="xm-pills"><span class="xm-pill ${unreachable ? 'warn' : 'on'}" data-testid="xmachines-power-state">${stateLabel}</span>`
    + `<span class="xm-pill norm" style="font-size:10px">read-only</span></div>`
    + `</div>`;

  const serviceSection = `<div class="xm-sec"><h2>Service</h2><div class="xm-metrics" style="grid-template-columns:repeat(2,1fr);gap:12px 8px">`
    + `<div class="xm-m"><span class="k">Model</span><span class="v" style="font-size:13px">${escapeHtml(dgx.model || '—')}</span></div>`
    + `<div class="xm-m"><span class="k">Serving</span><span class="v" style="font-size:13px;color:${stateColor}">${escapeHtml(serviceLine)}</span></div>`
    + `</div></div>`;

  const nodeCards = nodes.map((n) => {
    const reach = n && n.reachable;
    const temp = typeof n.gpuTempC === 'number' ? `${n.gpuTempC}°C` : '—';
    const util = typeof n.gpuUtil === 'number' ? `${Math.round(n.gpuUtil)}%` : '—';
    const pw = typeof n.gpuPowerW === 'number' ? `${Math.round(n.gpuPowerW)} W` : '—';
    const clk = typeof n.clockMHz === 'number' ? `${n.clockMHz} MHz` : '—';
    const mem = (typeof n.memUsedMB === 'number' && typeof n.memTotalMB === 'number')
      ? `${(n.memUsedMB / 1024).toFixed(1)}/${(n.memTotalMB / 1024).toFixed(1)} GB` : '—';
    const up = typeof n.uptime === 'string' ? n.uptime : '—';
    const head = `<div class="gpu-head"><span class="nm">${escapeHtml(n.label || n.host || 'node')}</span>`
      + `<span class="gpu-chip ${reach ? '' : 'stale'}">${reach ? escapeHtml(n.gpuName || 'GB10') : 'unreachable'}</span></div>`;
    if (!reach) {
      return `<div class="gpu-row" data-testid="xmachines-dgx-node"><div style="opacity:.75">${head}`
        + `<div class="xm-na" style="padding:6px 0">node unreachable — treat as unknown, not off</div></div></div>`;
    }
    return `<div class="gpu-row" data-testid="xmachines-dgx-node">${head}`
      + `<div class="xm-metrics" style="grid-template-columns:repeat(3,1fr);gap:10px 8px;margin-top:8px">`
      + `<div class="xm-m"><span class="k">GPU temp</span><span class="v xm-tval ${tempClassOf(n.gpuTempC)}">${temp}</span></div>`
      + `<div class="xm-m"><span class="k">Util</span><span class="v">${util}</span></div>`
      + `<div class="xm-m"><span class="k">Power</span><span class="v">${pw}</span></div>`
      + `<div class="xm-m"><span class="k">Clock</span><span class="v">${clk}</span></div>`
      + `<div class="xm-m"><span class="k">Unified mem</span><span class="v">${mem}</span></div>`
      + `<div class="xm-m"><span class="k">Uptime</span><span class="v" style="font-size:12px">${escapeHtml(up)}</span></div>`
      + `</div></div>`;
  }).join('');
  const nodesSection = `<div class="xm-sec"><h2>Nodes <span class="xm-badge xm-pill norm" style="font-size:10px">GB10 · unified memory</span></h2>${nodeCards}</div>`;

  const note = `<div class="xm-sec"><div class="xm-guard info"><span class="ic">🛰️</span><span>Remote DGX Spark pair over SSH tunnel — read-only monitoring, no power control. A node that can't be reached shows as <b>unknown</b>, not off.</span></div></div>`;

  return `<div class="xmachines-view"><div class="xm-detail" data-testid="xmachines-machine-detail" data-machine="${escapeHtml(machine.name || '')}">`
    + header + serviceSection + nodesSection + note
    + `</div></div>`;
}

// Detail is the only surface that shows PHP cost, the tariff flag, and the short-burst caveat.
export function renderMachineCostDetail(payload) {
  const machine = payload && payload.machine ? payload.machine : {};
  if (machine && machine.dgx) return renderDgxDetail(payload);
  const cost = payload && payload.cost ? payload.cost : {};
  const history = payload && payload._history ? payload._history : {};
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
  const forceButton = machine.name != null
    ? `<button type="button" data-testid="xmachines-force-button" aria-label="Force ${name} off">Force Off</button>`
    : '';
  const gpuRows = Array.isArray(payload?.gpuRows) ? payload.gpuRows : [];
  const gpuChip = typeof payload?.gpuChip === 'string' ? payload.gpuChip : '';
  const gpuBanner = gpuRows.length === 0 && gpuChip !== ''
    ? `<span data-testid="xmachines-gpu-chip" role="status">${escapeHtml(gpuChip)}</span>`
    : '';
  // D10 storage/UPS panel integration
  const disks = Array.isArray(payload?.disks) ? payload.disks : [];
  const filesystems = Array.isArray(payload?.filesystems) ? payload.filesystems : [];
  const ups = payload?.ups || null;
  const gpuRowHtml = gpuRows.map(row => {
    const uuid = escapeHtml(row.uuid ?? '');
    const gpuName = escapeHtml(row.name ?? '');
    const chip = escapeHtml(row.chip ?? '');
    const power = escapeHtml(row.power ?? '');
    const temp = escapeHtml(row.temperature ?? '');
    const memory = escapeHtml(compactMem(row.memory ?? ''));
    const util = escapeHtml(row.utilization ?? '');
    const fan = escapeHtml(row.fan ?? '');
    const sampleTime = escapeHtml(row.sampleTime ?? '');
    const tempClass = tempClassOf(parseInt(String(row.temperature ?? ''), 10));
    return `<div class="gpu-row" data-testid="xmachines-gpu-row" data-gpu-uuid="${uuid}" data-sample-time="${sampleTime}">`
      + `<div class="gpu-head"><span class="nm" data-testid="xmachines-gpu-name">${gpuName}</span><span class="gpu-chip" data-testid="xmachines-gpu-chip" role="status">${chip}</span></div>`
      + `<div class="xm-metrics" style="grid-template-columns:repeat(3,1fr);gap:12px 8px">`
      + `<div class="xm-m"><span class="k">Util</span><span class="v"><span data-testid="xmachines-gpu-util">${util}</span></span></div>`
      + `<div class="xm-m"><span class="k">VRAM</span><span class="v" style="font-size:13px"><span data-testid="xmachines-gpu-vram">${memory}</span></span></div>`
      + `<div class="xm-m"><span class="k">Temp</span><span class="v xm-tval ${tempClass}"><span data-testid="xmachines-gpu-temp">${temp}</span></span></div>`
      + `<div class="xm-m"><span class="k">Power</span><span class="v"><span data-testid="xmachines-gpu-power">${power}</span></span></div>`
      + `<div class="xm-m"><span class="k">Fan</span><span class="v"><span data-testid="xmachines-gpu-fan">${fan}</span></span></div>`
      + `</div></div>`;
  }).join('');
  const challenge = payload && payload.forceChallenge;
  const confirmationText = typeof payload?.forceConfirmation === 'string' ? payload.forceConfirmation : '';
  const challengeBlock = (challenge && challenge.displayNumber != null)
    ? `<div data-testid="xmachines-force-challenge" data-challenge="${escapeHtml(String(challenge.challengeId))}"><div data-testid="xmachines-force-confirmation">Force confirmation\n${escapeHtml(confirmationText)}</div><div data-testid="xmachines-force-confirmation-text">Process probe:\n${escapeHtml(confirmationText)}</div><button type="button" data-testid="xmachines-force-confirm" aria-label="Confirm force off">Confirm Force Off ${challenge.displayNumber}</button><span data-testid="xmachines-force-number" data-number="${challenge.displayNumber}">${challenge.displayNumber}</span></div>`
    : '';
  const forceRefusalBlock = renderForceRefusal(payload && payload.forceRefusal);
  // D10: render hdd panel
  const hddPanel = (disks.length > 0 || filesystems.length > 0)
    ? `<div class="hdd-panel" data-machine="${escapeHtml(name)}">${disks.map(d => `<div class="disk-row" data-disk="${escapeHtml(d.device)}"><span class="disk-id">${escapeHtml(d.device)}</span><span class="smart-health">${escapeHtml(d.health)}</span><span class="disk-temp">${escapeHtml(d.temperatureC)}</span></div>`).join('')}${filesystems.map(f => `<div class="fs-row" data-mount="${escapeHtml(f.mount)}"><span class="fs-mount">${escapeHtml(f.mount)}</span><span class="fs-total">${escapeHtml(f.total)}</span><span class="fs-used">${escapeHtml(f.used)}</span><span class="fs-available">${escapeHtml(f.available)}</span></div>`).join('')}</div>`
    : '';
  // D10: render UPS panel
  const upsPanel = ups
    ? `<div class="ups-panel" data-machine="${escapeHtml(name)}"><span class="ups-battery">${escapeHtml(ups.batteryChargePct ?? 'unavailable')}</span><span class="ups-runtime">${escapeHtml(ups.runtimeSeconds != null ? `${ups.runtimeSeconds}s` : 'unavailable')}</span><span class="ups-load">${escapeHtml(ups.loadPct ?? 'unavailable')}</span></div>`
    : `<div class="ups-panel" data-machine="${escapeHtml(name)}"><span class="ups-battery">unavailable</span><span class="ups-runtime">unavailable</span><span class="ups-load">unavailable</span></div>`;
  // ---------- section-based layout (approved mockup contract) ----------
  const rawName = machine.name != null ? String(machine.name) : '';
  const offline = isOfflineMachine(machine);
  const state = powerStateLabel(machine);
  const isStale = !offline && isExpiredSample(machine.sampleAge);
  const staleStyle = isStale ? ' style="opacity:0.5;"' : '';
  const displayName = escapeHtml(machine.displayName != null && String(machine.displayName).trim() ? machine.displayName : rawName);

  // header
  const hostLine = (machine.host || machine.ip)
    ? `${escapeHtml(machine.host || '')}${machine.host && machine.ip ? ' · ' : ''}${escapeHtml(machine.ip || '')}`
    : (typeof machine.roleHint === 'string' ? escapeHtml(machine.roleHint) : '');
  const busyPill = machine.busy && machine.busy.isBusy ? `<span class="xm-pill busy"><span class="xm-dot"></span>busy</span>` : '';
  const roleText = typeof machine.roleHint === 'string' && machine.roleHint.trim() ? machine.roleHint.trim() : '';
  const protectedRoleSpan = roleText ? `<span data-testid="xmachines-protected-role" class="xm-pill" style="background:var(--xm-surface-2);color:var(--xm-muted)">${escapeHtml(roleText)}</span>` : '';
  const simpleSev = offline ? 'off'
    : (machine.gpuTemp >= 90 || machine.cpuTemp >= 95) ? 'hot'
    : (machine.gpuTemp >= 80 || machine.cpuTemp >= 85) ? 'warn' : 'norm';
  const sevPillHtml = offline ? '<span class="xm-pill off"><span class="xm-dot"></span>Off</span>'
    : simpleSev === 'hot' ? '<span class="xm-pill hot"><span class="xm-dot"></span>Hot</span>'
    : simpleSev === 'warn' ? '<span class="xm-pill warn"><span class="xm-dot"></span>Warning</span>'
    : '<span class="xm-pill norm"><span class="xm-dot"></span>Normal</span>';
  const freshChip = offline
    ? `<span class="xm-fresh stale"><span class="xm-dot"></span>${escapeHtml(typeof machine.freshness === 'string' ? machine.freshness : 'offline')}</span>`
    : `<span class="xm-fresh"><span class="xm-dot"></span>${escapeHtml(typeof machine.sampleAge === 'string' ? machine.sampleAge : 'live')}</span>`;
  const powerStateHook = `<span data-testid="xmachines-power-state" style="position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden">${escapeHtml(state)}</span>`;
  const header = `<div class="xm-dhead">`
    + `<a class="xm-back" href="#/xmachines">‹ All machines</a>`
    + `<div class="xm-name-row" id="xm-name-row"><h1 id="xm-name-h1">${displayName}</h1>`
    + `<button type="button" class="xm-editname" data-action="rename" aria-label="Rename machine" title="Rename">✎</button></div>`
    + (hostLine ? `<div class="xm-host">${hostLine}</div>` : '')
    + `<div class="xm-pills">${sevPillHtml}${busyPill}${protectedRoleSpan}${freshChip}</div>`
    + `</div>`;

  // power & control
  const tempVal = typeof machine.gpuTemp === 'number' ? `${machine.gpuTemp}°C` : '';
  const powerVal = typeof machine.powerWatts === 'number' ? `${Math.round(machine.powerWatts)} W` : '';
  const powerIsMeasured = !!(machine.telemetry && machine.telemetry.powerWatts != null);
  const measWord = powerIsMeasured ? 'measured' : 'approx';
  const measKind = powerIsMeasured ? 'measured' : 'estimated';
  const uptimeVal = typeof machine.uptime === 'string' ? machine.uptime : '';
  const statePill = offline ? '<span class="xm-pill off"><span class="xm-dot"></span>Off</span>' : '<span class="xm-pill on"><span class="xm-dot"></span>On</span>';
  const uptimeHook = offline ? '' : `<span data-testid="xmachines-uptime"${staleStyle}>${escapeHtml(uptimeVal)}</span>`;
  const drawHook = offline ? '0 W'
    : `<span data-testid="xmachines-power-draw">${escapeHtml(powerVal)}</span>${powerVal ? ` <span data-testid="xmachines-measurement" data-measurement="${measKind}" class="xm-est">${measWord}</span>` : ''}`;
  const sessionDur = machine.powerSession && typeof machine.powerSession.duration === 'number' ? `${machine.powerSession.duration}s` : '';
  const sessionSpan = sessionDur
    ? `<span data-testid="xmachines-power-session">${escapeHtml(sessionDur)}</span> <span data-testid="xmachines-power-session-provenance">${escapeHtml(machine.powerSession && machine.powerSession.provenance != null ? machine.powerSession.provenance : '')}</span>`
    : `<span data-testid="xmachines-power-session">unknown</span>`;
  const onHours = machine.sampledOnHours && typeof machine.sampledOnHours.hours === 'number' ? `${machine.sampledOnHours.hours} h` : '';
  const onHoursSpan = onHours
    ? `<span data-testid="xmachines-on-hours">${escapeHtml(onHours)}</span> <span data-testid="xmachines-on-hours-provenance">${escapeHtml(machine.sampledOnHours && machine.sampledOnHours.label != null ? machine.sampledOnHours.label : 'estimated')}</span>`
    : '';
  const guardNote = offline
    ? `<div class="xm-guard info"><span class="ic">↻</span><span>Machine is off. Turning it on sends a Wake-on-LAN packet; xmac waits for it to answer.</span></div>`
    : (machine.busy && machine.busy.isBusy
      ? `<div class="xm-guard"><span class="ic">⛔</span><span><b>Busy — a normal power-off is blocked.</b> This machine is serving work; Force asks for confirmation first.</span></div>`
      : `<div class="xm-guard info"><span class="ic">✓</span><span>xmac checks the lease, live busy state, and wake-origin before it powers a machine off.</span></div>`);
  const powerSection = `<div class="xm-sec"><h2>Power &amp; control</h2>`
    + `<div class="xm-power-hero"><div class="xm-pstate">${statePill}<span class="xm-psub">${offline ? 'powered off' : 'up '}${uptimeHook}</span></div>`
    + `<div class="xm-draw"><div class="n">${drawHook}</div><div class="lab">current draw</div></div></div>`
    + `<div class="xm-controls">${offButton}${forceButton}</div>`
    + guardNote
    + `<div class="xm-kv" style="margin-top:12px"><span class="k">Power session</span><span class="v">${sessionSpan}</span></div>`
    + (onHoursSpan ? `<div class="xm-kv"><span class="k">On-hours</span><span class="v">${onHoursSpan}</span></div>` : '')
    + `${challengeBlock}${forceRefusalBlock}${renderNormalOffRefusal(payload && payload.offRefusal)}`
    + powerStateHook
    + `</div>`;

  // thermals (online only)
  const cpuVal = typeof machine.cpuTemp === 'number' && Number.isFinite(machine.cpuTemp) ? `${machine.cpuTemp}°C` : '';
  const boardTempC = typeof machine.boardTemp === 'number' && Number.isFinite(machine.boardTemp) ? machine.boardTemp
    : (typeof machine.ambientTemp === 'number' && Number.isFinite(machine.ambientTemp) ? machine.ambientTemp : null);
  const boardVal = boardTempC != null ? `${boardTempC}°C` : '';
  const cpuWattsVal = typeof machine.cpuWatts === 'number' && Number.isFinite(machine.cpuWatts) ? `${Math.round(machine.cpuWatts)} W` : '—';
  const thermalsSection = offline ? '' : `<div class="xm-sec"><h2>Thermals &amp; CPU</h2><div class="xm-metrics" style="grid-template-columns:repeat(2,1fr);gap:12px 8px">`
    + `<div class="xm-m"><span class="k">CPU temp</span><span class="v xm-tval ${tempClassOf(machine.cpuTemp)}">${cpuVal ? `<span data-testid="xmachines-cpu-temp">${escapeHtml(cpuVal)}</span>` : '—'}</span></div>`
    + `<div class="xm-m"><span class="k">CPU power</span><span class="v">${cpuWattsVal}</span></div>`
    + `<div class="xm-m"><span class="k">Hottest GPU</span><span class="v xm-tval ${tempClassOf(machine.gpuTemp)}"><span data-testid="xmachines-gpu-temp"${staleStyle}>${escapeHtml(tempVal)}</span></span></div>`
    + `<div class="xm-m"><span class="k">Box / board temp</span><span class="v xm-tval ${tempClassOf(boardTempC)}"><span data-testid="xmachines-board-temp">${boardVal || '—'}</span></span></div>`
    + `</div>${simpleSev === 'hot' ? '<div class="xm-guard"><span class="ic">🔥</span><span><b>Hot.</b> A sensor is in the alert band — fans are being driven up.</span></div>' : ''}</div>`;

  // gpus
  const gpuSection = (!offline && (gpuRowHtml || gpuBanner))
    ? `<div class="xm-sec"><h2>GPUs${gpuRowHtml ? ` <span class="xm-badge xm-pill norm" style="font-size:10px">self-detected</span>` : ''}</h2>${gpuBanner}${gpuRowHtml}</div>`
    : '';

  // fans (online only) — rich per-fan rows from the fancurve kit; graceful when absent
  const fanList = Array.isArray(machine.fans) ? machine.fans.filter((f) => f) : [];
  const fanRpmArr = (Array.isArray(machine.fanRpm) && machine.fanRpm.length)
    ? machine.fanRpm
    : fanList.map((f) => f.rpm).filter((x) => typeof x === 'number');
  const fanRpmText = fanRpmArr.length ? fanRpmArr.join(', ') : '';
  const fanRows = fanList.length ? fanList.map((f) => {
    const hdr = f.header == null ? 'fan' : (/^\d+$/.test(String(f.header)) ? 'Fan ' + f.header : String(f.header));
    const duty = typeof f.dutyPct === 'number' ? f.dutyPct : null;
    const dutyBar = duty != null
      ? `<div class="xm-bar"><i class="${duty >= 90 ? 'hot' : duty >= 70 ? 'warn' : 'ok'}" style="width:${Math.max(0, Math.min(100, duty))}%"></i></div><div style="font-size:10.5px;color:var(--xm-faint);margin-top:3px">${duty}% · ${escapeHtml(f.mode || '')}</div>`
      : `<span class="xm-na">${escapeHtml(f.mode || '—')}</span>`;
    // A fan driven (duty>0) but with no tach reading is a daisy-chained partner —
    // it spins at the same speed, the board just can't sense its RPM on a shared header.
    const rpm = typeof f.rpm === 'number' ? f.rpm : null;
    const driven = duty != null && duty > 0;
    const rpmCell = (rpm && rpm > 0)
      ? `${rpm} <small>rpm</small>`
      : (driven ? `<span class="xm-na" style="font-size:11px">spinning · no tach</span>` : `<span class="xm-na">—</span>`);
    return `<div class="xm-fanrow"><div class="fname">${escapeHtml(hdr)}</div><div class="duty">${dutyBar}</div><div class="rpm">${rpmCell}</div></div>`;
  }).join('') : '';
  const fansSection = offline ? '' : `<div class="xm-sec"><h2>Fans${machine.fancurveActive ? ` <span class="xm-badge xm-pill norm" style="font-size:10px">fancurve</span>` : ''}</h2>`
    + (fanRows
        ? fanRows + `<span class="xm-hooks"><span data-testid="xmachines-fan-rpm">${escapeHtml(fanRpmText)}</span></span>`
        : (fanRpmText
            ? `<div class="xm-kv"><span class="k">Fan RPM</span><span class="v"><span data-testid="xmachines-fan-rpm">${escapeHtml(fanRpmText)}</span></span></div>`
            : `<span class="xm-na">no fan data reported (needs the fancurve kit on this box)</span>`))
    + (machine.fancurveActive ? `<div class="xm-guard info" style="margin-top:11px"><span class="ic">🌀</span><span>fancurve active — fans auto-driven by hottest temp.</span></div>` : '')
    + `</div>`;

  // storage / ups (keep class-based panels exactly; show only for storage boxes
  // or machines with a real UPS, so plain GPU nodes don't show an empty panel)
  const upsHasData = !!(ups && (ups.batteryChargePct != null || ups.loadPct != null || ups.runtimeSeconds != null));
  const storageSection = (disks.length > 0 || filesystems.length > 0 || upsHasData)
    ? `<div class="xm-sec"><h2>Storage &amp; UPS</h2>${hddPanel}${upsHasData ? upsPanel : ''}</div>`
    : '';

  // history charts with range tabs (online only)
  const range = payload && payload._historyRange && XM_RANGES[payload._historyRange] ? payload._historyRange : '1h';
  const rc = XM_RANGES[range];
  const hist = payload && payload._history ? payload._history : {};
  const powerVals = seriesValues(hist.power);
  const tempVals = seriesValues(hist.temperature);
  const chartHot = typeof machine.gpuTemp === 'number' && machine.gpuTemp >= 80;
  const rangeTabs = Object.keys(XM_RANGES).map((k) => `<button type="button" data-action="range" data-range="${k}" class="${k === range ? 'active' : ''}">${XM_RANGES[k].label}</button>`).join('');
  const xlabels = rangeAxisLabels(rc);
  const historySection = offline ? '' : `<div class="xm-sec" id="xm-hist"><h2>History<span class="xm-rangetabs" style="margin-left:auto">${rangeTabs}</span></h2>`
    + `<div class="xm-chart-block"><div class="ctitle"><span>Power draw · watts</span>${powerVal ? `<b>now ${escapeHtml(powerVal)}</b>` : ''}</div>${lineChart(powerVals, 'W', false, xlabels)}</div>`
    + `<div class="xm-chart-block" style="margin-top:18px"><div class="ctitle"><span>Hottest temp · °C</span>${tempVal ? `<b>now ${escapeHtml(tempVal)}</b>` : ''}</div>${lineChart(tempVals, '°C', chartHot, xlabels)}</div>`
    + `</div>`;

  // energy & cost (keep exact cost hooks)
  const costSection = `<div class="xm-sec"><h2>Energy &amp; cost</h2>`
    + `<div class="xm-kv"><span class="k">Integrated</span><span class="v"><p data-testid="xmachines-cost-kwh" aria-label="Integrated kilowatt hours" style="margin:0">${kwhAmount} kWh</p></span></div>`
    + `<div class="xm-kv"><span class="k">Cost</span><span class="v"><p data-testid="xmachines-cost-php" aria-label="Energy cost in PHP" style="margin:0">PHP ${phpAmount}</p></span></div>`
    + `<div class="xm-kv"><span class="k">Tariff</span><span class="v" style="font-weight:400"><p data-testid="xmachines-tariff-flag" aria-label="${flagAria}" style="margin:0">${flag}</p></span></div>`
    + `<div class="xm-kv"><span class="k">Note</span><span class="v" style="font-weight:400;font-size:12px"><p data-testid="xmachines-cost-caveat" aria-label="Short burst caveat" style="margin:0">${caveat}</p></span></div>`
    + `</div>`;

  const wolBlock = renderWolSafety(payload && payload.wolSafety);
  const wolSection = wolBlock ? `<div class="xm-sec"><h2>Wake-on-LAN safety</h2>${wolBlock}</div>` : '';

  // data & freshness
  const provText = typeof machine.provenance === 'string' ? machine.provenance : '';
  const freshText = typeof machine.freshness === 'string' ? machine.freshness : '';
  const ageText = typeof machine.sampleAge === 'string' ? machine.sampleAge : '';
  const busyOut = machine.busy && typeof machine.busy.busyCheckOutput === 'string' ? machine.busy.busyCheckOutput : '';
  const leasesText = machine.busy && Array.isArray(machine.busy.leaseNames) && machine.busy.leaseNames.length ? machine.busy.leaseNames.join(', ') : '';
  const dataSection = `<div class="xm-sec"><h2>Data &amp; freshness</h2>`
    + (freshText ? `<div class="xm-kv"><span class="k">Freshness</span><span class="v"><span data-testid="xmachines-freshness">${escapeHtml(freshText)}</span></span></div>` : '')
    + (provText ? `<div class="xm-kv"><span class="k">Provenance</span><span class="v"><span data-testid="xmachines-provenance" data-provenance>${escapeHtml(provText)}</span></span></div>` : '')
    + (ageText && !offline ? `<div class="xm-kv"><span class="k">Sample age</span><span class="v"><span data-testid="xmachines-sample-age" data-sample-age>${escapeHtml(ageText)}</span></span></div>` : '')
    + (busyOut ? `<span class="xm-hooks"><span data-testid="xmachines-busy">${escapeHtml(busyOut)}</span></span>` : '')
    + (leasesText ? `<div class="xm-kv"><span class="k">Leases</span><span class="v"><span data-testid="xmachines-leases">${escapeHtml(leasesText)}</span></span></div>` : '')
    + `<div class="xm-kv"><span class="k">Machine ID</span><span class="v">${name}</span></div>`
    + `</div>`;

  const offlinePanel = offline
    ? `<div class="xm-sec"><div class="xm-offline"><span class="big">🌙</span><span class="t">Machine is powered off</span><span>Telemetry pauses while off. Turn it on above to see live GPU, thermal &amp; fan detail.</span></div></div>`
    : '';

  return `<section class="xm-detail" data-testid="xmachines-machine-detail" role="region" aria-label="Machine detail">`
    + header
    + powerSection
    + offlinePanel
    + thermalsSection
    + gpuSection
    + fansSection
    + storageSection
    + historySection
    + costSection
    + wolSection
    + dataSection
    + `</section>`;
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
  const offTarget = event && event.target && typeof event.target.closest === 'function'
    ? event.target.closest('[data-testid="xmachines-off-button"]')
    : null;
  const forceTarget = event && event.target && typeof event.target.closest === 'function'
    ? event.target.closest('[data-testid="xmachines-force-button"]')
    : null;
  if (!offTarget && !forceTarget) return payload;
  if (event && typeof event.preventDefault === 'function') event.preventDefault();
  const name = payload && payload.machine && payload.machine.name;
  if (!name) return payload;
  const fetchImpl = options.fetch || (typeof fetch !== 'undefined' ? fetch : null);
  if (!fetchImpl) return payload;
  const idempotencyKey = typeof options.idempotencyKey === 'function' ? options.idempotencyKey() : defaultIdempotencyKey();
  const isForce = !!forceTarget;
  const path = isForce
    ? `/api/xmachines/machines/${encodeURIComponent(name)}/power/force`
    : `/api/xmachines/machines/${encodeURIComponent(name)}/power/off`;
  const res = await fetchImpl(path, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey, 'Content-Type': 'application/json' },
    body: isForce ? JSON.stringify({ challengeId: payload?.forceChallenge?.challengeId, selectedNumber: payload?.forceChallenge?.selectedNumber }) : undefined,
  });
  let body = null;
  try { body = await res.json(); } catch {}
  if (res.ok || !body) return payload;
  if (isForce && body && body.status === 'challenge') {
    return { ...payload, forceChallenge: { challengeId: body.challengeId, displayNumber: body.displayNumber }, forceConfirmation: body.confirmation };
  }
  if (isForce && body && body.status === 'in-progress') {
    return { ...payload, forceChallenge: null, forceConfirmation: '' };
  }
  if (!isForce) {
    return { ...payload, offRefusal: body };
  }
  return { ...payload, forceRefusal: body };
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

export function renderForceRefusal(refusal) {
  if (!refusal || typeof refusal !== 'object') return '';
  const reason = typeof refusal.reason === 'string' ? refusal.reason : '';
  const detail = typeof refusal.detail === 'string' ? refusal.detail : '';
  if (!reason && !detail) return '';
  const exact = detail || reason;
  return `<div data-testid="xmachines-force-refusal-block" role="group" aria-label="Force Off refusal"><p data-testid="xmachines-force-refusal" role="alert" aria-label="${escapeHtml(exact)}">${escapeHtml(exact)}</p><p data-testid="xmachines-force-refusal-reason" aria-label="${escapeHtml(reason)}">${escapeHtml(reason)}</p></div>`;
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
