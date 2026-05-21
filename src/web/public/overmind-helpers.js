export const OVERMIND_STATUS_ICONS = {
  active: '•',
  working: '▶',
  stuck: '⚠',
  waiting_human: '⏸',
  awaiting_decision: '❓',
  paused: '⏯',
  completed: '✅',
  failed: '•'
};

export const OVERMIND_TASK_GLYPHS = {
  done: '✓',
  processing: '◐',
  pending: '○'
};

export const OVERMIND_STATUS_COLORS = {
  active: 'ovm-neutral',
  working: 'ovm-yellow',
  stuck: 'ovm-red',
  waiting_human: 'ovm-green',
  awaiting_decision: 'ovm-green',
  paused: 'ovm-grey',
  completed: 'ovm-grey',
  failed: 'ovm-red'
};

export function statusIcon(status) {
  return OVERMIND_STATUS_ICONS[status] || '•';
}

export function statusColor(status) {
  return OVERMIND_STATUS_COLORS[status] || 'ovm-neutral';
}

export function taskGlyph(state) {
  return OVERMIND_TASK_GLYPHS[state] || '○';
}

export function countDoneTasks(tasks) {
  return Array.isArray(tasks) ? tasks.filter(task => task?.state === 'done').length : 0;
}

export function formatStuckDuration(stuckSince, now = Date.now()) {
  if (!stuckSince) return '—';
  const start = Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(stuckSince)
    ? `${stuckSince.replace(' ', 'T')}Z`
    : stuckSince);
  const end = typeof now === 'number' ? now : Date.parse(now);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return '—';

  const totalSeconds = Math.floor((end - start) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function buildOvermindWsUrl(token, loc = globalThis.location) {
  if (!token || !loc?.host) return null;
  const protocol = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${loc.host}/ws/overmind?token=${encodeURIComponent(token)}`;
}
