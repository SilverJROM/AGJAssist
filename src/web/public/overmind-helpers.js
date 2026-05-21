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
  active: 'ovm-yellow',
  idle: 'ovm-yellow',
  working: 'ovm-green',
  stuck: 'ovm-red',
  waiting_human: 'ovm-blue',
  awaiting_decision: 'ovm-blue',
  paused: 'ovm-grey',
  completed: 'ovm-grey',
  closed: 'ovm-grey',
  failed: 'ovm-red'
};

export const BOTTOM_NAV_STORAGE_KEY = 'agj_bottom_nav_tabs_v1';

export const AVAILABLE_BOTTOM_NAV_TABS = [
  { id: '/', icon: '\u{1F3E0}', label: 'Home' },
  { id: '/tasks', icon: '\u{2705}', label: 'Tasks' },
  { id: '/notes', icon: '\u{1F4DD}', label: 'Notes' },
  { id: '/terminals', icon: '\u{1F5A5}', label: 'Terminal' },
  { id: '/conversations', icon: '\u{1F4AC}', label: 'Chat' },
  { id: '/settings', icon: '\u{2699}', label: 'Settings' },
  { id: '/overmind', icon: '\u{25B6}', label: 'Workflows' }
];

export const DEFAULT_BOTTOM_NAV_TAB_IDS = [
  '/',
  '/tasks',
  '/notes',
  '/terminals',
  '/conversations',
  '/settings'
];

const AVAILABLE_BOTTOM_NAV_TAB_IDS = AVAILABLE_BOTTOM_NAV_TABS.map(tab => tab.id);

export function statusIcon(status) {
  return OVERMIND_STATUS_ICONS[status] || '•';
}

export function statusColor(status) {
  return OVERMIND_STATUS_COLORS[status] || 'ovm-neutral';
}

export function isActiveStatus(status) {
  return ['active', 'working', 'waiting_human', 'awaiting_decision', 'stuck'].includes(status);
}

export function summarizeWorkflows(workflows) {
  const rows = Array.isArray(workflows) ? workflows : [];
  return {
    total: rows.length,
    active: rows.filter(workflow => isActiveStatus(workflow?.status)).length
  };
}

export function groupOvermindHistoryByWorkflow(history) {
  const rows = Array.isArray(history) ? history : [];
  const groups = new Map();

  for (const entry of rows) {
    if (!entry || typeof entry !== 'object') continue;
    const session = entry.coordinator_session || '';
    const name = entry.name || session || 'Unknown workflow';
    const key = session || name;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        coordinator_session: session || null,
        name,
        entries: []
      });
    }

    const group = groups.get(key);
    group.name = name;
    group.entries.push({
      id: entry.id,
      coordinator_session: session || null,
      name,
      at: entry.at || null,
      current_task: entry.current_task ?? null,
      done: Number.isFinite(Number(entry.done)) ? Number(entry.done) : 0,
      total: Number.isFinite(Number(entry.total)) ? Number(entry.total) : 0
    });
  }

  const sortedGroups = [...groups.values()].map(group => {
    group.entries.sort(compareHistoryEntriesDesc);
    group.latest_at = group.entries[0]?.at || null;
    return group;
  });
  sortedGroups.sort((a, b) => {
    const byTime = compareHistoryTimestampsDesc(a.latest_at, b.latest_at);
    if (byTime !== 0) return byTime;
    return a.name.localeCompare(b.name);
  });
  return sortedGroups;
}

export function normalizeBottomNavTabIds(tabIds = DEFAULT_BOTTOM_NAV_TAB_IDS) {
  const source = Array.isArray(tabIds) ? tabIds : DEFAULT_BOTTOM_NAV_TAB_IDS;
  const normalized = [];
  for (const id of source) {
    if (AVAILABLE_BOTTOM_NAV_TAB_IDS.includes(id) && !normalized.includes(id)) {
      normalized.push(id);
    }
  }
  return normalized.length > 0 ? normalized : [...DEFAULT_BOTTOM_NAV_TAB_IDS];
}

export function getBottomNavTabs(tabIds = DEFAULT_BOTTOM_NAV_TAB_IDS) {
  const normalized = normalizeBottomNavTabIds(tabIds);
  return normalized
    .map(id => AVAILABLE_BOTTOM_NAV_TABS.find(tab => tab.id === id))
    .filter(Boolean);
}

export function moveBottomNavTab(tabIds, tabId, direction) {
  const normalized = normalizeBottomNavTabIds(tabIds);
  const index = normalized.indexOf(tabId);
  const offset = direction < 0 ? -1 : 1;
  const target = index + offset;
  if (index < 0 || target < 0 || target >= normalized.length) return normalized;
  const next = [...normalized];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function removeBottomNavTab(tabIds, tabId) {
  const normalized = normalizeBottomNavTabIds(tabIds);
  if (normalized.length <= 1) return normalized;
  const next = normalized.filter(id => id !== tabId);
  return next.length > 0 ? next : normalized;
}

export function addBottomNavTab(tabIds, tabId) {
  const normalized = normalizeBottomNavTabIds(tabIds);
  if (!AVAILABLE_BOTTOM_NAV_TAB_IDS.includes(tabId) || normalized.includes(tabId)) return normalized;
  return [...normalized, tabId];
}

export function serializeBottomNavTabIds(tabIds) {
  return JSON.stringify(normalizeBottomNavTabIds(tabIds));
}

export function deserializeBottomNavTabIds(raw) {
  if (!raw) return [...DEFAULT_BOTTOM_NAV_TAB_IDS];
  try {
    return normalizeBottomNavTabIds(JSON.parse(raw));
  } catch {
    return [...DEFAULT_BOTTOM_NAV_TAB_IDS];
  }
}

export function readBottomNavTabIds(storage = globalThis.localStorage) {
  if (!storage?.getItem) return [...DEFAULT_BOTTOM_NAV_TAB_IDS];
  return deserializeBottomNavTabIds(storage.getItem(BOTTOM_NAV_STORAGE_KEY));
}

export function writeBottomNavTabIds(tabIds, storage = globalThis.localStorage) {
  const serialized = serializeBottomNavTabIds(tabIds);
  if (storage?.setItem) storage.setItem(BOTTOM_NAV_STORAGE_KEY, serialized);
  return JSON.parse(serialized);
}

export function taskGlyph(state) {
  return OVERMIND_TASK_GLYPHS[state] || '○';
}

export function countDoneTasks(tasks) {
  return Array.isArray(tasks) ? tasks.filter(task => task?.state === 'done').length : 0;
}

export function formatActiveSessionAttribution(workflow) {
  if (!workflow?.active_session || !workflow?.active_role) return '— no session active';

  if (workflow.active_role === 'parent') {
    const childSessions = Array.isArray(workflow.child_sessions) ? workflow.child_sessions : [];
    const childNote = childSessions.length
      ? `${childSessions.join(', ')} (child) idle/waiting`
      : 'children idle/waiting';
    return `working: ${workflow.active_session} (parent) · ${childNote}`;
  }

  const coordinator = workflow.coordinator_session
    ? `${workflow.coordinator_session} (parent) idle/waiting`
    : 'parent idle/waiting';
  return `working: ${workflow.active_session} (child) · ${coordinator}`;
}

export function formatStuckDuration(stuckSince, now = Date.now()) {
  if (!stuckSince) return '—';
  const start = parseTimestampMs(stuckSince);
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

export function currentElapsedMs(runStartedAt, endedAt = null, now = Date.now()) {
  const start = parseTimestampMs(runStartedAt);
  const end = endedAt ? parseTimestampMs(endedAt) : (typeof now === 'number' ? now : parseTimestampMs(now));
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 0;
  return end - start;
}

export function totalElapsedMs(accumulatedMs = 0, runStartedAt, endedAt = null, now = Date.now()) {
  const accumulated = Number.isFinite(Number(accumulatedMs)) ? Number(accumulatedMs) : 0;
  return Math.max(0, accumulated) + currentElapsedMs(runStartedAt, endedAt, now);
}

export function elapsedMs(createdAt, endedAt = null, now = Date.now()) {
  return currentElapsedMs(createdAt, endedAt, now);
}

export function formatElapsed(ms) {
  const totalMinutes = Math.floor(Math.max(0, ms) / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return '<1m';
}

export function buildOvermindWsUrl(token, loc = globalThis.location) {
  if (!token || !loc?.host) return null;
  const protocol = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${loc.host}/ws/overmind?token=${encodeURIComponent(token)}`;
}

function parseTimestampMs(value) {
  if (typeof value === 'number') return value;
  if (!value) return NaN;
  return Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value);
}

function compareHistoryEntriesDesc(a, b) {
  const byTime = compareHistoryTimestampsDesc(a?.at, b?.at);
  if (byTime !== 0) return byTime;
  return Number(b?.id || 0) - Number(a?.id || 0);
}

function compareHistoryTimestampsDesc(a, b) {
  const aTime = parseTimestampMs(a);
  const bTime = parseTimestampMs(b);
  if (Number.isNaN(aTime) && Number.isNaN(bTime)) return 0;
  if (Number.isNaN(aTime)) return 1;
  if (Number.isNaN(bTime)) return -1;
  return bTime - aTime;
}
