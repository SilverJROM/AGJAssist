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
  return `<span data-testid="${testId}">${escapeHtml(text)}</span>`;
}

// Cost fields are never printed. Down machines show offline and no live metrics.
function liveMetricSpans(machine) {
  if (!machine || isOfflineMachine(machine)) return '';
  const temp = typeof machine.gpuTemp === 'number' ? `${machine.gpuTemp}°C` : '';
  const power = typeof machine.powerWatts === 'number' ? `${machine.powerWatts} W` : '';
  const uptime = typeof machine.uptime === 'string' ? machine.uptime : '';
  return `${fieldSpan('xmachines-gpu-temp', temp)}${fieldSpan('xmachines-power-draw', power)}${fieldSpan('xmachines-uptime', uptime)}`;
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

// Fleet overview prints name and power state. Cost fields on a machine are ignored.
export function renderFleetOverview(payload) {
  const machines = payload && Array.isArray(payload.machines) ? payload.machines : [];
  const items = machines.map((machine) => {
    const name = escapeHtml(machine && machine.name != null ? machine.name : '');
    const state = escapeHtml(powerStateLabel(machine));
    const extra = `${liveMetricSpans(machine)}${serviceSpans(machine)}`;
    const tail = extra ? ` ${extra}` : '';
    return `<li data-testid="xmachines-fleet-card" aria-label="${name} ${state}">${name} ${state}${tail}</li>`;
  }).join('');
  return `<section class="xm-fleet" data-testid="xmachines-fleet-overview" role="region" aria-label="Fleet overview"><h1>Fleet overview</h1><ul>${items}</ul></section>`;
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
  return `<section class="xm-detail" data-testid="xmachines-machine-detail" role="region" aria-label="Machine detail"><h1 class="xm-detail-name">${name}</h1>${renderReadout(machine)}<p data-testid="xmachines-cost-kwh" aria-label="Integrated kilowatt hours">${kwhAmount} kWh</p><p data-testid="xmachines-cost-php" aria-label="Energy cost in PHP">PHP ${phpAmount}</p><p data-testid="xmachines-tariff-flag" aria-label="${flagAria}">${flag}</p><p data-testid="xmachines-cost-caveat" aria-label="Short burst caveat">${caveat}</p>${renderWolSafety(payload && payload.wolSafety)}${renderNormalOffRefusal(payload && payload.offRefusal)}</section>`;
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
