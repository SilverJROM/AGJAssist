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

// Fleet overview prints name and state only. Cost fields on a machine are ignored.
export function renderFleetOverview(payload) {
  const machines = payload && Array.isArray(payload.machines) ? payload.machines : [];
  const items = machines.map((machine) => {
    const name = escapeHtml(machine && machine.name != null ? machine.name : '');
    const state = escapeHtml(machine && machine.state != null ? machine.state : '');
    return `<li data-testid="xmachines-fleet-card" aria-label="${name} ${state}">${name} ${state}</li>`;
  }).join('');
  return `<section class="xm-fleet" data-testid="xmachines-fleet-overview" role="region" aria-label="Fleet overview"><h1>Fleet overview</h1><ul>${items}</ul></section>`;
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
  return `<section class="xm-detail" data-testid="xmachines-machine-detail" role="region" aria-label="Machine detail"><h1 class="xm-detail-name">${name}</h1><p data-testid="xmachines-cost-kwh" aria-label="Integrated kilowatt hours">${kwhAmount} kWh</p><p data-testid="xmachines-cost-php" aria-label="Energy cost in PHP">PHP ${phpAmount}</p><p data-testid="xmachines-tariff-flag" aria-label="${flagAria}">${flag}</p><p data-testid="xmachines-cost-caveat" aria-label="Short burst caveat">${caveat}</p>${renderWolSafety(payload && payload.wolSafety)}</section>`;
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
