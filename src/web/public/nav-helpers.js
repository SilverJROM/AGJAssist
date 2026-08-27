export const BOTTOM_NAV_STORAGE_KEY = 'agj_bottom_nav_tabs_v1';

export const LANDING_TAB_STORAGE_KEY = 'agj_landing_tab_v1';
export const DEFAULT_LANDING_TAB = '/';

export const AVAILABLE_BOTTOM_NAV_TABS = [
  { id: '/', icon: '\u{1F3E0}', label: 'Home' },
  { id: '/tasks', icon: '\u{2705}', label: 'Tasks' },
  { id: '/notes', icon: '\u{1F4DD}', label: 'Notes' },
  { id: '/terminals', icon: '\u{1F5A5}', label: 'Terminal' },
  { id: '/settings', icon: '\u{2699}', label: 'Settings' }
];

export const DEFAULT_BOTTOM_NAV_TAB_IDS = [
  '/',
  '/tasks',
  '/notes',
  '/terminals',
  '/settings'
];

const AVAILABLE_BOTTOM_NAV_TAB_IDS = AVAILABLE_BOTTOM_NAV_TABS.map(tab => tab.id);

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

export function readLandingTab(storage = globalThis.localStorage) {
  if (!storage?.getItem) return DEFAULT_LANDING_TAB;
  const raw = storage.getItem(LANDING_TAB_STORAGE_KEY);
  if (typeof raw === 'string' && AVAILABLE_BOTTOM_NAV_TAB_IDS.includes(raw)) return raw;
  return DEFAULT_LANDING_TAB;
}

export function writeLandingTab(tabId, storage = globalThis.localStorage) {
  if (!AVAILABLE_BOTTOM_NAV_TAB_IDS.includes(tabId)) tabId = DEFAULT_LANDING_TAB;
  if (storage?.setItem) storage.setItem(LANDING_TAB_STORAGE_KEY, tabId);
  return tabId;
}
