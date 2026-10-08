import { h, render, Component } from 'https://esm.sh/preact@10.19.3';
import { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from 'https://esm.sh/preact@10.19.3/hooks';
import htm from 'https://esm.sh/htm@3.1.1';
import { normalizeTerminalOutput, diffTerminalOutput, extractStatus, appendYou, extractStrippedChromeLines, applyAgentPatch, sanitizeOutgoingCommand, detectSelectionPrompt, readTerminalDraft, writeTerminalDraft, clearTerminalDraft, stripAnsiPlain } from './terminal-chat-state.js';
import {
  AVAILABLE_BOTTOM_NAV_TABS,
  DEFAULT_BOTTOM_NAV_TAB_IDS,
  DEFAULT_LANDING_TAB,
  addBottomNavTab,
  getBottomNavTabs,
  moveBottomNavTab,
  readBottomNavTabIds,
  readLandingTab,
  removeBottomNavTab,
  writeBottomNavTabIds,
  writeLandingTab
} from './nav-helpers.js';
import { renderFleetOverview, renderMachineCostDetail, handleMachineDetailClick, escapeHtml } from './xmachines-cost-view.js';

const html = htm.bind(h);
const TERMINAL_FONT_STORAGE_KEY = 'agj_terminal_font_size';
const TERMINAL_DEFAULT_FONT_SIZE = 13;
const TERMINAL_MIN_FONT_SIZE = 8;
const TERMINAL_MAX_FONT_SIZE = 28;
const TERMINAL_CONV_FONT_STORAGE_KEY = 'agj_terminal_conv_font_size';
const TERMINAL_CONV_FONT_DEFAULT = 17;
const TERMINAL_CONV_FONT_MIN = 12;
const TERMINAL_CONV_FONT_MAX = 26;

function clampTerminalConvFontSize(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return TERMINAL_CONV_FONT_DEFAULT;
  return Math.min(TERMINAL_CONV_FONT_MAX, Math.max(TERMINAL_CONV_FONT_MIN, Math.round(parsed)));
}

function readTerminalConvFontSize() {
  try {
    const stored = localStorage.getItem(TERMINAL_CONV_FONT_STORAGE_KEY);
    if (stored == null || stored === '') return TERMINAL_CONV_FONT_DEFAULT;
    return clampTerminalConvFontSize(stored);
  } catch {
    return TERMINAL_CONV_FONT_DEFAULT;
  }
}

function applyTerminalConvFontSize(size) {
  const next = clampTerminalConvFontSize(size);
  try { document.documentElement.style.setProperty('--terminal-conv-font', `${next}px`); } catch {}
  return next;
}

function writeTerminalConvFontSize(size) {
  const next = applyTerminalConvFontSize(size);
  try { localStorage.setItem(TERMINAL_CONV_FONT_STORAGE_KEY, String(next)); } catch {}
  try { window.dispatchEvent(new CustomEvent('agj-terminal-conv-font', { detail: next })); } catch {}
  return next;
}

applyTerminalConvFontSize(readTerminalConvFontSize());

// Reply-length (minimize): agent replies compact to the most recent N lines.
// 0 = Full (no compaction). Persisted per-device, synced via a custom event so
// the ☰ menu picker and the chat re-render together (same pattern as the font).
const TERMINAL_REPLY_LIMIT_STORAGE_KEY = 'agj_terminal_reply_limit';
const TERMINAL_REPLY_LIMIT_DEFAULT = 50;
const TERMINAL_REPLY_LIMIT_OPTIONS = [10, 50, 0]; // 0 = Full
function readTerminalReplyLimit() {
  try {
    const stored = localStorage.getItem(TERMINAL_REPLY_LIMIT_STORAGE_KEY);
    if (stored == null || stored === '') return TERMINAL_REPLY_LIMIT_DEFAULT;
    const n = Number(stored);
    return TERMINAL_REPLY_LIMIT_OPTIONS.includes(n) ? n : TERMINAL_REPLY_LIMIT_DEFAULT;
  } catch {
    return TERMINAL_REPLY_LIMIT_DEFAULT;
  }
}
function writeTerminalReplyLimit(value) {
  const n = TERMINAL_REPLY_LIMIT_OPTIONS.includes(Number(value)) ? Number(value) : TERMINAL_REPLY_LIMIT_DEFAULT;
  try { localStorage.setItem(TERMINAL_REPLY_LIMIT_STORAGE_KEY, String(n)); } catch {}
  try { window.dispatchEvent(new CustomEvent('agj-terminal-reply-limit', { detail: n })); } catch {}
  return n;
}

// Telegram-style session folder groups (client-only; never touches tmux).
const TERMINAL_GROUPS_STORAGE_KEY = 'agj_terminal_groups';
const TERMINAL_ACTIVE_GROUP_STORAGE_KEY = 'agj_terminal_active_group';

function newTerminalGroupId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {}
  return 'g_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}

function normalizeTerminalGroup(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').trim();
  const name = String(raw.name || '').trim();
  if (!id || !name) return null;
  const sessions = Array.isArray(raw.sessions)
    ? Array.from(new Set(raw.sessions.map((s) => String(s)).filter(Boolean)))
    : [];
  return { id, name, sessions };
}

function readTerminalGroups() {
  try {
    const parsed = JSON.parse(localStorage.getItem(TERMINAL_GROUPS_STORAGE_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeTerminalGroup).filter(Boolean);
  } catch {
    return [];
  }
}

function writeTerminalGroups(groups) {
  try {
    localStorage.setItem(TERMINAL_GROUPS_STORAGE_KEY, JSON.stringify(Array.isArray(groups) ? groups : []));
  } catch {}
}

function readActiveTerminalGroup() {
  try {
    const value = localStorage.getItem(TERMINAL_ACTIVE_GROUP_STORAGE_KEY);
    return value && String(value).trim() ? String(value) : 'all';
  } catch {
    return 'all';
  }
}

function writeActiveTerminalGroup(id) {
  try {
    localStorage.setItem(TERMINAL_ACTIVE_GROUP_STORAGE_KEY, id || 'all');
  } catch {}
}

function clampMenuPosition(top, left, width, height) {
  const maxLeft = Math.max(8, window.innerWidth - width - 8);
  const maxTop = Math.max(8, window.innerHeight - height - 8);
  return {
    top: Math.min(Math.max(8, top), maxTop),
    left: Math.min(Math.max(8, left), maxLeft)
  };
}

// Recent-message memory: the app remembers the last N exchanges (your message +
// the reply after it) per session in localStorage, so they survive closing and
// reopening the app and can be seeded back into the chat. Rolling — the oldest
// exchange drops out when an 11th arrives. Stored replies are length-capped so
// the store stays small.
const TERMINAL_MEMORY_KEY_PREFIX = 'agj_term_mem_';
const TERMINAL_MEMORY_MAX_EXCHANGES = 10;
const TERMINAL_MEMORY_REPLY_CAP = 4000; // chars kept per stored reply (tail)
function terminalMemoryKey(target) {
  return TERMINAL_MEMORY_KEY_PREFIX + String(target).replace(/[^a-zA-Z0-9_.-]/g, '_');
}
function capMemoryReply(text) {
  const s = typeof text === 'string' ? text : String(text == null ? '' : text);
  if (s.length <= TERMINAL_MEMORY_REPLY_CAP) return s;
  return '…' + s.slice(s.length - TERMINAL_MEMORY_REPLY_CAP);
}
function trimConversationForMemory(entries) {
  const conv = (Array.isArray(entries) ? entries : []).filter(
    (e) => e && (e.role === 'user' || e.role === 'agent') && typeof e.content === 'string'
  );
  const userIdx = [];
  conv.forEach((e, i) => { if (e.role === 'user') userIdx.push(i); });
  const start = userIdx.length > TERMINAL_MEMORY_MAX_EXCHANGES
    ? userIdx[userIdx.length - TERMINAL_MEMORY_MAX_EXCHANGES]
    : 0;
  return conv.slice(start).map((e) => (e.role === 'agent' ? { ...e, content: capMemoryReply(e.content) } : e));
}
function readTerminalMemory(target) {
  try {
    const raw = localStorage.getItem(terminalMemoryKey(target));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.entries) && parsed.entries.length ? parsed : null;
  } catch {
    return null;
  }
}
function writeTerminalMemory(target, entries) {
  try {
    const trimmed = trimConversationForMemory(entries);
    if (!trimmed.length) return;
    localStorage.setItem(terminalMemoryKey(target), JSON.stringify({ entries: trimmed, updatedAt: Date.now() }));
  } catch {}
}

// tmux key NAMES sent to the /keys REST endpoint (works over the tunnel — no
// WebSocket required — and no control-char issues since these are names, not
// bytes). The backend strictly allowlists this set.
const TERM_KEYS = {
  enter: 'Enter',
  esc: 'Escape',
  ctrlc: 'C-c',
  up: 'Up',
  down: 'Down',
  pageUp: 'PageUp',
  pageDown: 'PageDown',
  tab: 'Tab',
  shiftTab: 'BTab',
  space: 'Space',
};

// Telegram Mini App detection
const seededTgContext = (() => {
  try {
    return sessionStorage.getItem('agj_has_tg_init_data') === '1';
  } catch {
    return false;
  }
})();
const isTgMiniApp = !!(window.Telegram?.WebApp?.initData) || seededTgContext;
if (isTgMiniApp) {
  document.body.classList.add('tg-miniapp');
  // Runs on every load (incl. already-authenticated users where Login never mounts).
  // disableVerticalSwipes stops Telegram's swipe-to-minimize gesture from eating touch
  // scroll (the "mini-app scroll not working" bug). All guarded for older clients.
  try {
    const wa = window.Telegram.WebApp;
    wa.ready?.();
    wa.expand?.();
    wa.disableVerticalSwipes?.();
  } catch {}
  const root = document.documentElement.style;
  // Vars we force in light mode — must be cleared when returning to dark so the
  // base dark theme (:root / body.tg-miniapp → --tg-theme-*) takes back over.
  const FORCED_LIGHT_VARS = ['--text', '--text-secondary', '--bg', '--surface', '--border'];
  // Re-appliable so switching Telegram between light/dark updates the whole UI,
  // not just at first load (previously it only ran once and never removed
  // tg-light / the forced light vars, leaving a stale mixed theme on switch).
  function applyTgTheme() {
    const tp = (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.themeParams) || {};
    const tgVars = {
      '--tg-theme-bg-color': tp.bg_color,
      '--tg-theme-secondary-bg-color': tp.secondary_bg_color,
      '--tg-theme-text-color': tp.text_color,
      '--tg-theme-hint-color': tp.hint_color,
      '--tg-theme-button-color': tp.button_color,
      '--tg-theme-button-text-color': tp.button_text_color,
      '--tg-theme-section-bg-color': tp.section_bg_color,
      '--tg-theme-section-separator-color': tp.section_separator_color,
      '--tg-theme-accent-text-color': tp.accent_text_color
    };
    // Set the vars TG provides; clear the rest so none go stale across a switch.
    for (const key in tgVars) {
      if (tgVars[key]) root.setProperty(key, tgVars[key]);
      else root.removeProperty(key);
    }
    const bgColor = tp.bg_color || '#0d1117';
    const r = parseInt(bgColor.slice(1, 3), 16), g = parseInt(bgColor.slice(3, 5), 16), b = parseInt(bgColor.slice(5, 7), 16);
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    if (Number.isFinite(brightness) && brightness > 128) {
      // Light theme — force dark text + light surfaces.
      document.body.classList.add('tg-light');
      root.setProperty('--text', tp.text_color || '#1a1a1a');
      root.setProperty('--text-secondary', tp.hint_color || '#666666');
      root.setProperty('--bg', tp.bg_color || '#ffffff');
      root.setProperty('--surface', tp.secondary_bg_color || tp.section_bg_color || '#f0f0f0');
      root.setProperty('--border', tp.section_separator_color || '#d0d0d0');
    } else {
      // Dark theme — drop the light class + forced overrides so the dark theme applies.
      document.body.classList.remove('tg-light');
      for (const v of FORCED_LIGHT_VARS) root.removeProperty(v);
    }
  }
  applyTgTheme();
  // Re-apply whenever the user flips Telegram's appearance.
  try { window.Telegram.WebApp.onEvent?.('themeChanged', applyTgTheme); } catch {}
}

// API helper
const API_BASE = '';
let authToken = localStorage.getItem('agj_token');
let sessionExpired = false;
const sessionExpiredListeners = new Set();
function onSessionExpiredChange(fn) { sessionExpiredListeners.add(fn); return () => sessionExpiredListeners.delete(fn); }
function setSessionExpired() {
  if (sessionExpired) return;
  sessionExpired = true;
  // Auto-save any in-progress note work before showing overlay
  saveDraftToLocalStorage();
  sessionExpiredListeners.forEach(fn => fn(true));
}

// Draft save/restore — saves any in-progress text inputs on session expiry
function saveDraftToLocalStorage() {
  const drafts = [];
  // Scan all textareas and text inputs with content
  document.querySelectorAll('textarea, input[type="text"], input:not([type])').forEach(el => {
    if (el.value && el.value.trim() && el.value.trim().length > 2) {
      const label = el.placeholder || el.getAttribute('aria-label') || '';
      // Skip search inputs and small utility fields
      if (label.toLowerCase().includes('search') || el.style.letterSpacing) return;
      drafts.push({ placeholder: label, value: el.value, tag: el.tagName });
    }
  });
  if (drafts.length > 0) {
    const draft = {
      fields: drafts,
      timestamp: new Date().toISOString(),
      route: location.hash
    };
    // Detect specific context
    const noteBody = document.querySelector('textarea[placeholder="Write your note..."]');
    const noteEdit = document.querySelector('textarea[placeholder="Note content..."]');
    if (noteBody && noteBody.value.trim()) {
      draft.type = 'new';
      draft.formBody = noteBody.value;
      const titleEl = document.querySelector('input[placeholder="Note title..."]');
      draft.formTitle = titleEl ? titleEl.value : '';
    } else if (noteEdit && noteEdit.value.trim()) {
      draft.type = 'edit';
      draft.editBody = noteEdit.value;
      const titleEl = document.querySelector('input[placeholder="Title (optional)"]');
      draft.editTitle = titleEl ? titleEl.value : '';
    }
    localStorage.setItem('agj_note_draft', JSON.stringify(draft));
  }
}

function loadDraft() {
  try {
    const raw = localStorage.getItem('agj_note_draft');
    if (!raw) return null;
    const draft = JSON.parse(raw);
    // Expire drafts older than 24 hours
    if (Date.now() - new Date(draft.timestamp).getTime() > 24 * 60 * 60 * 1000) {
      localStorage.removeItem('agj_note_draft');
      return null;
    }
    return draft;
  } catch { return null; }
}

function clearDraft() { localStorage.removeItem('agj_note_draft'); }

async function api(path, opts = {}) {
  if (sessionExpired) throw new Error('Session expired');
  const headers = { ...(opts.headers || {}) };
  if (opts.body) headers['Content-Type'] = 'application/json';
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
  const timeoutMs = opts.timeout || 15000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...opts, headers, signal: controller.signal });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Request timed out. Check your connection and try again.');
    throw e;
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 204) return null;
  if (res.status === 401) {
    authToken = null;
    localStorage.removeItem('agj_token');
    setSessionExpired();
    throw new Error('Session expired. Please log in again.');
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// Session heartbeat — check every 2 minutes, pause when tab hidden
let heartbeatInterval = null;
function startHeartbeat() {
  if (heartbeatInterval) return;
  async function check() {
    if (!authToken || sessionExpired) return;
    try {
      const res = await fetch(API_BASE + '/api/auth/me', {
        headers: { 'Authorization': 'Bearer ' + authToken }
      });
      if (res.status === 401) {
        authToken = null;
        localStorage.removeItem('agj_token');
        setSessionExpired();
      }
    } catch { /* network error, ignore */ }
  }
  heartbeatInterval = setInterval(check, 2 * 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    } else {
      check(); // immediate check on tab focus
      heartbeatInterval = setInterval(check, 2 * 60 * 1000);
    }
  });
}
if (authToken) startHeartbeat();

// Session Expired Overlay component
function SessionExpiredOverlay() {
  const [show, setShow] = useState(sessionExpired);
  const draft = loadDraft();

  useEffect(() => {
    return onSessionExpiredChange((expired) => setShow(expired));
  }, []);

  if (!show) return null;

  return html`
    <div style="position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;padding:20px">
      <div style="background:var(--surface, #161b22);border:1px solid var(--border, #30363d);border-radius:12px;padding:24px;max-width:420px;width:100%;text-align:center">
        <div style="font-size:36px;margin-bottom:12px">🔒</div>
        <h3 style="color:var(--text, #e6edf3);margin:0 0 8px 0">Session Expired</h3>
        <p style="color:var(--text-secondary, #8b949e);font-size:14px;margin:0 0 16px 0">
          Your session has expired. Please log in again to continue.
        </p>
        ${draft && html`
          <div style="background:rgba(63,185,80,0.1);border:1px solid rgba(63,185,80,0.3);border-radius:8px;padding:10px 12px;margin-bottom:16px;text-align:left">
            <div style="font-size:12px;font-weight:600;color:var(--success, #3fb950);margin-bottom:4px">Draft auto-saved (${draft.fields?.length || 1} field${(draft.fields?.length || 1) > 1 ? 's' : ''})</div>
            ${draft.type ? html`
              <div style="font-size:12px;color:var(--text-secondary, #8b949e)">
                ${draft.type === 'new' ? 'New note' : 'Note edit'}: "${(draft.formTitle || draft.editTitle || draft.formBody?.slice(0, 50) || draft.editBody?.slice(0, 50))}"
              </div>
            ` : html`
              <div style="font-size:12px;color:var(--text-secondary, #8b949e)">
                ${draft.fields?.slice(0, 3).map(f => html`
                  <div style="margin-top:2px">${f.placeholder || 'Text'}: "${f.value.slice(0, 60)}${f.value.length > 60 ? '...' : ''}"</div>
                `)}
              </div>
            `}
            <div style="font-size:11px;color:var(--text-secondary, #8b949e);margin-top:4px">
              ${draft.type ? 'Your note will be restored after you log in.' : 'Saved at ' + new Date(draft.timestamp).toLocaleTimeString()}
            </div>
          </div>
        `}
        <button class="btn btn-primary" style="width:100%;padding:10px" onclick=${() => {
          localStorage.removeItem('agj_user');
          location.reload();
        }}>Log In Again</button>
        <p style="color:var(--text-secondary, #8b949e);font-size:11px;margin:10px 0 0 0">
          Your current page content is still visible behind this overlay. You can copy any unsaved text before logging in.
        </p>
      </div>
    </div>
  `;
}

// Router (hash-based)
function useRoute() {
  const [route, setRoute] = useState(location.hash.slice(1) || '/');
  useEffect(() => {
    const handler = () => setRoute(location.hash.slice(1) || '/');
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);
  return route;
}
function navigate(path) {
  const current = location.hash.slice(1) || '/';
  if (current && current !== path && current !== '/terminals') {
    try { sessionStorage.setItem('agj_prev_route', current); } catch {}
  }
  location.hash = path;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const MCP_OAUTH_RETURN_KEY = 'mcp_oauth_return';

function oauthAuthorizeReturnPath(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const url = new URL(raw, location.origin);
    if (url.origin !== location.origin) return null;
    if (url.pathname !== '/oauth/authorize') return null;
    return url.pathname + url.search + url.hash;
  } catch {
    return null;
  }
}

function finishWebLogin(data) {
  authToken = data.token;
  localStorage.setItem('agj_token', data.token);
  localStorage.setItem('agj_user', JSON.stringify(data.user));
  let returnTo = null;
  try {
    returnTo = oauthAuthorizeReturnPath(sessionStorage.getItem(MCP_OAUTH_RETURN_KEY));
    sessionStorage.removeItem(MCP_OAUTH_RETURN_KEY);
  } catch {}
  if (returnTo) {
    location.replace(returnTo);
    return;
  }
  location.reload();
}

function Login() {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Auto-auth in Telegram WebApp context
    const tg = window.Telegram?.WebApp;
    if (tg) {
      tg.ready();
      tg.expand();
      // Telegram's vertical swipe-to-minimize gesture (Bot API 7.7+) intercepts touch
      // scroll, breaking in-app scrolling. Disable it so content scrolls normally.
      // Guarded: no-op on older clients that lack the method.
      try { tg.disableVerticalSwipes?.(); } catch {}
      if (tg.initData) {
        doAuth(tg.initData, 'miniapp');
      } else {
        setError('Telegram WebApp detected but initData is empty. Please reopen from Telegram.');
      }
    }
  }, []);

  const [code, setCode] = useState('');
  const [totp, setTotp] = useState('');
  const [needs2FA, setNeeds2FA] = useState(false);
  const [step, setStep] = useState('code'); // 'code' | 'totp'
  // 2FA + Telegram number-match login (primary); 'code' is the /weblogin fallback.
  const [mode, setMode] = useState('tg2fa'); // 'tg2fa' | 'code'
  const [tgDisplayNumber, setTgDisplayNumber] = useState(null);
  const [tgPolling, setTgPolling] = useState(false);
  const tgPollRef = useRef(null);
  useEffect(() => () => { if (tgPollRef.current) clearTimeout(tgPollRef.current); }, []);

  async function doAuth(initData, surface = 'web') {
    setLoading(true);
    setError('');
    try {
      const data = await api('/api/auth/telegram', {
        method: 'POST',
        body: JSON.stringify({ initData, surface })
      });
      finishWebLogin(data);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }

  async function checkCodeAndProceed() {
    if (!code.trim()) return;
    setLoading(true);
    setError('');
    try {
      const data = await api('/api/auth/2fa/check', {
        method: 'POST',
        body: JSON.stringify({ code: code.trim() })
      });
      if (data.requires2FA) {
        setNeeds2FA(true);
        setStep('totp');
        setLoading(false);
        return;
      }
      // No 2FA, authenticate directly
      await doCodeAuth();
    } catch (e) {
      setError(e.message);
      setLoading(false);
    }
  }

  async function doCodeAuth() {
    if (!code.trim()) return;
    setLoading(true);
    setError('');
    try {
      const data = await api('/api/auth/code', {
        method: 'POST',
        body: JSON.stringify({ code: code.trim(), totp: totp.trim() || undefined })
      });
      finishWebLogin(data);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }

  // 2FA + Telegram number-match: verify the 2FA code, then the bot sends 3 numbers
  // and you tap the one shown here. Uses raw fetch (not api()) so a 401 doesn't
  // trip the session-expired path.
  function pollTg2fa(challengeId) {
    const deadline = Date.now() + 2 * 60 * 1000;
    const tick = async () => {
      if (Date.now() > deadline) { setTgPolling(false); setTgDisplayNumber(null); setError('Sign-in timed out — try again.'); return; }
      let res, data;
      try {
        res = await fetch(`${API_BASE}/api/auth/tg2fa/poll`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ challengeId }) });
        data = await res.json().catch(() => ({}));
      } catch { tgPollRef.current = setTimeout(tick, 2000); return; }
      if (res.ok && data.token) { setTgPolling(false); setTgDisplayNumber(null); finishWebLogin(data); return; }
      if (res.status === 401) {
        setTgPolling(false); setTgDisplayNumber(null);
        setError(data.status === 'failed' ? 'A different number was tapped — sign-in denied. Try again.' : 'Sign-in request expired — try again.');
        return;
      }
      tgPollRef.current = setTimeout(tick, 1800);
    };
    tick();
  }
  async function startTg2fa() {
    if (totp.length !== 6) return;
    setLoading(true); setError('');
    try {
      const res = await fetch(`${API_BASE}/api/auth/tg2fa/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ totp: totp.trim() }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || 'Invalid 2FA code'); setLoading(false); return; }
      setTgDisplayNumber(data.displayNumber);
      setTgPolling(true);
      pollTg2fa(data.challengeId);
    } catch {
      setError('Could not start sign-in — check your connection.');
    }
    setLoading(false);
  }
  function cancelTg2fa() {
    if (tgPollRef.current) clearTimeout(tgPollRef.current);
    setTgPolling(false); setTgDisplayNumber(null); setError('');
  }

  return html`
    <div class="login-container">
      <div class="login-card">
        <h2>AGJAssist</h2>
        ${window.Telegram?.WebApp?.initData ? html`
          <p>${loading ? 'Authenticating...' : 'Telegram WebApp detected. Authenticating automatically...'}</p>
        ` : mode === 'tg2fa' ? (tgDisplayNumber == null ? html`
          <p>Enter your <strong>2FA code</strong> from your authenticator app.</p>
          <div class="form-group" style="margin-top:16px">
            <label>2FA Code</label>
            <input value=${totp} onInput=${e => setTotp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                   onKeyDown=${e => e.key === 'Enter' && totp.length === 6 && startTg2fa()}
                   placeholder="000000" maxlength="6" data-testid="tg2fa-totp" inputmode="numeric"
                   style="text-align:center;font-size:24px;letter-spacing:8px;font-family:monospace" autofocus />
          </div>
          <button class="btn btn-primary" style="width:100%" data-testid="tg2fa-continue" onclick=${startTg2fa} disabled=${loading || totp.length !== 6}>
            ${loading ? 'Sending…' : 'Continue'}
          </button>
          <button class="btn" style="width:100%;margin-top:8px" onclick=${() => { setMode('code'); setError(''); setTotp(''); }}>
            Use a login code instead
          </button>
        ` : html`
          <p>Open Telegram and <strong>tap this number</strong> to approve the sign-in:</p>
          <div data-testid="tg2fa-number" style="font-size:46px;font-weight:800;text-align:center;letter-spacing:6px;margin:14px 0;color:var(--accent)">${tgDisplayNumber}</div>
          <p style="text-align:center;color:var(--text-secondary);font-size:13px">${tgPolling ? 'Waiting for your tap in Telegram…' : ''}</p>
          <button class="btn" style="width:100%;margin-top:8px" data-testid="tg2fa-cancel" onclick=${cancelTg2fa}>Cancel</button>
        `) : step === 'code' ? html`
          <p>Send <strong>/weblogin</strong> to the bot on Telegram to get a login code.</p>
          <div class="form-group" style="margin-top: 16px">
            <label>Login Code</label>
            <input value=${code} onInput=${e => setCode(e.target.value)}
                   onKeyDown=${e => e.key === 'Enter' && checkCodeAndProceed()}
                   placeholder="Paste your code here..." style="text-align:center;font-size:18px;letter-spacing:2px" />
          </div>
          <button class="btn btn-primary" style="width:100%" onclick=${checkCodeAndProceed} disabled=${loading}>
            ${loading ? 'Checking...' : 'Continue'}
          </button>
          <button class="btn" style="width:100%;margin-top:8px" onclick=${() => { setMode('tg2fa'); setError(''); setCode(''); }}>
            Use 2FA + Telegram sign-in
          </button>
        ` : html`
          <p>Enter your 2FA code from your authenticator app.</p>
          <div class="form-group" style="margin-top: 16px">
            <label>Login Code</label>
            <input value=${code} disabled style="text-align:center;font-size:14px;letter-spacing:2px;opacity:0.6" />
          </div>
          <div class="form-group">
            <label>2FA Code</label>
            <input value=${totp} onInput=${e => setTotp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                   onKeyDown=${e => e.key === 'Enter' && totp.length === 6 && doCodeAuth()}
                   placeholder="000000" maxlength="6"
                   style="text-align:center;font-size:24px;letter-spacing:8px;font-family:monospace" autofocus />
          </div>
          <button class="btn btn-primary" style="width:100%" onclick=${doCodeAuth} disabled=${loading || totp.length !== 6}>
            ${loading ? 'Authenticating...' : 'Login'}
          </button>
          <button class="btn" style="width:100%;margin-top:8px" onclick=${() => { setStep('code'); setTotp(''); setError(''); }}>
            Back
          </button>
        `}
        ${error && html`<p style="color: var(--danger); margin-top: 12px">${error}</p>`}
      </div>
    </div>
  `;
}

// Header
function Header({ user }) {
  const route = useRoute();
  return html`
    <header class="header">
      <div style="display:flex;align-items:center;gap:16px">
        <h1 style="cursor:pointer" onclick=${() => navigate('/')}>AGJAssist</h1>
        <nav class="nav-links">
          <a href="#/" class=${route === '/' ? 'active' : ''}>Dashboard</a>
          <a href="#/projects" class=${route === '/projects' || route.startsWith('/project/') ? 'active' : ''}>Projects</a>
          <a href="#/terminals" class=${route === '/terminals' ? 'active' : ''}>Terminals</a>
          <a href="#/tasks" class=${route === '/tasks' ? 'active' : ''}>Tasks</a>
          <a href="#/notes" class=${route === '/notes' ? 'active' : ''}>Notes</a>
          <a href="#/agent-os" class=${route === '/agent-os' ? 'active' : ''}>Agent OS</a>
          <a href="#/settings" class=${route === '/settings' ? 'active' : ''}>Settings</a>
          ${user?.role === 'owner' && html`<a href="#/xmachines" data-testid="xmachines-nav-link" class=${route === '/xmachines' || route.startsWith('/xmachines/') ? 'active' : ''}>xMachines</a>`}
          ${user?.role === 'owner' && html`<a href="#/mcp-access" data-testid="mcp-nav-access" class=${route === '/mcp-access' ? 'active' : ''}>MCP Access</a>`}
        </nav>
      </div>
      <div class="user-info">
        <span>${user?.displayName || user?.username || 'User'}</span>
        <span class="badge badge-${user?.role === 'owner' ? 'active' : 'draft'}">${user?.role}</span>
        <button class="btn btn-sm" onclick=${async () => {
          await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
          localStorage.clear();
          authToken = null;
          location.reload();
        }}>Logout</button>
      </div>
    </header>
  `;
}

// Dashboard (hub with section cards)
function Dashboard({ user }) {
  const [stats, setStats] = useState({ projects: 0, tasks: 0, reminders: 0, notes: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api('/api/projects').catch(() => ({ projects: [] })),
      api('/api/personal-tasks').catch(() => ({ tasks: [] })),
      api('/api/reminders').catch(() => ({ reminders: [] })),
      api('/api/notes?status=open').catch(() => ({ notes: [] }))
    ]).then(([p, t, r, n]) => {
      setStats({
        projects: p.projects?.length || 0,
        tasks: t.tasks?.length || 0,
        reminders: r.reminders?.length || 0,
        notes: n.notes?.length || 0
      });
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  if (loading) return html`<div class="loading">Loading...</div>`;

  const cards = [
    { label: 'Projects', count: stats.projects, route: '/projects', desc: 'Manage your development projects' },
    { label: 'Terminals', count: null, route: '/terminals', desc: 'Tmux terminal sessions' },
    { label: 'Tasks', count: stats.tasks, route: '/tasks', desc: 'Daily & weekly tasks, reminders' },
    { label: 'Notes', count: stats.notes, route: '/notes', desc: 'Quick notes, attach to any project' },
    { label: 'Settings', count: null, route: '/settings', desc: 'Templates, safety patterns, 2FA' }
  ];
  const xmachinesCard = user?.role === 'owner' ? { label: 'xMachines', count: null, route: '/xmachines', desc: 'Machine telemetry and control' } : null;

  return html`
    <div>
      <h2 style="margin-bottom:16px">Dashboard</h2>
      <div class="project-grid">
        ${cards.map(c => html`
          <div class="project-card" onclick=${() => navigate(c.route)}>
            <h3>${c.label}</h3>
            <div class="stats">
              ${c.count !== null ? html`<span class="stat" style="font-size:24px;font-weight:600">${c.count}</span>` : ''}
            </div>
            <p style="color:var(--text-secondary);font-size:12px;margin-top:8px">${c.desc}</p>
          </div>
        `)}
        ${xmachinesCard && html`
          <div class="project-card" onclick=${() => navigate(xmachinesCard.route)}>
            <h3>${xmachinesCard.label}</h3>
            <div class="stats"></div>
            <p style="color:var(--text-secondary);font-size:12px;margin-top:8px">${xmachinesCard.desc}</p>
          </div>
        `}
      </div>
    </div>
  `;
}

 function Projects() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showInactive, setShowInactive] = useState(false);

  useEffect(() => {
    api('/api/projects').then(d => { setProjects(d.projects); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  async function toggleActive(id, active) {
    await api('/api/projects/' + id, { method: 'PATCH', body: JSON.stringify({ active }) });
    const d = await api('/api/projects');
    setProjects(d.projects);
  }

  if (loading) return html`<div class="loading">Loading projects...</div>`;

  const activeProjects = projects.filter(p => p.active === 1);
  const inactiveProjects = projects.filter(p => p.active !== 1);

  return html`
    <div>
      <div class="action-bar">
        <h2>Projects</h2>
        <button class="btn btn-sm" onclick=${async () => {
          const d = await api('/api/projects/refresh', { method: 'POST' });
          setProjects(d.projects);
        }}>Refresh</button>
      </div>
      ${projects.length === 0
        ? html`<div class="empty-state">No projects found. Check ~/websites directory.</div>`
        : html`
          ${activeProjects.length > 0 ? html`
            <div class="project-grid" style="margin-bottom:24px">
              ${activeProjects.map(p => html`
                <div class="project-card" onclick=${() => navigate('/project/' + p.id)}>
                  <div style="display:flex;justify-content:space-between;align-items:center">
                    <h3>${p.display_name || p.directory_name}</h3>
                    <select value="active" onChange=${(e) => { e.stopPropagation(); if (e.target.value === 'inactive') toggleActive(p.id, 0); }}
                            onclick=${(e) => e.stopPropagation()}
                            style="font-size:11px;padding:2px 6px;background:var(--bg);color:var(--success);border:1px solid var(--border);border-radius:4px;cursor:pointer">
                      <option value="active">Active</option>
                      <option value="inactive">Set Inactive</option>
                    </select>
                  </div>
                  <div class="stats">
                    <span class="stat"><span class="dot ${p.open_notes_count > 0 ? 'dot-green' : 'dot-gray'}"></span> ${p.open_notes_count} notes</span>
                    <span class="stat"><span class="dot ${p.active_plans_count > 0 ? 'dot-green' : 'dot-gray'}"></span> ${p.active_plans_count} plans</span>
                    <span class="stat"><span class="dot ${p.pending_tasks_count > 0 ? 'dot-green' : 'dot-gray'}"></span> ${p.pending_tasks_count} tasks</span>
                  </div>
                </div>
              `)}
            </div>
          ` : ''}
          ${inactiveProjects.length > 0 ? html`
            <div style="margin-top:${activeProjects.length > 0 ? '16px' : '0'}">
              <div style="display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none;margin-bottom:${showInactive ? '12px' : '0'}"
                   onclick=${() => setShowInactive(!showInactive)}>
                <span style="font-size:12px;color:var(--text-secondary)">${showInactive ? '▼' : '▶'}</span>
                <h4 style="color:var(--text-secondary);font-size:12px;text-transform:uppercase;letter-spacing:1px;margin:0">Inactive Projects (${inactiveProjects.length})</h4>
              </div>
              ${showInactive && html`
                <div class="project-grid">
                  ${inactiveProjects.map(p => html`
                    <div class="project-card" style="opacity:0.6" onclick=${() => navigate('/project/' + p.id)}>
                      <div style="display:flex;justify-content:space-between;align-items:center">
                        <h3>${p.display_name || p.directory_name}</h3>
                        <select value="inactive" onChange=${(e) => { e.stopPropagation(); if (e.target.value === 'active') toggleActive(p.id, 1); }}
                                onclick=${(e) => e.stopPropagation()}
                                style="font-size:11px;padding:2px 6px;background:var(--bg);color:var(--text-secondary);border:1px solid var(--border);border-radius:4px;cursor:pointer">
                          <option value="inactive">Inactive</option>
                          <option value="active">Set Active</option>
                        </select>
                      </div>
                      <div class="stats">
                        <span class="stat"><span class="dot ${p.open_notes_count > 0 ? 'dot-green' : 'dot-gray'}"></span> ${p.open_notes_count} notes</span>
                        <span class="stat"><span class="dot ${p.active_plans_count > 0 ? 'dot-green' : 'dot-gray'}"></span> ${p.active_plans_count} plans</span>
                        <span class="stat"><span class="dot ${p.pending_tasks_count > 0 ? 'dot-green' : 'dot-gray'}"></span> ${p.pending_tasks_count} tasks</span>
                      </div>
                    </div>
                  `)}
                </div>
              `}
            </div>
          ` : ''}
        `
      }
    </div>
  `;
}

 function ProjectDetail({ id }) {
  const [project, setProject] = useState(null);
  const [tab, setTab] = useState('code');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api(`/api/projects/${id}`).then(d => { setProject(d.project); setLoading(false); }).catch(() => setLoading(false));
  }, [id]);

  if (loading) return html`<div class="loading">Loading...</div>`;
  if (!project) return html`<div class="empty-state">Project not found</div>`;

  const tabs = ['code', 'plans', 'tasks', 'activity'];

  return html`
    <div>
      <div class="action-bar">
        <h2 style="cursor:pointer" onclick=${() => navigate('/projects')}>← ${project.display_name || project.directory_name}</h2>
      </div>
      <div class="tabs">
        ${tabs.map(t => html`<div class="tab ${tab === t ? 'active' : ''}" onclick=${() => setTab(t)}>${t.charAt(0).toUpperCase() + t.slice(1)}</div>`)}
      </div>
      ${tab === 'code' && html`<${CodeTab} projectId=${id} projectRoot=${project.fullPath || ''} />`}
      ${tab === 'plans' && html`<${PlansTab} projectId=${id} />`}
      ${tab === 'tasks' && html`<${TasksTab} projectId=${id} />`}
      ${tab === 'activity' && html`<${ActivityTab} />`}
    </div>
  `;
}

// Terminals (top-level section)
function Terminals() {
  return html`
    <div>
      ${!isTgMiniApp && html`<h2 style="margin-bottom:16px">Terminals</h2>`}
      <${TerminalTab} />
    </div>
  `;
}

// Terminal Tab
function TerminalTab({ projectId, projectName } = {}) {
  const [sessions, setSessions] = useState([]);
  const [sessionsError, setSessionsError] = useState(null);
  const [activeTarget, setActiveTarget] = useState(null);
  // Live ref: the 8s session poll runs a mount-time closure that captured the
  // initial activeTarget (null) forever, so its auto-select kept re-selecting
  // the first pane on every list change and clobbered the user's manual pick.
  // Reading the ref (updated every render) makes the poll see the CURRENT
  // selection.
  const activeTargetRef = useRef(activeTarget);
  activeTargetRef.current = activeTarget;
  const myMsgNavRef = useRef(-1); // header ▲/▼ cursor into the YOU turns
  const [viewMode, setViewMode] = useState('list');
  const [sectionNavOpen, setSectionNavOpen] = useState(false);
  const [showNewSession, setShowNewSession] = useState(false);
  const [newSessionName, setNewSessionName] = useState('');
  const [friendlyMode, setFriendlyMode] = useState(isTgMiniApp);
  const [fullScreen, setFullScreen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [terminalGroups, setTerminalGroups] = useState(() => readTerminalGroups());
  const [activeGroupTab, setActiveGroupTab] = useState(() => {
    const groups = readTerminalGroups();
    const stored = readActiveTerminalGroup();
    return stored === 'all' || groups.some((group) => group.id === stored) ? stored : 'all';
  });
  const [rowGroupMenu, setRowGroupMenu] = useState(null);
  const [groupManageMenu, setGroupManageMenu] = useState(null);
  const [groupNamePrompt, setGroupNamePrompt] = useState(null);
  const [editingGroupId, setEditingGroupId] = useState(null);
  const [terminalFontSize, setTerminalFontSize] = useState(() => {
    try {
      const stored = Number(localStorage.getItem(TERMINAL_FONT_STORAGE_KEY));
      return Number.isFinite(stored)
        ? Math.min(TERMINAL_MAX_FONT_SIZE, Math.max(TERMINAL_MIN_FONT_SIZE, stored))
        : TERMINAL_DEFAULT_FONT_SIZE;
    } catch {
      return TERMINAL_DEFAULT_FONT_SIZE;
    }
  });

  const previousRoute = (() => {
    try {
      const candidate = sessionStorage.getItem('agj_prev_route');
      if (candidate === '/terminals' || candidate === '/' || !candidate) return null;
      return candidate;
    } catch { return null; }
  })();
  const [lineLimit, setLineLimit] = useState(25);
  const [terminalStatus, setTerminalStatus] = useState('disconnected');
  const [lastUpdatedAt, setLastUpdatedAt] = useState(0);
  const [friendlyRefreshTick, setFriendlyRefreshTick] = useState(0);
  const [convFontSize, setConvFontSize] = useState(() => applyTerminalConvFontSize(readTerminalConvFontSize()));
  const [replyLimit, setReplyLimit] = useState(() => readTerminalReplyLimit());
  const [showRawChrome, setShowRawChrome] = useState(false);
  const [agentReminders, setAgentReminders] = useState([]);
  const [wakeups, setWakeups] = useState([]);
  const [wakeupNowTick, setWakeupNowTick] = useState(0);
  const [wakeupExpanded, setWakeupExpanded] = useState(true);
  const [wakeupDate, setWakeupDate] = useState('');
  const [wakeupTime, setWakeupTime] = useState('');
  const [wakeupAction, setWakeupAction] = useState("Wake up — start today's queued tasks and report status.");
  const [cadenceMinutes, setCadenceMinutes] = useState(15);
  const [cadenceCustom, setCadenceCustom] = useState('');
  const [repeatMode, setRepeatMode] = useState('unlimited');
  const [repeatLimit, setRepeatLimit] = useState('');
  const [recipientAgentName, setRecipientAgentName] = useState('agent-a');
  const [recipientInclude, setRecipientInclude] = useState(true);
  const [summaryEndpoints, setSummaryEndpoints] = useState([]);
  const [endpointName, setEndpointName] = useState('');
  const [endpointBaseUrl, setEndpointBaseUrl] = useState('');
  const [endpointModel, setEndpointModel] = useState('');
  const [editingEndpointId, setEditingEndpointId] = useState(null);
  const [defaultEndpointId, setDefaultEndpointId] = useState(null);
  const [endpointError, setEndpointError] = useState('');
  const [summariesOpen, setSummariesOpen] = useState(false);
  const [remindersOpen, setRemindersOpen] = useState(false);
  const [wakeupsOpen, setWakeupsOpen] = useState(false);
  // Reminder dropdown: which folder sessions to nudge (name -> bool; undefined =
  // default to the active session) + the message the reminder posts to the chat.
  const [dlgReminderSessions, setDlgReminderSessions] = useState({});
  const [dlgReminderMessage, setDlgReminderMessage] = useState("Status update — where are you at, and any blockers?");
  // Editing an existing reminder's session recipients (id being edited + the
  // checklist state name -> bool).
  const [editingReminderId, setEditingReminderId] = useState(null);
  const [editReminderSessions, setEditReminderSessions] = useState({});
  // Editing an existing reminder's cadence (preset minutes + free-form override).
  const [editCadence, setEditCadence] = useState(30);
  const [editCadenceCustom, setEditCadenceCustom] = useState('');
  // Draggable header dropdowns (reminders/wakeups/summaries): null = default
  // anchored position, else a dragged {left, top}.
  const [modalPos, setModalPos] = useState(null);
  const [summaries, setSummaries] = useState([]);
  const [summariesLoading, setSummariesLoading] = useState(false);
  const [tabsCollapsed, setTabsCollapsed] = useState(true);
  // Phone/tablet (<900px) opens as a minimal header: the reminder row collapsed
  // to the bell AND the control cluster (font / ME-nav / summaries / gear) tucked
  // behind its "…" overflow, so the default chrome is just the back button +
  // session dropdown + bell + overflow. Desktop stays fully expanded. Both remain
  // user-togglable (tap 🔔 to expand utilities, tap … to reveal the controls).
  const initialHeaderCollapsed = typeof window !== 'undefined' && window.innerWidth < 900;
  const [utilitiesCollapsed, setUtilitiesCollapsed] = useState(initialHeaderCollapsed);
  const [controlsTucked, setControlsTucked] = useState(initialHeaderCollapsed);
  const menuRef = useRef(null);
  const sectionNavRef = useRef(null);
  const terminalGroupsRef = useRef(terminalGroups);
  const activeGroupTabRef = useRef(activeGroupTab);
  const groupsHydratedRef = useRef(false);
  const groupsDirtyRef = useRef(false);
  const groupsSaveTimerRef = useRef(null);
  const webAppContext = window.Telegram?.WebApp;
  const isTgMiniAppContext = isTgMiniApp || Boolean(
    webAppContext?.initData
    || webAppContext?.initDataUnsafe?.user
    || (webAppContext?.BackButton && typeof webAppContext?.initDataUnsafe === 'undefined')
  );

  function loadSessions() {
    setSessionsError(null);
    api('/api/tmux/sessions')
      .then(d => {
        const next = Array.isArray(d.sessions) ? d.sessions : [];
        // Only update when the list actually changed, so the background poll
        // doesn't churn re-renders or flicker the open dropdown.
        setSessions(prev => {
          const sig = (arr) => JSON.stringify(
            (arr || []).map(s => [s.session_name, (s.panes || []).map(p => [p.target, p.command, p.activity, p.busy].join(':')).join(',')])
          );
          if (sig(prev) === sig(next)) return prev;
          // auto-select first pane if none active (read the live ref, not the
          // stale poll-closure value, so a user's manual pick is never clobbered)
          if (!activeTargetRef.current && next.length > 0 && next[0].panes && next[0].panes.length > 0) {
            setActiveTarget(next[0].panes[0].target);
          }
          return next;
        });
      })
      .catch(e => setSessionsError(e.message || 'Failed to load sessions'));
  }

  async function reloadSessions({ refreshFriendly = true } = {}) {
    const d = await api('/api/tmux/sessions');
    const next = Array.isArray(d.sessions) ? d.sessions : [];
    setSessions(prev => {
      const sig = (arr) => JSON.stringify(
        (arr || []).map(s => [s.session_name, (s.panes || []).map(p => [p.target, p.command, p.activity, p.busy].join(':')).join(',')])
      );
      return sig(prev) === sig(next) ? prev : next;
    });
    if (refreshFriendly) setFriendlyRefreshTick(t => t + 1);
  }

  useEffect(() => { loadSessions(); }, []);

  // Keep the session list fresh so a newly-created tmux session shows in the
  // list without reopening the chat: poll lightly in the background.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') loadSessions();
    }, 8000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!activeTarget) return;
    const lineLimitKey = `agj_terminal_chat_${activeTarget.replace(/[^a-zA-Z0-9_.-]/g, '_')}_line_limit`;
    try {
      const saved = Number(sessionStorage.getItem(lineLimitKey) || '25');
      setLineLimit([25, 50, 100, 150, 200].includes(saved) ? saved : 25);
    } catch {
      setLineLimit(25);
    }
    setFriendlyMode(true);
  }, [activeTarget]);

  useEffect(() => {
    if (!activeTarget) return;
    const lineLimitKey = `agj_terminal_chat_${activeTarget.replace(/[^a-zA-Z0-9_.-]/g, '_')}_line_limit`;
    try {
      sessionStorage.setItem(lineLimitKey, String(lineLimit));
    } catch {}
  }, [activeTarget, lineLimit]);

  useEffect(() => {
    if (!activeTarget) {
      setTerminalStatus('disconnected');
      setLastUpdatedAt(0);
      return;
    }
    if (!terminalStatus || terminalStatus === 'disconnected') {
      setTerminalStatus('connected');
    }
  }, [activeTarget]);

  useEffect(() => {
    if (!menuOpen) return;
    const onOutsideClick = (event) => {
      const node = menuRef.current;
      if (node && !node.contains(event.target)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener('pointerdown', onOutsideClick);
    return () => {
      window.removeEventListener('pointerdown', onOutsideClick);
    };
  }, [menuOpen]);

  useEffect(() => {
    api('/api/agent-reminders/active')
      .then(data => {
        setAgentReminders(Array.isArray(data?.reminders) ? data.reminders : []);
      })
      .catch(() => setAgentReminders([]));
    api('/api/agent-wakeups/pending')
      .then(data => {
        setWakeups(Array.isArray(data?.wakeups) ? data.wakeups : []);
      })
      .catch(() => setWakeups([]));
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const id = setInterval(() => {
      setWakeupNowTick(t => t + 1);
      const now = new Date();
      setWakeups(prev => prev.filter(w => new Date(w.manual_fire_time) > now));
      api('/api/agent-wakeups/pending')
        .then(data => {
          setWakeups(Array.isArray(data?.wakeups) ? data.wakeups : []);
        })
        .catch(() => {});
    }, 30000);
    return () => clearInterval(id);
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    api('/api/summary-endpoints')
      .then(data => {
        const eps = Array.isArray(data?.endpoints) ? data.endpoints : [];
        setSummaryEndpoints(eps);
        const def = eps.find(e => e.is_default);
        setDefaultEndpointId(def ? def.id : null);
      })
      .catch(() => {
        setSummaryEndpoints([]);
        setDefaultEndpointId(null);
      });
  }, [menuOpen]);

  useEffect(() => {
    if (!activeTarget) {
      setSummaries([]);
      return;
    }
    setSummariesLoading(true);
    Promise.all([
      api(`/api/summary-agents/${encodeURIComponent(activeTarget)}/summaries`),
      api('/api/summary-endpoints').catch(() => ({ endpoints: [] }))
    ]).then(([summData, epData]) => {
      const rows = Array.isArray(summData?.summaries) ? summData.summaries : [];
      setSummaries(rows);
      const eps = Array.isArray(epData?.endpoints) ? epData.endpoints : [];
      setSummaryEndpoints(eps);
      const def = eps.find(e => e.is_default);
      setDefaultEndpointId(def ? def.id : null);
    }).catch(() => setSummaries([]))
      .finally(() => setSummariesLoading(false));
  }, [summariesOpen, activeTarget]);

  const handleSaveReminder = async () => {
    const folderGroup = resolvedActiveGroupTab === 'all' ? 'all' : (activeGroup?.id || resolvedActiveGroupTab);
    const minutes = cadenceCustom ? Number(cadenceCustom) : cadenceMinutes;
    const payload = {
      folder_group: folderGroup,
      cadence_minutes: minutes,
      repeat_limit: repeatMode === 'unlimited' ? null : Number(repeatLimit) || 0,
      recipients: [{ agent_name: recipientAgentName || 'agent-a', include: recipientInclude ? 1 : 0 }]
    };
    try {
      await api('/api/agent-reminders', { method: 'POST', body: JSON.stringify(payload) });
      api('/api/agent-reminders/active')
        .then(data => setAgentReminders(Array.isArray(data?.reminders) ? data.reminders : []))
        .catch(() => {});
    } catch (e) {
      console.error(e);
    }
  };

  // Reminder dropdown create: recipients are the chosen folder sessions (default:
  // the active session), and solicit_message is the message posted to the chat.
  const reminderSessionChecked = (name, isActive) =>
    (dlgReminderSessions[name] !== undefined ? dlgReminderSessions[name] : isActive);
  const handleCreateReminderFromDropdown = async () => {
    const minutes = cadenceCustom ? Number(cadenceCustom) : cadenceMinutes;
    if (!Number.isFinite(minutes) || minutes <= 0) return;
    const folderGroup = resolvedActiveGroupTab === 'all' ? 'all' : (activeGroup?.id || resolvedActiveGroupTab);
    const chosen = fullGroupMembers.filter((m) => reminderSessionChecked(m.name, m.isActive));
    if (chosen.length === 0) return;
    const payload = {
      folder_group: folderGroup,
      cadence_minutes: minutes,
      repeat_limit: repeatMode === 'unlimited' ? null : Number(repeatLimit) || 0,
      solicit_message: (dlgReminderMessage || '').trim() || 'give me a status update',
      recipients: chosen.map((m) => ({ agent_name: m.name, include: 1 })),
    };
    try {
      await api('/api/agent-reminders', { method: 'POST', body: JSON.stringify(payload) });
      const data = await api('/api/agent-reminders/active').catch(() => null);
      if (data) setAgentReminders(Array.isArray(data.reminders) ? data.reminders : []);
    } catch (e) {
      console.error(e);
    }
  };

  // Open the session editor for an existing reminder, pre-checked with its current
  // recipients.
  const startEditReminder = (r) => {
    const sel = {};
    (r.recipients || []).forEach((rc) => { if (rc.include === undefined || rc.include) sel[rc.agent_name] = true; });
    setEditReminderSessions(sel);
    const c = Number(r.cadence_minutes) || 30;
    setEditCadence(c);
    setEditCadenceCustom([15, 30, 60].includes(c) ? '' : String(c));
    setEditingReminderId(r.id);
  };
  const saveEditReminderSessions = async (r) => {
    const recipients = fullGroupMembers
      .filter((m) => editReminderSessions[m.name])
      .map((m) => ({ agent_name: m.name, include: 1 }));
    if (recipients.length === 0) return;
    const minutes = editCadenceCustom ? Number(editCadenceCustom) : editCadence;
    if (!Number.isFinite(minutes) || minutes < 1) return;
    try {
      await api('/api/agent-reminders/' + r.id, { method: 'PATCH', body: JSON.stringify({ recipients, cadence_minutes: minutes }) });
      const data = await api('/api/agent-reminders/active').catch(() => null);
      if (data) setAgentReminders(Array.isArray(data.reminders) ? data.reminders : []);
      setEditingReminderId(null);
    } catch (e) {
      console.error(e);
    }
  };

  // Drag the open header dropdown by its title bar (desktop/tablet). Pointer-based
  // so it works for mouse + touch; the position is clamped to the viewport.
  const startModalDrag = (e) => {
    const modal = e.currentTarget.closest('[data-draggable-modal]');
    if (!modal || (e.button !== undefined && e.button !== 0)) return;
    const rect = modal.getBoundingClientRect();
    const offX = e.clientX - rect.left;
    const offY = e.clientY - rect.top;
    const onMove = (ev) => {
      const left = Math.max(4, Math.min(ev.clientX - offX, window.innerWidth - rect.width - 4));
      const top = Math.max(4, Math.min(ev.clientY - offY, window.innerHeight - 40));
      setModalPos({ left, top });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    e.preventDefault();
  };
  const modalPosStyle = modalPos ? `left:${modalPos.left}px;top:${modalPos.top}px;right:auto` : 'top:60px;right:12px';

  const handleSaveEndpoint = async () => {
    if (!endpointName || !endpointBaseUrl || !endpointModel) return;
    setEndpointError('');
    try {
      if (editingEndpointId) {
        await api(`/api/summary-endpoints/${editingEndpointId}`, {
          method: 'PATCH',
          body: JSON.stringify({ name: endpointName, base_url: endpointBaseUrl, model: endpointModel })
        });
      } else {
        await api('/api/summary-endpoints', {
          method: 'POST',
          body: JSON.stringify({ name: endpointName, base_url: endpointBaseUrl, model: endpointModel })
        });
      }
      setEndpointName('');
      setEndpointBaseUrl('');
      setEndpointModel('');
      setEditingEndpointId(null);
      const data = await api('/api/summary-endpoints');
      const eps = Array.isArray(data?.endpoints) ? data.endpoints : [];
      setSummaryEndpoints(eps);
      const def = eps.find(e => e.is_default);
      setDefaultEndpointId(def ? def.id : null);
    } catch (e) {
      console.error(e);
      setEndpointError(e.message || 'Endpoint error');
    }
  };

  const handleDeleteEndpoint = async (id) => {
    setEndpointError('');
    try {
      await api(`/api/summary-endpoints/${id}`, { method: 'DELETE' });
      const data = await api('/api/summary-endpoints');
      const eps = Array.isArray(data?.endpoints) ? data.endpoints : [];
      setSummaryEndpoints(eps);
      const def = eps.find(e => e.is_default);
      setDefaultEndpointId(def ? def.id : null);
    } catch (e) {
      console.error(e);
      setEndpointError(e.message || 'Endpoint error');
    }
  };

  const handleSetDefault = async (id) => {
    setEndpointError('');
    try {
      await api(`/api/summary-endpoints/${id}/default`, { method: 'POST' });
      const data = await api('/api/summary-endpoints');
      const eps = Array.isArray(data?.endpoints) ? data.endpoints : [];
      setSummaryEndpoints(eps);
      setDefaultEndpointId(id);
    } catch (e) {
      console.error(e);
      setEndpointError(e.message || 'Endpoint error');
    }
  };

  const startEditEndpoint = (ep) => {
    setEditingEndpointId(ep.id);
    setEndpointName(ep.name || '');
    setEndpointBaseUrl(ep.base_url || '');
    setEndpointModel(ep.model || '');
  };

  function cacheTerminalGroupsLocal(groups, active) {
    writeTerminalGroups(groups);
    writeActiveTerminalGroup(active);
  }

  function queueTerminalGroupsSave(immediate) {
    if (!groupsHydratedRef.current) return;
    const payload = {
      groups: terminalGroupsRef.current,
      activeGroup: activeGroupTabRef.current
    };
    cacheTerminalGroupsLocal(payload.groups, payload.activeGroup);
    const send = () => {
      api('/api/terminal/groups', { method: 'PUT', body: JSON.stringify(payload) }).catch(() => {});
    };
    if (groupsSaveTimerRef.current) {
      clearTimeout(groupsSaveTimerRef.current);
      groupsSaveTimerRef.current = null;
    }
    if (immediate) send();
    else groupsSaveTimerRef.current = setTimeout(send, 500);
  }

  function persistTerminalGroups(updater) {
    setTerminalGroups((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      terminalGroupsRef.current = next;
      writeTerminalGroups(next);
      groupsDirtyRef.current = true;
      queueTerminalGroupsSave(false);
      return next;
    });
  }

  function persistActiveGroupTab(id) {
    const next = id || 'all';
    activeGroupTabRef.current = next;
    writeActiveTerminalGroup(next);
    setActiveGroupTab(next);
    groupsDirtyRef.current = true;
    queueTerminalGroupsSave(false);
  }

  useEffect(() => {
    let cancelled = false;
    api('/api/terminal/groups')
      .then((data) => {
        if (cancelled) return;
        const server = {
          groups: Array.isArray(data?.groups) ? data.groups.map(normalizeTerminalGroup).filter(Boolean) : [],
          activeGroup: data?.activeGroup == null ? 'all' : String(data.activeGroup)
        };
        const localGroups = terminalGroupsRef.current || [];
        const localActive = activeGroupTabRef.current || 'all';
        // In-flight edits must not be overwritten by the GET, and the GET must not
        // be clobbered by a pre-hydrate PUT of empty cache (queueTerminalGroupsSave
        // no-ops until hydrated).
        if (groupsDirtyRef.current) {
          groupsHydratedRef.current = true;
          queueTerminalGroupsSave(true);
          return;
        }
        // Empty server + existing local cache: first-run promote (don't wipe PC groups on deploy).
        const promoteLocal = server.groups.length === 0 && localGroups.length > 0;
        const groups = promoteLocal ? localGroups : server.groups;
        const activeCandidate = promoteLocal ? localActive : server.activeGroup;
        const active = activeCandidate === 'all' || groups.some((group) => group.id === activeCandidate)
          ? (activeCandidate || 'all')
          : 'all';
        terminalGroupsRef.current = groups;
        activeGroupTabRef.current = active;
        setTerminalGroups(groups);
        setActiveGroupTab(active);
        cacheTerminalGroupsLocal(groups, active);
        groupsHydratedRef.current = true;
        if (promoteLocal) queueTerminalGroupsSave(true);
      })
      .catch(() => {
        if (!cancelled) groupsHydratedRef.current = true;
      });
    return () => {
      cancelled = true;
      if (groupsSaveTimerRef.current) {
        clearTimeout(groupsSaveTimerRef.current);
        groupsSaveTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!groupsHydratedRef.current) return;
    if (activeGroupTab !== 'all' && !terminalGroups.some((group) => group.id === activeGroupTab)) {
      persistActiveGroupTab('all');
    }
  }, [activeGroupTab, terminalGroups]);

  useEffect(() => {
    if (viewMode === 'list' || !activeTarget) return undefined;
    setRowGroupMenu(null);
    setGroupManageMenu(null);
    return undefined;
  }, [viewMode, activeTarget]);

  useEffect(() => {
    if (!rowGroupMenu && !groupManageMenu && !groupNamePrompt && !editingGroupId) return undefined;
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      if (groupNamePrompt) {
        setGroupNamePrompt(null);
        return;
      }
      if (editingGroupId) {
        setEditingGroupId(null);
        return;
      }
      setRowGroupMenu(null);
      setGroupManageMenu(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rowGroupMenu, groupManageMenu, groupNamePrompt, editingGroupId]);

  useEffect(() => {
    if (!isTgMiniAppContext) return;
    document.body.classList.toggle('tg-terminal-focus', fullScreen);
    return () => document.body.classList.remove('tg-terminal-focus');
  }, [fullScreen]);

  // Reclaim the bottom nav's vertical space ON THE TERMINAL TAB ONLY (JROM): the
  // Terminal chat surfaces the section-nav in its header instead, so the bottom
  // tab bar + bot footer are hidden here. Other sections keep the bottom nav.
  useEffect(() => {
    if (!isTgMiniAppContext) return undefined;
    document.body.classList.add('tg-terminal-nav');
    return () => document.body.classList.remove('tg-terminal-nav');
  }, []);

  useEffect(() => {
    const sync = () => setConvFontSize(applyTerminalConvFontSize(readTerminalConvFontSize()));
    const onStorage = (event) => {
      if (event.key && event.key !== TERMINAL_CONV_FONT_STORAGE_KEY) return;
      sync();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('agj-terminal-conv-font', sync);
    window.addEventListener('hashchange', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('agj-terminal-conv-font', sync);
      window.removeEventListener('hashchange', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, []);

  const exitFullScreen = useCallback(() => {
    setFullScreen(false);
    const targetRoute = previousRoute && previousRoute !== '/terminals' ? previousRoute : null;
    if (targetRoute) navigate(targetRoute);
  }, [previousRoute]);

  useEffect(() => {
    if (!isTgMiniAppContext) return undefined;
    const backButton = window.Telegram?.WebApp?.BackButton;
    if (!backButton) return undefined;
    if (!fullScreen) {
      try { backButton.hide(); } catch {}
      return undefined;
    }

    const handler = () => exitFullScreen();
    try {
      backButton.show();
      backButton.onClick(handler);
    } catch {}

    return () => {
      try { backButton.offClick(handler); } catch {}
      try { backButton.hide(); } catch {}
    };
  }, [fullScreen, exitFullScreen]);

  async function createSession() {
    const name = newSessionName.trim() || `agj-${projectName || 'session'}`;
    try {
      await api('/api/tmux/sessions', {
        method: 'POST',
        body: JSON.stringify({ project_id: Number(projectId), name })
      });
      const d = await api('/api/tmux/sessions');
      setSessions(d.sessions);
      setShowNewSession(false);
      setNewSessionName('');
      const created = (d.sessions || []).find((s) => s.session_name === name);
      const primary = getPrimarySessionPane(created);
      if (primary?.target) switchActiveTarget(primary.target);
    } catch (e) { alert(e.message); }
  }

  const allPanes = sessions.flatMap(s => s.panes.map(p => ({ ...p, session_name: s.session_name })));
  const activePane = allPanes.find(p => p.target === activeTarget) || null;
  const isListView = viewMode === 'list' || !activeTarget;
  const hasTarget = !!activeTarget && !isListView;
  const menuStatusClass = `badge badge-${terminalStatus === 'connected' ? 'active' : terminalStatus === 'loading' || terminalStatus === 'connecting' || terminalStatus === 'running' ? 'pending' : 'failed'}`;

  function updateTerminalFontSize(nextSize) {
    const clamped = Math.min(TERMINAL_MAX_FONT_SIZE, Math.max(TERMINAL_MIN_FONT_SIZE, nextSize));
    setTerminalFontSize(clamped);
    try { localStorage.setItem(TERMINAL_FONT_STORAGE_KEY, String(clamped)); } catch {}
  }

  function updateConvFontSize(nextSize) {
    setConvFontSize(writeTerminalConvFontSize(nextSize));
  }

  function updateReplyLimit(nextValue) {
    setReplyLimit(writeTerminalReplyLimit(nextValue));
  }

  function normalizeLineLimit(value) {
    const parsed = Number(value);
    return [25, 50, 100, 150, 200].includes(parsed) ? parsed : 25;
  }

  function handleLineLimitChange(nextValue) {
    const selected = normalizeLineLimit(nextValue);
    setLineLimit(selected);
    if (friendlyMode) {
      // Let the child receive the new limit before restarting its real fetch effect.
      setTimeout(() => setFriendlyRefreshTick((tick) => tick + 1), 0);
    }
  }

  // Same switch the hamburger / mobile-picker <select>s use.
  function switchActiveTarget(nextTarget) {
    setActiveTarget(nextTarget || null);
    setViewMode(nextTarget ? 'chat' : 'list');
    setSectionNavOpen(false);
    myMsgNavRef.current = -1;
  }

  function backToTerminalList() {
    setViewMode('list');
    setActiveTarget(null);
    setMenuOpen(false);
    setSectionNavOpen(false);
    myMsgNavRef.current = -1;
  }

  // Header ▲/▼ that jump between MY (YOU) messages. DOM-driven so it lives in the
  // header (beside settings) without blocking the conversation. Clamps at the ends.
  function jumpToMyMessage(dir) {
    const wrap = document.querySelector('[data-testid="terminal-conversation"]');
    if (!wrap) return;
    const turns = Array.from(wrap.querySelectorAll('[data-testid="terminal-turn-user"]'));
    if (!turns.length) return;
    let next = myMsgNavRef.current < 0 ? (dir > 0 ? 0 : turns.length - 1) : myMsgNavRef.current + dir;
    next = Math.max(0, Math.min(turns.length - 1, next));
    myMsgNavRef.current = next;
    const el = turns[next];
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.add('terminal-chat-focus-flash');
    setTimeout(() => el.classList.remove('terminal-chat-focus-flash'), 700);
  }

  function closeGroupPopovers() {
    setRowGroupMenu(null);
    setGroupManageMenu(null);
  }

  function selectGroupTab(id) {
    persistActiveGroupTab(id || 'all');
    closeGroupPopovers();
  }

  function openCreateGroupPrompt(sessionName) {
    closeGroupPopovers();
    setGroupNamePrompt({
      mode: sessionName ? 'create-and-assign' : 'create',
      sessionName: sessionName || null,
      groupId: null,
      draft: ''
    });
  }

  function openRenameGroupPrompt(groupId) {
    const group = terminalGroups.find((g) => g.id === groupId);
    if (!group) return;
    closeGroupPopovers();
    setGroupNamePrompt({ mode: 'rename', groupId, sessionName: null, draft: group.name });
  }

  function submitGroupNamePrompt() {
    const prompt = groupNamePrompt;
    if (!prompt) return;
    const name = String(prompt.draft || '').trim();
    if (!name) return;
    if (prompt.mode === 'rename' && prompt.groupId) {
      persistTerminalGroups((prev) => prev.map((group) => (
        group.id === prompt.groupId ? { ...group, name } : group
      )));
    } else {
      const id = newTerminalGroupId();
      const sessions = prompt.sessionName ? [prompt.sessionName] : [];
      persistTerminalGroups((prev) => [...prev, { id, name, sessions }]);
      if (prompt.mode === 'create') persistActiveGroupTab(id);
    }
    setGroupNamePrompt(null);
  }

  function deleteGroup(groupId) {
    closeGroupPopovers();
    setEditingGroupId((current) => (current === groupId ? null : current));
    persistTerminalGroups((prev) => prev.filter((group) => group.id !== groupId));
    if (activeGroupTab === groupId) persistActiveGroupTab('all');
  }

  function toggleSessionInGroup(groupId, sessionName, nextChecked) {
    if (!groupId || !sessionName) return;
    persistTerminalGroups((prev) => prev.map((group) => {
      if (group.id !== groupId) return group;
      const has = group.sessions.includes(sessionName);
      if (nextChecked && !has) return { ...group, sessions: [...group.sessions, sessionName] };
      if (!nextChecked && has) return { ...group, sessions: group.sessions.filter((name) => name !== sessionName) };
      return group;
    }));
  }

  function openRowGroupMenu(event, sessionName) {
    event.stopPropagation();
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const pos = clampMenuPosition(rect.bottom + 4, rect.right - 220, 220, 240);
    setGroupManageMenu(null);
    setRowGroupMenu({ sessionName, top: pos.top, left: pos.left });
  }

  function openGroupManageMenu(event, groupId) {
    event.stopPropagation();
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const pos = clampMenuPosition(rect.bottom + 4, rect.right - 180, 180, 160);
    setRowGroupMenu(null);
    setGroupManageMenu({ groupId, top: pos.top, left: pos.left });
  }

  function openGroupEdit(groupId) {
    closeGroupPopovers();
    if (!terminalGroups.some((group) => group.id === groupId)) return;
    setEditingGroupId(groupId);
  }

  function openSessionFromRow(event, target) {
    if (!target) return;
    if (event?.target?.closest?.('[data-testid="terminal-row-groups"]')) return;
    closeGroupPopovers();
    switchActiveTarget(target);
  }

  function getPrimarySessionPane(session) {
    const panes = Array.isArray(session?.panes) ? session.panes : [];
    return panes.find((p) => String(p.window) === '0' && String(p.pane) === '0')
      || panes.find((p) => /\.0$/.test(String(p.target || '')))
      || panes[0]
      || null;
  }

  function getSessionActivity(session) {
    const panes = Array.isArray(session?.panes) ? session.panes : [];
    return panes.reduce((max, pane) => {
      const value = Number(pane.activity || 0);
      return Number.isFinite(value) && value > max ? value : max;
    }, 0);
  }

  function formatTerminalActivity(seconds) {
    const value = Number(seconds || 0);
    if (!Number.isFinite(value) || value <= 0) return '';
    const date = new Date(value * 1000);
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startYesterday = startToday - 24 * 60 * 60 * 1000;
    const time = date.getTime();
    if (time >= startToday) {
      return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }
    if (time >= startYesterday) return 'Yesterday';
    return date.toLocaleDateString([], { month: 'numeric', day: 'numeric', year: '2-digit' });
  }

  const sessionRows = sessions.map((session) => {
    const primaryPane = getPrimarySessionPane(session);
    const activity = getSessionActivity(session);
    const busy = (session.panes || []).some((pane) => pane.busy);
    const awaiting = (session.panes || []).some((pane) => pane.awaiting_selection);
    return {
      session,
      primaryPane,
      activity,
      busy,
      awaiting,
      connected: Boolean(primaryPane?.target)
    };
  }).sort((a, b) => b.activity - a.activity || String(a.session.session_name).localeCompare(String(b.session.session_name)));

  const resolvedActiveGroupTab = activeGroupTab === 'all' || terminalGroups.some((group) => group.id === activeGroupTab)
    ? activeGroupTab
    : 'all';
  const activeGroup = resolvedActiveGroupTab === 'all'
    ? null
    : terminalGroups.find((group) => group.id === resolvedActiveGroupTab) || null;
  const visibleRows = resolvedActiveGroupTab === 'all'
    ? sessionRows
    : sessionRows.filter((row) => activeGroup?.sessions.includes(row.session.session_name));
  // Quick-switch chips for the OTHER live sessions in the current session's group,
  // shown in the chat-header whitespace beside the session name.
  const headerGroupSiblings = (() => {
    const activeName = activePane?.session_name;
    if (!activeName) return [];
    const group = (resolvedActiveGroupTab !== 'all' && activeGroup)
      || terminalGroups.find((g) => Array.isArray(g.sessions) && g.sessions.includes(activeName));
    if (!group || !Array.isArray(group.sessions)) return [];
    return group.sessions
      .filter((name) => name !== activeName)
      .map((name) => ({ name, session: sessions.find((s) => s.session_name === name) }))
      .filter((x) => x.session && x.session.panes && x.session.panes.length && x.session.panes[0].target)
      .map((x) => ({ name: x.name, target: x.session.panes[0].target, awaiting: x.session.panes.some((p) => p.awaiting_selection) }));
  })();

  const fullGroupMembers = (() => {
    const activeName = activePane?.session_name;
    if (!activeName) return [];
    const group = (resolvedActiveGroupTab !== 'all' && activeGroup)
      || terminalGroups.find((g) => Array.isArray(g.sessions) && g.sessions.includes(activeName));
    if (!group || !Array.isArray(group.sessions)) return [];
    return group.sessions
      .map((name) => ({ name, session: sessions.find((s) => s.session_name === name) }))
      .filter((x) => x.session && x.session.panes && x.session.panes.length && x.session.panes[0].target)
      .map((x) => {
        const target = x.session.panes[0].target;
        const pane = x.session.panes[0];
        const isActive = target === activeTarget;
        const hasDraft = Boolean(readTerminalDraft('friendly-terminal', target));
        const status = pane.busy ? 'running' : 'idle';
        const awaiting = x.session.panes.some((p) => p.awaiting_selection);
        return { name: x.name, target, isActive, hasDraft, status, awaiting };
      });
  })();
  const editingGroup = editingGroupId
    ? terminalGroups.find((group) => group.id === editingGroupId) || null
    : null;

  const updatedLabel = lastUpdatedAt ? new Date(lastUpdatedAt).toLocaleTimeString() : '';
  const targetSubtitle = [
    activeTarget || '',
    activePane?.command || '',
    updatedLabel ? `updated ${updatedLabel}` : ''
  ].filter(Boolean).join(' · ');

  // Section-nav (Home/Notes/Chat/…) surfaced in the terminal header so the bottom
  // nav can be reclaimed for chat space on this tab only.
  const sectionNavItems = getBottomNavTabs(readBottomNavTabIds()).filter((t) => t.id !== '/terminals');

  const shell = html`
    <div class=${'terminal-shell' + (fullScreen ? ' terminal-shell-fullscreen' : '') + (friendlyMode ? ' terminal-shell-friendly' : '')}>
      <div class=${'terminal-shell-header' + (!isListView && utilitiesCollapsed ? ' util-collapsed' : '')} data-term-topbar>
        <div class="terminal-topbar-main">
          ${isTgMiniAppContext && fullScreen && html`
            <button class="terminal-topbar-icon-btn" onclick=${exitFullScreen} aria-label="Back">←</button>
          `}
          ${isListView ? html`
            <button class="terminal-topbar-icon-btn terminal-menu-trigger" data-testid="terminal-sectionnav"
                    aria-label="Sections" aria-expanded=${sectionNavOpen}
                    onclick=${() => {
                      setMenuOpen(false);
                      setSectionNavOpen((current) => !current);
                    }}>☰</button>
            <div class="terminal-topbar-target">
              <div class="terminal-topbar-name terminal-topbar-name-static" data-testid="terminal-list-title">
                <span class="terminal-topbar-name-text">Terminals</span>
              </div>
            </div>
            <button type="button" class="terminal-topbar-icon-btn terminal-new-session-trigger"
                    data-testid="terminal-new-session" aria-label="New session"
                    onclick=${() => { setNewSessionName(''); setShowNewSession(true); }}>+</button>
          ` : html`
            <button class="terminal-topbar-icon-btn terminal-menu-trigger" data-testid="terminal-back-list"
                    aria-label="Back to terminal list" onclick=${backToTerminalList}>←</button>
            <div class=${'terminal-topbar-target' + (activePane?.awaiting_selection ? ' awaiting-selection' : '')} style=${headerGroupSiblings.length ? 'flex:0 1 auto' : ''}
                 title=${activePane?.awaiting_selection ? 'This agent is waiting for you to pick an option below' : ''}>
              <div class="terminal-topbar-name terminal-topbar-name-static" data-testid="terminal-session-name">
                <span class=${'terminal-topbar-dot' + (activePane?.awaiting_selection ? ' awaiting' : (hasTarget && (terminalStatus === 'connected' || terminalStatus === 'running') ? ' on' : ''))}></span>
                <span class="terminal-topbar-name-text">${activePane?.awaiting_selection ? '🔴 ' : ''}${activePane?.session_name || (friendlyMode ? 'Terminal Chat' : 'Raw Terminal')}</span>
              </div>
              <div class="terminal-topbar-sub">
                ${hasTarget ? (targetSubtitle || activeTarget) : 'Select a pane'}
              </div>
            </div>
            <div class="command-center-header" data-testid="command-center-header">
              <div class="terminal-header-v2" data-testid="terminal-header-v2">
                <button type="button" class="command-center-toggle" data-testid="tabs-collapse" onclick=${() => setTabsCollapsed(c => !c)}>${tabsCollapsed ? 'Tabs ▼' : 'Tabs ▲'} (${headerGroupSiblings.length})</button>
                ${headerGroupSiblings.length ? html`
                  <div class="terminal-header-tabs" data-testid="agent-group-switcher" hidden=${tabsCollapsed}>
                    ${headerGroupSiblings.map((sib) => {
                      const hasDraft = Boolean(readTerminalDraft('friendly-terminal', sib.target));
                      return html`
                      <button type="button" class=${'terminal-header-tab' + (sib.awaiting ? ' awaiting-selection' : '')} data-testid="terminal-header-tab"
                              title=${'Switch to ' + sib.name + (sib.awaiting ? ' — waiting for your selection' : '') + (hasDraft ? ' — draft' : '')} onclick=${() => switchActiveTarget(sib.target)}>${sib.awaiting ? '🔴 ' : ''}${sib.name}${hasDraft ? ' •' : ''}</button>
                    `})}
                  </div>
                  <div class="agent-group-switcher-scrubber" data-testid="agent-group-switcher-scrubber" hidden=${tabsCollapsed} onPointerDown=${e => {
                    const tabs = document.querySelector('[data-testid="agent-group-switcher"]');
                    if (!tabs) return;
                    const startX = e.clientX;
                    const startScroll = tabs.scrollLeft;
                    const onMove = ev => { tabs.scrollLeft = startScroll + (startX - ev.clientX); };
                    const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
                    window.addEventListener('pointermove', onMove);
                    window.addEventListener('pointerup', onUp);
                  }}></div>
                  <div class=${'agent-group-switcher-dropdown-wrap' + (fullGroupMembers.some((m) => m.awaiting) ? ' has-awaiting' : '')} data-testid="agent-group-switcher-dropdown" hidden=${tabsCollapsed}>
                    <select value=${activeTarget || ''} onchange=${e => switchActiveTarget(e.target.value)} aria-label="Agent group switcher">
                      ${fullGroupMembers.map((m) => {
                        const label = `${m.awaiting ? '🔴 ' : ''}${m.name} ${m.status}${m.hasDraft ? ' • draft' : ''}`;
                        const className = (m.awaiting ? 'awaiting ' : '') + (m.isActive ? 'active' : m.status === 'running' ? 'running' : 'idle');
                        return html`<option value=${m.target} class=${className}>${label}</option>`;
                      })}
                    </select>
                  </div>
                ` : ''}
              </div>
            </div>
            ${utilitiesCollapsed ? html`
              <button type="button" class=${'command-center-bell' + (agentReminders.length > 0 ? ' has-reminder' : '') + (wakeups.length > 0 ? ' has-wakeup' : '')} data-testid="bell-indicator"
                      aria-label="Show utilities" onclick=${() => setUtilitiesCollapsed(false)}>🔔<span class="cc-util-icon-dot"></span><span class="cc-util-icon-count">${wakeups.length}</span></button>
            ` : html`
              <button type="button" class="cc-util-toggle" data-testid="utilities-collapse"
                      aria-label="Hide utilities" onclick=${() => setUtilitiesCollapsed(true)}>‹</button>
            `}
            <div class=${'cc-ctrlcluster' + (controlsTucked ? ' collapsed' : '')}>
              <div class="cc-ctrl-items">
                <div class="terminal-fontpill" title="Text size">
                  <button type="button" class="am" data-testid="terminal-font-decrease"
                          onclick=${() => updateConvFontSize(convFontSize - 1)}
                          disabled=${convFontSize <= TERMINAL_CONV_FONT_MIN}>A−</button>
                  <button type="button" class="ap" data-testid="terminal-font-increase"
                          onclick=${() => updateConvFontSize(convFontSize + 1)}
                          disabled=${convFontSize >= TERMINAL_CONV_FONT_MAX}>A+</button>
                </div>
                <div class="terminal-mynav-header" data-testid="terminal-mynav" title="Jump between my messages">
                  <button type="button" class="terminal-mynav-hbtn" data-testid="terminal-mynav-up"
                          aria-label="Jump to my previous message" onclick=${() => jumpToMyMessage(-1)}>▲</button>
                  <span class="terminal-mynav-hlabel">ME</span>
                  <button type="button" class="terminal-mynav-hbtn" data-testid="terminal-mynav-down"
                          aria-label="Jump to my next message" onclick=${() => jumpToMyMessage(1)}>▼</button>
                </div>
                <button type="button" class="terminal-topbar-icon-btn" data-testid="summaries-toggle" aria-label="Agent summaries" onclick=${() => setSummariesOpen(s => !s)}>
                  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v13H8l-4 4V4z"/><path d="M8 9h8M8 13h5"/></svg>
                </button>
                <button type="button" class="terminal-topbar-icon-btn terminal-settings-trigger"
                        data-term-menu data-testid="terminal-menu" aria-label="Terminal settings" aria-expanded=${menuOpen}
                        onclick=${() => { setSectionNavOpen(false); setMenuOpen((current) => !current); }}>
                  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="3"></circle>
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                  </svg>
                </button>
              </div>
              <button type="button" class="cc-ctrl-toggle" data-testid="controls-collapse"
                      aria-label=${controlsTucked ? 'Show controls' : 'Hide controls'}
                      onclick=${() => setControlsTucked(c => !c)}>${controlsTucked ? '...' : '‹'}</button>
            </div>
          `}
        </div>
        ${!isListView ? html`
          <div class="cc-utilarea" data-testid="utilities">
            <button type="button" class=${'cc-util-chip' + (remindersOpen ? ' cc-util-chip-open' : '')} data-testid="reminder-chip" aria-expanded=${remindersOpen}
                    title="Set up an agent reminder"
                    onclick=${() => { setSummariesOpen(false); setWakeupsOpen(false); setRemindersOpen(o => !o); }}>Reminder: ${agentReminders.length > 0 ? agentReminders[0].id : 'none'}</button>
            <button type="button" class=${'cc-util-chip' + (wakeupsOpen ? ' cc-util-chip-open' : '')} data-testid="wakeup-chip" aria-expanded=${wakeupsOpen}
                    title="Schedule an agent wakeup"
                    onclick=${() => { setSummariesOpen(false); setRemindersOpen(false); setWakeupsOpen(o => !o); }}>Wakeup: ${wakeups.length > 0 ? wakeups[0].id : 'none'}</button>
            <button type="button" class=${'cc-util-chip' + (summariesOpen ? ' cc-util-chip-open' : '')} data-testid="summary-chip" aria-expanded=${summariesOpen}
                    title="View agent summaries"
                    onclick=${() => { setRemindersOpen(false); setWakeupsOpen(false); setSummariesOpen(s => !s); }}>Summary: ${summaries.length > 0 ? summaries[0].summary_text?.slice(0,20) : 'none'}</button>
          </div>
        ` : ''}
      </div>
      ${summariesOpen && html`
        <div key="summaries-dropdown" data-testid="agent-summaries-dropdown" data-draggable-modal style=${'position:absolute;z-index:250;width:320px;max-height:400px;overflow:auto;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:12px;box-shadow:0 8px 24px rgba(0,0,0,0.3);' + modalPosStyle}>
          <div class="dd-drag-handle" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;cursor:move;touch-action:none" onpointerdown=${startModalDrag}>
            <strong>Summaries</strong>
            <button type="button" style="cursor:pointer" onpointerdown=${e => e.stopPropagation()} onclick=${() => setSummariesOpen(false)}>✕</button>
          </div>
          ${summariesLoading ? html`<div>Loading…</div>` : summaries.length === 0 ? html`<div data-testid="summaries-empty">No summaries yet</div>` : html`
            ${[...summaries].sort((a, b) => { const tb = Date.parse(b.created_at || '') || 0; const ta = Date.parse(a.created_at || '') || 0; return tb - ta || (Number(b.id) || 0) - (Number(a.id) || 0); }).map(s => {
              const ep = summaryEndpoints.find(e => e.id === s.endpoint_id);
              const epName = ep ? ep.name : `id ${s.endpoint_id}`;
              const time = s.created_at ? new Date(s.created_at).toLocaleString() : '';
              return html`
                <div data-testid="summary-card" style="border:1px solid var(--border);border-radius:8px;padding:8px;margin-bottom:8px">
                  <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-secondary)">
                    <span>${time}</span>
                    <span style="background:var(--accent-soft);color:var(--accent);padding:1px 6px;border-radius:4px">via ${epName}</span>
                  </div>
                  <div style="margin-top:4px;font-size:13px">${s.summary_text || ''}</div>
                </div>
              `;
            })}
          `}
        </div>
      `}
      ${remindersOpen && html`
        <div key="reminders-dropdown" data-testid="agent-reminders-dropdown" data-draggable-modal style=${'position:absolute;z-index:250;width:320px;max-width:calc(100vw - 24px);max-height:440px;overflow:auto;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:12px;box-shadow:0 8px 24px rgba(0,0,0,0.3);' + modalPosStyle}>
          <div class="dd-drag-handle" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;cursor:move;touch-action:none" onpointerdown=${startModalDrag}>
            <strong>Reminders</strong>
            <button type="button" aria-label="Close" style="cursor:pointer" onpointerdown=${e => e.stopPropagation()} onclick=${() => setRemindersOpen(false)}>✕</button>
          </div>
          <div style="font-size:11px;color:var(--text-secondary);margin-bottom:8px">Periodically nudge this agent group so it keeps reporting.</div>
          ${agentReminders.length === 0
            ? html`<div data-testid="dd-reminders-empty" style="font-size:12px;color:var(--text-secondary);margin-bottom:8px">No active reminders</div>`
            : html`${agentReminders.map(r => html`
              <div data-testid="dd-reminder-item" style="border:1px solid var(--border);border-radius:8px;padding:6px 8px;margin-bottom:6px">
                <div data-testid="dd-reminder-row" style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">
                  <div style="min-width:0;font-size:12px">
                    <div>Every ${r.cadence_minutes || '?'} min${r.folder_group ? ' · ' + r.folder_group : ''}</div>
                    ${r.solicit_message ? html`<div style="color:var(--text-secondary);font-size:11px;margin-top:2px">“${r.solicit_message}”</div>` : ''}
                    ${(r.recipients && r.recipients.filter(rc => rc.include === undefined || rc.include).length) ? html`<div style="color:var(--text-secondary);font-size:11px;margin-top:2px">→ ${r.recipients.filter(rc => rc.include === undefined || rc.include).map(rc => rc.agent_name).join(', ')}</div>` : ''}
                  </div>
                  <div style="display:flex;gap:4px;flex:0 0 auto">
                    <button type="button" class="btn btn-sm" data-testid="dd-reminder-edit" onclick=${() => editingReminderId === r.id ? setEditingReminderId(null) : startEditReminder(r)}>${editingReminderId === r.id ? 'Close' : 'Edit'}</button>
                    <button type="button" class="btn btn-sm" data-testid="dd-reminder-cancel" onclick=${async () => { try { await api('/api/agent-reminders/' + r.id, { method: 'DELETE' }); setAgentReminders(prev => prev.filter(x => x.id !== r.id)); if (editingReminderId === r.id) setEditingReminderId(null); } catch {} }}>Cancel</button>
                  </div>
                </div>
                ${editingReminderId === r.id ? html`
                  <div data-testid="dd-reminder-edit-panel" style="margin-top:6px;border-top:1px solid var(--border);padding-top:6px">
                    <div style="font-size:11px;color:var(--text-secondary);margin-bottom:4px">Add / remove sessions</div>
                    ${fullGroupMembers.length === 0
                      ? html`<div style="font-size:12px;color:var(--text-secondary)">No sessions in this folder</div>`
                      : fullGroupMembers.map((m) => html`
                        <label style="display:flex;gap:6px;align-items:center;font-size:12px;margin-bottom:3px;cursor:pointer">
                          <input type="checkbox" data-testid="dd-edit-session" data-session=${m.name} checked=${!!editReminderSessions[m.name]} onchange=${e => setEditReminderSessions(s => ({ ...s, [m.name]: e.target.checked }))} />
                          <span>${m.name}${m.isActive ? ' · current' : ''}</span>
                        </label>`)}
                    <div style="font-size:11px;color:var(--text-secondary);margin:8px 0 4px">Cadence (how often it fires)</div>
                    <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;margin-bottom:6px">
                      ${[15, 30, 60].map((mins) => html`
                        <button type="button" class=${'btn btn-sm' + (!editCadenceCustom && editCadence === mins ? ' btn-primary' : '')}
                                data-testid=${'dd-edit-cadence-' + mins}
                                onclick=${() => { setEditCadence(mins); setEditCadenceCustom(''); }}>${mins}m</button>`)}
                      <input data-testid="dd-edit-cadence-custom" type="number" min="1" placeholder="custom" value=${editCadenceCustom}
                             oninput=${e => setEditCadenceCustom(e.target.value)} style="width:74px" />
                      <span style="font-size:11px;color:var(--text-secondary)">min</span>
                    </div>
                    <button type="button" class="btn btn-sm btn-primary" data-testid="dd-reminder-edit-save" onclick=${() => saveEditReminderSessions(r)}>Save</button>
                  </div>
                ` : ''}
              </div>`)}`}
          <div style="border-top:1px solid var(--border);margin:6px 0 8px;padding-top:8px;font-weight:600;font-size:12px">New reminder</div>
          <div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">
            <button type="button" class=${'btn btn-sm' + (!cadenceCustom && cadenceMinutes===15 ? ' btn-primary' : '')} data-testid="dd-cadence-15" onclick=${() => { setCadenceMinutes(15); setCadenceCustom(''); }}>15m</button>
            <button type="button" class=${'btn btn-sm' + (!cadenceCustom && cadenceMinutes===30 ? ' btn-primary' : '')} data-testid="dd-cadence-30" onclick=${() => { setCadenceMinutes(30); setCadenceCustom(''); }}>30m</button>
            <button type="button" class=${'btn btn-sm' + (!cadenceCustom && cadenceMinutes===60 ? ' btn-primary' : '')} data-testid="dd-cadence-60" onclick=${() => { setCadenceMinutes(60); setCadenceCustom(''); }}>60m</button>
            <input data-testid="dd-cadence-custom" type="number" min="1" placeholder="custom" value=${cadenceCustom} oninput=${e => setCadenceCustom(e.target.value)} style="width:74px" />
          </div>
          <div style="font-size:11px;color:var(--text-secondary);margin-bottom:4px">Sessions in this folder</div>
          <div data-testid="dd-reminder-sessions" style="margin-bottom:8px;max-height:120px;overflow:auto">
            ${fullGroupMembers.length === 0
              ? html`<div style="font-size:12px;color:var(--text-secondary)">No sessions in this folder</div>`
              : fullGroupMembers.map((m) => html`
                <label style="display:flex;gap:6px;align-items:center;font-size:12px;margin-bottom:3px;cursor:pointer">
                  <input type="checkbox" data-testid="dd-reminder-session" data-session=${m.name} checked=${reminderSessionChecked(m.name, m.isActive)} onchange=${e => setDlgReminderSessions(s => ({ ...s, [m.name]: e.target.checked }))} />
                  <span>${m.name}${m.isActive ? ' · current' : ''}${m.status ? ' (' + m.status + ')' : ''}</span>
                </label>
              `)}
          </div>
          <div style="font-size:11px;color:var(--text-secondary);margin-bottom:4px">Message posted to the chat</div>
          <textarea data-testid="dd-reminder-message" placeholder="e.g. Status update — where are you at, and any blockers?" value=${dlgReminderMessage} oninput=${e => setDlgReminderMessage(e.target.value)} style="width:100%;min-height:54px;margin-bottom:8px;resize:vertical;box-sizing:border-box"></textarea>
          <button type="button" class="btn btn-sm btn-primary" data-testid="dd-reminder-create" onclick=${handleCreateReminderFromDropdown}>Create reminder</button>
        </div>
      `}
      ${wakeupsOpen && html`
        <div key="wakeups-dropdown" data-testid="agent-wakeups-dropdown" data-draggable-modal style=${'position:absolute;z-index:250;width:320px;max-width:calc(100vw - 24px);max-height:440px;overflow:auto;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:12px;box-shadow:0 8px 24px rgba(0,0,0,0.3);' + modalPosStyle}>
          <div class="dd-drag-handle" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;cursor:move;touch-action:none" onpointerdown=${startModalDrag}>
            <strong>Wakeups</strong>
            <button type="button" aria-label="Close" style="cursor:pointer" onpointerdown=${e => e.stopPropagation()} onclick=${() => setWakeupsOpen(false)}>✕</button>
          </div>
          <div style="font-size:11px;color:var(--text-secondary);margin-bottom:8px">Fire a one-time action into ${activeTarget || 'this agent'} at a set time.</div>
          ${(() => {
            const now = new Date();
            const pending = wakeups.filter(w => w.pane_target === activeTarget && new Date(w.manual_fire_time) > now);
            return pending.length === 0
              ? html`<div data-testid="dd-wakeups-empty" style="font-size:12px;color:var(--text-secondary);margin-bottom:8px">No pending wakeups</div>`
              : html`${pending.map(w => { const diffMin = Math.max(0, Math.round((new Date(w.manual_fire_time) - now) / 60000)); return html`
                <div data-testid="dd-wakeup-row" style="display:flex;justify-content:space-between;gap:8px;align-items:center;border:1px solid var(--border);border-radius:8px;padding:6px 8px;margin-bottom:6px">
                  <span style="font-size:12px">in ${diffMin}m · ${w.action || ''}</span>
                  <button type="button" class="btn btn-sm" data-testid="dd-wakeup-cancel" onclick=${async () => { try { await api('/api/agent-wakeups/' + w.id, { method: 'DELETE' }); setWakeups(prev => prev.filter(x => x.id !== w.id)); } catch {} }}>Cancel</button>
                </div>`; })}`;
          })()}
          <div style="border-top:1px solid var(--border);margin:6px 0 8px;padding-top:8px;font-weight:600;font-size:12px">Schedule wakeup</div>
          <div style="display:flex;gap:6px;margin-bottom:8px">
            <input data-testid="dd-wakeup-date" type="date" value=${wakeupDate} oninput=${e => setWakeupDate(e.target.value)} style="flex:1;min-width:0" />
            <input data-testid="dd-wakeup-time" type="time" value=${wakeupTime} oninput=${e => setWakeupTime(e.target.value)} style="flex:1;min-width:0" />
          </div>
          <input data-testid="dd-wakeup-action" type="text" placeholder="Action to send" value=${wakeupAction} oninput=${e => setWakeupAction(e.target.value)} style="width:100%;margin-bottom:8px" />
          <button type="button" class="btn btn-sm btn-primary" data-testid="dd-wakeup-create" onclick=${async () => {
            if (!wakeupDate || !wakeupTime || !wakeupAction) return;
            const iso = new Date(wakeupDate + 'T' + wakeupTime).toISOString();
            try {
              const res = await api('/api/agent-wakeups', { method: 'POST', body: JSON.stringify({ pane_target: activeTarget || '', manual_fire_time: iso, action: wakeupAction }) });
              if (res?.wakeup) setWakeups(prev => [...prev, res.wakeup]);
              setWakeupDate(''); setWakeupTime('');
            } catch {}
          }}>Schedule wakeup</button>
        </div>
      `}
      <div key="sectionnav-overlay" class="terminal-sectionnav-overlay"
           hidden=${!sectionNavOpen} onclick=${() => setSectionNavOpen(false)}></div>
      ${(isTgMiniAppContext && sectionNavOpen) ? html`
        <div class="terminal-sectionnav-menu terminal-sectionnav-menu-fixed" data-testid="terminal-sectionnav-menu" role="menu">
          ${sectionNavItems.map((it) => html`
            <button type="button" class="terminal-sectionnav-item" role="menuitem"
                    onclick=${() => { setSectionNavOpen(false); navigate(it.id); try { window.Telegram?.WebApp?.HapticFeedback?.selectionChanged(); } catch {} }}>
              <span class="terminal-sectionnav-icon">${it.icon}</span>${it.label}
            </button>
          `)}
        </div>
      ` : ''}
      <div key="menu-overlay" class="terminal-menu-overlay" hidden=${!menuOpen} onclick=${() => setMenuOpen(false)}></div>
      <div key="menu-sheet" class=${'terminal-menu-sheet' + (menuOpen ? ' open' : '')} data-term-menu-sheet data-testid="terminal-menu-sheet" role="menu" ref=${menuRef} inert=${!menuOpen} onclick=${(event) => event.stopPropagation()}>
        <div class="terminal-sheet-inner">
          <div data-testid="agent-reminder-sheet">
            <div class="terminal-sheet-sect">Agent Reminders</div>
            <div class="terminal-sheet-row">
              <div class="terminal-sheet-lbl">Active reminders</div>
              <div>
                ${agentReminders.length === 0 ? html`<div>No active reminders</div>` : html`
                  ${agentReminders.map(r => html`<div data-testid="active-reminder-row">${r.id || ''} ${r.cadence_minutes || ''} min</div>`)}
                `}
              </div>
            </div>
            <div class="terminal-sheet-sect">New reminder</div>
            <div class="terminal-sheet-row">
              <div class="terminal-sheet-lbl">Cadence</div>
              <div class="terminal-seg">
                <button type="button" data-testid="cadence-preset-15" onclick=${() => { setCadenceMinutes(15); setCadenceCustom(''); }}>15m</button>
                <button type="button" data-testid="cadence-preset-30" onclick=${() => { setCadenceMinutes(30); setCadenceCustom(''); }}>30m</button>
                <button type="button" data-testid="cadence-preset-60" onclick=${() => { setCadenceMinutes(60); setCadenceCustom(''); }}>60m</button>
              </div>
            </div>
            <div class="terminal-sheet-row">
              <input data-testid="cadence-custom-input" type="number" placeholder="Custom minutes" value=${cadenceCustom} oninput=${e => setCadenceCustom(e.target.value)} />
            </div>
            <div class="terminal-sheet-row">
              <div class="terminal-sheet-lbl">Repeat limit</div>
              <div class="terminal-seg">
                <button type="button" data-testid="repeat-limit-mode-unlimited" class=${repeatMode==='unlimited'?'sel':''} onclick=${() => setRepeatMode('unlimited')}>Unlimited</button>
                <button type="button" data-testid="repeat-limit-mode-stop" class=${repeatMode==='stop'?'sel':''} onclick=${() => setRepeatMode('stop')}>Stop after N</button>
              </div>
            </div>
            ${repeatMode==='stop' ? html`
              <div class="terminal-sheet-row">
                <input data-testid="repeat-limit-input" type="number" value=${repeatLimit} oninput=${e => setRepeatLimit(e.target.value)} />
              </div>
            ` : ''}
            <div class="terminal-sheet-row">
              <div class="terminal-sheet-lbl">Recipient agent</div>
              <input data-testid="recipient-agent-name-input" type="text" value=${recipientAgentName} oninput=${e => setRecipientAgentName(e.target.value)} />
            </div>
            <div class="terminal-sheet-row">
              <label><input type="checkbox" data-testid="recipient-include-toggle" checked=${recipientInclude} onchange=${e => setRecipientInclude(e.target.checked)} /> Include</label>
            </div>
            <div class="terminal-sheet-row">
              <button type="button" data-testid="agent-reminder-save" onclick=${handleSaveReminder}>Save</button>
            </div>
          </div>
          <div data-testid="wakeup-sheet">
            <div class="terminal-sheet-sect">Wakeup</div>
            <div class="terminal-sheet-row">
              <div class="terminal-sheet-lbl">Pending wakeups</div>
              <div>
                ${(() => {
                  const now = new Date();
                  const pending = wakeups.filter(w => w.pane_target === activeTarget && new Date(w.manual_fire_time) > now);
                  const count = pending.length;
                  const nearest = pending.reduce((min,w) => {
                    const diff = new Date(w.manual_fire_time) - now;
                    return diff < min.diff ? {diff, w} : min;
                  }, {diff: Infinity});
                  const nearestMin = count ? Math.max(0, Math.round(nearest.diff/60000)) : null;
                  return html`
                    <button type="button" data-testid="wakeup-expand-toggle" onclick=${() => setWakeupExpanded(e => !e)}>${wakeupExpanded ? 'Hide wakeups' : 'Show wakeups'}</button>
                    <span data-testid="wakeup-collapsed-summary" style="margin-left:8px">${count === 0 ? 'No pending wakeups' : `${count} wakeup${count!==1?'s':''} · in ${nearestMin}m`}</span>
                    ${wakeupExpanded ? html`
                      ${count === 0 ? html`<div>No pending wakeups</div>` : html`
                        ${pending.map(w => {
                          const fireAt = new Date(w.manual_fire_time);
                          const diffMs = fireAt - now;
                          const diffMin = Math.max(0, Math.round(diffMs/60000));
                          return html`<div data-testid="wakeup-pending-row" style="display:flex;justify-content:space-between;gap:8px;margin-bottom:4px">
                            <span>${w.pane_target || ''} · ${w.action || ''} · in ${diffMin}m</span>
                            <button type="button" data-testid="wakeup-cancel" onclick=${async () => {
                              try {
                                await api(`/api/agent-wakeups/${w.id}`, { method: 'DELETE' });
                                setWakeups(prev => prev.filter(x => x.id !== w.id));
                              } catch {}
                            }}>Cancel</button>
                          </div>`;
                        })}
                      `}
                    ` : ''}
                  `;
                })()}
              </div>
            </div>
            <div class="terminal-sheet-sect">Schedule wakeup</div>
            <div class="terminal-sheet-row">
              <div class="terminal-sheet-lbl">Date</div>
              <input data-testid="wakeup-date-input" type="date" value=${wakeupDate} oninput=${e => setWakeupDate(e.target.value)} />
            </div>
            <div class="terminal-sheet-row">
              <div class="terminal-sheet-lbl">Time</div>
              <input data-testid="wakeup-time-input" type="time" value=${wakeupTime} oninput=${e => setWakeupTime(e.target.value)} />
            </div>
            <div class="terminal-sheet-row">
              <div class="terminal-sheet-lbl">Action</div>
              <input data-testid="wakeup-action-input" type="text" value=${wakeupAction} oninput=${e => setWakeupAction(e.target.value)} />
            </div>
            <div class="terminal-sheet-row">
              <button type="button" data-testid="wakeup-save" onclick=${async () => {
                if (!wakeupDate || !wakeupTime || !wakeupAction) return;
                const iso = new Date(`${wakeupDate}T${wakeupTime}`).toISOString();
                try {
                  const res = await api('/api/agent-wakeups', {
                    method: 'POST',
                    body: JSON.stringify({ pane_target: activeTarget || '', manual_fire_time: iso, action: wakeupAction })
                  });
                  setWakeups(prev => [...prev, res.wakeup]);
                  setWakeupDate('');
                  setWakeupTime('');
                  setWakeupAction("Wake up — start today's queued tasks and report status.");
                } catch {}
              }}>Save wakeup</button>
            </div>
          </div>
          <div data-testid="summary-endpoint-sheet">
            ${endpointError ? html`<div data-testid="endpoint-error" role="alert">${endpointError}</div>` : ''}
            <div class="terminal-sheet-sect">Summary Endpoints</div>
            <div class="terminal-sheet-row">
              <div class="terminal-sheet-lbl">Existing endpoints</div>
              <div>
                ${summaryEndpoints.length === 0 ? html`<div>No endpoints</div>` : html`
                  ${summaryEndpoints.map(ep => html`
                    <div data-testid="endpoint-row" style="display:flex;gap:8px;align-items:center;margin-bottom:4px">
                      <input type="radio" name="default-endpoint" data-testid="endpoint-default-radio" checked=${defaultEndpointId === ep.id} onchange=${() => handleSetDefault(ep.id)} />
                      <span>${ep.name || ''} ${ep.model || ''}</span>
                      <button type="button" data-testid="endpoint-edit" onclick=${() => startEditEndpoint(ep)}>Edit</button>
                      <button type="button" data-testid="endpoint-delete" onclick=${() => handleDeleteEndpoint(ep.id)}>Del</button>
                    </div>
                  `)}
                `}
              </div>
            </div>
            <div class="terminal-sheet-sect">${editingEndpointId ? 'Edit endpoint' : 'New endpoint'}</div>
            <div class="terminal-sheet-row">
              <div class="terminal-sheet-lbl">Name</div>
              <input data-testid="endpoint-name-input" type="text" placeholder="Name" value=${endpointName} oninput=${e => setEndpointName(e.target.value)} />
            </div>
            <div class="terminal-sheet-row">
              <div class="terminal-sheet-lbl">Base URL</div>
              <input data-testid="endpoint-baseurl-input" type="text" placeholder="https://.../v1" value=${endpointBaseUrl} oninput=${e => setEndpointBaseUrl(e.target.value)} />
            </div>
            <div class="terminal-sheet-row">
              <div class="terminal-sheet-lbl">Model</div>
              <input data-testid="endpoint-model-input" type="text" placeholder="Model" value=${endpointModel} oninput=${e => setEndpointModel(e.target.value)} />
            </div>
            <div class="terminal-sheet-row">
              <button type="button" data-testid="endpoint-save" onclick=${handleSaveEndpoint}>${editingEndpointId ? 'Update' : 'Add'}</button>
              ${editingEndpointId ? html`<button type="button" onclick=${() => { setEditingEndpointId(null); setEndpointName(''); setEndpointBaseUrl(''); setEndpointModel(''); }}>Cancel</button>` : ''}
            </div>
          </div>
          <div class="terminal-sheet-topbar">
            <span class="terminal-sheet-title">Terminal settings</span>
            <button type="button" class="terminal-sheet-done" data-testid="terminal-menu-done"
                    onclick=${() => setMenuOpen(false)} aria-label="Close settings">Done</button>
          </div>
          <div class="terminal-sheet-sect">Text size</div>
          <div class="terminal-sheet-row">
            <div class="terminal-sheet-lbl">Conversation size<small>Also in Settings ▸ Appearance (syncs everywhere)</small></div>
            <div class="terminal-sheet-stepper">
              <button type="button" onclick=${() => updateConvFontSize(convFontSize - 1)} disabled=${convFontSize <= TERMINAL_CONV_FONT_MIN}>A−</button>
              <span class="val">${convFontSize}px</span>
              <button type="button" onclick=${() => updateConvFontSize(convFontSize + 1)} disabled=${convFontSize >= TERMINAL_CONV_FONT_MAX}>A＋</button>
            </div>
          </div>
          <div class="terminal-sheet-row">
            <input type="range" min=${TERMINAL_CONV_FONT_MIN} max=${TERMINAL_CONV_FONT_MAX} step="1" value=${String(convFontSize)}
                   onInput=${e => updateConvFontSize(Number(e.target.value))} />
          </div>
          <div class="terminal-sheet-row" style="margin-bottom:16px">
            <div class="terminal-sheet-lbl">Reset to default</div>
            <button type="button" class="terminal-sheet-chip" onclick=${() => updateConvFontSize(TERMINAL_CONV_FONT_DEFAULT)}>Reset · ${TERMINAL_CONV_FONT_DEFAULT}px</button>
          </div>

          <div class="terminal-sheet-sect">Reply length</div>
          <div class="terminal-sheet-row" style="margin-bottom:16px">
            <div class="terminal-sheet-lbl">Minimize agent replies<small>Shows the most recent N lines · tap a reply to expand</small></div>
            <div class="terminal-seg" role="group" aria-label="Reply length" data-testid="terminal-reply-limit">
              <button type="button" class=${'terminal-seg-btn' + (replyLimit === 10 ? ' sel' : '')}
                      onclick=${() => updateReplyLimit(10)}>10</button>
              <button type="button" class=${'terminal-seg-btn' + (replyLimit === 50 ? ' sel' : '')}
                      onclick=${() => updateReplyLimit(50)}>50</button>
              <button type="button" class=${'terminal-seg-btn' + (replyLimit === 0 ? ' sel' : '')}
                      onclick=${() => updateReplyLimit(0)}>Full</button>
            </div>
          </div>

          ${hasTarget && html`
            <div class="terminal-sheet-sect">Raw terminal size</div>
            <div class="terminal-sheet-row" style="margin-bottom:16px">
              <div class="terminal-font-controls" aria-label="Terminal font size controls">
                <button class="btn btn-sm" onclick=${() => updateTerminalFontSize(terminalFontSize - 1)} disabled=${terminalFontSize <= TERMINAL_MIN_FONT_SIZE} title="Decrease terminal font size">A-</button>
                <button class="btn btn-sm" onclick=${() => updateTerminalFontSize(TERMINAL_DEFAULT_FONT_SIZE)} disabled=${terminalFontSize === TERMINAL_DEFAULT_FONT_SIZE} title="Reset terminal font size">Reset</button>
                <button class="btn btn-sm" onclick=${() => updateTerminalFontSize(terminalFontSize + 1)} disabled=${terminalFontSize >= TERMINAL_MAX_FONT_SIZE} title="Increase terminal font size">A+</button>
              </div>
            </div>
          `}

          <div class="terminal-sheet-sect">Output</div>
          <div class="terminal-sheet-row">
            <div class="terminal-sheet-lbl">Show raw terminal output<small>Reveals stripped CLI chrome</small></div>
            <button type="button" class=${'terminal-switch' + (showRawChrome ? ' on' : '')}
                    data-testid="terminal-show-raw" data-show-raw role="switch" aria-checked=${showRawChrome}
                    disabled=${!hasTarget || !friendlyMode}
                    onclick=${() => setShowRawChrome((current) => !current)}></button>
          </div>

          <div class="terminal-sheet-sect">Session</div>
          <div class="terminal-menu-section">
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <strong>${friendlyMode ? 'Terminal Chat' : 'Raw Terminal'}</strong>
              ${activeTarget ? html`<span class="terminal-chat-detail-pill">${activeTarget}</span>` : ''}
              ${hasTarget ? html`<span class=${menuStatusClass}>${terminalStatus}</span>` : ''}
              ${updatedLabel ? html`<span class="terminal-chat-detail-pill" data-testid="terminal-last-updated" data-terminal-last-updated>updated ${updatedLabel}</span>` : ''}
            </div>
          </div>
          <div class="terminal-sheet-picker">
            ${sessionsError
              ? html`<div style="color:var(--danger,#f85149);font-size:12px;flex:1">${sessionsError} <button class="btn btn-sm" onclick=${loadSessions}>Retry</button></div>`
              : html`<select value=${activeTarget || ''} onChange=${e => switchActiveTarget(e.target.value)}>
                  <option value="">${allPanes.length === 0 ? 'Loading panes...' : 'Select a pane...'}</option>
                  ${allPanes.map(p => html`
                    <option value=${p.target}>${p.session_name} · ${p.target} · ${p.command}</option>
                  `)}
                </select>`
            }
          </div>
          <div class="terminal-sheet-chips" style="margin-bottom:12px">
            <button type="button" class="terminal-sheet-chip" onclick=${() => {
              setShowNewSession(true);
              setNewSessionName('');
              setMenuOpen(false);
            }}>+ New</button>
            <button type="button" class="terminal-sheet-chip" onclick=${() => {
              if (friendlyMode) {
                setFriendlyRefreshTick((tick) => tick + 1);
              }
            }}>Refresh</button>
            <button type="button" class="terminal-sheet-chip danger" onclick=${() => {
              setMenuOpen(false);
              backToTerminalList();
            }}>Disconnect</button>
          </div>
          <div class="terminal-sheet-row">
            <div class="terminal-sheet-lbl">Lines captured</div>
            <label class="terminal-chat-line-picker">
              <span>Lines</span>
              <select data-testid="terminal-lines" value=${String(lineLimit)} onchange=${e => handleLineLimitChange(e.target.value)}>
                <option value="25">25</option>
                <option value="50">50</option>
                <option value="100">100</option>
                <option value="150">150</option>
                <option value="200">200</option>
              </select>
            </label>
          </div>
          <div class="terminal-sheet-chips">
            ${isTgMiniAppContext && html`
              <button type="button" class="terminal-sheet-chip" onclick=${() => {
                setMenuOpen(false);
                if (fullScreen) {
                  exitFullScreen();
                } else {
                  setFullScreen(true);
                }
              }}>${fullScreen ? 'Close Full' : 'Full Screen'}</button>
            `}
            ${hasTarget && html`
              <button type="button" class=${'terminal-sheet-chip' + (friendlyMode ? ' sel' : '')}
                      onclick=${() => {
                        setMenuOpen(false);
                        setFriendlyMode(true);
                      }}>Friendly</button>
              <button type="button" class=${'terminal-sheet-chip' + (!friendlyMode ? ' sel' : '')}
                      onclick=${() => {
                        setMenuOpen(false);
                        setFriendlyMode(false);
                      }}>Raw</button>
            `}
          </div>
        </div>
      </div>

      <div class="terminal-container" key="terminal-container">
        ${!isTgMiniAppContext && !isListView && html`
          <div class="session-tree">
            <div style="display:flex;gap:4px;margin-bottom:8px">
              <button class="btn btn-sm btn-primary" style="flex:1" onclick=${() => {
                setNewSessionName('');
                setShowNewSession(true);
              }}>New Session</button>
            </div>
            ${sessions.map(s => html`
              <div>
                <div style="font-size:11px;color:var(--text-secondary);padding:4px 8px;margin-top:4px">${s.session_name}</div>
                ${s.panes.map(p => html`
                  <div class="tree-item ${activeTarget === p.target ? 'active' : ''}${p.awaiting_selection ? ' awaiting-selection' : ''}"
                       onclick=${() => activeTarget === p.target ? backToTerminalList() : switchActiveTarget(p.target)}>
                    ${p.awaiting_selection ? '🔴 ' : ''}${p.target} <span style="color:var(--text-secondary);font-size:11px">${p.command}</span>
                  </div>
                `)}
              </div>
            `)}
            ${sessions.length === 0 && html`<div style="color:var(--text-secondary);font-size:12px;padding:8px">No active sessions</div>`}
          </div>
        `}

        <div class=${'terminal-panel' + (friendlyMode ? ' terminal-panel-friendly' : '')}>
          ${isListView
            ? html`
              <div class="terminal-list-wrap">
                <div class="terminal-list-tabs" data-testid="terminal-list-tabs" role="tablist" aria-label="Session groups">
                  <div class=${'terminal-list-tab' + (resolvedActiveGroupTab === 'all' ? ' active' : '')}
                       role="tab"
                       tabindex="0"
                       data-testid="terminal-group-tab"
                       data-group-id="all"
                       aria-selected=${resolvedActiveGroupTab === 'all'}
                       onclick=${() => selectGroupTab('all')}
                       onkeydown=${(event) => {
                         if (event.key === 'Enter' || event.key === ' ') {
                           event.preventDefault();
                           selectGroupTab('all');
                         }
                       }}>
                    <span class="terminal-list-tab-name">All</span>
                  </div>
                  ${terminalGroups.map((group) => html`
                    <div key=${group.id}
                         class=${'terminal-list-tab' + (resolvedActiveGroupTab === group.id ? ' active' : '')}
                         role="tab"
                         tabindex="0"
                         data-testid="terminal-group-tab"
                         data-group-id=${group.id}
                         aria-selected=${resolvedActiveGroupTab === group.id}
                         onclick=${() => selectGroupTab(group.id)}
                         onkeydown=${(event) => {
                           if (event.key === 'Enter' || event.key === ' ') {
                             event.preventDefault();
                             selectGroupTab(group.id);
                           }
                         }}>
                      <span class="terminal-list-tab-name">${group.name}</span>
                      <button type="button"
                              class="terminal-list-tab-more"
                              data-testid="terminal-group-manage"
                              aria-label=${'Manage ' + group.name}
                              onclick=${(event) => openGroupManageMenu(event, group.id)}>⋮</button>
                    </div>
                  `)}
                  <button type="button"
                          class="terminal-list-tab-create"
                          data-testid="terminal-group-create"
                          aria-label="Create group"
                          onclick=${() => openCreateGroupPrompt(null)}>+</button>
                </div>
                <div class="terminal-list" data-testid="terminal-session-list">
                  ${sessionsError
                    ? html`<div class="terminal-list-state error">${sessionsError} <button type="button" class="btn btn-sm" onclick=${loadSessions}>Retry</button></div>`
                    : resolvedActiveGroupTab !== 'all' && visibleRows.length === 0
                      ? html`<div class="terminal-list-state" data-testid="terminal-group-empty">No sessions in this group yet — add them from All (📁) or the group's Edit screen.</div>`
                      : visibleRows.length === 0
                        ? html`<div class="terminal-list-state">No active sessions</div>`
                        : visibleRows.map((row) => html`
                          <div role="button"
                               tabindex="0"
                               key=${row.session.session_name}
                               class=${'terminal-list-row' + (row.busy ? ' busy' : '') + (row.awaiting ? ' awaiting-selection' : '')}
                               data-testid="terminal-session-row"
                               data-session-target=${row.primaryPane?.target || ''}
                               onclick=${(event) => openSessionFromRow(event, row.primaryPane?.target)}
                               onkeydown=${(event) => {
                                 if (event.target !== event.currentTarget) return;
                                 if (event.key === 'Enter' || event.key === ' ') {
                                   event.preventDefault();
                                   openSessionFromRow(event, row.primaryPane?.target);
                                 }
                               }}>
                            <span class=${'terminal-list-dot ' + (row.awaiting ? 'awaiting' : row.busy ? 'busy' : row.connected ? 'connected' : 'offline')} aria-hidden="true"></span>
                            <span class="terminal-list-main">
                              <span class="terminal-list-name">${row.awaiting ? '🔴 ' : ''}${row.session.session_name}</span>
                              ${row.awaiting
                                ? html`<span class="terminal-list-status awaiting-selection-label">waiting for your selection</span>`
                                : row.busy
                                ? html`<span class="terminal-list-status">working…</span>`
                                : html`<span class="terminal-list-status">${row.connected ? 'ready' : 'not connected'}</span>`}
                            </span>
                            <span class="terminal-list-meta">
                              <span class="terminal-list-time">${formatTerminalActivity(row.activity)}</span>
                              <button type="button"
                                      class="terminal-row-groups"
                                      data-testid="terminal-row-groups"
                                      aria-label=${'Assign ' + row.session.session_name + ' to groups'}
                                      onclick=${(event) => openRowGroupMenu(event, row.session.session_name)}
                                      onpointerdown=${(event) => event.stopPropagation()}>📁</button>
                            </span>
                          </div>
                        `)}
                </div>
              </div>`
            : hasTarget
            ? (friendlyMode
                ? html`<${FriendlyTerminalView}
                    target=${activeTarget}
                    sessionName=${activePane?.session_name || ''}
                    projectId=${projectId || sessions.find(s => s.session_name === activePane?.session_name)?.project_id || null}
                    fullScreen=${fullScreen}
                    key=${`${activeTarget}:${lineLimit}`}
                    lineLimit=${lineLimit}
                    refreshTick=${friendlyRefreshTick}
                    showRawChrome=${showRawChrome}
                    isTui=${!!activePane?.alternate_on}
                    onStatusChange=${setTerminalStatus}
                    onLastUpdated=${setLastUpdatedAt}
                    onToggleFullScreen=${isTgMiniAppContext ? () => {
                      if (fullScreen) {
                        exitFullScreen();
                      } else {
                        setFullScreen(true);
                      }
                    } : null}
                    onDisconnect=${backToTerminalList}
                    onReloadSessions=${reloadSessions}
                  />`
                : html`<${TerminalView} target=${activeTarget} key=${activeTarget} fontSize=${terminalFontSize} onDisconnect=${backToTerminalList} onStatusChange=${setTerminalStatus} onLastUpdated=${setLastUpdatedAt} />`)
            : html`<div class="terminal-empty-state">
                <strong>No terminal selected</strong>
                <div>Select a pane to connect and start using terminal chat.</div>
              </div>`
          }
        </div>
      </div>
    </div>
  `;

  return html`
    ${showNewSession && html`
      <div class="modal-overlay" onclick=${() => setShowNewSession(false)}>
        <div class="modal" style="max-width:400px" onclick=${e => e.stopPropagation()}>
          <h3>New Tmux Session</h3>
          <div class="form-group">
            <label>Session Name</label>
            <input value=${newSessionName}
                   onInput=${e => setNewSessionName(e.target.value)}
                   onKeyDown=${e => e.key === 'Enter' && createSession()}
                   placeholder=${`agj-${projectName || 'session'}`} autofocus />
          </div>
          <div class="modal-actions">
            <button class="btn" onclick=${() => setShowNewSession(false)}>Cancel</button>
            <button class="btn btn-primary" onclick=${createSession}>Create</button>
          </div>
        </div>
      </div>
    `}
    ${groupNamePrompt && html`
      <div class="modal-overlay terminal-group-overlay" data-testid="terminal-group-name-modal" onclick=${() => setGroupNamePrompt(null)}>
        <div class="modal" style="max-width:400px" onclick=${(event) => event.stopPropagation()}>
          <h3>${groupNamePrompt.mode === 'rename' ? 'Rename group' : 'New group'}</h3>
          <div class="form-group">
            <label>Group name</label>
            <input data-testid="terminal-group-name-input"
                   value=${groupNamePrompt.draft}
                   onInput=${(event) => setGroupNamePrompt((current) => current ? { ...current, draft: event.target.value } : current)}
                   onKeyDown=${(event) => event.key === 'Enter' && submitGroupNamePrompt()}
                   placeholder="e.g. north" autofocus />
          </div>
          <div class="modal-actions">
            <button type="button" class="btn" onclick=${() => setGroupNamePrompt(null)}>Cancel</button>
            <button type="button" class="btn btn-primary" data-testid="terminal-group-name-submit" onclick=${submitGroupNamePrompt}>
              ${groupNamePrompt.mode === 'rename' ? 'Save' : 'Create'}
            </button>
          </div>
        </div>
      </div>
    `}
    ${editingGroup && html`
      <div class="modal-overlay terminal-group-overlay" onclick=${() => setEditingGroupId(null)}>
        <div class="modal terminal-group-edit" data-testid="terminal-group-edit" onclick=${(event) => event.stopPropagation()}>
          <h3>${editingGroup.name}</h3>
          <div class="terminal-group-edit-list">
            ${sessionRows.length === 0
              ? html`<div class="terminal-list-state">No active sessions</div>`
              : sessionRows.map((row) => html`
                <label key=${row.session.session_name} class="terminal-group-edit-row">
                  <input type="checkbox"
                         data-testid="terminal-group-edit-session"
                         data-session-name=${row.session.session_name}
                         checked=${editingGroup.sessions.includes(row.session.session_name)}
                         onchange=${(event) => toggleSessionInGroup(editingGroup.id, row.session.session_name, event.target.checked)} />
                  <span class=${'terminal-list-dot ' + (row.busy ? 'busy' : row.connected ? 'connected' : 'offline')} aria-hidden="true"></span>
                  <span class="terminal-group-edit-main">
                    <span class="terminal-list-name">${row.session.session_name}</span>
                    <span class="terminal-list-status">${row.busy ? 'working…' : row.connected ? 'ready' : 'not connected'}</span>
                  </span>
                </label>
              `)}
          </div>
          <div class="modal-actions">
            <button type="button" class="btn btn-primary" data-testid="terminal-group-edit-done" onclick=${() => setEditingGroupId(null)}>Done</button>
          </div>
        </div>
      </div>
    `}
    ${rowGroupMenu && html`
      <div class="terminal-group-menu-backdrop" onclick=${closeGroupPopovers}></div>
      <div class="terminal-group-menu" data-testid="terminal-group-menu" role="menu"
           style=${'top:' + rowGroupMenu.top + 'px;left:' + rowGroupMenu.left + 'px'}>
        ${terminalGroups.length === 0
          ? html`<div class="terminal-group-menu-empty">No groups yet</div>`
          : terminalGroups.map((group) => html`
            <label key=${group.id} class="terminal-group-menu-item">
              <input type="checkbox"
                     data-testid="terminal-group-check"
                     data-group-id=${group.id}
                     checked=${group.sessions.includes(rowGroupMenu.sessionName)}
                     onchange=${(event) => {
                       event.stopPropagation();
                       toggleSessionInGroup(group.id, rowGroupMenu.sessionName, event.target.checked);
                     }} />
              <span>${group.name}</span>
            </label>
          `)}
        <button type="button" class="terminal-group-menu-new" data-testid="terminal-group-menu-new"
                onclick=${() => openCreateGroupPrompt(rowGroupMenu.sessionName)}>New group…</button>
      </div>
    `}
    ${groupManageMenu && html`
      <div class="terminal-group-menu-backdrop" onclick=${closeGroupPopovers}></div>
      <div class="terminal-group-menu terminal-group-manage-menu" data-testid="terminal-group-manage-menu" role="menu"
           style=${'top:' + groupManageMenu.top + 'px;left:' + groupManageMenu.left + 'px'}>
        <button type="button" class="terminal-group-menu-action" data-testid="terminal-group-action-rename"
                onclick=${() => openRenameGroupPrompt(groupManageMenu.groupId)}>Rename</button>
        <button type="button" class="terminal-group-menu-action" data-testid="terminal-group-action-edit"
                onclick=${() => openGroupEdit(groupManageMenu.groupId)}>Edit</button>
        <button type="button" class="terminal-group-menu-action danger" data-testid="terminal-group-action-delete"
                onclick=${() => deleteGroup(groupManageMenu.groupId)}>Delete</button>
      </div>
    `}
    ${fullScreen && isTgMiniAppContext
      ? html`<div class="terminal-fullscreen-overlay">${shell}</div>`
      : shell}
  `;
}

// Agent task-panel detection: the CLI prints a live todo list as lines led by a
// task glyph (◻/◼ open, ✔/✓/☑ done, ☐/☒ checkbox), the first often after a ⎿
// connector. We collapse a run of these into one "📋 N tasks" line so the panel
// stops eating chat space (JROM). A single glyph line is left alone.
const _TASK_LINE_RE = /^\s*(?:⎿\s*)?([◻◼▪☐☒✔✓☑])\s+(\S.*?)\s*$/u;
const _TASK_DONE_RE = /[✔✓☑]/u;
function parseTaskLine(line) {
  const m = String(line).match(_TASK_LINE_RE);
  if (!m) return null;
  return { done: _TASK_DONE_RE.test(m[1]), label: m[2].trim() };
}
// Split bubble text into ordered segments of plain text and task blocks (>=2
// consecutive task lines).
function splitTaskSegments(text) {
  const lines = String(text).split('\n');
  const segments = [];
  let i = 0;
  while (i < lines.length) {
    if (parseTaskLine(lines[i])) {
      let j = i;
      const items = [];
      while (j < lines.length && parseTaskLine(lines[j])) { items.push(parseTaskLine(lines[j])); j++; }
      if (items.length >= 2) {
        segments.push({ type: 'tasks', items });
        i = j;
        continue;
      }
    }
    // accumulate a text run
    let k = i;
    const buf = [];
    while (k < lines.length) {
      if (parseTaskLine(lines[k])) {
        // peek: only break the text run if a real (>=2) task block starts here
        let p = k, cnt = 0;
        while (p < lines.length && parseTaskLine(lines[p])) { cnt++; p++; }
        if (cnt >= 2) break;
      }
      buf.push(lines[k]); k++;
    }
    segments.push({ type: 'text', text: buf.join('\n') });
    i = k;
  }
  return segments;
}

function TaskBlock({ items }) {
  const [open, setOpen] = useState(false);
  const total = items.length;
  const done = items.filter((it) => it.done).length;
  return html`
    <div class="terminal-taskblock" data-testid="terminal-taskblock">
      <button type="button" class="terminal-taskblock-toggle" data-testid="terminal-taskblock-toggle"
              aria-expanded=${open} onclick=${() => setOpen((o) => !o)}>
        <span class="terminal-taskblock-caret">${open ? '▾' : '▸'}</span>
        📋 ${total} task${total === 1 ? '' : 's'} · ${done} done / ${total - done} open
      </button>
      ${open ? html`
        <div class="terminal-taskblock-items">
          ${items.map((it) => html`
            <div class=${'terminal-taskblock-item' + (it.done ? ' done' : '')}>
              <span class="terminal-taskblock-mark">${it.done ? '✔' : '◻'}</span>${it.label}
            </div>
          `)}
        </div>
      ` : ''}
    </div>
  `;
}

// The terminal wraps a long URL across physical lines (no space at the wrap
// point). Rejoin those fragments so the whole URL is one contiguous string the
// linkifier can capture — otherwise only the first wrapped line becomes a link.
// A continuation is joined only when the current line ends in a URL and the next
// line's leading token is long and space-free (a URL continuation, not prose).
function rejoinWrappedUrls(text) {
  const s = String(text);
  if (!/https?:\/\//.test(s)) return s;
  const lines = s.split('\n');
  const endsWithUrl = /https?:\/\/\S+$/;   // a URL running to end-of-line
  const out = [];
  let i = 0;
  while (i < lines.length) {
    let line = lines[i];
    while (
      i + 1 < lines.length &&
      endsWithUrl.test(line) &&            // (accumulated) line ends in a URL
      line.length >= 24 &&                 // long line => a wrap, not short prose
      lines[i + 1].length > 0 &&
      !/^\s/.test(lines[i + 1]) &&         // continuation has no leading space
      !/^https?:\/\//.test(lines[i + 1]) &&// and isn't a brand-new URL
      /^\S{12,}/.test(lines[i + 1])        // its leading token is long (URL, not prose)
    ) {
      line += lines[i + 1];
      i += 1;
    }
    out.push(line);
    i += 1;
  }
  return out.join('\n');
}

// Make http(s) URLs in agent output tappable (e.g. a `/login` auth link). Splits
// text on a URL match and renders each URL as a safe new-tab link; everything
// else stays plain text. Trailing punctuation is not swallowed into the link.
const _URL_RE = /(https?:\/\/[^\s<>()[\]{}"']+[^\s<>()[\]{}"'.,;:!?])/g;
// Wrap every case-insensitive occurrence of `query` in a <mark> so the searched
// word is visibly highlighted in the transcript (a yellow marker on the actual
// text), not merely a ring around the whole bubble. Returns the plain string
// unchanged when there is no query or no match, so non-search rendering is
// untouched.
function highlightQuery(str, query) {
  const s = typeof str === 'string' ? str : String(str == null ? '' : str);
  const q = (query || '').trim();
  if (!q) return s;
  const lower = s.toLowerCase();
  const ql = q.toLowerCase();
  if (!lower.includes(ql)) return s;
  const out = [];
  let last = 0;
  let idx;
  while ((idx = lower.indexOf(ql, last)) !== -1) {
    if (idx > last) out.push(s.slice(last, idx));
    out.push(html`<mark class="terminal-search-mark">${s.slice(idx, idx + ql.length)}</mark>`);
    last = idx + ql.length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

function linkify(text, query) {
  const s0 = typeof text === 'string' ? text : String(text == null ? '' : text);
  const s = rejoinWrappedUrls(s0);
  if (!/https?:\/\//.test(s)) return highlightQuery(s, query);
  const out = [];
  let last = 0;
  let m;
  _URL_RE.lastIndex = 0;
  while ((m = _URL_RE.exec(s)) !== null) {
    if (m.index > last) out.push(highlightQuery(s.slice(last, m.index), query));
    const url = m[0];
    out.push(html`<a class="terminal-chat-link" href=${url} target="_blank" rel="noopener noreferrer">${url}</a>`);
    last = m.index + url.length;
  }
  if (last < s.length) out.push(highlightQuery(s.slice(last), query));
  return out;
}

// A monospace box-drawing table (│-delimited rows with content) is rendered in a
// <pre> so its columns line up exactly like the terminal, instead of collapsing
// into ragged proportional text. Split a string into ordered text / table runs.
function _isTableLine(line) {
  return /[│┃]/.test(line) && /[A-Za-z0-9]/.test(line);
}
function splitTableRuns(text) {
  const lines = String(text).split('\n');
  const segments = [];
  let i = 0;
  while (i < lines.length) {
    if (_isTableLine(lines[i])) {
      let j = i;
      while (j < lines.length && _isTableLine(lines[j])) j++;
      if (j - i >= 2) { segments.push({ type: 'table', text: lines.slice(i, j).join('\n') }); i = j; continue; }
    }
    let k = i;
    const buf = [];
    while (k < lines.length) {
      if (_isTableLine(lines[k])) {
        let p = k, cnt = 0;
        while (p < lines.length && _isTableLine(lines[p])) { cnt++; p++; }
        if (cnt >= 2) break;
      }
      buf.push(lines[k]); k++;
    }
    segments.push({ type: 'text', text: buf.join('\n') });
    i = k;
  }
  return segments;
}

// Render agent text with tappable URLs AND aligned monospace tables. Non-table
// runs are linkified (agent) or left plain (user); table runs go in a <pre>.
function renderRichText(text, role, query) {
  const s = typeof text === 'string' ? text : String(text == null ? '' : text);
  const segs = splitTableRuns(s);
  if (!segs.some((seg) => seg.type === 'table')) {
    return role === 'agent' ? linkify(s, query) : highlightQuery(s, query);
  }
  return segs.map((seg) => seg.type === 'table'
    ? html`<pre class="terminal-chat-table">${seg.text}</pre>`
    : (seg.text ? html`<span class="terminal-chat-textseg">${role === 'agent' ? linkify(seg.text, query) : highlightQuery(seg.text, query)}</span>` : ''));
}

function renderBubbleText(text, query) {
  const segments = splitTaskSegments(text);
  if (!segments.some((s) => s.type === 'tasks')) return null; // no task block
  return html`<div class="ovm-chat-text terminal-chat-content">
    ${segments.map((seg) => seg.type === 'tasks'
      ? html`<${TaskBlock} items=${seg.items} />`
      : (seg.text ? html`<span class="terminal-chat-textseg">${renderRichText(seg.text, 'agent', query)}</span>` : ''))}
  </div>`;
}

// Minimize: agent replies compact to the most recent `limit` lines (the tail,
// so scroll-to-bottom still lands on the newest line), with a per-reply toggle
// to expand to full and back. `limit` comes from the ☰ menu picker (0 = Full).
// User messages are never compacted so they stay easy to scan. A small slack
// avoids collapsing a reply that's only a few lines over the limit.
const BUBBLE_COMPACT_SLACK = 4;

function CollapsibleBubbleContent({ content, role, limit, query }) {
  const [expanded, setExpanded] = useState(false);
  const text = typeof content === 'string' ? content : String(content == null ? '' : content);

  // A visible task panel is collapsed in place (independent of the line-minimize).
  const withTasks = role === 'agent' ? renderBubbleText(text, query) : null;
  if (withTasks) return withTasks;

  // Linkify URLs in agent replies (e.g. a /login auth link); leave user text plain.
  // `query` (the active chat-search term) highlights matching words in a <mark>.
  const rt = (s) => renderRichText(s, role, query);

  const cap = Number(limit);
  const lines = text.split('\n');
  const total = lines.length;
  const compactable = role === 'agent' && cap > 0 && total > cap + BUBBLE_COMPACT_SLACK;

  if (!compactable) {
    return html`<div class="ovm-chat-text terminal-chat-content">${rt(text)}</div>`;
  }

  if (expanded) {
    return html`
      <button type="button" class="terminal-chat-showmore" data-testid="terminal-reply-minimize"
              onclick=${() => setExpanded(false)}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 15l-6-6-6 6"></path></svg>
        Minimize to ${cap} lines
      </button>
      <div class="ovm-chat-text terminal-chat-content">${rt(text)}</div>
    `;
  }

  const hidden = total - cap;
  const visible = lines.slice(total - cap).join('\n');
  return html`
    <button type="button" class="terminal-chat-showmore" data-testid="terminal-reply-expand"
            onclick=${() => setExpanded(true)}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"></path></svg>
      Show full reply · ${hidden} earlier lines
    </button>
    <div class="ovm-chat-text terminal-chat-content">${rt(visible)}</div>
  `;
}

function FriendlyTerminalView({ target, sessionName, lineLimit, refreshTick, showRawChrome = false, isTui = false, onStatusChange, onLastUpdated, projectId, onReloadSessions }) {
  const [status, setStatus] = useState('loading');
  const [statusLine, setStatusLine] = useState('');
  const [entries, setEntries] = useState([]);
  const [input, setInput] = useState('');
  const draftViewer = 'friendly-terminal';
  const draftHydratedRef = useRef(false);
  // Persist draft on input change, but skip writes during initial hydration
  useEffect(() => {
    if (!draftHydratedRef.current) return;
    writeTerminalDraft(draftViewer, target, input);
  }, [input, target, draftViewer]);
  const [composerHeight, setComposerHeight] = useState(() => {
    try { const v = Number(localStorage.getItem('agj_terminal_composer_h')); return Number.isFinite(v) && v > 0 ? v : 0; } catch { return 0; }
  });
  const composerFieldRef = useRef(null);
  const composerHeightRef = useRef(0);
  const [sending, setSending] = useState(false);
  const [snapshot, setSnapshot] = useState('');
  const [lastCommand, setLastCommand] = useState('');
  const [lastUpdatedAt, setLastUpdatedAt] = useState(0);
  const [sendMode, setSendMode] = useState('command');
  const [attachments, setAttachments] = useState([]);
  const [attaching, setAttaching] = useState(false);
  const [attachError, setAttachError] = useState('');
  const [replyLimit, setReplyLimit] = useState(() => readTerminalReplyLimit());
  const [keyFlash, setKeyFlash] = useState(0);
  const [convFontSize, setConvFontSize] = useState(() => applyTerminalConvFontSize(readTerminalConvFontSize()));
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [unseenWhileUp, setUnseenWhileUp] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshDoneAt, setRefreshDoneAt] = useState(0);
  const [refreshError, setRefreshError] = useState('');
  // Chat search + jump-between-my-messages (additive, read-only over `entries`).
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchIdx, setSearchIdx] = useState(0);
  const [flashId, setFlashId] = useState(null);
  const searchInputRef = useRef(null);
  const searchMatchIds = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return entries
      .filter((e) => (e.role === 'user' || e.role === 'agent') && String(e.content ?? '').toLowerCase().includes(q))
      .map((e) => e.id);
  }, [entries, searchQuery]);
  const searchMatchSet = useMemo(() => new Set(searchMatchIds), [searchMatchIds]);
  const transcriptRef = useRef(null);
  const snapshotRef = useRef('');
  const sendingRef = useRef(false);
  const openAgentAfterYouRef = useRef(false);
  const sendBaselineRef = useRef('');
  const previousSnapshotRef = useRef('');
  const lastSentRef = useRef('');
  const fileInputRef = useRef(null);
  const pinToBottomRef = useRef(true);
  const entryCountRef = useRef(0);
  const wsRef = useRef(null);
  const wsLiveRef = useRef(false);
  const pollNowRef = useRef(null);
  const pendingNoteRef = useRef(null);
  const storageKey = 'agj_terminal_chat_' + target.replace(/[^a-zA-Z0-9_.-]/g, '_');

  function lastRoleIndex(list, role) {
    for (let i = list.length - 1; i >= 0; i -= 1) {
      if (list[i] && list[i].role === role) return i;
    }
    return -1;
  }

  // After YOU, the next cleaned snapshot must open a new AGENT. Never patch the pre-send agent.
  // First post-YOU body diffs the send-time baseline; later polls diff adjacent snapshots.
  function applyConversationSnapshot(prev, latest) {
    let list = Array.isArray(prev) ? prev : [];
    const lastUserIdx = lastRoleIndex(list, 'user');
    const lastAgentIdx = lastRoleIndex(list, 'agent');
    if (openAgentAfterYouRef.current) {
      if (lastUserIdx < 0 || lastUserIdx < lastAgentIdx) return list;
    }
    if (lastUserIdx >= 0 && lastSentRef.current) {
      const you = list[lastUserIdx];
      if (you && !you.sentContent && !you.sent) {
        list = list.slice();
        list[lastUserIdx] = { ...you, sentContent: lastSentRef.current, sent: lastSentRef.current };
      }
    }
    const openNew = lastAgentIdx < 0 || lastUserIdx > lastAgentIdx;
    const baselineAtSend = (openNew && sendBaselineRef.current) ? sendBaselineRef.current : undefined;
    const previousSnapshot = (!openNew && previousSnapshotRef.current) ? previousSnapshotRef.current : undefined;
    const next = applyAgentPatch(list, latest, { baselineAtSend, previousSnapshot });
    previousSnapshotRef.current = latest;
    if (openAgentAfterYouRef.current && lastRoleIndex(next, 'agent') > lastRoleIndex(next, 'user')) {
      openAgentAfterYouRef.current = false;
    }
    // Real turn boundary: post-YOU agent exists and C4 status is no longer busy.
    const status = extractStatus(latest);
    const busy = /drizzl|working|thinking|compacting|waiting for/i.test(status || '');
    if (!openNew && lastRoleIndex(next, 'agent') > lastRoleIndex(next, 'user') && !busy) {
      sendBaselineRef.current = '';
    }
    return next;
  }

  // Shared snapshot handler for the REST poll AND the WS change-trigger, so the
  // render path (dedup/minimize) is identical no matter what woke it.
  function processSnapshot(latest) {
    if (!latest) return;
    // Note delivery must be checked every poll — even when the pane is unchanged
    // (an idle agent produces a stable snapshot, which is exactly when to send).
    maybeFlushPendingNote(latest);
    if (latest === snapshotRef.current) return;
    snapshotRef.current = latest;
    setSnapshot(latest);
    setLastUpdatedAt(Date.now());
    setEntries(prev => applyConversationSnapshot(prev, latest));
    setStatusLine(extractStatus(latest));
  }

  function processRefreshSnapshot(latest) {
    if (!latest) return;
    maybeFlushPendingNote(latest);
    snapshotRef.current = latest;
    previousSnapshotRef.current = latest;
    setSnapshot(latest);
    setLastUpdatedAt(Date.now());
    setStatusLine(extractStatus(latest));
    openAgentAfterYouRef.current = false;
    sendBaselineRef.current = '';
    setEntries(prev => {
      const list = Array.isArray(prev) ? prev : [];
      const lastUser = lastRoleIndex(list, 'user');
      const lastAgent = lastRoleIndex(list, 'agent');
      // Settled exchange (last turn is an agent reply): keep it and let
      // applyAgentPatch/_reconcileMovedOnPane patch it to the live pane content, so
      // a queued composer echo (a reminder sitting unsent above fresh output) does
      // not wipe the reply on refresh. Only a mid-send (last=user) rebuilds fresh.
      if (lastAgent >= 0 && lastAgent >= lastUser) return applyAgentPatch(list, latest);
      const kept = lastUser >= 0 ? list.slice(0, lastUser + 1) : [];
      return applyAgentPatch(kept, latest);
    });
  }

  // A note attached to a selection can only be delivered once the agent is idle
  // again (typing into a busy composer doesn't submit). Hold it until the prompt
  // is gone and the agent isn't generating — after we've seen it busy, or a
  // timeout for instant replies. Give up after a while so it can't leak.
  function maybeFlushPendingNote(latest) {
    const p = pendingNoteRef.current;
    if (!p) return;
    const now = Date.now();
    if (now > p.expireAt) { pendingNoteRef.current = null; return; }
    // Deliver as soon as the selection prompt has closed (plus a small settle).
    // Do NOT wait for idle — the agent may stay busy indefinitely; Claude queues
    // a message typed while it's working, so a busy agent still receives it.
    if (detectSelectionPrompt(latest)) return;
    if (now < p.readyAt) return;
    pendingNoteRef.current = null;
    (async () => {
      try {
        // Type the note, then a separated Enter so it submits (or queues, if the
        // agent is busy) — a trailing Enter in the same send races the text.
        await api(`/api/tmux/panes/${encodeURIComponent(target)}/send`, {
          method: 'POST', body: JSON.stringify({ command: p.note, enter: false }),
        });
        await new Promise((r) => setTimeout(r, 400));
        await api(`/api/tmux/panes/${encodeURIComponent(target)}/send`, {
          method: 'POST', body: JSON.stringify({ send_enter_only: true }),
        });
      } catch {}
      setTimeout(() => { pollNowRef.current && pollNowRef.current(); }, 300);
    })();
  }

  // On-demand fetch of the proven 2000-line snapshot (same source the interval
  // uses) — called right after a keypress and when the WS says the pane changed,
  // so the chat reflects the result within a fetch instead of the poll interval.
  async function pollNow() {
    if (sendingRef.current) return;
    try {
      const data = await api(`/api/tmux/panes/${encodeURIComponent(target)}/output?lines=${getCaptureLines()}`);
      processSnapshot(normalizeTerminalOutput(data.output));
    } catch {}
  }
  pollNowRef.current = pollNow;

  async function refreshOutput() {
    const data = await api(`/api/tmux/panes/${encodeURIComponent(target)}/output?lines=${getCaptureLines()}&refresh=1`);
    processRefreshSnapshot(normalizeTerminalOutput(data.output));
  }

  async function handleRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshError('');
    try {
      await Promise.all([
        onReloadSessions ? onReloadSessions({ refreshFriendly: false }) : Promise.resolve(),
        refreshOutput()
      ]);
      setRefreshDoneAt(Date.now());
    } catch (e) {
      setRefreshError(e.message || 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  }

  // Send named control keys to the pane over plain REST (/keys). Works over the
  // tunnel like every other API call — no WebSocket dependency — then refresh so
  // the effect shows quickly. Accepts a single key name or an array (a sequence).
  async function sendKeys(keys) {
    const arr = (Array.isArray(keys) ? keys : [keys]).filter(Boolean);
    if (!arr.length) return false;
    setKeyFlash(Date.now());
    setTimeout(() => setKeyFlash(0), 900);
    try {
      await api(`/api/tmux/panes/${encodeURIComponent(target)}/keys`, {
        method: 'POST',
        body: JSON.stringify({ keys: arr }),
      });
    } catch {
      return false;
    }
    setTimeout(() => { pollNowRef.current && pollNowRef.current(); }, 120);
    setTimeout(() => { pollNowRef.current && pollNowRef.current(); }, 450);
    return true;
  }

  // Drive a parsed selection: move the cursor to option `idx` (0-based) and Enter.
  // Prefer relative navigation when the ❯ cursor position is known; otherwise
  // clamp to the top (Up × count) then step down — deterministic without wrap.
  // Navigation keys to move the cursor from its current position to option `idx`.
  function _navToOption(selection, idx) {
    const seq = [];
    if (selection.selectedIndex >= 0) {
      const delta = idx - selection.selectedIndex;
      for (let i = 0; i < Math.abs(delta); i++) seq.push(delta >= 0 ? TERM_KEYS.down : TERM_KEYS.up);
    } else {
      for (let i = 0; i < selection.options.length; i++) seq.push(TERM_KEYS.up);
      for (let i = 0; i < idx; i++) seq.push(TERM_KEYS.down);
    }
    return seq;
  }

  function _deliverPendingNote() {
    const note = sanitizeOutgoingCommand(input || '').trim();
    if (!note) return;
    setInput('');
    const now = Date.now();
    pendingNoteRef.current = { note, readyAt: now + 1500, expireAt: now + 60000 };
    setTimeout(() => { pollNowRef.current && pollNowRef.current(); }, 1600);
  }

  // Multi-select: tap an option to TOGGLE it (Space) and keep the card open so
  // several can be toggled; the pane re-renders each poll so the checkbox state
  // updates. Submit them all with the Submit button (or the ⏎ control key).
  async function toggleSelectionOption(selection, idx) {
    if (!selection || idx < 0 || idx >= selection.options.length) return;
    const seq = _navToOption(selection, idx);
    seq.push(TERM_KEYS.space);
    await sendKeys(seq);
    setTimeout(() => { pollNowRef.current && pollNowRef.current(); }, 250);
  }

  // Submit the current selection (Enter) — used by the multi-select Submit button.
  async function submitSelection(selection) {
    if (selection) {
      const sig = selection.options.map((o) => o.n + ':' + o.label).join('|');
      setDismissedSel(sig);
      setTimeout(() => setDismissedSel((prev) => (prev === sig ? '' : prev)), 3000);
    }
    await sendKeys(TERM_KEYS.enter);
    _deliverPendingNote();
  }

  // Single-select: tap an option to pick + submit it (navigate + Enter). Hides
  // the card immediately; un-hides after 3s if the tap didn't take (retry).
  async function chooseSelectionOption(selection, idx) {
    if (!selection || idx < 0 || idx >= selection.options.length) return;
    const sig = selection.options.map((o) => o.n + ':' + o.label).join('|');
    setDismissedSel(sig);
    setTimeout(() => setDismissedSel((prev) => (prev === sig ? '' : prev)), 3000);
    const seq = _navToOption(selection, idx);
    seq.push(TERM_KEYS.enter);
    await sendKeys(seq);
    _deliverPendingNote();
  }

  function syncConvFontFromStorage() {
    const next = applyTerminalConvFontSize(readTerminalConvFontSize());
    setConvFontSize(next);
    return next;
  }

  useEffect(() => {
    syncConvFontFromStorage();
    const onStorage = (event) => {
      if (event.key && event.key !== TERMINAL_CONV_FONT_STORAGE_KEY) return;
      syncConvFontFromStorage();
    };
    const onSameTab = () => syncConvFontFromStorage();
    window.addEventListener('storage', onStorage);
    window.addEventListener('agj-terminal-conv-font', onSameTab);
    window.addEventListener('hashchange', onSameTab);
    document.addEventListener('visibilitychange', onSameTab);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('agj-terminal-conv-font', onSameTab);
      window.removeEventListener('hashchange', onSameTab);
      document.removeEventListener('visibilitychange', onSameTab);
    };
  }, []);

  useEffect(() => {
    const sync = () => setReplyLimit(readTerminalReplyLimit());
    const onStorage = (event) => {
      if (event.key && event.key !== TERMINAL_REPLY_LIMIT_STORAGE_KEY) return;
      sync();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('agj-terminal-reply-limit', sync);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('agj-terminal-reply-limit', sync);
    };
  }, []);

  function getCaptureLines() {
    // peekPane clamps at 2000. Request that bound so a ❯ user run stays in-window
    // past the old 800-row poll, without pulling full scrollback (capturePane 5000).
    // Friendly extraction depth is independent of the UI "Lines captured" picker.
    return 2000;
  }

  function conversationSeed(savedState) {
    const saved = Array.isArray(savedState?.entries) ? savedState.entries : [];
    return saved.filter((entry) => entry && (entry.role === 'user' || entry.role === 'agent'));
  }

  useEffect(() => {
    if (onStatusChange) onStatusChange(status);
    if (onLastUpdated) onLastUpdated(lastUpdatedAt);
  }, [status, lastUpdatedAt, onStatusChange, onLastUpdated]);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    sendingRef.current = sending;
  }, [sending]);

  useEffect(() => {
    let active = true;

    async function loadInitial() {
      setStatus('loading');
      draftHydratedRef.current = false;
      const draft = readTerminalDraft(draftViewer, target);
      setInput(draft ?? '');
      draftHydratedRef.current = true;
      setAttachments([]);
      setAttachError('');
      setEntries([]);
      setSnapshot('');
      setStatusLine('');
      snapshotRef.current = '';
      sendBaselineRef.current = '';
      previousSnapshotRef.current = '';
      openAgentAfterYouRef.current = false;
      lastSentRef.current = '';
      pinToBottomRef.current = true;
      entryCountRef.current = 0;
      setShowScrollBottom(false);
      setUnseenWhileUp(0);
      let savedState = null;
      try {
        savedState = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
      } catch {}
      // Persistent recent-message memory (localStorage) survives app reopens and
      // is preferred as the on-open seed; sessionStorage is the within-session fallback.
      const memoryState = readTerminalMemory(target);
      const seedState = memoryState || savedState;
      try {
        const data = await api(`/api/tmux/panes/${encodeURIComponent(target)}/output?lines=${getCaptureLines()}`);
        if (!active) return;
        const output = normalizeTerminalOutput(data.output);
        const nextEntries = applyAgentPatch(conversationSeed(seedState), output);
        setSnapshot(output);
        snapshotRef.current = output;
        previousSnapshotRef.current = output;
        setEntries(nextEntries);
        setStatusLine(extractStatus(output));
        setLastCommand(savedState?.lastCommand || '');
        setLastUpdatedAt(Date.now());
        if (onLastUpdated) onLastUpdated(Date.now());
        setStatus('connected');
      } catch (e) {
        if (!active) return;
        setStatus('error');
        const savedEntries = conversationSeed(seedState);
        if (savedEntries.length) {
          const savedSnapshot = normalizeTerminalOutput(savedState?.snapshot || '');
          setSnapshot(savedSnapshot);
          snapshotRef.current = savedSnapshot;
          setEntries(savedEntries);
          setStatusLine(extractStatus(savedSnapshot));
          setLastCommand(savedState?.lastCommand || '');
          setLastUpdatedAt(savedState?.updatedAt || 0);
        } else {
          setEntries([{
            id: 'initial-error',
            role: 'error',
            label: 'Connection error',
            content: e.message || 'Failed to load terminal output.',
            timestamp: new Date().toLocaleTimeString()
          }]);
        }
      }
    }

    loadInitial();

    return () => {
      active = false;
    };
  }, [target, sessionName, storageKey, lineLimit, refreshTick]);

  useEffect(() => {
    let active = true;
    const refreshTimer = setInterval(async () => {
      if (!active || sendingRef.current) return;
      try {
        const data = await api(`/api/tmux/panes/${encodeURIComponent(target)}/output?lines=${getCaptureLines()}`);
        if (!active) return;
        processSnapshot(normalizeTerminalOutput(data.output));
      } catch {}
    }, 1000);

    return () => {
      active = false;
      clearInterval(refreshTimer);
    };
  }, [target]);

  // Live tmux WebSocket: used to SEND raw keys (control bar + selection) and as a
  // change-trigger — when the pane changes, refresh the 2000-line snapshot at once
  // so tapping a choice/key updates the chat live. Render source stays the proven
  // REST poll to avoid any capture-depth mismatch with the WS buffer.
  useEffect(() => {
    if (!target) return undefined;
    let closed = false;
    let debounce = null;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${location.host}/ws/tmux/${encodeURIComponent(target)}?token=${encodeURIComponent(authToken || '')}`;
    let ws;
    try {
      ws = new WebSocket(url);
    } catch {
      return undefined;
    }
    wsRef.current = ws;
    ws.onopen = () => { if (!closed) wsLiveRef.current = true; };
    ws.onclose = () => { wsLiveRef.current = false; if (wsRef.current === ws) wsRef.current = null; };
    ws.onerror = () => { wsLiveRef.current = false; };
    ws.onmessage = (e) => {
      if (closed || sendingRef.current) return;
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.type === 'snapshot' || msg.type === 'output') {
        if (debounce) return;
        debounce = setTimeout(() => { debounce = null; pollNowRef.current && pollNowRef.current(); }, 100);
      }
    };
    return () => {
      closed = true;
      wsLiveRef.current = false;
      if (debounce) clearTimeout(debounce);
      try { ws.close(); } catch {}
      if (wsRef.current === ws) wsRef.current = null;
    };
  }, [target]);

  useEffect(() => {
    if (status === 'loading') return;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({
        entries,
        snapshot,
        lastCommand,
        updatedAt: Date.now()
      }));
    } catch {}
    // Persist the rolling recent-message memory (last 10 exchanges) so it
    // survives app reopens; trimming + reply-capping happen in the writer.
    writeTerminalMemory(target, entries);
  }, [entries, snapshot, lastCommand, storageKey, status, target]);

  async function captureCommandResult(beforeSnapshot) {
    let latest = beforeSnapshot;
    let changed = false;
    let stableReads = 0;

    for (let i = 0; i < 8; i += 1) {
      await sleep(i === 0 ? 250 : 450);
      const data = await api(`/api/tmux/panes/${encodeURIComponent(target)}/output?lines=${getCaptureLines()}`);
      const current = normalizeTerminalOutput(data.output);
      if (current !== latest) {
        latest = current;
        changed = true;
        stableReads = 0;
        continue;
      }
      if (changed) {
        stableReads += 1;
        if (stableReads >= 2) break;
      }
    }

    return {
      snapshot: latest,
      output: diffTerminalOutput(beforeSnapshot, latest)
    };
  }

  // Deliver a message to the pane. On failure the YOU bubble (youId) is marked
  // `failed` with the exact text/attachment needed to resend — it persists via the
  // recent-message memory, so a message that didn't go through is never silently
  // lost when you leave the session; you can see it and one-tap resend.
  async function performSend(command, youId, attachmentPaths = []) {
    const sentText = sanitizeOutgoingCommand(command).trim();
    if (!sentText) return;
    const beforeSnapshot = snapshotRef.current;
    sendingRef.current = true;
    openAgentAfterYouRef.current = true;
    sendBaselineRef.current = beforeSnapshot;
    lastSentRef.current = sentText;
    pinToBottomRef.current = true;
    setShowScrollBottom(false);
    setUnseenWhileUp(0);
    setSending(true);
    setStatus('running');
    setLastCommand(sentText);
    try {
      // Clear the input first (Ctrl-U) when this looks like an OAuth login code:
      // after a rejected code + retry, claude's "Paste code here" field keeps
      // residual content, so a plain send appends to junk and never submits.
      const atLoginPrompt = /paste code here|oauth\/authorize\?code|browser didn'?t open/i.test(beforeSnapshot || '');
      const looksLikeCode = /^[^\s]{30,}$/.test(sentText);
      const clearFirst = atLoginPrompt || looksLikeCode;
      await api(`/api/tmux/panes/${encodeURIComponent(target)}/send`, {
        method: 'POST',
        body: JSON.stringify({ command: sentText, enter: true, clear_first: clearFirst })
      });
      const result = await captureCommandResult(beforeSnapshot);
      const nextSnapshot = normalizeTerminalOutput(result.snapshot);
      snapshotRef.current = nextSnapshot;
      setSnapshot(nextSnapshot);
      setLastUpdatedAt(Date.now());
      setEntries(prev => applyConversationSnapshot(prev, nextSnapshot));
      setStatusLine(extractStatus(nextSnapshot));
      setStatus('connected');
    } catch (e) {
      // Mark the YOU bubble as not-delivered + attach resend data (persists).
      setEntries(prev => prev.map(entry => entry.id === youId
        ? { ...entry, failed: true, retrying: false, resendText: command, resendAttachmentPaths: attachmentPaths, failReason: e.message || 'Not sent' }
        : entry));
      setStatus('error');
    }
    sendingRef.current = false;
    setSending(false);
  }

  async function sendCommand() {
    const text = input.trim();
    const imageRefs = attachments.map((item) => `[image: ${item.path}]`).join(' ');
    const command = text && imageRefs ? `${text} ${imageRefs}` : (text || imageRefs);
    if (!command || sending) return;

    const sentText = sanitizeOutgoingCommand(command).trim();
    if (!sentText) {
      setEntries(prev => [...prev, {
        id: 'err-empty-' + Date.now(),
        role: 'error',
        label: 'Invalid input',
        content: 'Command is empty after removing control characters.',
        timestamp: new Date().toLocaleTimeString()
      }]);
      return;
    }

    const now = Date.now();
    const youId = 'you-' + now;
    const attachmentPaths = attachments.map((item) => item.path);
    setInput('');
    clearTerminalDraft(draftViewer, target);
    setAttachments([]);
    setAttachError('');
    setEntries(prev => appendYou(prev, command, { now, sentContent: sentText }));
    await performSend(command, youId, attachmentPaths);
  }

  // One-tap resend of a message that failed to send.
  async function resendFailed(entry) {
    if (sending || !entry || !entry.resendText) return;
    setEntries(prev => prev.map(e => e.id === entry.id ? { ...e, failed: false, retrying: true } : e));
    await performSend(entry.resendText, entry.id, entry.resendAttachmentPaths || []);
  }

  async function sendManualEnter() {
    if (sending) return;

    const beforeSnapshot = snapshotRef.current;
    sendingRef.current = true;
    setSending(true);
    setStatus('running');

    try {
      await api(`/api/tmux/panes/${encodeURIComponent(target)}/send`, {
        method: 'POST',
        body: JSON.stringify({ send_enter_only: true })
      });
      const result = await captureCommandResult(beforeSnapshot);
      const nextSnapshot = normalizeTerminalOutput(result.snapshot);
      snapshotRef.current = nextSnapshot;
      setSnapshot(nextSnapshot);
      setLastUpdatedAt(Date.now());
      setEntries(prev => applyConversationSnapshot(prev, nextSnapshot));
      setStatusLine(extractStatus(nextSnapshot));
      setStatus('connected');
    } catch (e) {
      setEntries(prev => [...prev, {
        id: 'err-enter-' + Date.now(),
        role: 'error',
        label: 'Enter failed',
        content: e.message || 'Failed to send Enter.',
        timestamp: new Date().toLocaleTimeString()
      }]);
      setStatus('error');
    }

    sendingRef.current = false;
    setSending(false);
  }

  const rawChrome = showRawChrome ? extractStrippedChromeLines(snapshot) : '';
  // Raw fallback: the friendly parser is built for Claude Code's line-based output.
  // A full-screen TUI CLI (e.g. grok, codex TUIs on the alternate screen — isTui)
  // produces no parseable agent turns, so the transcript would show the user's
  // messages but never the agent's reply (blank). For a TUI pane we always render
  // the ANSI-stripped live screen; for any other pane we show it only when nothing
  // parsed at all. Updates live as `snapshot` polls.
  const hasAgentContent = entries.some((e) => e.role === 'agent' && String(e.content || '').trim());
  const hasChatContent = entries.some((e) => (e.role === 'agent' || e.role === 'user') && String(e.content || '').trim());
  const rawFallback = (isTui ? !hasAgentContent : !hasChatContent) && !rawChrome ? stripAnsiPlain(snapshot) : '';
  const statusBusy = /drizzl|working|thinking|running/i.test(statusLine || '');
  const selection = useMemo(() => detectSelectionPrompt(snapshot), [snapshot]);
  // Instant-dismiss: hide the card the moment an option is tapped (before the
  // pane poll catches up), keyed by the option set so a genuinely NEW prompt
  // still shows. Reset when the prompt resolves so the same question can reappear.
  const [dismissedSel, setDismissedSel] = useState('');
  const selectionSig = selection ? selection.options.map((o) => o.n + ':' + o.label).join('|') : '';
  useEffect(() => { if (!selection) setDismissedSel(''); }, [selection]);
  const showSelection = selection && selectionSig !== dismissedSel;

  function handleComposerInput(event) {
    setInput(event.target.value);
    const field = event.target;
    // If the user set a manual height by dragging, keep it (scroll inside);
    // otherwise auto-grow up to 120px.
    if (composerHeightRef.current) {
      field.style.height = composerHeightRef.current + 'px';
      return;
    }
    field.style.height = 'auto';
    field.style.height = Math.min(field.scrollHeight, 120) + 'px';
  }

  // Draggable composer resize: drag the grip up to make the input taller, down to
  // shrink; persisted per-device. composerHeight 0 = auto-grow (default).
  useEffect(() => {
    composerHeightRef.current = composerHeight;
    const field = composerFieldRef.current;
    if (field && composerHeight) field.style.height = composerHeight + 'px';
  }, [composerHeight]);

  function startComposerResize(e) {
    e.preventDefault();
    const field = composerFieldRef.current;
    const startY = e.clientY != null ? e.clientY : (e.touches && e.touches[0] ? e.touches[0].clientY : 0);
    const startH = composerHeightRef.current || (field ? field.clientHeight : 44) || 44;
    const maxH = Math.round((window.innerHeight || 800) * 0.6);
    const move = (ev) => {
      const y = ev.clientY != null ? ev.clientY : (ev.touches && ev.touches[0] ? ev.touches[0].clientY : startY);
      const next = Math.max(40, Math.min(maxH, Math.round(startH + (startY - y))));
      composerHeightRef.current = next;
      setComposerHeight(next);
      if (field) field.style.height = next + 'px';
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      try { localStorage.setItem('agj_terminal_composer_h', String(composerHeightRef.current || 0)); } catch {}
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function resetComposerHeight() {
    composerHeightRef.current = 0;
    setComposerHeight(0);
    const field = composerFieldRef.current;
    if (field) { field.style.height = 'auto'; field.style.height = Math.min(field.scrollHeight, 120) + 'px'; }
    try { localStorage.setItem('agj_terminal_composer_h', '0'); } catch {}
  }

  // One-tap small/large input toggle (in addition to the drag grip). Small =
  // auto-grow (0); large = a comfortable fixed height for long messages.
  const COMPOSER_LARGE_H = 200;
  function toggleComposerSize() {
    const next = composerHeightRef.current ? 0 : COMPOSER_LARGE_H;
    composerHeightRef.current = next;
    setComposerHeight(next);
    const field = composerFieldRef.current;
    if (field) {
      if (next) field.style.height = next + 'px';
      else { field.style.height = 'auto'; field.style.height = Math.min(field.scrollHeight, 120) + 'px'; }
    }
    try { localStorage.setItem('agj_terminal_composer_h', String(next)); } catch {}
  }

  function openAttachPicker() {
    if (sending || attaching) return;
    setAttachError('');
    fileInputRef.current?.click();
  }

  function removeAttachment(index) {
    setAttachments(prev => prev.filter((_, currentIndex) => currentIndex !== index));
    setAttachError('');
  }

  async function uploadAttachedImage(file, filename) {
    const name = filename || file.name;
    const ext = (name.split('.').pop() || '').toLowerCase();
    if (!['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext) && !(file.type || '').startsWith('image/')) {
      setAttachError('Choose a png, jpg, jpeg, gif, or webp image.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setAttachError('Image exceeds 10MB limit.');
      return;
    }

    setAttaching(true);
    setAttachError('');
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Failed to read image.'));
        reader.readAsDataURL(file);
      });
      const dataBase64 = dataUrl.replace(/^data:[^,]+,/, '');
      const body = { filename: name, dataBase64 };
      if (projectId) body.project_id = Number(projectId);
      const result = await api('/api/tmux/attach-image', {
        method: 'POST',
        body: JSON.stringify(body),
        timeout: 60000
      });
      if (!result?.ok || !result.path) {
        throw new Error('Upload did not return a path.');
      }
      setAttachments(prev => [...prev, { path: result.path, preview: dataUrl, name }]);
    } catch (e) {
      setAttachError(e.message || 'Failed to attach image.');
    }
    setAttaching(false);
  }

  async function handleAttachFile(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length || sending || attaching) return;
    for (const file of files) await uploadAttachedImage(file);
  }

  function handleComposerPaste(event) {
    const items = event.clipboardData && event.clipboardData.items;
    if (!items) return;
    let imageItem = null;
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (item && String(item.type || '').startsWith('image/')) {
        imageItem = item;
        break;
      }
    }
    if (!imageItem) return;
    event.preventDefault();
    if (sending || attaching) return;
    const file = imageItem.getAsFile();
    if (!file) return;
    const filename = 'pasted-' + new Date().toISOString().replace(/[-:.]/g, '') + '.png';
    uploadAttachedImage(file, filename);
  }

  function isTranscriptNearBottom(node) {
    if (!node) return true;
    return node.scrollHeight - node.scrollTop - node.clientHeight < 80;
  }

  function updateScrollBottomButton() {
    const node = transcriptRef.current;
    if (!node) return;
    const near = isTranscriptNearBottom(node);
    pinToBottomRef.current = near;
    const canScroll = node.scrollHeight > node.clientHeight + 4;
    setShowScrollBottom(canScroll && !near);
    if (near) setUnseenWhileUp(0);
  }

  function scrollTranscriptToBottom() {
    const node = transcriptRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' });
    pinToBottomRef.current = true;
    setShowScrollBottom(false);
    setUnseenWhileUp(0);
  }

  function scrollToTurn(id) {
    if (id == null) return;
    const node = transcriptRef.current;
    if (!node) return;
    const sel = '[data-turn-id="' + String(id).replace(/["\\]/g, '\\$&') + '"]';
    const el = node.querySelector(sel);
    if (!el) return;
    pinToBottomRef.current = false;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setFlashId(id);
    setTimeout(() => setFlashId((cur) => (cur === id ? null : cur)), 700);
  }
  function gotoSearchMatch(idx) {
    if (!searchMatchIds.length) return;
    const n = ((idx % searchMatchIds.length) + searchMatchIds.length) % searchMatchIds.length;
    setSearchIdx(n);
    scrollToTurn(searchMatchIds[n]);
  }
  function closeSearch() {
    setSearchOpen(false);
    setSearchQuery('');
    setSearchIdx(0);
  }
  // When the query changes, reset to the first match and scroll to it.
  useEffect(() => {
    setSearchIdx(0);
    if (searchOpen && searchQuery.trim() && searchMatchIds.length) {
      const id = searchMatchIds[0];
      requestAnimationFrame(() => scrollToTurn(id));
    }
  }, [searchQuery, searchOpen]);

  useEffect(() => {
    const node = transcriptRef.current;
    if (!node) return;
    const onScroll = () => updateScrollBottomButton();
    node.addEventListener('scroll', onScroll, { passive: true });
    updateScrollBottomButton();
    return () => node.removeEventListener('scroll', onScroll);
  }, [target]);

  useEffect(() => {
    const node = transcriptRef.current;
    if (!node) return;
    const prevCount = entryCountRef.current;
    const grew = entries.length > prevCount;
    entryCountRef.current = entries.length;
    if (pinToBottomRef.current) {
      node.scrollTop = node.scrollHeight;
      setShowScrollBottom(false);
      setUnseenWhileUp(0);
    } else if (grew) {
      setUnseenWhileUp((n) => n + (entries.length - prevCount));
      updateScrollBottomButton();
    }
  }, [entries, sending, statusLine]);

  function renderRefreshControl() {
    const refreshStatus = refreshing ? 'Refreshing' : refreshError ? 'Error' : refreshDoneAt ? 'Updated' : '';
    return html`
      <button type="button" class="terminal-refresh-btn" data-testid="terminal-refresh" aria-label="Refresh terminal" aria-busy=${refreshing} disabled=${refreshing} onclick=${handleRefresh}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M23 4v6h-6"></path><path d="M1 20v-6h6"></path><path d="M3.51 9a9 9 0 0 1 14.13-3.36L23 10"></path><path d="M1 14a9 9 0 0 0 14.13 3.36L23 14"></path></svg>
      </button>
      <span aria-live="polite" class="terminal-refresh-status" data-testid="terminal-refresh-status">${refreshStatus}</span>
    `;
  }

  return html`
    <div class="terminal-chat-view">
      <div class="terminal-chat-transcript-wrap">
      ${searchOpen ? html`
        <div class="terminal-search-bar" data-testid="terminal-search-bar">
          <svg class="terminal-search-glass" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="M21 21l-4.3-4.3"></path></svg>
          <input class="terminal-search-input" data-testid="terminal-search-input" ref=${searchInputRef}
                 type="text" placeholder="Search this chat…" value=${searchQuery} autofocus
                 oninput=${(e) => setSearchQuery(e.target.value)}
                 onkeydown=${(e) => {
                   if (e.key === 'Enter') { e.preventDefault(); gotoSearchMatch(searchIdx + (e.shiftKey ? -1 : 1)); }
                   else if (e.key === 'Escape') { e.preventDefault(); closeSearch(); }
                 }} />
          <span class="terminal-search-count" data-testid="terminal-search-count">${searchMatchIds.length ? (searchIdx + 1) + '/' + searchMatchIds.length : '0/0'}</span>
          <button type="button" class="terminal-search-btn" data-testid="terminal-search-prev" aria-label="Previous match"
                  disabled=${!searchMatchIds.length} onclick=${() => gotoSearchMatch(searchIdx - 1)}>▲</button>
          <button type="button" class="terminal-search-btn" data-testid="terminal-search-next" aria-label="Next match"
                  disabled=${!searchMatchIds.length} onclick=${() => gotoSearchMatch(searchIdx + 1)}>▼</button>
          <button type="button" class="terminal-search-btn terminal-search-close" data-testid="terminal-search-close" aria-label="Close search"
                  onclick=${closeSearch}>✕</button>
          ${renderRefreshControl()}
        </div>
      ` : html`
        <div class="terminal-chat-topbar">
          <button type="button" class="terminal-search-toggle" data-testid="terminal-search-toggle" aria-label="Search chat"
                  onclick=${() => setSearchOpen(true)}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="M21 21l-4.3-4.3"></path></svg>
          </button>
          ${renderRefreshControl()}
        </div>
      `}
      <div class="terminal-chat-transcript" data-testid="terminal-conversation" ref=${transcriptRef}>
        <div class="terminal-chat-daydiv">Today</div>
        ${rawChrome ? html`
          <div class="terminal-chat-raw" data-testid="terminal-raw-chrome" data-raw-chrome>
            <pre>${rawChrome}</pre>
          </div>` : ''}
        ${entries.map((entry) => {
          if (entry.role === 'agent' || entry.role === 'user') {
            const isUser = entry.role === 'user';
            return html`
              <div key=${entry.id}
                   class=${'ovm-chat-row ' + (isUser ? 'ovm-chat-row-user' : 'ovm-chat-row-ovm') + ' terminal-chat-entry ' + (isUser ? 'terminal-chat-entry-user' : 'terminal-chat-entry-agent') + (isUser && entry.failed ? ' failed' : '') + (searchMatchSet.has(entry.id) ? ' terminal-chat-hit' : '') + (searchMatchIds[searchIdx] === entry.id ? ' terminal-chat-hit-current' : '') + (flashId === entry.id ? ' terminal-chat-focus-flash' : '')}
                   data-testid=${isUser ? 'terminal-turn-user' : 'terminal-turn-agent'}
                   data-turn-id=${entry.id}>
                <div class=${'terminal-chat-who' + (isUser ? ' user' : '')}>
                  ${isUser
                    ? html`<span data-testid="terminal-turn-time">${entry.timestamp}</span><span class="terminal-chat-badge">YOU</span>`
                    : html`<span class="terminal-chat-badge">AGENT</span><span>${sessionName || 'Agent'} · <span data-testid="terminal-turn-time">${entry.timestamp}</span></span>`}
                </div>
                <div class=${'ovm-chat-bubble terminal-chat-bubble ' + (isUser ? 'ovm-chat-bubble-user' : 'ovm-chat-bubble-ovm') + (isUser && entry.failed ? ' failed' : '')}>
                  <${CollapsibleBubbleContent} content=${entry.content} role=${entry.role} limit=${replyLimit} query=${searchOpen && searchQuery.trim() ? searchQuery : ''} />
                </div>
                ${isUser && entry.failed ? html`
                  <div class="terminal-chat-failed" data-testid="terminal-turn-failed">
                    <span class="terminal-chat-failed-msg">⚠ Not sent${entry.failReason ? ' · ' + entry.failReason.replace(/\.$/, '') : ''}</span>
                    <button type="button" class="terminal-chat-resend" data-testid="terminal-resend"
                            onclick=${() => resendFailed(entry)} disabled=${sending}>↻ Resend</button>
                  </div>
                ` : (isUser && entry.retrying ? html`<div class="terminal-chat-failed"><span class="terminal-chat-failed-msg">↻ Resending…</span></div>` : '')}
              </div>
            `;
          }
          return html`
            <div key=${entry.id} class="ovm-chat-row ovm-chat-row-system terminal-chat-entry terminal-chat-entry-${entry.role}">
              <div class="ovm-chat-pill">${entry.content}</div>
            </div>
          `;
        })}
        ${rawFallback ? html`
          <div class="terminal-chat-rawfull" data-testid="terminal-raw-fallback" data-raw-fallback>
            <div class="terminal-chat-rawfull-head">
              <span class="terminal-chat-rawfull-label">Live terminal (raw)</span>
              ${isTui ? html`
                <div class="terminal-chat-rawfull-scroll" role="group" aria-label="Scroll the terminal">
                  <button type="button" title="Scroll up" aria-label="Scroll up" data-testid="raw-scroll-up"
                          onclick=${() => sendKeys(TERM_KEYS.pageUp)}>▲</button>
                  <button type="button" title="Scroll down" aria-label="Scroll down" data-testid="raw-scroll-down"
                          onclick=${() => sendKeys(TERM_KEYS.pageDown)}>▼</button>
                  <button type="button" title="Jump to latest" aria-label="Jump to latest" data-testid="raw-scroll-latest"
                          onclick=${() => sendKeys(Array(20).fill(TERM_KEYS.pageDown))}>⤓</button>
                </div>` : ''}
            </div>
            <pre>${rawFallback}</pre>
          </div>` : ''}
        <div class=${'terminal-chat-status' + (statusBusy ? ' busy' : '') + (!statusLine ? ' empty' : '')} data-testid="terminal-status">
          ${statusBusy ? html`<span class="terminal-chat-pulse"></span>` : ''}
          ${statusLine}
        </div>
        ${sending && html`
          <div class="terminal-chat-inline-status">
            <div class="typing-dots">
              <span class="typing-dot"></span>
              <span class="typing-dot"></span>
              <span class="typing-dot"></span>
            </div>
          </div>
        `}
      </div>
      ${showScrollBottom ? html`
        <button type="button"
                class="terminal-scroll-bottom"
                data-testid="terminal-scroll-bottom"
                aria-label="Scroll to bottom"
                onclick=${scrollTranscriptToBottom}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M6 9l6 6 6-6"></path>
          </svg>
          ${unseenWhileUp > 0 ? html`<span class="terminal-scroll-bottom-dot"></span>` : ''}
        </button>
      ` : ''}
      </div>

      ${showSelection ? html`
        <div class="terminal-selection-backdrop" data-testid="terminal-selection-backdrop">
        <div class=${'terminal-selection terminal-selection-modal' + (selection.multi ? ' multi' : '')} data-testid="terminal-selection" role="dialog" aria-modal="true">
          <div class="terminal-selection-head">
            <span class="terminal-selection-dot"></span>
            <span class="terminal-selection-title" data-testid="terminal-selection-title">${selection.question || selection.title || 'Claude is asking'}</span>
            <button type="button" class="terminal-selection-close" data-testid="terminal-selection-close" aria-label="Close" onclick=${() => setDismissedSel(selectionSig)}>✕</button>
          </div>
          <div class="terminal-selection-opts">
            ${selection.options.map((opt, i) => {
              // In multi-select the checkbox state is carried in the label ([✓]/[ ]
              // or ☑/☐); show it as a checked pill and toggle on tap.
              const checked = /\[[x✓]\]|☑|☒|◉|●/u.test(opt.label);
              const label = selection.multi ? opt.label.replace(/^\s*(\[[ x✓]\]|☑|☒|☐|◉|○|●)\s*/u, '') : opt.label;
              const isCurrent = !selection.multi && selection.selectedIndex === i;
              const isType = /type\s+(something|a\b|your|here|it|in)|write\s+your\s+own|custom\s+answer|^other\b/i.test(label);
              return html`
                <button type="button" class=${'terminal-selection-opt' + (selection.multi && checked ? ' checked' : '') + (isCurrent ? ' current' : '')}
                        data-testid="terminal-selection-opt"
                        onclick=${() => (selection.multi ? toggleSelectionOption(selection, i) : chooseSelectionOption(selection, i))}>
                  ${selection.multi
                    ? html`<span class="terminal-selection-check">${checked ? '☑' : '☐'}</span>`
                    : html`<span class="terminal-selection-num">${opt.n}</span>`}
                  <span class="terminal-selection-optbody">
                    <span class="terminal-selection-optlabel">${label}</span>
                    ${opt.description ? html`<span class="terminal-selection-optdesc">${opt.description}</span>` : ''}
                    ${isType ? html`<span class="terminal-selection-optdesc terminal-selection-typehint" data-testid="terminal-selection-typehint">Pick this, then type your reply in the box below and send — it goes to the agent as your answer.</span>` : ''}
                  </span>
                </button>
              `;
            })}
          </div>
          ${selection.multi ? html`
            <div class="terminal-selection-multibar">
              <span class="terminal-selection-hint">Tap to toggle, then Submit</span>
              <button type="button" class="terminal-selection-submit" data-testid="terminal-selection-submit"
                      onclick=${() => submitSelection(selection)}>Submit ⏎</button>
            </div>
          ` : ''}
        </div>
        </div>
      ` : ''}

      <div class="terminal-control-bar" data-testid="terminal-control-bar" role="group" aria-label="Terminal keys">
        <button type="button" data-testid="ctl-enter" title="Enter" onclick=${() => sendKeys(TERM_KEYS.enter)}>⏎</button>
        <button type="button" data-testid="ctl-esc" title="Esc / interrupt" onclick=${() => sendKeys(TERM_KEYS.esc)}>Esc</button>
        <button type="button" data-testid="ctl-ctrlc" title="Ctrl-C / cancel" onclick=${() => sendKeys(TERM_KEYS.ctrlc)}>^C</button>
        <button type="button" data-testid="ctl-mode" title="Shift-Tab / cycle mode" onclick=${() => sendKeys(TERM_KEYS.shiftTab)}>⇧⇥</button>
        <button type="button" data-testid="ctl-up" title="Up" onclick=${() => sendKeys(TERM_KEYS.up)}>↑</button>
        <button type="button" data-testid="ctl-down" title="Down" onclick=${() => sendKeys(TERM_KEYS.down)}>↓</button>
        ${keyFlash ? html`<span class="terminal-key-flash" data-testid="terminal-key-flash">sent ✓</span>` : ''}
      </div>

      <div class="terminal-chat-composer">
        <div class="terminal-composer-grip" data-testid="terminal-composer-grip"
             title="Drag to resize · double-tap to reset"
             onPointerDown=${startComposerResize} onDblClick=${resetComposerHeight}>
          <span class="terminal-composer-grip-bar"></span>
        </div>
        <div class="terminal-chat-modebar">
          <button type="button" class=${sendMode === 'command' ? 'sel' : ''}
                  onclick=${() => setSendMode('command')}>Send as command</button>
          <button type="button" class=${'terminal-chat-enter-btn' + (sendMode === 'raw' ? ' sel' : '')}
                  data-testid="terminal-send-enter"
                  onclick=${() => { setSendMode('raw'); sendManualEnter(); }}
                  disabled=${sending}>Send raw keys</button>
          <button type="button" class=${'terminal-size-toggle' + (composerHeight ? ' sel' : '')}
                  data-testid="terminal-size-toggle"
                  title=${composerHeight ? 'Shrink the input' : 'Enlarge the input'}
                  onclick=${toggleComposerSize}>
            ${composerHeight ? '▾ Small input' : '▴ Large input'}
          </button>
        </div>
        ${attachError ? html`<div class="terminal-attach-error">${attachError}</div>` : ''}
        <div class="terminal-chat-composer-row">
          <button type="button" class="terminal-chat-attach-btn" data-testid="terminal-attach-image"
                  aria-label="Attach image" onclick=${openAttachPicker} disabled=${sending || attaching}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="3" y="5" width="18" height="14" rx="2"></rect>
              <circle cx="8.5" cy="10" r="1.5"></circle>
              <path d="M21 16l-5-5-11 8"></path>
            </svg>
          </button>
          <input type="file" accept="image/*" multiple hidden ref=${fileInputRef} onChange=${handleAttachFile} />
          ${attachments.length ? html`
            <span class="terminal-attach-pills" data-testid="terminal-attachment-list">
              ${attachments.map((attachment, index) => html`
                <span class="terminal-attach-pill" data-testid="terminal-attachment-chip" title=${attachment.path}>
                  <img src=${attachment.preview} alt="" />
                  <button type="button" onclick=${() => removeAttachment(index)} aria-label=${`Remove attachment ${index + 1}`}>×</button>
                </span>
              `)}
            </span>
          ` : ''}
          <div data-testid="terminal-draft">
          <textarea class="terminal-chat-input-field"
                    data-testid="terminal-composer-input"
                    ref=${composerFieldRef}
                    value=${input}
                    rows="1"
                    style=${composerHeight ? `height:${composerHeight}px` : ''}
                    placeholder="Message the agent..."
                    onInput=${handleComposerInput}
                    onPaste=${handleComposerPaste}
                    onKeyDown=${e => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        // Empty composer + an active multi-select prompt → Enter
                        // submits the toggled options (like the terminal). With
                        // text, it sends the message as usual.
                        if (!input.trim() && !attachments.length && showSelection && selection?.multi) {
                          submitSelection(selection);
                        } else {
                          sendCommand();
                        }
                      }
                    }}></textarea>
          </div>
          <button class="terminal-chat-send-btn" data-testid="terminal-send-command" onclick=${sendCommand} disabled=${sending || (!input.trim() && !attachments.length)}>
            ${sending ? html`<div class="typing-dots"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></div>` : '➤'}
          </button>
        </div>
      </div>
    </div>
  `;
}

// Terminal View (xterm.js)
function TerminalView({ target, fontSize, onDisconnect, onStatusChange, onLastUpdated }) {
  const [status, setStatus] = useState('connecting');
  const [lastUpdatedAt, setLastUpdatedAt] = useState(0);
  const termRef = useRef(null);
  const fitAddonRef = useRef(null);

  useEffect(() => {
    if (onStatusChange) onStatusChange(status);
    if (onLastUpdated) onLastUpdated(lastUpdatedAt);
  }, [status, lastUpdatedAt, onStatusChange, onLastUpdated]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontSize = fontSize;
    fitAddonRef.current?.fit();
    term.refresh(0, term.rows - 1);
  }, [fontSize]);

  useEffect(() => {
    let ws, term, cleanup;
    async function init() {
      const { Terminal } = await import('https://cdn.jsdelivr.net/npm/xterm@5.3.0/+esm');
      const { FitAddon } = await import('https://cdn.jsdelivr.net/npm/xterm-addon-fit@0.8.0/+esm');

      const container = document.getElementById('terminal-' + target.replace(/[:.]/g, '-'));
      if (!container) return;

      term = new Terminal({
        theme: {
          background: '#0a0e14',
          foreground: '#e6edf3',
          cursor: '#58a6ff',
          selectionBackground: '#264f78',
          black: '#1e1e1e',
          red: '#f85149',
          green: '#3fb950',
          yellow: '#d29922',
          blue: '#58a6ff',
          magenta: '#bc8cff',
          cyan: '#39c5cf',
          white: '#e6edf3',
          brightBlack: '#6e7681',
          brightRed: '#ffa198',
          brightGreen: '#56d364',
          brightYellow: '#e3b341',
          brightBlue: '#79c0ff',
          brightMagenta: '#d2a8ff',
          brightCyan: '#56d4dd',
          brightWhite: '#ffffff'
        },
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
        fontSize,
        lineHeight: 1.1,
        cursorBlink: false,
        scrollback: 5000,
        convertEol: false
      });

      const fitAddon = new FitAddon();
      termRef.current = term;
      fitAddonRef.current = fitAddon;
      term.loadAddon(fitAddon);
      term.open(container);
      fitAddon.fit();

      const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${wsProtocol}//${location.host}/ws/tmux/${encodeURIComponent(target)}?token=${authToken}`);

      ws.onopen = () => {
        setLastUpdatedAt(Date.now());
        setStatus('connected');
      };
      ws.onclose = () => {
        setLastUpdatedAt(Date.now());
        setStatus('disconnected');
        term.write('\r\n\x1b[31m[Disconnected]\x1b[0m\r\n');
      };
      ws.onerror = () => setStatus('error');

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          setLastUpdatedAt(Date.now());
          if (msg.type === 'snapshot') {
            term.reset();
            term.write(msg.data);
          } else if (msg.type === 'output') {
            term.write(msg.data);
          } else if (msg.type === 'safety_block') {
            term.write(`\r\n\x1b[33m[SAFETY] Command blocked: ${msg.pattern}\x1b[0m\r\n`);
          } else if (msg.type === 'closed') {
            term.write(`\r\n\x1b[31m[${msg.reason}]\x1b[0m\r\n`);
          }
        } catch {}
      };

      term.onData(data => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'input', data }));
        }
      });

      const observer = new ResizeObserver(() => fitAddon.fit());
      observer.observe(container);

      cleanup = () => {
        observer.disconnect();
        ws?.close();
        term?.dispose();
        if (termRef.current === term) termRef.current = null;
        if (fitAddonRef.current === fitAddon) fitAddonRef.current = null;
      };
    }

    init();
    return () => cleanup?.();
  }, [target]);

  const containerId = 'terminal-' + target.replace(/[:.]/g, '-');
  return html`
    <div style="height:100%;position:relative">
      <div id=${containerId} style="height:100%"></div>
    </div>
  `;
}

// Code Tab - VS Code-like file editor
function CodeTab({ projectId, projectRoot }) {
  const [openTabs, setOpenTabs] = useState([]);
  const [activeTabIdx, setActiveTabIdx] = useState(-1);
  const [contextMenu, setContextMenu] = useState(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const [treeRefreshKey, setTreeRefreshKey] = useState(0);

  const openFile = useCallback(async (filePath) => {
    const existingIdx = openTabs.findIndex(t => t.path === filePath);
    if (existingIdx >= 0) {
      setActiveTabIdx(existingIdx);
      return;
    }
    try {
      const data = await api(`/api/projects/${projectId}/files/read?path=${encodeURIComponent(filePath)}`);
      const name = filePath.split('/').pop();
      const newTab = { path: filePath, name, content: data.content, originalContent: data.content, language: data.language };
      setOpenTabs(prev => [...prev, newTab]);
      setActiveTabIdx(openTabs.length);
    } catch (e) {
      alert(e.message);
    }
  }, [openTabs, projectId]);

  const closeTab = useCallback((idx, force = false) => {
    const tab = openTabs[idx];
    if (!force && tab && tab.content !== tab.originalContent) {
      if (!confirm(`"${tab.name}" has unsaved changes. Close anyway?`)) return;
    }
    setOpenTabs(prev => prev.filter((_, i) => i !== idx));
    setActiveTabIdx(prev => {
      if (prev === idx) return Math.max(0, idx - 1);
      if (prev > idx) return prev - 1;
      return prev;
    });
  }, [openTabs]);

  const openTabsRef = useRef(openTabs);
  openTabsRef.current = openTabs;

  const saveFile = useCallback(async (idx, editorContent) => {
    const tab = openTabsRef.current[idx];
    if (!tab) return;
    const content = editorContent !== undefined ? editorContent : tab.content;
    try {
      await api(`/api/projects/${projectId}/files?path=${encodeURIComponent(tab.path)}`, {
        method: 'PUT',
        body: JSON.stringify({ content })
      });
      setOpenTabs(prev => prev.map((t, i) => i === idx ? { ...t, content, originalContent: content } : t));
    } catch (e) {
      alert('Save failed: ' + e.message);
    }
  }, [projectId]);

  const updateTabContent = useCallback((idx, content) => {
    setOpenTabs(prev => prev.map((t, i) => i === idx ? { ...t, content } : t));
  }, []);

  // Keyboard shortcuts (Ctrl+S handled by Monaco when editor is focused)
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
        e.preventDefault();
        setQuickOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('contextmenu', close);
    return () => { window.removeEventListener('click', close); window.removeEventListener('contextmenu', close); };
  }, [contextMenu]);

  const activeTab = openTabs[activeTabIdx] || null;

  return html`
    <div class="code-container">
      <div class="file-tree">
        <${FileTreeNode} projectId=${projectId} path="" depth=${0} onFileSelect=${openFile}
          onContextMenu=${(e, path, type) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, path, type }); }}
          refreshKey=${treeRefreshKey} />
      </div>
      <div class="code-editor-panel">
        ${openTabs.length > 0 ? html`
          <div class="editor-tab-bar">
            ${openTabs.map((t, i) => html`
              <div class="editor-tab ${i === activeTabIdx ? 'active' : ''}" onclick=${() => setActiveTabIdx(i)}
                   onauxclick=${(e) => { if (e.button === 1) { e.preventDefault(); closeTab(i); } }}>
                ${t.content !== t.originalContent ? html`<span class="modified-dot"></span>` : ''}
                <span class="editor-tab-name">${t.name}</span>
                <span class="editor-tab-close" onclick=${(e) => { e.stopPropagation(); closeTab(i); }}>x</span>
              </div>
            `)}
          </div>
          ${activeTab ? html`
            <div class="editor-breadcrumb">
              ${activeTab.path.split('/').map((seg, i, arr) => html`
                <span>${seg}</span>${i < arr.length - 1 ? html`<span class="breadcrumb-sep">></span>` : ''}
              `)}
            </div>
            <${MonacoEditorView}
              key=${activeTab.path}
              content=${activeTab.content}
              language=${activeTab.language}
              onChange=${(val) => updateTabContent(activeTabIdx, val)}
              onSave=${(editorContent) => saveFile(activeTabIdx, editorContent)}
            />
          ` : ''}
        ` : html`
          <div class="code-empty-state">
            <div>Select a file from the tree to open it</div>
            <div style="font-size:12px;color:var(--text-secondary);margin-top:8px">Ctrl+P to quick open</div>
          </div>
        `}
      </div>

      ${contextMenu && html`<${ContextMenu}
        x=${contextMenu.x} y=${contextMenu.y}
        path=${contextMenu.path} type=${contextMenu.type}
        projectId=${projectId} projectRoot=${projectRoot}
        onClose=${() => setContextMenu(null)}
        onRefresh=${() => setTreeRefreshKey(k => k + 1)}
        onOpenFile=${openFile}
      />`}

      ${quickOpen && html`<${QuickOpenDialog}
        projectId=${projectId}
        onSelect=${(path) => { setQuickOpen(false); openFile(path); }}
        onClose=${() => setQuickOpen(false)}
      />`}
    </div>
  `;
}

// File Tree Node (recursive, lazy-loading)
function FileTreeNode({ projectId, path: dirPath, depth, onFileSelect, onContextMenu, refreshKey }) {
  const [entries, setEntries] = useState(null);
  const [expanded, setExpanded] = useState(depth === 0);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api(`/api/projects/${projectId}/files?path=${encodeURIComponent(dirPath || '.')}`);
      setEntries(data.entries);
    } catch { setEntries([]); }
    setLoading(false);
  }, [projectId, dirPath]);

  useEffect(() => {
    if (expanded && entries === null) load();
  }, [expanded, load]);

  // Refresh when key changes (after file operations)
  useEffect(() => {
    if (expanded && entries !== null && refreshKey > 0) load();
  }, [refreshKey, expanded, load]);

  if (!expanded && depth > 0) {
    return html`<div class="tree-node tree-node-dir" style="padding-left:${depth * 16}px"
                     onclick=${() => setExpanded(true)}
                     oncontextmenu=${(e) => onContextMenu(e, dirPath, 'directory')}>
      <span class="tree-icon">▶</span> <span>${dirPath.split('/').pop() || 'root'}</span>
    </div>`;
  }

  return html`
    <div>
      ${depth > 0 && html`
        <div class="tree-node tree-node-dir" style="padding-left:${depth * 16}px"
             onclick=${() => setExpanded(false)}
             oncontextmenu=${(e) => onContextMenu(e, dirPath, 'directory')}>
          <span class="tree-icon">▼</span> <span>${dirPath.split('/').pop()}</span>
        </div>
      `}
      ${loading && html`<div style="padding-left:${(depth + 1) * 16}px;font-size:11px;color:var(--text-secondary)">Loading...</div>`}
      ${entries && entries.map(entry => {
        const entryPath = dirPath ? `${dirPath}/${entry.name}` : entry.name;
        if (entry.type === 'directory') {
          return html`<${FileTreeNode} projectId=${projectId} path=${entryPath} depth=${depth + 1}
                        onFileSelect=${onFileSelect} onContextMenu=${onContextMenu} refreshKey=${refreshKey} />`;
        }
        return html`
          <div class="tree-node tree-node-file" style="padding-left:${(depth + 1) * 16}px"
               onclick=${() => onFileSelect(entryPath)}
               oncontextmenu=${(e) => onContextMenu(e, entryPath, 'file')}>
            <span class="tree-icon-file"></span> ${entry.name}
          </div>
        `;
      })}
    </div>
  `;
}

// Monaco Editor View
function MonacoEditorView({ content, language, onChange, onSave }) {
  const editorRef = useRef(null);
  const onSaveRef = useRef(onSave);
  const onChangeRef = useRef(onChange);

  // Keep refs pointing to latest callbacks
  onSaveRef.current = onSave;
  onChangeRef.current = onChange;

  useEffect(() => {
    let disposed = false;

    // Load Monaco AMD loader
    function loadMonaco() {
      return new Promise((resolve) => {
        if (window.monaco) { resolve(window.monaco); return; }
        if (document.getElementById('monaco-loader')) {
          const check = setInterval(() => { if (window.monaco) { clearInterval(check); resolve(window.monaco); } }, 50);
          return;
        }
        const script = document.createElement('script');
        script.id = 'monaco-loader';
        script.src = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs/loader.min.js';
        script.onload = () => {
          window.require.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs' } });
          window.require(['vs/editor/editor.main'], (m) => { window.monaco = m; resolve(m); });
        };
        document.head.appendChild(script);
      });
    }

    async function init() {
      const monaco = await loadMonaco();
      if (disposed) return;

      const container = document.getElementById('monaco-editor-container');
      if (!container) return;

      // Define custom dark theme
      monaco.editor.defineTheme('agj-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [],
        colors: {
          'editor.background': '#0d1117',
          'editor.foreground': '#e6edf3',
          'editorCursor.foreground': '#58a6ff',
          'editor.selectionBackground': '#264f78',
          'editor.lineHighlightBackground': '#161b22',
          'editorLineNumber.foreground': '#6e7681',
          'editorLineNumber.activeForeground': '#e6edf3'
        }
      });

      const editor = monaco.editor.create(container, {
        value: content,
        language: language || 'plaintext',
        theme: 'agj-dark',
        minimap: { enabled: true },
        wordWrap: 'off',
        fontSize: 13,
        tabSize: 2,
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
        lineHeight: 20,
        padding: { top: 8 },
        scrollBeyondLastLine: false,
        automaticLayout: true,
        renderWhitespace: 'selection'
      });

      editorRef.current = editor;

      editor.onDidChangeModelContent(() => {
        if (!disposed) onChangeRef.current(editor.getValue());
      });

      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        onSaveRef.current(editor.getValue());
      });
    }

    init();
    return () => { disposed = true; if (editorRef.current) { editorRef.current.dispose(); editorRef.current = null; } };
  }, []);

  // Update content when switching tabs
  useEffect(() => {
    if (editorRef.current && editorRef.current.getValue() !== content) {
      editorRef.current.setValue(content);
    }
  }, [content]);

  // Update language when switching tabs
  useEffect(() => {
    if (editorRef.current && window.monaco) {
      const model = editorRef.current.getModel();
      if (model) window.monaco.editor.setModelLanguage(model, language || 'plaintext');
    }
  }, [language]);

  return html`<div id="monaco-editor-container" style="flex:1;min-height:0"></div>`;
}

// Context Menu
function ContextMenu({ x, y, path: filePath, type, projectId, projectRoot, onClose, onRefresh, onOpenFile }) {
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState('');

  async function handleAction(action) {
    onClose();
    try {
      if (action === 'copyPath') {
        const fullPath = projectRoot ? `${projectRoot}/${filePath}` : filePath;
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(fullPath);
        } else {
          const ta = document.createElement('textarea');
          ta.value = fullPath;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
        }
      } else if (action === 'delete') {
        if (!confirm(`Delete "${filePath}"?`)) return;
        await api(`/api/projects/${projectId}/files?path=${encodeURIComponent(filePath)}`, { method: 'DELETE' });
        onRefresh();
      } else if (action === 'duplicate') {
        const ext = filePath.includes('.') ? '.' + filePath.split('.').pop() : '';
        const base = ext ? filePath.slice(0, -ext.length) : filePath;
        const dest = `${base}-copy${ext}`;
        await api(`/api/projects/${projectId}/files/copy`, { method: 'POST', body: JSON.stringify({ srcPath: filePath, destPath: dest }) });
        onRefresh();
      } else if (action === 'newFile') {
        const name = prompt('New file name:');
        if (!name) return;
        const newPath = filePath ? `${filePath}/${name}` : name;
        await api(`/api/projects/${projectId}/files?path=${encodeURIComponent(newPath)}`, {
          method: 'POST', body: JSON.stringify({ type: 'file', content: '' })
        });
        onRefresh();
        onOpenFile(newPath);
      } else if (action === 'newFolder') {
        const name = prompt('New folder name:');
        if (!name) return;
        const newPath = filePath ? `${filePath}/${name}` : name;
        await api(`/api/projects/${projectId}/files?path=${encodeURIComponent(newPath)}`, {
          method: 'POST', body: JSON.stringify({ type: 'directory' })
        });
        onRefresh();
      } else if (action === 'rename') {
        const currentName = filePath.split('/').pop();
        const name = prompt('Rename to:', currentName);
        if (!name || name === currentName) return;
        const parentPath = filePath.includes('/') ? filePath.split('/').slice(0, -1).join('/') : '';
        const newPath = parentPath ? `${parentPath}/${name}` : name;
        await api(`/api/projects/${projectId}/files/rename`, {
          method: 'POST', body: JSON.stringify({ oldPath: filePath, newPath })
        });
        onRefresh();
      }
    } catch (e) {
      alert(e.message);
    }
  }

  // Adjust position to stay on screen
  const style = `position:fixed;left:${Math.min(x, window.innerWidth - 200)}px;top:${Math.min(y, window.innerHeight - 250)}px;z-index:1000`;

  return html`
    <div class="context-menu" style=${style} onclick=${(e) => e.stopPropagation()}>
      ${type === 'directory' ? html`
        <div class="context-menu-item" onclick=${() => handleAction('newFile')}>New File</div>
        <div class="context-menu-item" onclick=${() => handleAction('newFolder')}>New Folder</div>
        <div class="context-menu-separator"></div>
      ` : ''}
      <div class="context-menu-item" onclick=${() => handleAction('copyPath')}>Copy Path</div>
      <div class="context-menu-item" onclick=${() => handleAction('rename')}>Rename</div>
      ${type === 'file' ? html`
        <div class="context-menu-item" onclick=${() => handleAction('duplicate')}>Duplicate</div>
      ` : ''}
      <div class="context-menu-separator"></div>
      <div class="context-menu-item context-menu-danger" onclick=${() => handleAction('delete')}>Delete</div>
    </div>
  `;
}

// Quick Open Dialog (Ctrl+P)
function QuickOpenDialog({ projectId, onSelect, onClose }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const data = await api(`/api/projects/${projectId}/files/search?q=${encodeURIComponent(query)}&limit=20`);
        setResults(data.files);
        setSelectedIdx(0);
      } catch { setResults([]); }
      setLoading(false);
    }, 150);
    return () => clearTimeout(timer);
  }, [query, projectId]);

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, results.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, 0)); }
    if (e.key === 'Enter' && results[selectedIdx]) { onSelect(results[selectedIdx]); }
  };

  return html`
    <div class="quick-open-overlay" onclick=${onClose}>
      <div class="quick-open-modal" onclick=${(e) => e.stopPropagation()}>
        <input class="quick-open-input" placeholder="Search files by name..."
               value=${query} onInput=${(e) => setQuery(e.target.value)}
               onKeyDown=${handleKeyDown} autofocus />
        <div class="quick-open-results">
          ${results.map((f, i) => html`
            <div class="quick-open-item ${i === selectedIdx ? 'selected' : ''}"
                 onclick=${() => onSelect(f)}
                 onmouseenter=${() => setSelectedIdx(i)}>
              <span class="quick-open-filename">${f.split('/').pop()}</span>
              <span class="quick-open-filepath">${f}</span>
            </div>
          `)}
          ${query && !loading && results.length === 0 && html`
            <div class="quick-open-item" style="color:var(--text-secondary);cursor:default">No files found</div>
          `}
          ${loading && html`<div class="quick-open-item" style="color:var(--text-secondary);cursor:default">Searching...</div>`}
        </div>
      </div>
    </div>
  `;
}

// Notes Tab
function NoteCard({ note: n, selected, onToggle, onDelete, onSave }) {
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(n.title || '');
  const [editBody, setEditBody] = useState(n.body);

  if (editing) {
    return html`
      <div class="item-card" style="display:flex;gap:12px;align-items:start">
        <input type="checkbox" style="margin-top:4px;flex-shrink:0" checked=${selected} onchange=${onToggle} />
        <div style="flex:1;min-width:0">
          <div class="form-group" style="margin-bottom:8px">
            <label style="font-size:11px">Title</label>
            <input value=${editTitle} onInput=${e => setEditTitle(e.target.value)} placeholder="Title (optional)" />
          </div>
          <div class="form-group" style="margin-bottom:8px">
            <label style="font-size:11px">Body</label>
            <textarea rows="4" value=${editBody} onInput=${e => setEditBody(e.target.value)}></textarea>
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-sm btn-primary" onclick=${async () => {
              if (!editBody.trim()) return;
              await onSave({ title: editTitle.trim() || null, body: editBody.trim() });
              setEditing(false);
            }}>Save</button>
            <button class="btn btn-sm" onclick=${() => { setEditTitle(n.title || ''); setEditBody(n.body); setEditing(false); }}>Cancel</button>
          </div>
        </div>
      </div>
    `;
  }

  return html`
    <div class="item-card" style="display:flex;gap:12px;align-items:start">
      <input type="checkbox" style="margin-top:4px;flex-shrink:0" checked=${selected} onchange=${onToggle} />
      <div style="flex:1;min-width:0">
        <div style="display:flex;justify-content:space-between;align-items:start">
          <h4>${n.title || n.body.slice(0, 80)}</h4>
        </div>
        ${n.title && html`<p>${n.body.slice(0, 200)}</p>`}
        <div class="meta" style="display:flex;gap:8px;align-items:center">
          <span>${new Date(n.created_at).toLocaleString()}</span>
          <button class="btn btn-sm" onclick=${() => setEditing(true)}>Edit</button>
          <button class="btn btn-sm btn-danger" onclick=${onDelete}>Delete</button>
        </div>
      </div>
    </div>
  `;
}

// ===================== iOS NOTES PAGE (N2) =====================

// --- Helpers ---
function stripHtml(html) {
  if (!html) return '';
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function noteTitle(body) {
  if (!body) return 'New Note';
  const clean = stripHtml(body);
  const first = clean.split('\n')[0].trim();
  return first.length > 0 ? first.slice(0, 80) : 'New Note';
}

function noteSnippet(body) {
  if (!body) return '';
  const clean = stripHtml(body);
  const lines = clean.split('\n').map(l => l.trim()).filter(Boolean);
  const snippet = lines.slice(1).join(' ') || lines[0] || '';
  return snippet.slice(0, 100);
}

function relativeDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T') + 'Z');
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ', ' +
         d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// --- Note row with swipe actions: Pin | Move | Delete ---
function IosNoteRow({ note, onOpen, onDelete, onPin, onMove, onMore }) {
  const [swiped, setSwiped] = useState(false);
  const touchStartX = useRef(null);
  const rowRef = useRef(null);

  function handleTouchStart(e) {
    touchStartX.current = e.touches[0].clientX;
  }
  function handleTouchMove(e) {
    if (touchStartX.current === null) return;
    const dx = e.touches[0].clientX - touchStartX.current;
    if (dx < -50) setSwiped(true);
    else if (dx > 20) setSwiped(false);
  }
  function handleTouchEnd() {
    touchStartX.current = null;
  }
  // Desktop: right-click or long-press shows actions
  function handleContextMenu(e) {
    e.preventDefault();
    setSwiped(v => !v);
  }

  const title = note.title || noteTitle(note.body);
  const date = relativeDate(note.updated_at || note.created_at);

  return html`
    <div class="ios-note-row-wrap" ref=${rowRef}>
      <div class=${'ios-note-row' + (swiped ? ' swiped-actions' : '')}
           ontouchstart=${handleTouchStart}
           ontouchmove=${handleTouchMove}
           ontouchend=${handleTouchEnd}
           oncontextmenu=${handleContextMenu}
           onclick=${() => { if (!swiped) onOpen(note); }}>
        <div class="ios-note-row-content">
          <div class="ios-note-row-main">
            <span class="ios-note-title">${note.pinned ? html`<span class="ios-pin-indicator">📌 </span>` : ''}${title}</span>
            <span class="ios-note-date">${date}</span>
          </div>
          ${onMore && html`
            <button class="ios-note-more-btn"
                    onclick=${e => { e.stopPropagation(); e.preventDefault(); onMore(note); }}
                    onmousedown=${e => e.stopPropagation()}
                    title="More actions">⋯</button>
          `}
        </div>
      </div>
      <div class="ios-swipe-actions">
        ${onPin && html`
          <button class="ios-swipe-action-btn ios-swipe-pin-btn"
                  onclick=${(e) => { e.stopPropagation(); setSwiped(false); onPin(note); }}>
            ${note.pinned ? 'Unpin' : 'Pin'}
          </button>
        `}
        ${onMove && html`
          <button class="ios-swipe-action-btn ios-swipe-move-btn"
                  onclick=${(e) => { e.stopPropagation(); setSwiped(false); onMove(note); }}>
            Move
          </button>
        `}
        <button class="ios-swipe-action-btn ios-swipe-delete-btn"
                onclick=${(e) => { e.stopPropagation(); setSwiped(false); onDelete(note); }}>
          Delete
        </button>
      </div>
    </div>
    <div class="ios-list-divider"></div>
  `;
}

// --- Move-to-folder bottom sheet ---
function IosMoveFolderSheet({ note, folders, currentFolderId, onMove, onClose }) {
  const others = folders.filter(f => f.id !== currentFolderId);
  return html`
    <div class="ios-sheet-backdrop" onclick=${onClose}>
      <div class="ios-sheet" onclick=${e => e.stopPropagation()}>
        <div class="ios-sheet-handle"></div>
        <div class="ios-sheet-title">Move to Folder</div>
        <div class="ios-sheet-list">
          ${others.length === 0 && html`<div class="ios-sheet-empty">No other folders.</div>`}
          ${others.map(f => html`
            <button key=${f.id} class="ios-sheet-row" onclick=${() => onMove(note, f)}>
              <span class="ios-folder-icon">📁</span>
              <span class="ios-sheet-row-name">${f.name}</span>
            </button>
          `)}
        </div>
        <button class="ios-sheet-cancel" onclick=${onClose}>Cancel</button>
      </div>
    </div>
  `;
}

// --- Note more-actions bottom sheet ---
function IosNoteMoreSheet({ note, canPin, canMove, onEdit, onDelete, onPin, onMove, onClose }) {
  return html`
    <div class="ios-sheet-backdrop" onclick=${onClose}></div>
    <div class="ios-more-sheet">
      <div class="ios-more-sheet-handle"></div>
      <div class="ios-more-sheet-title">${note.title || 'Note'}</div>
      <button class="ios-more-sheet-btn" onclick=${onEdit}>Edit</button>
      ${canPin && html`
        <button class="ios-more-sheet-btn" onclick=${onPin}>
          ${note.pinned ? 'Unpin' : 'Pin'}
        </button>
      `}
      ${canMove && html`
        <button class="ios-more-sheet-btn" onclick=${onMove}>Move to Folder</button>
      `}
      <button class="ios-more-sheet-btn ios-more-sheet-btn--danger" onclick=${onDelete}>Delete</button>
      <button class="ios-more-sheet-btn ios-more-sheet-btn--cancel" onclick=${onClose}>Cancel</button>
    </div>
  `;
}

// --- Notes list screen (within a folder) ---
function IosNotesList({ folder, folders, onBack, onOpenNote, onNewNote, onPinNote }) {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [moveNote, setMoveNote] = useState(null);
  const [moreNote, setMoreNote] = useState(null);
  const searchRef = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const loadNotes = useCallback(() => {
    setLoading(true);
    let url;
    if (searchDebounced) {
      url = `/api/notes?search=${encodeURIComponent(searchDebounced)}`;
    } else {
      url = `/api/notes?folder_id=${folder.id}`;
    }
    api(url).then(d => {
      setNotes(d.notes || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [folder.id, searchDebounced]);

  useEffect(() => { loadNotes(); }, [loadNotes]);

  async function handleDelete(note) {
    if (!confirm('Delete this note?')) return;
    try {
      await api(`/api/notes/${note.id}`, { method: 'DELETE' });
      loadNotes();
    } catch (e) { alert(e.message); }
  }

  async function handlePin(note) {
    try {
      const newPinned = !note.pinned;
      await api(`/api/notes/${note.id}`, { method: 'PATCH', body: JSON.stringify({ pinned: newPinned }) });
      loadNotes();
      if (onPinNote) onPinNote();
    } catch (e) { alert(e.message); }
  }

  async function handleMoveConfirm(note, targetFolder) {
    setMoveNote(null);
    try {
      await api(`/api/notes/${note.id}`, { method: 'PATCH', body: JSON.stringify({ folder_id: targetFolder.id }) });
      loadNotes();
    } catch (e) { alert(e.message); }
  }

  async function handleNewNote() {
    try {
      const d = await api('/api/notes', { method: 'POST', body: JSON.stringify({ folder_id: folder.id, body: '' }) });
      const newNote = d.note || d;
      loadNotes();
      onOpenNote(newNote, loadNotes);
    } catch (e) { alert(e.message); }
  }

  // Split pinned / regular
  const pinned = notes.filter(n => n.pinned);
  const regular = notes.filter(n => !n.pinned);

  return html`
    <div class="ios-notes-screen">
      <div class="ios-notes-header">
        <button class="ios-back-btn" onclick=${onBack}>
          <span class="ios-back-chevron">‹</span>
          <span>Folders</span>
        </button>
        <h1 class="ios-screen-title">${folder.name}</h1>
        <button class="ios-header-new-btn" onclick=${handleNewNote} title="New Note">+</button>
      </div>

      <div class="ios-search-bar-wrap">
        <div class="ios-search-bar">
          <span class="ios-search-icon">⌕</span>
          <input ref=${searchRef} type="text" value=${search}
                 onInput=${e => setSearch(e.target.value)}
                 placeholder="Search"
                 class="ios-search-input" />
          ${search && html`<button class="ios-search-clear" onclick=${() => setSearch('')}>✕</button>`}
        </div>
      </div>

      ${loading ? html`<div class="ios-loading">Loading...</div>` : html`
        <div class="ios-list-body">
          ${pinned.length > 0 && html`
            <div class="ios-section-header">Pinned</div>
            <div class="ios-list-group">
              ${pinned.map(n => html`
                <${IosNoteRow} key=${n.id} note=${n}
                  onOpen=${(note) => onOpenNote(note, loadNotes)}
                  onDelete=${handleDelete}
                  onPin=${handlePin}
                  onMove=${(folders && folders.length > 1) ? (note) => setMoveNote(note) : null}
                  onMore=${(note) => setMoreNote(note)}
                />
              `)}
            </div>
          `}

          ${regular.length > 0 && html`
            <div class="ios-section-header">Notes</div>
            <div class="ios-list-group">
              ${regular.map(n => html`
                <${IosNoteRow} key=${n.id} note=${n}
                  onOpen=${(note) => onOpenNote(note, loadNotes)}
                  onDelete=${handleDelete}
                  onPin=${handlePin}
                  onMove=${(folders && folders.length > 1) ? (note) => setMoveNote(note) : null}
                  onMore=${(note) => setMoreNote(note)}
                />
              `)}
            </div>
          `}

          ${notes.length === 0 && html`
            <div class="ios-empty-state">
              ${searchDebounced ? 'No notes match your search.' : 'No notes in this folder yet.'}
            </div>
          `}
        </div>
      `}

      <div class="ios-note-count-bar">
        ${loading ? '' : `${notes.length} Note${notes.length !== 1 ? 's' : ''}`}
      </div>

      <button class="ios-compose-btn" onclick=${handleNewNote}>
        <span class="ios-compose-icon">✏</span>
      </button>

      ${moveNote && html`
        <${IosMoveFolderSheet}
          note=${moveNote}
          folders=${folders || []}
          currentFolderId=${folder.id}
          onMove=${handleMoveConfirm}
          onClose=${() => setMoveNote(null)}
        />
      `}

      ${moreNote && html`
        <${IosNoteMoreSheet}
          note=${moreNote}
          canPin=${true}
          canMove=${folders && folders.length > 1}
          onEdit=${() => { setMoreNote(null); onOpenNote(moreNote, loadNotes); }}
          onDelete=${() => { setMoreNote(null); handleDelete(moreNote); }}
          onPin=${() => { setMoreNote(null); handlePin(moreNote); }}
          onMove=${() => { setMoreNote(null); setMoveNote(moreNote); }}
          onClose=${() => setMoreNote(null)}
        />
      `}
    </div>
  `;
}

// --- Rich Note Editor (N3: iPhone Notes-style) ---

// Normalize empty contenteditable to empty string for comparison
function getEditorHtml(el) {
  if (!el) return '';
  const html = el.innerHTML;
  // contenteditable reports '<br>' for empty state in some browsers
  if (html === '<br>' || html === '' ) return '';
  return html;
}

// Build initial HTML for contenteditable from stored body.
// If the stored body is plain text (no tags), wrap in a <p> so the first line
// becomes a proper block for title styling.
function prepareInitialHtml(body) {
  if (!body) return '';
  // Already contains HTML tags — use as-is
  if (/<[a-zA-Z]/.test(body)) return body;
  // Plain text: wrap each newline-separated line in <p>
  return body.split('\n').map(l => `<p>${l || '<br>'}</p>`).join('');
}

function IosNoteEditor({ note, folder, folders, onBack, onReload, onMoveNote }) {
  const [pinned, setPinned] = useState(!!note.pinned);
  const [showMoveSheet, setShowMoveSheet] = useState(false);
  const [saveLabel, setSaveLabel] = useState('Save');
  // Track whether this is a brand-new empty note (for discard-on-back logic)
  const isNewEmpty = useRef(!note.body || note.body.trim() === '');
  const saveTimer = useRef(null);
  const feedbackTimer = useRef(null);
  const [editorTitle, setEditorTitle] = useState(note.title || '');
  const editorRef = useRef(null);
  // Keep a live ref to current HTML so handleBack always sees latest value
  const currentHtmlRef = useRef(note.body || '');

  const FONT_SIZES = [13, 15, 17, 20];
  const initialFontIdx = FONT_SIZES.indexOf(note.font_size);
  const [fontSizeIdx, setFontSizeIdx] = useState(initialFontIdx >= 0 ? initialFontIdx : 1);

  async function handleFontChange(newIdx) {
    const newSize = FONT_SIZES[newIdx];
    setFontSizeIdx(newIdx);
    try {
      await api(`/api/notes/${note.id}`, { method: 'PATCH', body: JSON.stringify({ font_size: newSize }) });
    } catch { /* silent; UI already updated */ }
  }

  async function handleTitleSave() {
    try {
      await api(`/api/notes/${note.id}`, { method: 'PATCH', body: JSON.stringify({ title: editorTitle || null }) });
    } catch { /* silent */ }
  }

  // Set initial content on mount (once; bypass Preact diffing)
  useEffect(() => {
    if (!editorRef.current) return;
    const initial = prepareInitialHtml(note.body || '');
    editorRef.current.innerHTML = initial;
    currentHtmlRef.current = initial;
    // Place cursor at end
    const range = document.createRange();
    const sel = window.getSelection();
    range.selectNodeContents(editorRef.current);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
    editorRef.current.focus();
  }, []);

  // Ctrl+S / Cmd+S keyboard save
  useEffect(() => {
    function onKeyDown(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleManualSave();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  // Debounced auto-save
  function scheduleAutoSave(html) {
    currentHtmlRef.current = html;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await api(`/api/notes/${note.id}`, { method: 'PATCH', body: JSON.stringify({ body: html }) });
        if (onReload) onReload();
      } catch {}
    }, 800);
  }

  function handleEditorInput() {
    if (!editorRef.current) return;
    const html = getEditorHtml(editorRef.current);
    scheduleAutoSave(html);
  }

  async function handleManualSave() {
    if (!editorRef.current) return;
    clearTimeout(saveTimer.current);
    const html = getEditorHtml(editorRef.current);
    currentHtmlRef.current = html;
    try {
      await api(`/api/notes/${note.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ body: html, title: editorTitle || null })
      });
      if (onReload) onReload();
      setSaveLabel('Saved ✓');
      clearTimeout(feedbackTimer.current);
      feedbackTimer.current = setTimeout(() => setSaveLabel('Save'), 1000);
    } catch {
      setSaveLabel('Save');
    }
  }

  async function handlePinToggle() {
    const newPinned = !pinned;
    setPinned(newPinned);
    try {
      await api(`/api/notes/${note.id}`, { method: 'PATCH', body: JSON.stringify({ pinned: newPinned }) });
      if (onReload) onReload();
    } catch {}
  }

  async function handleDelete() {
    if (!confirm('Delete this note?')) return;
    try {
      await api(`/api/notes/${note.id}`, { method: 'DELETE' });
      if (onReload) onReload();
      onBack();
    } catch (e) { alert(e.message); }
  }

  async function handleMoveToFolder(targetFolder) {
    setShowMoveSheet(false);
    try {
      await api(`/api/notes/${note.id}`, { method: 'PATCH', body: JSON.stringify({ folder_id: targetFolder.id }) });
      if (onReload) onReload();
      if (onMoveNote) onMoveNote(targetFolder);
      onBack();
    } catch (e) { alert(e.message); }
  }

  // Flush pending save on back; discard brand-new empty note (iPhone behavior)
  async function handleBack() {
    clearTimeout(saveTimer.current);
    const html = editorRef.current ? getEditorHtml(editorRef.current) : currentHtmlRef.current;
    const isEmpty = !html || html.replace(/<[^>]*>/g, '').replace(/\s/g, '') === '';
    if (isNewEmpty.current && isEmpty) {
      // Discard: delete the empty new note silently
      try { await api(`/api/notes/${note.id}`, { method: 'DELETE' }); } catch {}
      if (onReload) onReload();
      onBack();
      return;
    }
    // Flush unsaved changes
    if (html !== (note.body || '')) {
      try {
        await api(`/api/notes/${note.id}`, { method: 'PATCH', body: JSON.stringify({ body: html }) });
        if (onReload) onReload();
      } catch {}
    }
    onBack();
  }

  // ---- Formatting toolbar commands ----

  function cmdExec(cmd, value) {
    editorRef.current && editorRef.current.focus();
    document.execCommand(cmd, false, value || null);
    handleEditorInput();
  }

  function fmtBold() { cmdExec('bold'); }
  function fmtItalic() { cmdExec('italic'); }
  function fmtUnderline() { cmdExec('underline'); }

  // Heading: wrap the current block in <h1> if not already; else convert back to <p>
  function fmtHeading() {
    editorRef.current && editorRef.current.focus();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    // Walk up from anchor to find block-level container inside editor
    let node = sel.anchorNode;
    while (node && node !== editorRef.current) {
      if (node.nodeType === 1 && /^(P|DIV|H[1-6]|LI)$/.test(node.tagName)) break;
      node = node.parentNode;
    }
    if (!node || node === editorRef.current) {
      // Fallback: formatBlock
      document.execCommand('formatBlock', false, 'h1');
    } else if (/^H[1-6]$/.test(node.tagName)) {
      document.execCommand('formatBlock', false, 'p');
    } else {
      document.execCommand('formatBlock', false, 'h1');
    }
    handleEditorInput();
  }

  function fmtBullet() {
    editorRef.current && editorRef.current.focus();
    document.execCommand('insertUnorderedList', false, null);
    handleEditorInput();
  }

  // Insert a checklist item at current cursor position
  function fmtChecklist() {
    editorRef.current && editorRef.current.focus();
    const sel = window.getSelection();
    const selectedText = sel && !sel.isCollapsed ? sel.toString() : '';
    const nonEmptyLines = selectedText ? selectedText.split('\n').filter(l => l.trim()) : [];
    if (nonEmptyLines.length > 0) {
      // Bulk convert: replace selection with one cl-item per non-empty line
      const html = nonEmptyLines.map(line => {
        const escaped = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `<div class="cl-item" data-checked="false"><button class="cl-btn" tabindex="-1" type="button">◯</button><span class="cl-text">${escaped}</span></div>`;
      }).join('');
      document.execCommand('insertHTML', false, html);
    } else {
      // No selection (or whitespace-only) — insert single empty item
      const clHtml = '<div class="cl-item" data-checked="false"><button class="cl-btn" tabindex="-1" type="button">◯</button><span class="cl-text"> </span></div>';
      document.execCommand('insertHTML', false, clHtml);
    }
    handleEditorInput();
  }

  // Checklist toggle — event delegation on editor div
  function handleEditorClick(e) {
    const btn = e.target.closest('.cl-btn');
    if (!btn) return;
    const item = btn.closest('.cl-item');
    if (!item) return;
    const checked = item.getAttribute('data-checked') === 'true';
    item.setAttribute('data-checked', (!checked).toString());
    btn.textContent = checked ? '◯' : '◉';
    handleEditorInput();
  }

  // Same handler for touch (prevent double-fire)
  function handleEditorTouchEnd(e) {
    const btn = e.target.closest('.cl-btn');
    if (!btn) return;
    e.preventDefault();
    handleEditorClick(e);
  }

  const otherFolders = (folders || []).filter(f => f.id !== (folder && folder.id));

  return html`
    <div class="ios-editor-screen">
      <div class="ios-notes-header ios-editor-header">
        <button class="ios-back-btn" onclick=${handleBack}>
          <span class="ios-back-chevron">‹</span>
          <span>${folder ? folder.name : 'Notes'}</span>
        </button>
        <div class="ios-editor-actions">
          <button class="ios-editor-action-btn" onclick=${handlePinToggle}
                  title=${pinned ? 'Unpin' : 'Pin'}>
            ${pinned ? '📌' : '📍'}
          </button>
          ${otherFolders.length > 0 && html`
            <button class="ios-editor-action-btn" onclick=${() => setShowMoveSheet(true)}
                    title="Move to folder">📂</button>
          `}
          <button class="ios-editor-action-btn ios-delete-btn" onclick=${handleDelete}
                  title="Delete">🗑</button>
        </div>
      </div>

      <div class="ios-format-toolbar">
        <button class="ios-fmt-btn" onmousedown=${e => { e.preventDefault(); fmtBold(); }} title="Bold"><b>B</b></button>
        <button class="ios-fmt-btn" onmousedown=${e => { e.preventDefault(); fmtItalic(); }} title="Italic"><i>I</i></button>
        <button class="ios-fmt-btn" onmousedown=${e => { e.preventDefault(); fmtUnderline(); }} title="Underline"><u>U</u></button>
        <div class="ios-fmt-divider"></div>
        <button class="ios-fmt-btn" onmousedown=${e => { e.preventDefault(); fmtHeading(); }} title="Heading">H</button>
        <button class="ios-fmt-btn" onmousedown=${e => { e.preventDefault(); fmtBullet(); }} title="Bullet list">• ≡</button>
        <button class="ios-fmt-btn" onmousedown=${e => { e.preventDefault(); fmtChecklist(); }} title="Checklist">◯✓</button>
        <div class="ios-fmt-divider"></div>
        <button class="ios-fmt-btn" onmousedown=${e => { e.preventDefault(); if (fontSizeIdx > 0) handleFontChange(fontSizeIdx - 1); }} title="Smaller text">A−</button>
        <button class="ios-fmt-btn" onmousedown=${e => { e.preventDefault(); if (fontSizeIdx < FONT_SIZES.length - 1) handleFontChange(fontSizeIdx + 1); }} title="Larger text">A+</button>
        <div class="ios-fmt-divider"></div>
        <button class=${'ios-fmt-btn' + (saveLabel === 'Saved ✓' ? ' saved' : '')}
                onmousedown=${e => { e.preventDefault(); handleManualSave(); }}
                title="Save">${saveLabel}</button>
      </div>

      <input class="ios-editor-title"
             type="text"
             placeholder="Note title…"
             value=${editorTitle}
             onInput=${e => setEditorTitle(e.target.value)}
             onBlur=${handleTitleSave}
      />

      <div class="ios-editor-body">
        <div ref=${editorRef}
             class="ios-editor-rich"
             contenteditable="true"
             spellcheck="true"
             data-placeholder="Start typing…"
             style=${'font-size:' + FONT_SIZES[fontSizeIdx] + 'px'}
             onInput=${handleEditorInput}
             onclick=${handleEditorClick}
             ontouchend=${handleEditorTouchEnd}
        ></div>
      </div>

      ${showMoveSheet && html`
        <${IosMoveFolderSheet}
          note=${note}
          folders=${folders || []}
          currentFolderId=${folder && folder.id}
          onMove=${handleMoveToFolder}
          onClose=${() => setShowMoveSheet(false)}
        />
      `}
    </div>
  `;
}

// --- Folders screen ---
function IosNotesPage() {
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  // nav state: null = folders screen, {folder} = notes list, {folder, note} = editor
  const [currentFolder, setCurrentFolder] = useState(null);
  const [currentNote, setCurrentNote] = useState(null);
  const reloadNotesRef = useRef(null);

  const loadFolders = useCallback(() => {
    setLoading(true);
    api('/api/note-folders').then(d => {
      setFolders(d.folders || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  useEffect(() => { loadFolders(); }, [loadFolders]);

  // --- Folder CRUD ---
  async function handleCreateFolder() {
    const name = window.prompt('Folder name:');
    if (!name || !name.trim()) return;
    try {
      await api('/api/note-folders', { method: 'POST', body: JSON.stringify({ name: name.trim() }) });
      loadFolders();
    } catch (e) { alert(e.message); }
  }

  async function handleRenameFolder(f) {
    // Default "Notes" folder is protected — match iPhone behavior: skip rename
    if (f.is_default) { alert('The default "Notes" folder cannot be renamed.'); return; }
    const name = window.prompt('Rename folder:', f.name);
    if (!name || !name.trim() || name.trim() === f.name) return;
    try {
      await api(`/api/note-folders/${f.id}`, { method: 'PATCH', body: JSON.stringify({ name: name.trim() }) });
      loadFolders();
    } catch (e) { alert(e.message); }
  }

  async function handleDeleteFolder(f) {
    if (f.is_default) { alert('The default "Notes" folder cannot be deleted.'); return; }
    if (!confirm(`Delete folder "${f.name}"?\nIts notes will be moved to the default Notes folder.`)) return;
    try {
      await api(`/api/note-folders/${f.id}`, { method: 'DELETE' });
      loadFolders();
    } catch (e) {
      // 4xx from API (e.g. default folder guard on server side)
      alert(e.message || 'Cannot delete this folder.');
    }
  }

  // --- Routing within the notes stack ---
  if (currentNote && currentFolder) {
    return html`<${IosNoteEditor}
      note=${currentNote}
      folder=${currentFolder}
      folders=${folders}
      onBack=${() => setCurrentNote(null)}
      onReload=${reloadNotesRef.current || null}
      onMoveNote=${(targetFolder) => {
        // After moving from editor, go back to the list screen (note left current folder)
        if (reloadNotesRef.current) reloadNotesRef.current();
      }}
    />`;
  }

  if (currentFolder) {
    return html`<${IosNotesList}
      folder=${currentFolder}
      folders=${folders}
      onBack=${() => { setCurrentFolder(null); loadFolders(); }}
      onOpenNote=${(note, reloadFn) => {
        reloadNotesRef.current = reloadFn;
        setCurrentNote(note);
      }}
      onNewNote=${() => {}}
      onPinNote=${loadFolders}
    />`;
  }

  // --- Folders screen ---
  return html`
    <div class="ios-notes-screen">
      <div class="ios-folders-header ios-folders-header--row">
        <h1 class="ios-folders-title">Notes</h1>
        <div class="ios-folders-header-actions">
          <button class="ios-folder-edit-toggle" onclick=${() => setEditMode(v => !v)}>
            ${editMode ? 'Done' : 'Edit'}
          </button>
          <button class="ios-folder-new-btn" onclick=${handleCreateFolder} title="New Folder">
            <span class="ios-folder-new-icon">📁+</span>
          </button>
        </div>
      </div>

      ${loading ? html`<div class="ios-loading">Loading...</div>` : html`
        <div class="ios-list-body">
          <div class="ios-section-header">iCloud</div>
          <div class="ios-list-group">
            ${folders.map(f => html`
              <${IosFolderRow}
                key=${f.id}
                folder=${f}
                editMode=${editMode}
                onOpen=${(folder) => setCurrentFolder(folder)}
                onDelete=${handleDeleteFolder}
                onRename=${handleRenameFolder}
              />
            `)}
            ${folders.length === 0 && html`
              <div class="ios-empty-state">No folders found.</div>
            `}
          </div>

          ${!editMode && html`
            <div class="ios-folder-new-row" onclick=${handleCreateFolder}>
              <span class="ios-folder-new-row-icon">📁</span>
              <span class="ios-folder-new-row-label">New Folder</span>
            </div>
          `}
        </div>
      `}
    </div>
  `;
}


function IosFolderRow({ folder, editMode, onOpen, onDelete, onRename }) {
  const [swiped, setSwiped] = useState(false);
  const touchStartX = useRef(null);

  function handleTouchStart(e) {
    if (folder.is_default) return;
    touchStartX.current = e.touches[0].clientX;
  }
  function handleTouchMove(e) {
    if (touchStartX.current === null) return;
    const dx = e.touches[0].clientX - touchStartX.current;
    if (dx < -50) setSwiped(true);
    else if (dx > 20) setSwiped(false);
  }
  function handleTouchEnd() {
    touchStartX.current = null;
  }
  function handleContextMenu(e) {
    if (folder.is_default) return;
    e.preventDefault();
    setSwiped(v => !v);
  }

  return html`
    <div class="ios-folder-row-wrap">
      <div class=${'ios-folder-row' + (editMode ? ' ios-folder-row--edit' : '') + (swiped ? ' ios-folder-row--swiped' : '')}
           ontouchstart=${handleTouchStart}
           ontouchmove=${handleTouchMove}
           ontouchend=${handleTouchEnd}
           oncontextmenu=${handleContextMenu}
           onclick=${() => { if (!editMode && !swiped) onOpen(folder); else if (swiped) setSwiped(false); }}>
        ${editMode && !folder.is_default && html`
          <button class="ios-folder-delete-circle" title="Delete folder"
                  onclick=${(e) => { e.stopPropagation(); onDelete(folder); }}>
            <span>–</span>
          </button>
        `}
        ${editMode && folder.is_default && html`
          <span class="ios-folder-delete-circle ios-folder-delete-circle--disabled" title="Default folder">–</span>
        `}
        <span class="ios-folder-icon">📁</span>
        <span class="ios-folder-name">${folder.name}</span>
        <span class="ios-folder-count">${folder.note_count ?? ''}</span>
        ${editMode && !folder.is_default
          ? html`<button class="ios-folder-rename-btn" onclick=${(e) => { e.stopPropagation(); onRename(folder); }}>Rename</button>`
          : html`<span class="ios-folder-chevron">${editMode ? '' : '›'}</span>`
        }
      </div>
      ${!folder.is_default && html`
        <div class="ios-folder-swipe-actions">
          <button class="ios-swipe-action-btn ios-swipe-delete-btn"
                  onclick=${(e) => { e.stopPropagation(); setSwiped(false); onDelete(folder); }}>
            Delete
          </button>
        </div>
      `}
    </div>
    <div class="ios-list-divider ios-list-divider--indent"></div>
  `;
}


// Plans Tab
function PlansTab({ projectId }) {
  const [plans, setPlans] = useState([]);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showCompleted, setShowCompleted] = useState(false);

  const load = useCallback(() => {
    api(`/api/projects/${projectId}/plans`).then(d => { setPlans(d.plans); setLoading(false); }).catch(() => setLoading(false));
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return html`<div class="loading">Loading...</div>`;

  if (selectedPlan) {
    return html`<${PlanDetail} planId=${selectedPlan} onBack=${() => { setSelectedPlan(null); load(); }} projectId=${projectId} />`;
  }

  const activePlans = plans.filter(p => p.status !== 'completed');
  const completedPlans = plans.filter(p => p.status === 'completed');
  const displayPlans = showCompleted ? plans : activePlans;

  return html`
    <div>
      <div class="action-bar">
        <div style="display:flex;align-items:center;gap:12px">
          <h3>${activePlans.length} Plans</h3>
          ${completedPlans.length > 0 && html`
            <label style="font-size:12px;color:var(--text-secondary);cursor:pointer;display:flex;align-items:center;gap:4px">
              <input type="checkbox" checked=${showCompleted} onchange=${() => setShowCompleted(v => !v)} />
              Show inserted (${completedPlans.length})
            </label>
          `}
        </div>
        <button class="btn btn-sm btn-primary" onclick=${async () => {
          const title = prompt('Plan title:');
          if (!title) return;
          await api(`/api/projects/${projectId}/plans`, { method: 'POST', body: JSON.stringify({ title }) });
          load();
        }}>New Plan</button>
      </div>
      <div class="item-list">
        ${displayPlans.map(p => html`
          <div class="item-card" style="cursor:pointer;${p.status === 'completed' ? 'opacity:0.6' : ''}" onclick=${() => setSelectedPlan(p.id)}>
            <div style="display:flex;justify-content:space-between;align-items:center">
              <h4>${p.title}</h4>
              <div style="display:flex;align-items:center;gap:6px">
                <span class="badge badge-${p.status}">${p.status}</span>
                <button class="btn btn-sm btn-danger" onclick=${async (e) => {
                  e.stopPropagation();
                  if (!confirm('Delete plan "' + p.title + '"? This will also delete all its steps.')) return;
                  await api('/api/plans/' + p.id, { method: 'DELETE' });
                  load();
                }} style="padding:2px 8px;font-size:11px">Del</button>
              </div>
            </div>
            ${p.description && html`<p>${p.description.slice(0, 150)}</p>`}
            <div class="meta">${new Date(p.created_at).toLocaleString()}</div>
          </div>
        `)}
        ${displayPlans.length === 0 && html`<div class="empty-state">No plans yet. Select notes and add them to a plan.</div>`}
      </div>
    </div>
  `;
}

// Plan Detail
function PlanStepCard({ step: s, planId, projectId, onReload }) {
  const [editing, setEditing] = useState(false);
  const [editDesc, setEditDesc] = useState(s.description);

  if (editing) {
    return html`
      <div class="item-card" style="display:flex;align-items:center;gap:8px">
        <input type="checkbox" checked=${s.completed} disabled />
        <input style="flex:1" value=${editDesc} onInput=${e => setEditDesc(e.target.value)}
               onKeyDown=${e => {
                 if (e.key === 'Enter') { e.target.blur(); saveEdit(); }
                 if (e.key === 'Escape') { setEditDesc(s.description); setEditing(false); }
               }}
               autofocus />
        <button class="btn btn-sm btn-primary" onclick=${saveEdit}>Save</button>
        <button class="btn btn-sm" onclick=${() => { setEditDesc(s.description); setEditing(false); }}>Cancel</button>
      </div>
    `;
  }

  async function saveEdit() {
    if (!editDesc.trim()) return;
    await api(`/api/plans/${planId}/steps/${s.id}`, {
      method: 'PATCH', body: JSON.stringify({ description: editDesc.trim() })
    });
    setEditing(false);
    onReload();
  }

  return html`
    <div class="item-card" style="display:flex;align-items:center;gap:8px">
      <input type="checkbox" checked=${s.completed} onchange=${async () => {
        await api(`/api/plans/${planId}/steps/${s.id}`, {
          method: 'PATCH', body: JSON.stringify({ completed: !s.completed })
        });
        onReload();
      }} />
      <span style=${s.completed ? 'text-decoration:line-through;color:var(--text-secondary);flex:1;cursor:pointer' : 'flex:1;cursor:pointer'}
            ondblclick=${() => setEditing(true)}>${s.description}</span>
      <button class="btn btn-sm" onclick=${() => setEditing(true)}>Edit</button>
      <button class="btn btn-sm" onclick=${async () => {
        await api(`/api/plans/${planId}/tasks`, {
          method: 'POST',
          body: JSON.stringify({ project_id: Number(projectId), plan_step_id: s.id, title: s.description })
        });
        alert('Task created');
      }}>Create Task</button>
    </div>
  `;
}

function AddFromTemplate({ planId, onReload }) {
  const [show, setShow] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);

  async function open() {
    setShow(true);
    setLoading(true);
    try {
      const d = await api('/api/templates');
      setTemplates(d.templates);
    } catch { setTemplates([]); }
    setLoading(false);
  }

  async function apply(templateId) {
    setApplying(true);
    try {
      await api(`/api/plans/${planId}/apply-template`, {
        method: 'POST', body: JSON.stringify({ template_id: templateId })
      });
      setShow(false);
      onReload();
    } catch (e) { alert('Failed: ' + e.message); }
    setApplying(false);
  }

  if (!show) return html`<button class="btn btn-sm" onclick=${open}>Add from Template</button>`;

  return html`
    <div class="modal-overlay" onclick=${() => setShow(false)}>
      <div class="modal" style="max-width:450px" onclick=${e => e.stopPropagation()}>
        <h3>Add Steps from Template</h3>
        ${loading ? html`<div class="loading">Loading...</div>` : html`
          <div class="item-list" style="max-height:350px;overflow-y:auto">
            ${templates.map(t => html`
              <div class="item-card" style="cursor:pointer;padding:10px 14px" onclick=${() => !applying && apply(t.id)}>
                <div style="font-weight:500">${t.name}</div>
                <div style="font-size:11px;color:var(--text-secondary)">${new Date(t.created_at).toLocaleString()}</div>
              </div>
            `)}
            ${templates.length === 0 && html`<div class="empty-state" style="padding:16px">No templates yet. Create one in Settings.</div>`}
          </div>
        `}
        <div class="modal-actions">
          <button class="btn" onclick=${() => setShow(false)}>Cancel</button>
        </div>
      </div>
    </div>
  `;
}

function PlanDetail({ planId, onBack, projectId }) {
  const [plan, setPlan] = useState(null);
  const [linkedNotes, setLinkedNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showInsert, setShowInsert] = useState(false);
  const [folders, setFolders] = useState([]);
  const [insertMode, setInsertMode] = useState('new'); // 'new' | 'existing'
  const [newFolderName, setNewFolderName] = useState('');
  const [selectedFolder, setSelectedFolder] = useState('');
  const [inserting, setInserting] = useState(false);
  const [editingPlan, setEditingPlan] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');

  const load = useCallback(async () => {
    try {
      const [planData, notesData] = await Promise.all([
        api(`/api/plans/${planId}`),
        api(`/api/plans/${planId}/notes`)
      ]);
      setPlan(planData.plan);
      setLinkedNotes(notesData.notes);
    } catch {}
    setLoading(false);
  }, [planId]);

  useEffect(() => { load(); }, [load]);

  async function openInsertModal() {
    try {
      const d = await api(`/api/plans/${planId}/folders`);
      setFolders(d.folders);
    } catch { setFolders([]); }
    setInsertMode(folders.length > 0 ? 'existing' : 'new');
    setNewFolderName('');
    setSelectedFolder('');
    setShowInsert(true);
  }

  async function doInsert() {
    const folder = insertMode === 'new' ? newFolderName.trim() : selectedFolder;
    if (!folder) return;
    setInserting(true);
    try {
      const result = await api(`/api/plans/${planId}/insert`, {
        method: 'POST',
        body: JSON.stringify({ folder, createNew: insertMode === 'new' })
      });
      setShowInsert(false);
      alert(`Plan inserted to ${result.path}`);
      onBack();
    } catch (e) {
      alert('Insert failed: ' + e.message);
    }
    setInserting(false);
  }

  if (loading) return html`<div class="loading">Loading...</div>`;
  if (!plan) return html`<div class="empty-state">Plan not found</div>`;

  return html`
    <div>
      ${showInsert && html`
        <div class="modal-overlay" onclick=${() => setShowInsert(false)}>
          <div class="modal" style="max-width:450px" onclick=${e => e.stopPropagation()}>
            <h3>Insert Plan to Project</h3>
            <p style="font-size:12px;color:var(--text-secondary);margin-bottom:12px">
              This will generate a <code>plan.md</code> file inside the selected folder under <code>plan/</code> and mark this plan as completed.
            </p>
            <div style="display:flex;gap:8px;margin-bottom:16px">
              <button class="btn btn-sm ${insertMode === 'new' ? 'btn-primary' : ''}" onclick=${() => setInsertMode('new')}>New Folder</button>
              <button class="btn btn-sm ${insertMode === 'existing' ? 'btn-primary' : ''}" onclick=${() => setInsertMode('existing')}>Existing Folder</button>
            </div>
            ${insertMode === 'new' ? html`
              <div class="form-group">
                <label>Folder Name</label>
                <div style="display:flex;align-items:center;gap:4px">
                  <span style="color:var(--text-secondary);font-size:13px">plan/</span>
                  <input value=${newFolderName} onInput=${e => setNewFolderName(e.target.value)}
                         onKeyDown=${e => e.key === 'Enter' && doInsert()}
                         placeholder="e.g. plan02, feature-auth" autofocus />
                </div>
              </div>
            ` : html`
              <div class="form-group">
                <label>Select Folder</label>
                ${folders.length > 0 ? html`
                  <div class="item-list" style="max-height:250px;overflow-y:auto">
                    ${folders.map(f => html`
                      <div class="item-card" style="cursor:pointer;padding:8px 12px;display:flex;justify-content:space-between;align-items:center;${selectedFolder === f.name ? 'border-color:var(--accent);background:rgba(88,166,255,0.08)' : ''}"
                           onclick=${() => setSelectedFolder(f.name)}>
                        <div>
                          <div style="font-weight:500;font-size:13px">plan/${f.name}/</div>
                          <div style="font-size:11px;color:var(--text-secondary)">${f.files.length} file${f.files.length !== 1 ? 's' : ''}${f.files.length > 0 ? ': ' + f.files.slice(0, 3).join(', ') + (f.files.length > 3 ? '...' : '') : ''}</div>
                        </div>
                        ${selectedFolder === f.name && html`<span style="color:var(--accent);font-size:16px">✓</span>`}
                      </div>
                    `)}
                  </div>
                ` : html`<p style="color:var(--text-secondary);font-size:13px">No existing folders in plan/. Create a new one instead.</p>`}
              </div>
            `}
            <div class="modal-actions">
              <button class="btn" onclick=${() => setShowInsert(false)}>Cancel</button>
              <button class="btn btn-primary" onclick=${doInsert} disabled=${inserting || (insertMode === 'new' ? !newFolderName.trim() : !selectedFolder)}>
                ${inserting ? 'Inserting...' : 'Insert'}
              </button>
            </div>
          </div>
        </div>
      `}

      <div class="action-bar">
        <h3 style="cursor:pointer" onclick=${onBack}>← ${editingPlan ? 'Editing...' : plan.title}</h3>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="badge badge-${plan.status}">${plan.status}</span>
          ${plan.status !== 'completed' && !editingPlan && html`
            <button class="btn btn-sm" onclick=${() => { setEditTitle(plan.title); setEditDesc(plan.description || ''); setEditingPlan(true); }}>Edit</button>
            <button class="btn btn-sm btn-primary" onclick=${openInsertModal}>
              Insert to Project
            </button>
          `}
          <button class="btn btn-sm btn-danger" onclick=${async () => {
            if (!confirm('Delete this plan and all its steps?')) return;
            await api('/api/plans/' + planId, { method: 'DELETE' });
            onBack();
          }}>Delete</button>
        </div>
      </div>

      ${editingPlan ? html`
        <div class="item-card" style="margin-bottom:16px">
          <div class="form-group" style="margin-bottom:8px">
            <label>Title</label>
            <input value=${editTitle} onInput=${e => setEditTitle(e.target.value)} />
          </div>
          <div class="form-group" style="margin-bottom:8px">
            <label>Description</label>
            <textarea rows="3" value=${editDesc} onInput=${e => setEditDesc(e.target.value)} placeholder="Plan description (optional)"></textarea>
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-sm btn-primary" onclick=${async () => {
              if (!editTitle.trim()) return;
              await api(`/api/plans/${planId}`, { method: 'PATCH', body: JSON.stringify({ title: editTitle.trim(), description: editDesc.trim() || null }) });
              setEditingPlan(false);
              load();
            }}>Save</button>
            <button class="btn btn-sm" onclick=${() => setEditingPlan(false)}>Cancel</button>
          </div>
        </div>
      ` : html`
        ${plan.description && html`<p style="margin-bottom:16px;color:var(--text-secondary)">${plan.description}</p>`}
      `}

      ${linkedNotes.length > 0 && html`
        <h4 style="margin-bottom:8px">Linked Notes (${linkedNotes.length})</h4>
        <div class="item-list" style="margin-bottom:16px">
          ${linkedNotes.map(n => html`
            <div class="item-card" style="border-left:3px solid var(--accent)">
              <h4 style="font-size:13px">${n.title || 'Untitled'}</h4>
              <p style="font-size:12px;color:var(--text-secondary);white-space:pre-wrap">${n.body.slice(0, 300)}${n.body.length > 300 ? '...' : ''}</p>
            </div>
          `)}
        </div>
      `}

      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <h4>Steps (${plan.steps.length})</h4>
        <div style="display:flex;gap:6px;align-items:center">
          ${plan.steps.length > 0 && html`
            <button class="btn btn-sm" onclick=${async () => {
              const name = prompt('Save steps as template named:');
              if (!name) return;
              await api('/api/templates/from-plan', { method: 'POST', body: JSON.stringify({ plan_id: planId, name }) });
              alert('Template saved!');
            }}>Save as Template</button>
          `}
          <button class="btn btn-sm" onclick=${async () => {
            const desc = prompt('Step description:');
            if (!desc) return;
            await api(`/api/plans/${planId}/steps`, { method: 'POST', body: JSON.stringify({ description: desc }) });
            load();
          }}>Add Step</button>
          <${AddFromTemplate} planId=${planId} onReload=${load} />
        </div>
      </div>
      <div class="item-list" style="margin-bottom:16px">
        ${plan.steps.map(s => html`
          <${PlanStepCard} key=${s.id} step=${s} planId=${planId} projectId=${projectId} onReload=${load} />
        `)}
        ${plan.steps.length === 0 && html`<div class="empty-state" style="padding:16px">No steps yet. Add steps to outline the plan.</div>`}
      </div>
    </div>
  `;
}

// Tasks Tab
function TasksTab({ projectId }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    api(`/api/projects/${projectId}/tasks`).then(d => { setTasks(d.tasks); setLoading(false); }).catch(() => setLoading(false));
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return html`<div class="loading">Loading...</div>`;

  const columns = [
    { key: 'pending', label: 'Pending' },
    { key: 'in_progress', label: 'In Progress' },
    { key: 'completed', label: 'Completed' },
    { key: 'failed', label: 'Failed' }
  ];

  return html`
    <div class="kanban">
      ${columns.map(col => html`
        <div class="kanban-column">
          <h4>${col.label} (${tasks.filter(t => t.status === col.key).length})</h4>
          ${tasks.filter(t => t.status === col.key).map(t => html`
            <div class="kanban-card">
              <div style="font-weight:500;margin-bottom:4px">${t.title}</div>
              ${t.assigned_to && html`<div style="font-size:11px;color:var(--text-secondary)">Assigned: ${t.assigned_to}</div>`}
              <div style="display:flex;gap:4px;margin-top:6px">
                ${col.key === 'pending' && html`<button class="btn btn-sm" onclick=${async () => {
                  const executor = prompt('Executor (agent name or "operator"):', t.assigned_to || 'operator');
                  if (!executor) return;
                  await api(`/api/tasks/${t.id}/execute`, { method: 'POST', body: JSON.stringify({ executor }) });
                  load();
                }}>Start</button>`}
                ${col.key !== 'completed' && col.key !== 'failed' && html`
                  <select class="btn btn-sm" style="padding:2px 4px" onchange=${async (e) => {
                    if (!e.target.value) return;
                    await api(`/api/tasks/${t.id}`, { method: 'PATCH', body: JSON.stringify({ status: e.target.value }) });
                    e.target.value = '';
                    load();
                  }}>
                    <option value="">Move...</option>
                    ${columns.filter(c => c.key !== col.key).map(c => html`<option value=${c.key}>${c.label}</option>`)}
                  </select>
                `}
              </div>
            </div>
          `)}
        </div>
      `)}
    </div>
    ${tasks.length === 0 && html`<div class="empty-state" style="margin-top:16px">No tasks yet. Create tasks from plan steps.</div>`}
  `;
}

// Activity Tab
function ActivityTab() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api('/api/audit?limit=50').then(d => { setEntries(d.entries); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  if (loading) return html`<div class="loading">Loading...</div>`;

  return html`
    <div class="item-list">
      ${entries.map(e => html`
        <div class="item-card" style="padding:8px 12px;font-size:13px">
          <div style="display:flex;justify-content:space-between">
            <span>
              <strong>${e.action_type}</strong>
              ${e.agent_name ? html` by <span style="color:var(--accent)">${e.agent_name}</span>` : ''}
              ${e.resource_type ? html` on ${e.resource_type}${e.resource_id ? ` #${e.resource_id}` : ''}` : ''}
            </span>
            <span style="color:var(--text-secondary);font-size:11px">${new Date(e.timestamp).toLocaleString()}</span>
          </div>
        </div>
      `)}
      ${entries.length === 0 && html`<div class="empty-state">No activity yet</div>`}
    </div>
  `;
}

// ===================== TASKS SECTION =====================

// Sub-tabs component
function SubTabs({ tabs, active, onSelect }) {
  return html`
    <div class="sub-tabs">
      ${tabs.map(t => html`
        <div class="sub-tab ${active === t.key ? 'active' : ''}"
             onclick=${() => onSelect(t.key)}>
          ${t.label}
        </div>
      `)}
    </div>
  `;
}

// Day-of-week bitmask picker
function DayOfWeekPicker({ value, onChange }) {
  const days = [
    { label: 'Su', bit: 0 },
    { label: 'M', bit: 1 },
    { label: 'T', bit: 2 },
    { label: 'W', bit: 3 },
    { label: 'Th', bit: 4 },
    { label: 'F', bit: 5 },
    { label: 'Sa', bit: 6 },
  ];

  function toggle(bit) {
    const mask = 1 << bit;
    const newValue = (value || 0) ^ mask;
    onChange(newValue);
  }

  return html`
    <div style="display:flex;gap:4px">
      ${days.map(d => {
        const isSet = ((value || 0) & (1 << d.bit)) !== 0;
        return html`
          <button class="btn btn-sm ${isSet ? 'btn-primary' : ''}"
                  style="width:32px;height:28px;padding:0;font-size:11px;font-weight:${isSet ? '600' : '400'}"
                  onclick=${() => toggle(d.bit)}
                  type="button">
            ${d.label}
          </button>
        `;
      })}
    </div>
  `;
}

// Helper to format bitmask as day labels
function bitmaskToDays(bitmask) {
  const labels = ['Su','M','T','W','Th','F','Sa'];
  if (!bitmask) return '';
  if (bitmask === 127) return 'Every day';
  const days = [];
  for (let i = 0; i < 7; i++) {
    if ((bitmask & (1 << i)) !== 0) days.push(labels[i]);
  }
  return days.join(', ');
}

// Expandable task card with sub-items
function TaskActionCard({ task, onReload }) {
  const [expanded, setExpanded] = useState(false);
  const [items, setItems] = useState([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [newItemText, setNewItemText] = useState('');

  const isChecked = task.frequency === 'daily' ? task.completed_today
    : task.frequency === 'weekly' ? task.completed_this_week
    : task.completed;

  async function loadItems() {
    setLoadingItems(true);
    try {
      const d = await api('/api/personal-tasks/' + task.id + '/items');
      setItems(d.items || []);
    } catch {}
    setLoadingItems(false);
  }

  async function toggleExpand() {
    if (!expanded) { await loadItems(); }
    setExpanded(!expanded);
  }

  async function addItem() {
    if (!newItemText.trim()) return;
    await api('/api/personal-tasks/' + task.id + '/items', {
      method: 'POST', body: JSON.stringify({ description: newItemText.trim() })
    });
    setNewItemText('');
    loadItems();
  }

  async function toggleItem(itemId) {
    await api('/api/personal-task-items/' + itemId + '/toggle', { method: 'POST' });
    loadItems();
  }

  async function deleteItem(itemId) {
    await api('/api/personal-task-items/' + itemId, { method: 'DELETE' });
    loadItems();
  }

  return html`
    <div class="item-card" style="padding:0;overflow:hidden">
      <div style="display:flex;align-items:center;gap:8px;padding:10px 12px;cursor:pointer" onclick=${toggleExpand}>
        <input type="checkbox" checked=${isChecked} onclick=${(e) => e.stopPropagation()} onchange=${async (e) => {
          e.stopPropagation();
          await api('/api/personal-tasks/' + task.id + '/toggle', { method: 'POST', body: JSON.stringify({}) });
          onReload();
        }} />
        <div style="flex:1;${isChecked ? 'text-decoration:line-through;color:var(--text-secondary)' : ''}">
          <div style="font-weight:500">${task.title}</div>
          ${task.description && html`<div style="font-size:11px;color:var(--text-secondary)">${task.description}</div>`}
        </div>
        ${task.template_id ? html`
          <span class="badge badge-active" style="font-size:10px">instance</span>
        ` : task.frequency === 'once' ? html`
          <span class="badge badge-pending" style="font-size:10px">one-off</span>
        ` : html`
          <span class="badge badge-draft" style="font-size:10px">${task.frequency}</span>
        `}
        <span style="font-size:11px;color:var(--text-secondary)">${expanded ? '\u25BC' : '\u25B6'}</span>
        <button class="btn btn-sm btn-danger" onclick=${async (e) => {
          e.stopPropagation();
          if (!confirm('Delete "' + task.title + '"?')) return;
          await api('/api/personal-tasks/' + task.id, { method: 'DELETE' });
          onReload();
        }} style="padding:2px 6px;font-size:10px" title="Delete">x</button>
      </div>
      ${expanded && html`
        <div style="border-top:1px solid var(--border);padding:8px 12px 8px 36px;background:var(--surface)">
          ${loadingItems ? html`<div style="font-size:12px;color:var(--text-secondary)">Loading...</div>` : html`
            ${items.map(item => html`
              <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
                <input type="checkbox" checked=${!!item.completed} onchange=${() => toggleItem(item.id)} />
                <span style="flex:1;font-size:13px;${item.completed ? 'text-decoration:line-through;color:var(--text-secondary)' : ''}">${item.description}</span>
                <button class="btn btn-sm btn-danger" onclick=${() => deleteItem(item.id)}
                        style="padding:1px 4px;font-size:10px">x</button>
              </div>
            `)}
            <div style="display:flex;gap:6px;margin-top:6px">
              <input value=${newItemText} onInput=${e => setNewItemText(e.target.value)}
                     onKeyDown=${e => e.key === 'Enter' && addItem()}
                     placeholder="Add sub-item..." style="flex:1;font-size:12px;padding:4px 8px" />
              <button class="btn btn-sm btn-primary" onclick=${addItem} style="font-size:11px;padding:2px 8px">Add</button>
            </div>
          `}
        </div>
      `}
    </div>
  `;
}

// TASKS TAB - action view with sub-tabs (Daily, Weekly, Reminders)
function TasksActionTab({ onReload }) {
  const [subTab, setSubTab] = useState('daily');
  const [viewMode, setViewMode] = useState('active'); // 'active' | 'completed'
  const [dailyTasks, setDailyTasks] = useState([]);
  const [weeklyTasks, setWeeklyTasks] = useState([]);
  const [oneOffTasks, setOneOffTasks] = useState([]);
  const [reminderTasks, setReminderTasks] = useState([]);
  const [completedTasks, setCompletedTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newOneOff, setNewOneOff] = useState('');
  const [generating, setGenerating] = useState(false);
  const [completedDays, setCompletedDays] = useState(7);
  const [expandedDates, setExpandedDates] = useState(new Set());

  const todayISO = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

  // Compute Saturday of this week
  function getSaturday() {
    // Use Manila date to determine the correct Saturday
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
    const d = new Date(todayStr + 'T00:00:00');
    const day = d.getDay();
    const diff = day === 6 ? 0 : 6 - day;
    d.setDate(d.getDate() + diff);
    return d.toISOString().slice(0, 10);
  }
  const saturdayISO = getSaturday();

  const loadData = useCallback(async () => {
    try {
      const [dailyD, weeklyD, oneOffD, remD] = await Promise.all([
        api('/api/personal-tasks?view=daily-instances&date=' + todayISO),
        api('/api/personal-tasks?view=weekly-instances&date=' + saturdayISO),
        api('/api/personal-tasks?view=oneoffs&date=' + todayISO),
        api('/api/reminders?view=tasks')
      ]);
      setDailyTasks(dailyD.tasks || []);
      setWeeklyTasks(weeklyD.tasks || []);
      setOneOffTasks(oneOffD.tasks || []);
      setReminderTasks(remD.reminders || []);
    } catch {}
    setLoading(false);
  }, []);

  const loadCompleted = useCallback(async () => {
    try {
      const d = await api('/api/personal-tasks?view=completed&days=' + completedDays);
      setCompletedTasks(d.tasks || []);
    } catch {}
  }, [completedDays]);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { if (viewMode === 'completed') loadCompleted(); }, [viewMode, loadCompleted]);

  function reloadAll() { loadData(); onReload(); }

  async function generateDaily(force) {
    setGenerating(true);
    try {
      const result = await api('/api/personal-tasks/generate', { method: 'POST', body: JSON.stringify({ date: todayISO, type: 'daily', force: !!force }) });
      if (result.message) alert(result.message);
      reloadAll();
    } catch (e) {
      if (!force && e.message && e.message.includes('already exist')) {
        if (confirm(e.message + '\n\nOverwrite and regenerate?')) {
          await generateDaily(true);
          return;
        }
      } else {
        alert(e.message);
      }
    }
    setGenerating(false);
  }

  async function generateWeekly(force) {
    setGenerating(true);
    try {
      const result = await api('/api/personal-tasks/generate', { method: 'POST', body: JSON.stringify({ date: todayISO, type: 'weekly', force: !!force }) });
      if (result.message) alert(result.message);
      reloadAll();
    } catch (e) {
      if (!force && e.message && e.message.includes('already exist')) {
        if (confirm(e.message + '\n\nOverwrite and regenerate?')) {
          await generateWeekly(true);
          return;
        }
      } else {
        alert(e.message);
      }
    }
    setGenerating(false);
  }

  async function addOneOff() {
    if (!newOneOff.trim()) return;
    const parentSelect = document.getElementById('oneoff-parent');
    const parentId = parentSelect ? parentSelect.value : '';
    const body = { title: newOneOff.trim(), frequency: 'once', target_date: todayISO };
    if (parentId) body.template_id = Number(parentId);
    await api('/api/personal-tasks', {
      method: 'POST',
      body: JSON.stringify(body)
    });
    setNewOneOff('');
    reloadAll();
  }

  async function addWeeklyOneOff() {
    if (!newOneOff.trim()) return;
    const parentSelect = document.getElementById('weeklyoneoff-parent');
    const parentId = parentSelect ? parentSelect.value : '';
    const body = { title: newOneOff.trim(), frequency: 'once', target_date: saturdayISO };
    if (parentId) body.template_id = Number(parentId);
    await api('/api/personal-tasks', {
      method: 'POST',
      body: JSON.stringify(body)
    });
    setNewOneOff('');
    reloadAll();
  }

  if (loading) return html`<div class="loading">Loading...</div>`;

  const subTabs = [
    { key: 'daily', label: 'Daily (' + dailyTasks.length + ')' },
    { key: 'weekly', label: 'Weekly (' + weeklyTasks.length + ')' },
    { key: 'reminders', label: 'Reminders' }
  ];

  const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const todayName = dayNames[new Date().getDay()];

  // Naming convention: DAY_YYMMDD_DT / DAY_YYMMDD_WT
  function fmtTaskLabel(d, type) {
    const days = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
    const day = days[d.getDay()];
    const yy = String(d.getFullYear()).slice(-2);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return day + '_' + yy + mm + dd + '_' + type;
  }
  const dailyLabel = fmtTaskLabel(new Date(), 'DT');
  const satDate = new Date(saturdayISO + 'T00:00:00');
  const weeklyLabel = fmtTaskLabel(satDate, 'WT');

  return html`
    <div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <div style="display:flex;gap:4px">
          <button class="btn btn-sm btn-primary" onclick=${() => generateDaily()} disabled=${generating}
                  style="font-size:11px;padding:3px 8px">
            ${generating ? 'Generating...' : 'Generate Daily'}
          </button>
          <button class="btn btn-sm btn-primary" onclick=${() => generateWeekly()} disabled=${generating}
                  style="font-size:11px;padding:3px 8px">
            ${generating ? 'Generating...' : 'Generate Weekly'}
          </button>
        </div>
        <div style="display:flex;gap:4px">
          <button class=${'btn btn-sm' + (viewMode === 'active' ? ' btn-primary' : '')} onclick=${() => setViewMode('active')}
                  style="font-size:11px;padding:3px 8px">Active</button>
          <button class=${'btn btn-sm' + (viewMode === 'completed' ? ' btn-primary' : '')} onclick=${() => setViewMode('completed')}
                  style="font-size:11px;padding:3px 8px">Completed</button>
        </div>
      </div>

      <${SubTabs} tabs=${subTabs} active=${subTab} onSelect=${setSubTab} />

      ${viewMode === 'completed' ? html`
        <div>
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap">
            <h4 style="margin:0;color:var(--text-secondary);font-size:12px;text-transform:uppercase;letter-spacing:1px">Completed Tasks</h4>
            <div style="display:flex;gap:2px;align-items:center;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:2px;margin-left:auto">
              ${[5, 7, 10, 15, 30].map(d => html`
                <button onclick=${() => setCompletedDays(d)}
                        style="padding:3px 7px;font-size:11px;border:none;border-radius:4px;cursor:pointer;background:${completedDays === d ? 'var(--accent)' : 'transparent'};color:${completedDays === d ? '#fff' : 'var(--text-secondary)'}">${d}d</button>
              `)}
            </div>
          </div>
          ${(() => {
            const groups = {};
            completedTasks.forEach(t => {
              if (t.template_id && completedTasks.find(p => p.id === t.template_id)) return;
              const dateKey = t.completed_at ? t.completed_at.slice(0, 10) : 'Unknown';
              if (!groups[dateKey]) groups[dateKey] = [];
              groups[dateKey].push(t);
            });
            const sortedDates = Object.keys(groups).sort((a, b) => b.localeCompare(a));
            if (sortedDates.length === 0) return html`<div class="empty-state" style="padding:16px">No completed tasks in the last ${completedDays} days.</div>`;
            return sortedDates.map(dateKey => {
              const dateLabel = dateKey === 'Unknown' ? 'Unknown Date' : new Date(dateKey + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' });
              const isExpanded = expandedDates.has(dateKey);
              const taskCount = groups[dateKey].length;
              return html`
                <div style="margin-bottom:12px">
                  <div onclick=${() => {
                    setExpandedDates(prev => {
                      const next = new Set(prev);
                      if (next.has(dateKey)) next.delete(dateKey); else next.add(dateKey);
                      return next;
                    });
                  }}
                       style="font-size:13px;font-weight:600;color:var(--text);padding:6px 10px;background:var(--surface);border-radius:var(--radius);border-left:3px solid var(--accent);cursor:pointer;display:flex;align-items:center;gap:8px;user-select:none">
                    <span style="font-size:10px;width:12px">${isExpanded ? '\u25BC' : '\u25B6'}</span>
                    <span style="flex:1">${dateLabel}</span>
                    <span style="font-size:11px;color:var(--text-secondary);font-weight:400">${taskCount} task${taskCount !== 1 ? 's' : ''}</span>
                  </div>
                  ${isExpanded && html`
                    <div class="item-list" style="margin-top:4px">
                      ${groups[dateKey].map(t => {
                        const children = completedTasks.filter(c => c.template_id === t.id);
                        return html`
                          <div key=${'c-' + t.id}>
                            <${TaskActionCard} task=${t} onReload=${() => { loadCompleted(); reloadAll(); }} />
                            ${children.map(c => html`
                              <div style="margin-left:24px;border-left:2px solid var(--border);padding-left:0">
                                <${TaskActionCard} key=${c.id} task=${c} onReload=${() => { loadCompleted(); reloadAll(); }} />
                              </div>
                            `)}
                          </div>
                        `;
                      })}
                    </div>
                  `}
                </div>
              `;
            });
          })()}
        </div>
      ` : html`
        ${subTab === 'daily' && html`
          <div>
            <div style="font-size:13px;font-weight:600;margin-bottom:8px">${dailyLabel} <span style="font-weight:400;color:var(--text-secondary);font-size:12px">(${todayName})</span></div>
            <div class="item-list">
              ${dailyTasks.map(t => html`
                <div key=${'group-' + t.id}
                     onDragOver=${e => { e.preventDefault(); e.currentTarget.style.outline = '2px dashed var(--primary)'; }}
                     onDragLeave=${e => { e.currentTarget.style.outline = ''; }}
                     onDrop=${async e => {
                       e.preventDefault();
                       e.currentTarget.style.outline = '';
                       const taskId = e.dataTransfer.getData('text/plain');
                       if (taskId) {
                         await api('/api/personal-tasks/' + taskId, {
                           method: 'PATCH', body: JSON.stringify({ template_id: t.id })
                         });
                         reloadAll();
                       }
                     }}>
                  <${TaskActionCard} key=${t.id} task=${t} onReload=${reloadAll} />
                  ${oneOffTasks.filter(o => o.template_id === t.id).map(o => html`
                    <div style="margin-left:24px;border-left:2px solid var(--border);padding-left:0"
                         draggable="true"
                         onDragStart=${e => { e.dataTransfer.setData('text/plain', String(o.id)); e.dataTransfer.effectAllowed = 'move'; }}>
                      <${TaskActionCard} key=${o.id} task=${o} onReload=${reloadAll} />
                    </div>
                  `)}
                </div>
              `)}
            </div>
            ${dailyTasks.length === 0 && oneOffTasks.filter(o => !o.template_id || (!dailyTasks.find(d => d.id === o.template_id) && !weeklyTasks.find(w => w.id === o.template_id))).length === 0 && html`<div class="empty-state" style="padding:16px;font-size:13px">No daily instances yet. Click "Generate Tasks" or wait for 2am auto-generation.</div>`}

            <div style="margin-top:12px;padding:8px;border:1px dashed var(--border);border-radius:6px;min-height:32px"
                 onDragOver=${e => { e.preventDefault(); e.currentTarget.style.borderColor = 'var(--primary)'; e.currentTarget.style.background = 'rgba(var(--primary-rgb,99,102,241),0.05)'; }}
                 onDragLeave=${e => { e.currentTarget.style.borderColor = ''; e.currentTarget.style.background = ''; }}
                 onDrop=${async e => {
                   e.preventDefault();
                   e.currentTarget.style.borderColor = '';
                   e.currentTarget.style.background = '';
                   const taskId = e.dataTransfer.getData('text/plain');
                   if (taskId) {
                     await api('/api/personal-tasks/' + taskId, {
                       method: 'PATCH', body: JSON.stringify({ template_id: null })
                     });
                     reloadAll();
                   }
                 }}>
              <div style="font-size:11px;color:var(--text-secondary);margin-bottom:4px">Standalone one-offs (drag here to detach)</div>
              ${oneOffTasks.filter(o => !o.template_id || (!dailyTasks.find(d => d.id === o.template_id) && !weeklyTasks.find(w => w.id === o.template_id))).map(o => html`
                <div draggable="true"
                     onDragStart=${e => { e.dataTransfer.setData('text/plain', String(o.id)); e.dataTransfer.effectAllowed = 'move'; }}
                     style="cursor:grab">
                  <${TaskActionCard} key=${o.id} task=${o} onReload=${reloadAll} />
                </div>
              `)}
            </div>

            <div style="display:flex;gap:6px;margin-top:12px">
              <select id="oneoff-parent" style="font-size:12px;padding:4px 6px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px;max-width:140px">
                <option value="">Standalone</option>
                ${dailyTasks.map(t => html`<option value=${t.id}>${t.title.slice(0, 25)}</option>`)}
              </select>
              <input value=${newOneOff} onInput=${e => setNewOneOff(e.target.value)}
                     onKeyDown=${e => e.key === 'Enter' && addOneOff()}
                     placeholder="Add one-off task..." style="flex:1;font-size:12px;padding:6px 10px" />
              <button class="btn btn-sm btn-primary" onclick=${addOneOff} style="font-size:11px;padding:4px 10px">Add</button>
            </div>
          </div>
        `}

        ${subTab === 'weekly' && html`
          <div>
            <div style="font-size:13px;font-weight:600;margin-bottom:8px">${weeklyLabel} <span style="font-weight:400;color:var(--text-secondary);font-size:12px">(Sat ${saturdayISO})</span></div>
            <div class="item-list">
              ${weeklyTasks.map(t => html`
                <div key=${'wgroup-' + t.id}
                     onDragOver=${e => { e.preventDefault(); e.currentTarget.style.outline = '2px dashed var(--primary)'; }}
                     onDragLeave=${e => { e.currentTarget.style.outline = ''; }}
                     onDrop=${async e => {
                       e.preventDefault();
                       e.currentTarget.style.outline = '';
                       const taskId = e.dataTransfer.getData('text/plain');
                       if (taskId) {
                         await api('/api/personal-tasks/' + taskId, {
                           method: 'PATCH', body: JSON.stringify({ template_id: t.id })
                         });
                         reloadAll();
                       }
                     }}>
                  <${TaskActionCard} key=${t.id} task=${t} onReload=${reloadAll} />
                  ${oneOffTasks.filter(o => o.template_id === t.id).map(o => html`
                    <div style="margin-left:24px;border-left:2px solid var(--border);padding-left:0"
                         draggable="true"
                         onDragStart=${e => { e.dataTransfer.setData('text/plain', String(o.id)); e.dataTransfer.effectAllowed = 'move'; }}>
                      <${TaskActionCard} key=${o.id} task=${o} onReload=${reloadAll} />
                    </div>
                  `)}
                </div>
              `)}
            </div>
            ${weeklyTasks.length === 0 && html`<div class="empty-state" style="padding:16px;font-size:13px">No weekly instances yet. Click "Generate Tasks" or wait for 2am auto-generation.</div>`}

            <div style="margin-top:12px;padding:8px;border:1px dashed var(--border);border-radius:6px;min-height:32px"
                 onDragOver=${e => { e.preventDefault(); e.currentTarget.style.borderColor = 'var(--primary)'; e.currentTarget.style.background = 'rgba(var(--primary-rgb,99,102,241),0.05)'; }}
                 onDragLeave=${e => { e.currentTarget.style.borderColor = ''; e.currentTarget.style.background = ''; }}
                 onDrop=${async e => {
                   e.preventDefault();
                   e.currentTarget.style.borderColor = '';
                   e.currentTarget.style.background = '';
                   const taskId = e.dataTransfer.getData('text/plain');
                   if (taskId) {
                     await api('/api/personal-tasks/' + taskId, {
                       method: 'PATCH', body: JSON.stringify({ template_id: null })
                     });
                     reloadAll();
                   }
                 }}>
              <div style="font-size:11px;color:var(--text-secondary);margin-bottom:4px">Standalone one-offs (drag here to detach)</div>
              ${oneOffTasks.filter(o => !o.template_id || (!dailyTasks.find(d => d.id === o.template_id) && !weeklyTasks.find(w => w.id === o.template_id))).map(o => html`
                <div draggable="true"
                     onDragStart=${e => { e.dataTransfer.setData('text/plain', String(o.id)); e.dataTransfer.effectAllowed = 'move'; }}
                     style="cursor:grab">
                  <${TaskActionCard} key=${o.id} task=${o} onReload=${reloadAll} />
                </div>
              `)}
            </div>

            <div style="display:flex;gap:6px;margin-top:12px">
              <select id="weeklyoneoff-parent" style="font-size:12px;padding:4px 6px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px;max-width:140px">
                <option value="">Standalone</option>
                ${weeklyTasks.map(t => html`<option value=${t.id}>${t.title.slice(0, 25)}</option>`)}
              </select>
              <input value=${newOneOff} onInput=${e => setNewOneOff(e.target.value)}
                     onKeyDown=${e => e.key === 'Enter' && addWeeklyOneOff()}
                     placeholder="Add one-off task..." style="flex:1;font-size:12px;padding:6px 10px" />
              <button class="btn btn-sm btn-primary" onclick=${addWeeklyOneOff} style="font-size:11px;padding:4px 10px">Add</button>
            </div>
          </div>
        `}

        ${subTab === 'reminders' && html`
          <div class="item-list">
            ${reminderTasks.map(r => html`
              <div class="item-card" style="padding:10px 14px">
                <div style="display:flex;justify-content:space-between;align-items:start">
                  <div style="flex:1">
                    <div style="display:flex;align-items:center;gap:8px">
                      <span style="font-weight:500">${r.title}</span>
                      ${r.sent_event ? html`<span class="badge badge-completed" style="font-size:10px">Completed</span>` : html`<span class="badge badge-pending" style="font-size:10px">Pending</span>`}
                    </div>
                    <div style="font-size:11px;color:var(--text-secondary);margin-top:4px">
                      Event: ${new Date(r.event_date).toLocaleString()}
                    </div>
                    ${r.alerts && r.alerts.length > 0 && html`
                      <div style="font-size:11px;color:var(--text-secondary);margin-top:2px">
                        Alerts: ${r.alerts.map((a, i) => html`${i > 0 ? ', ' : ''}${a.offset_value} ${a.offset_unit} before${a.sent ? ' (sent)' : ''}`)}
                      </div>
                    `}
                  </div>
                  <button class="btn btn-sm" onclick=${async () => {
                    await api('/api/reminders/' + r.id, { method: 'PATCH', body: JSON.stringify({ active: 0 }) });
                    reloadAll();
                  }} style="padding:2px 6px;font-size:10px">Arc</button>
                </div>
              </div>
            `)}
            ${reminderTasks.length === 0 && html`<div class="empty-state" style="padding:24px">No active reminders to show.</div>`}
          </div>
        `}
      `}
    </div>
  `;
}

// Setup template card with expandable sub-items
function SetupTemplateCard({ task, onReload, showDays }) {
  const [expanded, setExpanded] = useState(false);
  const [items, setItems] = useState([]);
  const [newItemText, setNewItemText] = useState('');
  const [loadedItems, setLoadedItems] = useState(false);
  const [dayOfWeek, setDayOfWeek] = useState(task.day_of_week || 127);

  async function loadItems() {
    try {
      const d = await api('/api/personal-tasks/' + task.id + '/items');
      setItems(d.items || []);
      setLoadedItems(true);
    } catch (e) { setItems([]); }
  }

  async function addItem() {
    if (!newItemText.trim()) return;
    await api('/api/personal-tasks/' + task.id + '/items', {
      method: 'POST', body: JSON.stringify({ description: newItemText.trim() })
    });
    setNewItemText('');
    loadItems();
  }

  async function deleteItem(itemId) {
    await api('/api/personal-task-items/' + itemId, { method: 'DELETE' });
    loadItems();
  }

  async function toggleActive(e) {
    e.stopPropagation();
    const newActive = task.active ? 0 : 1;
    await api('/api/personal-tasks/' + task.id, { method: 'PATCH', body: JSON.stringify({ active: newActive }) });
    onReload();
  }

  async function updateDayOfWeek(newVal) {
    setDayOfWeek(newVal);
    await api('/api/personal-tasks/' + task.id, { method: 'PATCH', body: JSON.stringify({ day_of_week: newVal }) });
    onReload();
  }

  async function deleteTask() {
    if (!confirm('Delete "' + task.title + '"?')) return;
    await api('/api/personal-tasks/' + task.id, { method: 'DELETE' });
    onReload();
  }

  function handleExpand() {
    if (!expanded && !loadedItems) loadItems();
    setExpanded(!expanded);
  }

  return html`
    <div class="item-card" style="padding:0;${task.active ? '' : 'opacity:0.5'}">
      <div style="padding:10px 12px;cursor:pointer;display:flex;align-items:center;gap:8px" onclick=${handleExpand}>
        <input type="checkbox" checked=${!!task.active} onChange=${toggleActive}
               onclick=${(e) => e.stopPropagation()}
               style="width:16px;height:16px;cursor:pointer;flex-shrink:0" />
        <span style="font-size:12px;color:var(--text-secondary)">${expanded ? '▼' : '▶'}</span>
        <div style="flex:1">
          <span style="font-weight:500">${task.title}</span>
          ${task.description ? html` <span style="font-size:11px;color:var(--text-secondary)">- ${task.description}</span>` : ''}
          ${loadedItems ? html` <span style="font-size:10px;color:var(--text-secondary)">(${items.length} items)</span>` : ''}
        </div>
        ${showDays ? html`<span style="font-size:11px;color:var(--text-secondary)">${bitmaskToDays(task.day_of_week) || 'No days'}</span>` : ''}
        <button class="btn btn-sm btn-danger" onclick=${(e) => { e.stopPropagation(); deleteTask(); }} style="padding:2px 6px;font-size:10px">Del</button>
      </div>
      ${expanded && html`
        <div style="border-top:1px solid var(--border);padding:8px 12px 8px 32px;background:var(--surface)">
          ${showDays && html`
            <div style="margin-bottom:10px">
              <div style="font-size:11px;font-weight:600;color:var(--text-secondary);margin-bottom:4px">Active Days</div>
              <${DayOfWeekPicker} value=${dayOfWeek} onChange=${updateDayOfWeek} />
            </div>
          `}
          <div style="font-size:11px;font-weight:600;color:var(--text-secondary);margin-bottom:6px">Sub-items (bullet points)</div>
          ${items.map(item => html`
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
              <span style="color:var(--text-secondary)">•</span>
              <span style="flex:1;font-size:13px">${item.description}</span>
              <button class="btn btn-sm btn-danger" onclick=${() => deleteItem(item.id)}
                      style="padding:1px 4px;font-size:10px">x</button>
            </div>
          `)}
          ${items.length === 0 && html`<div style="font-size:12px;color:var(--text-secondary);margin-bottom:6px">No sub-items yet. Add bullet points below.</div>`}
          <div style="display:flex;gap:6px;margin-top:6px">
            <input value=${newItemText} onInput=${e => setNewItemText(e.target.value)}
                   onKeyDown=${e => e.key === 'Enter' && addItem()}
                   placeholder="Add bullet point..." style="flex:1;font-size:12px;padding:4px 8px" />
            <button class="btn btn-sm btn-primary" onclick=${addItem} style="font-size:11px;padding:2px 8px">Add</button>
          </div>
        </div>
      `}
    </div>
  `;
}

// SETUP TAB - configuration view with sub-tabs (Daily, Weekly, Reminders)
function TasksSetupTab({ tasks, reminders, onReloadTasks, onReloadReminders }) {
  const [subTab, setSubTab] = useState('daily');
  const [showNewTask, setShowNewTask] = useState(false);
  const [showNewReminder, setShowNewReminder] = useState(false);
  const [editingReminder, setEditingReminder] = useState(null);
  const [newDayOfWeek, setNewDayOfWeek] = useState(127); // all days default

  const dailyTasks = tasks.filter(t => t.frequency === 'daily');
  const weeklyTasks = tasks.filter(t => t.frequency === 'weekly');
  const activeDailyTasks = dailyTasks.filter(t => t.active);
  const inactiveDailyTasks = dailyTasks.filter(t => !t.active);
  const activeWeeklyTasks = weeklyTasks.filter(t => t.active);
  const inactiveWeeklyTasks = weeklyTasks.filter(t => !t.active);

  async function createTask(title, description, frequency, day_of_week) {
    await api('/api/personal-tasks', {
      method: 'POST',
      body: JSON.stringify({ title, description: description || undefined, frequency, day_of_week })
    });
    setShowNewTask(false);
    setNewDayOfWeek(127);
    onReloadTasks();
  }

  const subTabs = [
    { key: 'daily', label: 'Daily' },
    { key: 'weekly', label: 'Weekly' },
    { key: 'reminders', label: 'Reminders' }
  ];

  return html`
    <div>
      <${SubTabs} tabs=${subTabs} active=${subTab} onSelect=${setSubTab} />

      ${subTab === 'daily' && html`
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <h3 style="font-size:14px">Daily Templates</h3>
            <button class="btn btn-sm btn-primary" onclick=${() => setShowNewTask(true)}>+ Add Template</button>
          </div>

          ${showNewTask && html`
            <div class="modal-overlay" onclick=${() => setShowNewTask(false)}>
              <div class="modal" onclick=${e => e.stopPropagation()}>
                <h3>New Daily Task</h3>
                <div class="form-group"><label>Title</label><input id="nt_title" /></div>
                <div class="form-group"><label>Description (optional)</label><input id="nt_desc" /></div>
                <div class="form-group">
                  <label>Days of Week</label>
                  <${DayOfWeekPicker} value=${newDayOfWeek} onChange=${setNewDayOfWeek} />
                </div>
                <div class="modal-actions">
                  <button class="btn" onclick=${() => setShowNewTask(false)}>Cancel</button>
                  <button class="btn btn-primary" onclick=${() => {
                    const title = document.getElementById('nt_title').value.trim();
                    if (!title) return;
                    createTask(title, document.getElementById('nt_desc').value, 'daily', newDayOfWeek);
                  }}>Create</button>
                </div>
              </div>
            </div>
          `}

          <div class="item-list">
            ${activeDailyTasks.map(t => html`<${SetupTemplateCard} key=${t.id} task=${t} onReload=${onReloadTasks} showDays=${true} />`)}
            ${activeDailyTasks.length === 0 && html`<div class="empty-state" style="padding:16px">No active daily templates.</div>`}
          </div>
          ${inactiveDailyTasks.length > 0 && html`
            <div style="margin-top:16px">
              <div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px">Inactive Templates</div>
              <div class="item-list">
                ${inactiveDailyTasks.map(t => html`<${SetupTemplateCard} key=${t.id} task=${t} onReload=${onReloadTasks} showDays=${true} />`)}
              </div>
            </div>
          `}
        </div>
      `}

      ${subTab === 'weekly' && html`
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <h3 style="font-size:14px">Weekly Templates</h3>
            <button class="btn btn-sm btn-primary" onclick=${() => setShowNewTask(true)}>+ Add Template</button>
          </div>

          ${showNewTask && html`
            <div class="modal-overlay" onclick=${() => setShowNewTask(false)}>
              <div class="modal" onclick=${e => e.stopPropagation()}>
                <h3>New Weekly Task</h3>
                <div class="form-group"><label>Title</label><input id="nt_title" /></div>
                <div class="form-group"><label>Description (optional)</label><input id="nt_desc" /></div>
                <div class="modal-actions">
                  <button class="btn" onclick=${() => setShowNewTask(false)}>Cancel</button>
                  <button class="btn btn-primary" onclick=${() => {
                    const title = document.getElementById('nt_title').value.trim();
                    if (!title) return;
                    createTask(title, document.getElementById('nt_desc').value, 'weekly', null);
                  }}>Create</button>
                </div>
              </div>
            </div>
          `}

          <div class="item-list">
            ${activeWeeklyTasks.map(t => html`<${SetupTemplateCard} key=${t.id} task=${t} onReload=${onReloadTasks} showDays=${false} />`)}
            ${activeWeeklyTasks.length === 0 && html`<div class="empty-state" style="padding:16px">No active weekly templates.</div>`}
          </div>
          ${inactiveWeeklyTasks.length > 0 && html`
            <div style="margin-top:16px">
              <div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px">Inactive Templates</div>
              <div class="item-list">
                ${inactiveWeeklyTasks.map(t => html`<${SetupTemplateCard} key=${t.id} task=${t} onReload=${onReloadTasks} showDays=${false} />`)}
              </div>
            </div>
          `}
        </div>
      `}

      ${subTab === 'reminders' && html`
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <h3 style="font-size:14px">Reminders</h3>
            <button class="btn btn-sm btn-primary" onclick=${() => setShowNewReminder(true)}>+ New Reminder</button>
          </div>

          ${showNewReminder && html`<${ReminderFormModal}
            onClose=${() => setShowNewReminder(false)}
            onSave=${async (data) => {
              await api('/api/reminders', { method: 'POST', body: JSON.stringify(data) });
              setShowNewReminder(false);
              onReloadReminders();
            }}
          />`}

          ${editingReminder && html`<${ReminderFormModal}
            reminder=${editingReminder}
            onClose=${() => setEditingReminder(null)}
            onSave=${async (data) => {
              await api('/api/reminders/' + editingReminder.id, { method: 'PATCH', body: JSON.stringify(data) });
              setEditingReminder(null);
              onReloadReminders();
            }}
          />`}

          <div class="item-list">
            ${reminders.map(r => html`
              <div class="item-card" style="padding:10px 14px">
                <div style="display:flex;justify-content:space-between;align-items:start">
                  <div style="flex:1">
                    <div style="display:flex;align-items:center;gap:8px">
                      <span style="font-weight:500">${r.title}</span>
                      ${r.recurrence && html`<span class="badge badge-active" style="font-size:10px">${r.recurrence}</span>`}
                      ${r.sent_event ? html`<span class="badge badge-completed" style="font-size:10px">Completed</span>` : html`<span class="badge badge-pending" style="font-size:10px">Pending</span>`}
                    </div>
                    ${r.description && html`<div style="font-size:11px;color:var(--text-secondary);margin-top:2px">${r.description}</div>`}
                    <div style="font-size:11px;color:var(--text-secondary);margin-top:4px">
                      Event: ${new Date(r.event_date).toLocaleString()}
                    </div>
                    ${r.alerts && r.alerts.length > 0 && html`
                      <div style="font-size:11px;color:var(--text-secondary);margin-top:2px">
                        Alerts: ${r.alerts.map((a, i) => html`${i > 0 ? ', ' : ''}${a.offset_value} ${a.offset_unit} before${a.sent ? ' (sent)' : ''}`)}
                      </div>
                    `}
                  </div>
                  <div style="display:flex;gap:4px;flex-shrink:0">
                    <button class="btn btn-sm" onclick=${() => setEditingReminder(r)} style="padding:2px 6px;font-size:10px">Edit</button>
                    <button class="btn btn-sm btn-danger" onclick=${async () => {
                      if (!confirm('Delete reminder "' + r.title + '"?')) return;
                      await api('/api/reminders/' + r.id, { method: 'DELETE' });
                      onReloadReminders();
                    }} style="padding:2px 6px;font-size:10px">Del</button>
                  </div>
                </div>
              </div>
            `)}
            ${reminders.length === 0 && html`<div class="empty-state" style="padding:16px">No reminders configured.</div>`}
          </div>
        </div>
      `}
    </div>
  `;
}

// Reminder form modal (create/edit)
function ReminderFormModal({ reminder, onClose, onSave }) {
  const [title, setTitle] = useState(reminder?.title || '');
  const [description, setDescription] = useState(reminder?.description || '');
  const [eventDate, setEventDate] = useState(reminder?.event_date?.slice(0, 16) || '');
  const [recurrence, setRecurrence] = useState(reminder?.recurrence || '');
  const [alerts, setAlerts] = useState(
    reminder?.alerts?.map(a => ({ offset_value: a.offset_value, offset_unit: a.offset_unit })) || []
  );

  function addAlert() {
    if (alerts.length >= 5) return;
    setAlerts([...alerts, { offset_value: 1, offset_unit: 'hours' }]);
  }

  function removeAlert(idx) {
    setAlerts(alerts.filter((_, i) => i !== idx));
  }

  function updateAlert(idx, field, value) {
    setAlerts(alerts.map((a, i) => i === idx ? { ...a, [field]: field === 'offset_value' ? Number(value) : value } : a));
  }

  function handleSave() {
    if (!title.trim() || !eventDate) { alert('Title and event date are required'); return; }
    onSave({
      title: title.trim(),
      description: description.trim() || undefined,
      event_date: eventDate,
      recurrence: recurrence || undefined,
      alerts
    });
  }

  return html`
    <div class="modal-overlay" onclick=${onClose}>
      <div class="modal" style="max-width:500px" onclick=${e => e.stopPropagation()}>
        <h3>${reminder ? 'Edit Reminder' : 'New Reminder'}</h3>
        <div class="form-group"><label>Title</label>
          <input value=${title} onInput=${e => setTitle(e.target.value)} placeholder="Reminder title..." /></div>
        <div class="form-group"><label>Description (optional)</label>
          <input value=${description} onInput=${e => setDescription(e.target.value)} /></div>
        <div class="form-group"><label>Event Date & Time</label>
          <input type="datetime-local" value=${eventDate} onInput=${e => setEventDate(e.target.value)} /></div>
        <div class="form-group"><label>Recurrence</label>
          <select value=${recurrence} onChange=${e => setRecurrence(e.target.value)}>
            <option value="">None (one-time)</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
        </div>

        <div style="margin-bottom:12px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <label style="font-weight:500;font-size:13px">Alerts (${alerts.length}/5)</label>
            ${alerts.length < 5 && html`
              <button class="btn btn-sm" onclick=${addAlert} style="font-size:11px">+ Add Alert</button>
            `}
          </div>
          ${alerts.map((a, i) => html`
            <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px">
              <input type="number" min="1" value=${a.offset_value}
                     onInput=${e => updateAlert(i, 'offset_value', e.target.value)}
                     style="width:60px;text-align:center" />
              <select value=${a.offset_unit} onChange=${e => updateAlert(i, 'offset_unit', e.target.value)}
                      style="width:90px">
                <option value="hours">hours</option>
                <option value="days">days</option>
              </select>
              <span style="font-size:12px;color:var(--text-secondary)">before event</span>
              <button class="btn btn-sm btn-danger" onclick=${() => removeAlert(i)} style="padding:1px 6px;font-size:10px">x</button>
            </div>
          `)}
          ${alerts.length === 0 && html`<div style="font-size:12px;color:var(--text-secondary)">No alerts configured. You can add up to 5.</div>`}
        </div>

        <div class="modal-actions">
          <button class="btn" onclick=${onClose}>Cancel</button>
          <button class="btn btn-primary" onclick=${handleSave}>${reminder ? 'Save' : 'Create'}</button>
        </div>
      </div>
    </div>
  `;
}

function TasksSection() {
  const [tab, setTab] = useState('tasks');
  const [templates, setTemplates] = useState([]);
  const [reminders, setReminders] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadTemplates = useCallback(async () => {
    try {
      const d = await api('/api/personal-tasks?view=templates');
      setTemplates(d.tasks || []);
    } catch {}
    setLoading(false);
  }, []);

  const loadReminders = useCallback(async () => {
    try {
      const d = await api('/api/reminders?all=true');
      setReminders(d.reminders || []);
    } catch {}
  }, []);

  useEffect(() => { loadTemplates(); loadReminders(); }, [loadTemplates, loadReminders]);

  if (loading) return html`<div class="loading">Loading...</div>`;

  return html`
    <div>
      <div class="action-bar">
        <h2>Tasks</h2>
      </div>

      <div class="tabs" style="margin-bottom:16px">
        <div class="tab ${tab === 'tasks' ? 'active' : ''}" onclick=${() => setTab('tasks')}>
          Tasks
        </div>
        <div class="tab ${tab === 'setup' ? 'active' : ''}" onclick=${() => setTab('setup')}>
          Setup
        </div>
      </div>

      ${tab === 'tasks' && html`<${TasksActionTab} onReload=${loadTemplates} />`}
      ${tab === 'setup' && html`<${TasksSetupTab}
        tasks=${templates} reminders=${reminders}
        onReloadTasks=${loadTemplates} onReloadReminders=${loadReminders}
      />`}
    </div>
  `;
}

// ========== Telegram Mini App Components ==========

// ── Landing-page preference (JROM 2026-05-24) ──────────────────────────────
// Lets the user pick which tab the app opens on a fresh load. Default '/'.
// Stored in localStorage via readLandingTab/writeLandingTab.

function LandingPagePreference() {
  const [value, setValue] = useState(() => readLandingTab());
  const onChange = (e) => {
    const next = writeLandingTab(e.target.value);
    setValue(next);
  };
  return html`
    <div class="settings-row">
      <label for="landing-page-select">Default landing page:</label>
      <select
        id="landing-page-select"
        class="settings-select"
        value=${value}
        onChange=${onChange}
      >
        ${AVAILABLE_BOTTOM_NAV_TABS.map(tab => html`
          <option key=${tab.id} value=${tab.id}>
            ${tab.icon} ${tab.label}${tab.id === DEFAULT_LANDING_TAB ? ' (default)' : ''}
          </option>
        `)}
      </select>
    </div>
    <div style="font-size:11px;color:var(--text-secondary);margin-top:-4px;margin-bottom:8px">
      Opens here on a fresh page load. Deep links to specific pages still work.
    </div>
  `;
}

 function TwoFactorSetup() {
  const [status, setStatus] = useState('loading'); // loading | disabled | setup | enabled
  const [qrData, setQrData] = useState(null);
  const [secret, setSecret] = useState('');
  const [confirmCode, setConfirmCode] = useState('');
  const [error, setError] = useState('');
  const [disableCode, setDisableCode] = useState('');

  useEffect(() => {
    api('/api/auth/me').then(d => {
      setStatus(d.totp_enabled ? 'enabled' : 'disabled');
    }).catch(() => setStatus('disabled'));
  }, []);

  async function startSetup() {
    setError('');
    try {
      const data = await api('/api/auth/2fa/setup');
      setQrData(data.qrDataUrl);
      setSecret(data.secret);
      setStatus('setup');
    } catch (e) { setError(e.message); }
  }

  async function confirmSetup() {
    if (confirmCode.length !== 6) return;
    setError('');
    try {
      await api('/api/auth/2fa/confirm', {
        method: 'POST',
        body: JSON.stringify({ token: confirmCode })
      });
      setStatus('enabled');
      setQrData(null);
      setSecret('');
      setConfirmCode('');
    } catch (e) { setError(e.message); }
  }

  async function disable2FA() {
    if (disableCode.length !== 6) return;
    setError('');
    try {
      await api('/api/auth/2fa/disable', {
        method: 'POST',
        body: JSON.stringify({ token: disableCode })
      });
      setStatus('disabled');
      setDisableCode('');
    } catch (e) { setError(e.message); }
  }

  if (status === 'loading') return html`<div class="loading">Loading...</div>`;

  return html`
    <div>
      ${status === 'disabled' && html`
        <p style="color:var(--text-secondary);margin-bottom:12px">Two-factor authentication is not enabled.</p>
        <button class="btn btn-primary" onclick=${startSetup}>Enable 2FA</button>
      `}

      ${status === 'setup' && html`
        <p style="margin-bottom:12px">Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.):</p>
        <div style="text-align:center;margin:16px 0">
          <img src=${qrData} style="border-radius:8px;background:#fff;padding:8px" />
        </div>
        <div style="margin-bottom:12px">
          <label style="font-size:11px;color:var(--text-secondary)">Manual entry key:</label>
          <code style="display:block;padding:8px;background:var(--bg);border-radius:4px;font-size:13px;word-break:break-all;margin-top:4px">${secret}</code>
        </div>
        <div class="form-group">
          <label>Enter the 6-digit code from your app to confirm:</label>
          <input value=${confirmCode}
                 onInput=${e => setConfirmCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                 onKeyDown=${e => e.key === 'Enter' && confirmCode.length === 6 && confirmSetup()}
                 placeholder="000000" maxlength="6"
                 style="text-align:center;font-size:24px;letter-spacing:8px;font-family:monospace;max-width:250px" />
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-primary" onclick=${confirmSetup} disabled=${confirmCode.length !== 6}>Verify & Enable</button>
          <button class="btn" onclick=${() => { setStatus('disabled'); setQrData(null); setSecret(''); }}>Cancel</button>
        </div>
      `}

      ${status === 'enabled' && html`
        <p style="color:var(--success);margin-bottom:12px">2FA is enabled. Your account is protected.</p>
        <div class="form-group" style="max-width:300px">
          <label>Enter current 2FA code to disable:</label>
          <input value=${disableCode}
                 onInput=${e => setDisableCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                 onKeyDown=${e => e.key === 'Enter' && disableCode.length === 6 && disable2FA()}
                 placeholder="000000" maxlength="6"
                 style="text-align:center;font-size:18px;letter-spacing:6px;font-family:monospace" />
        </div>
        <button class="btn btn-danger" onclick=${disable2FA} disabled=${disableCode.length !== 6}>Disable 2FA</button>
      `}

      ${error && html`<p style="color:var(--danger);margin-top:12px">${error}</p>`}
    </div>
  `;
}


function TemplateManagement() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);
  const [expandedItems, setExpandedItems] = useState([]);

  const loadTemplates = useCallback(() => {
    api('/api/templates').then(d => { setTemplates(d.templates); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  useEffect(() => { loadTemplates(); }, [loadTemplates]);

  async function loadItems(id) {
    if (expanded === id) { setExpanded(null); return; }
    try {
      const d = await api(`/api/templates/${id}`);
      setExpandedItems(d.template.items);
      setExpanded(id);
    } catch { setExpanded(null); }
  }

  if (loading) return html`<div class="loading">Loading...</div>`;

  return html`
    <div>
      ${templates.map(t => html`
        <div class="item-card" style="margin-bottom:8px">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span style="font-weight:500;cursor:pointer;flex:1" onclick=${() => loadItems(t.id)}>${t.name}</span>
            <div style="display:flex;gap:6px">
              <button class="btn btn-sm" onclick=${async () => {
                const name = prompt('Rename template:', t.name);
                if (!name || name === t.name) return;
                await api(`/api/templates/${t.id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
                loadTemplates();
              }}>Rename</button>
              <button class="btn btn-sm btn-danger" onclick=${async () => {
                if (!confirm('Delete template "' + t.name + '"?')) return;
                await api(`/api/templates/${t.id}`, { method: 'DELETE' });
                if (expanded === t.id) setExpanded(null);
                loadTemplates();
              }}>Del</button>
            </div>
          </div>
          ${expanded === t.id && html`
            <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border)">
              ${expandedItems.map(item => html`
                <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;font-size:13px">
                  <span style="color:var(--text-secondary);min-width:20px">${item.item_order}.</span>
                  <span style="flex:1">${item.description}</span>
                  <button class="btn btn-sm" onclick=${async () => {
                    const desc = prompt('Edit step:', item.description);
                    if (!desc || desc === item.description) return;
                    await api(`/api/templates/${t.id}/items/${item.id}`, {
                      method: 'PATCH', body: JSON.stringify({ description: desc })
                    });
                    loadItems(t.id);
                  }} style="padding:1px 6px;font-size:11px">Edit</button>
                  <button class="btn btn-sm btn-danger" onclick=${async () => {
                    await api(`/api/templates/${t.id}/items/${item.id}`, { method: 'DELETE' });
                    loadItems(t.id);
                  }} style="padding:1px 6px;font-size:11px">Del</button>
                </div>
              `)}
              ${expandedItems.length === 0 && html`<div style="font-size:12px;color:var(--text-secondary)">No items yet.</div>`}
              <div style="margin-top:6px;display:flex;gap:6px">
                <input id="newTplItem_${t.id}" placeholder="New step..." style="flex:1;font-size:12px" onKeyDown=${async e => {
                  if (e.key !== 'Enter') return;
                  const desc = e.target.value.trim();
                  if (!desc) return;
                  await api(`/api/templates/${t.id}/items`, { method: 'POST', body: JSON.stringify({ description: desc }) });
                  e.target.value = '';
                  loadItems(t.id);
                }} />
                <button class="btn btn-sm btn-primary" onclick=${async () => {
                  const input = document.getElementById('newTplItem_' + t.id);
                  const desc = input.value.trim();
                  if (!desc) return;
                  await api(`/api/templates/${t.id}/items`, { method: 'POST', body: JSON.stringify({ description: desc }) });
                  input.value = '';
                  loadItems(t.id);
                }} style="font-size:11px">Add</button>
              </div>
            </div>
          `}
        </div>
      `)}
      ${templates.length === 0 && html`<div style="font-size:13px;color:var(--text-secondary)">No templates yet.</div>`}
      <div style="margin-top:12px;display:flex;gap:8px">
        <input id="newTemplateName" placeholder="Template name..." style="flex:1" />
        <button class="btn btn-sm btn-primary" onclick=${async () => {
          const input = document.getElementById('newTemplateName');
          const name = input.value.trim();
          if (!name) return;
          await api('/api/templates', { method: 'POST', body: JSON.stringify({ name }) });
          input.value = '';
          loadTemplates();
        }}>Add Template</button>
      </div>
    </div>
  `;
}


function SettingsSection({ title, icon, children, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen !== false);
  return html`
    <div class="settings-section" style="margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;padding-bottom:${open ? '12px' : '0'}"
           onclick=${() => setOpen(!open)}>
        <h3 style="font-size:14px;display:flex;align-items:center;gap:8px">
          <span style="font-size:11px;color:var(--text-secondary)">${open ? '\u25BC' : '\u25B6'}</span>
          ${icon ? html`<span style="font-size:16px">${icon}</span>` : ''}
          ${title}
        </h3>
      </div>
      ${open && children}
    </div>
  `;
}


function AgentRegistrySection() {
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api('/api/agents').then(d => { setAgents(d.agents || []); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  if (loading) return html`<div class="loading">Loading...</div>`;

  return html`
    <div>
      <p style="font-size:12px;color:var(--text-secondary);margin-bottom:12px">
        Available agents for conversations. These are defined in the agent registry.
      </p>
      <div class="item-list">
        ${agents.map(a => html`
          <div class="item-card" style="padding:8px 12px;display:flex;align-items:center;gap:12px">
            <div style="flex:1">
              <span style="font-weight:500">${a.id}</span>
              <span style="color:var(--text-secondary);font-size:12px;margin-left:8px">${a.name}</span>
            </div>
            <span style="font-size:11px;color:var(--text-secondary)">${a.description}</span>
            <span class="badge badge-${a.model === 'Opus' ? 'active' : 'draft'}" style="font-size:10px">${a.model}</span>
          </div>
        `)}
      </div>
    </div>
  `;
}

function Settings({ onEditBottomNav } = {}) {
  const [patterns, setPatterns] = useState([]);
  const [conversationFontSize, setConversationFontSize] = useState(() => applyTerminalConvFontSize(readTerminalConvFontSize()));
  const [loading, setLoading] = useState(true);
  const [userInfo, setUserInfo] = useState(null);

  useEffect(() => {
    Promise.all([
      api('/api/safety/patterns').then(d => setPatterns(d.patterns)).catch(() => {}),
      api('/api/auth/me').then(d => setUserInfo(d)).catch(() => {})
    ]).then(() => setLoading(false));
  }, []);

  function updateConversationFontSize(nextSize) {
    setConversationFontSize(writeTerminalConvFontSize(nextSize));
  }

  return html`
    <div>
      <h2 style="margin-bottom:16px">Settings</h2>

      ${onEditBottomNav && html`
        <${SettingsSection} title="Navigation" defaultOpen=${true}>
          <div style="margin-bottom:12px">
            <button class="btn btn-sm" onclick=${onEditBottomNav}>Edit bottom nav</button>
          </div>
          <${LandingPagePreference} />
        </${SettingsSection}>
      `}

      <${SettingsSection} title="Account" defaultOpen=${true}>
        <div style="margin-bottom:16px">
          ${userInfo?.user ? html`
            <div class="item-card" style="padding:12px 16px;margin-bottom:12px">
              <div style="display:flex;justify-content:space-between;align-items:center">
                <div>
                  <div style="font-weight:500;margin-bottom:4px">${userInfo.user.display_name || userInfo.user.displayName || userInfo.user.username || 'User'}</div>
                  <div style="font-size:12px;color:var(--text-secondary)">
                    Role: <span class="badge badge-${userInfo.user.role === 'owner' ? 'active' : 'draft'}">${userInfo.user.role}</span>
                    ${userInfo.totp_enabled ? html` <span class="badge badge-active" style="font-size:10px">2FA ON</span>` : ''}
                  </div>
                </div>
              </div>
            </div>
          ` : ''}
          <h4 style="font-size:13px;margin-bottom:8px">Two-Factor Authentication</h4>
          <${TwoFactorSetup} />
        </div>
        ${userInfo?.user?.role === 'owner' && html`
          <div style="margin-top:16px">
            <h4 style="font-size:13px;margin-bottom:8px">Web Sessions</h4>
            <div class="item-card" style="padding:12px 16px">
              <button class="btn btn-danger btn-sm" data-testid="revoke-all-web-sessions" onclick=${async () => {
                try {
                  await api('/api/xmachines/sessions/revoke-all', { method: 'POST' });
                  localStorage.removeItem('agj_token');
                  localStorage.removeItem('agj_user');
                  window.location.hash = '#/';
                  window.location.reload();
                } catch (e) {
                  console.error(e);
                }
              }}>Revoke All Web Sessions</button>
            </div>
          </div>
        `}
      </${SettingsSection}>
      <${SettingsSection} title="Terminal Conversation" defaultOpen=${true}>
        <div style="margin-bottom:16px">
          <div style="font-size:12px;color:var(--text-secondary);margin-bottom:6px">Conversation font size</div>
          <div data-testid="terminal-conv-font-settings" style="display:flex;align-items:center;gap:8px">
            <input type="range" min="${TERMINAL_CONV_FONT_MIN}" max="${TERMINAL_CONV_FONT_MAX}" value=${String(conversationFontSize)}
                   onInput=${e => updateConversationFontSize(Number(e.target.value))}
                   onChange=${e => updateConversationFontSize(Number(e.target.value))}
            />
            <span style="min-width:42px;font-size:12px;color:var(--text-secondary)">${conversationFontSize}px</span>
          </div>
        </div>
      </${SettingsSection}>


      <${SettingsSection} title="Agent Registry" defaultOpen=${false}>
        <${AgentRegistrySection} />
      </${SettingsSection}>

      <${SettingsSection} title="Step Templates" defaultOpen=${false}>
        <${TemplateManagement} />
      </${SettingsSection}>

      <${SettingsSection} title="Safety Patterns" defaultOpen=${false}>
        ${loading ? html`<div class="loading">Loading...</div>` : html`
          <div>
            <p style="font-size:12px;color:var(--text-secondary);margin-bottom:12px">
              Commands matching these patterns will be blocked in terminal sessions.
            </p>
            ${patterns.map(p => html`
              <div class="pattern-row">
                <span class="pattern-text">${p.pattern}</span>
                <span style="color:var(--text-secondary);font-size:11px;flex:1">${p.description || ''}</span>
                <span style="font-size:11px;color:var(--text-secondary)">${p.is_regex ? 'regex' : 'prefix'}</span>
                <label class="toggle">
                  <input type="checkbox" checked=${p.active} onchange=${async () => {
                    await api(`/api/safety/patterns/${p.id}`, {
                      method: 'PATCH', body: JSON.stringify({ active: !p.active })
                    });
                    const d = await api('/api/safety/patterns');
                    setPatterns(d.patterns);
                  }} />
                  <span class="slider"></span>
                </label>
                <button class="btn btn-sm btn-danger" onclick=${async () => {
                  if (!confirm('Delete this pattern?')) return;
                  await api(`/api/safety/patterns/${p.id}`, { method: 'DELETE' });
                  const d = await api('/api/safety/patterns');
                  setPatterns(d.patterns);
                }}>Del</button>
              </div>
            `)}
            <div style="margin-top:12px;display:flex;gap:8px">
              <input id="newPattern" placeholder="Pattern..." style="flex:1" />
              <input id="newPatternDesc" placeholder="Description..." style="flex:1" />
              <button class="btn btn-sm btn-primary" onclick=${async () => {
                const pattern = document.getElementById('newPattern').value;
                const description = document.getElementById('newPatternDesc').value;
                if (!pattern) return;
                await api('/api/safety/patterns', {
                  method: 'POST', body: JSON.stringify({ pattern, description })
                });
                document.getElementById('newPattern').value = '';
                document.getElementById('newPatternDesc').value = '';
                const d = await api('/api/safety/patterns');
                setPatterns(d.patterns);
              }}>Add</button>
            </div>
          </div>
        `}
      </${SettingsSection}>
    </div>
  `;
}

function BottomNavEditor({ tabIds, onChange, onClose }) {
  const [addId, setAddId] = useState('');
  const currentTabs = getBottomNavTabs(tabIds);
  const hiddenTabs = AVAILABLE_BOTTOM_NAV_TABS.filter(tab => !tabIds.includes(tab.id));
  const selectedAddId = hiddenTabs.some(tab => tab.id === addId) ? addId : (hiddenTabs[0]?.id || '');

  return html`
    <div class="tg-nav-editor">
      <div class="tg-nav-editor-header">
        <h3>Bottom Nav</h3>
        <button class="tg-icon-button" title="Close" onclick=${onClose}>×</button>
      </div>
      <div class="tg-nav-editor-list">
        ${currentTabs.map((tab, index) => html`
          <div class="tg-nav-editor-row" key=${tab.id}>
            <span class="tg-nav-editor-icon">${tab.icon}</span>
            <span class="tg-nav-editor-label">${tab.label}</span>
            <div class="tg-nav-editor-actions">
              <button class="tg-icon-button" title="Move up" disabled=${index === 0}
                      onclick=${() => onChange(moveBottomNavTab(tabIds, tab.id, -1))}>↑</button>
              <button class="tg-icon-button" title="Move down" disabled=${index === currentTabs.length - 1}
                      onclick=${() => onChange(moveBottomNavTab(tabIds, tab.id, 1))}>↓</button>
              <button class="tg-icon-button tg-danger-icon" title="Remove tab" disabled=${currentTabs.length <= 1}
                      onclick=${() => onChange(removeBottomNavTab(tabIds, tab.id))}>×</button>
            </div>
          </div>
        `)}
      </div>
      <div class="tg-nav-editor-add">
        <select value=${selectedAddId} disabled=${hiddenTabs.length === 0}
                onchange=${e => setAddId(e.target.value)}>
          ${hiddenTabs.length === 0
            ? html`<option value="">All tabs shown</option>`
            : hiddenTabs.map(tab => html`<option value=${tab.id} key=${tab.id}>${tab.label}</option>`)}
        </select>
        <button class="btn btn-sm" disabled=${!selectedAddId}
                onclick=${() => onChange(addBottomNavTab(tabIds, selectedAddId))}>+ Add</button>
        <button class="btn btn-sm" onclick=${() => onChange(DEFAULT_BOTTOM_NAV_TAB_IDS)}>Reset</button>
      </div>
    </div>
  `;
}

function TgDashboard({ onEditBottomNav, user }) {
  const [stats, setStats] = useState({ projects: 0, tasks: 0, reminders: 0, notes: 0 });
  const [machineCount, setMachineCount] = useState(0);
  const [machineOnline, setMachineOnline] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const telemetryLoad = user?.role === 'owner'
      ? api('/api/xmachines/telemetry').catch(() => ({ machines: [] }))
      : Promise.resolve({ machines: [] });
    Promise.all([
      api('/api/projects').catch(() => ({ projects: [] })),
      api('/api/personal-tasks').catch(() => ({ tasks: [] })),
      api('/api/reminders').catch(() => ({ reminders: [] })),
      api('/api/notes?status=open').catch(() => ({ notes: [] })),
      telemetryLoad
    ]).then(([p, t, r, n, telemetry]) => {
      const machines = telemetry && Array.isArray(telemetry.machines) ? telemetry.machines : [];
      setStats({
        projects: p.projects?.length || 0,
        tasks: t.tasks?.length || 0,
        reminders: r.reminders?.length || 0,
        notes: n.notes?.length || 0
      });
      setMachineCount(machines.length);
      // Online = anything not powered off/down (an unreachable DGX pair is "unknown", still counted up).
      setMachineOnline(machines.filter((m) => !(m && (m.offline === true || m.state === 'down'))).length);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [user?.role]);

  if (loading) return html`<div class="loading">Loading...</div>`;

  const cards = [
    { icon: '\u{1F4CB}', label: 'Tasks', count: stats.tasks, route: '/tasks', desc: 'Daily & weekly' },
    { icon: '\u{1F4DD}', label: 'Notes', count: stats.notes, route: '/notes', desc: 'Quick notes' },
    { icon: '\u{1F5A5}', label: 'Terminals', count: null, route: '/terminals', desc: 'Tmux sessions' },
    { icon: '\u{1F4C1}', label: 'Projects', count: stats.projects, route: '/projects', desc: 'Dev projects' },
    { icon: '\u{23F0}', label: 'Reminders', count: stats.reminders, route: '/tasks', desc: 'Upcoming events' },
    { icon: '\u{2699}', label: 'Settings', count: null, route: '/settings', desc: 'Config & templates' }
  ];
  const xmachinesTile = { icon: '\u{1F4BB}', label: 'xMachines', count: machineCount ? `${machineOnline}/${machineCount}` : machineCount, route: '/xmachines', desc: 'online / total' };

  return html`
    <div>
      <div class="tg-page-title-row">
        <div class="tg-page-title">AGJAssist</div>
        <button class="tg-icon-button tg-title-action" title="Edit bottom navigation" onclick=${onEditBottomNav}>✎</button>
      </div>
      <div class="tg-dashboard-grid">
        ${cards.map(c => html`
          <div class="tg-dash-card" onclick=${() => {
            navigate(c.route);
            try { window.Telegram?.WebApp?.HapticFeedback?.selectionChanged(); } catch {}
          }}>
            <div class="tg-dash-icon">${c.icon}</div>
            <div class="tg-dash-label">${c.label}</div>
            ${c.count !== null ? html`<div class="tg-dash-count">${c.count}</div>` : ''}
            <div class="tg-dash-desc">${c.desc}</div>
          </div>
        `)}
        ${user?.role === 'owner' && html`
          <div class="tg-dash-card" onclick=${() => {
            navigate(xmachinesTile.route);
            try { window.Telegram?.WebApp?.HapticFeedback?.selectionChanged(); } catch {}
          }}>
            <div class="tg-dash-icon">${xmachinesTile.icon}</div>
            <div class="tg-dash-label">${xmachinesTile.label}</div>
            <div class="tg-dash-count">${xmachinesTile.count}</div>
            <div class="tg-dash-desc">${xmachinesTile.desc}</div>
          </div>
        `}
      </div>
      <div class="tg-home-preferences">
        <${LandingPagePreference} />
      </div>
    </div>
  `;
}

function AgentOS() {
  const [agents, setAgents] = useState([]);
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [bindings, setBindings] = useState([]);
  const [defaults, setDefaults] = useState([]);
  const [form, setForm] = useState({ name: '', provider: 'claude', model: '', default_effort: 'medium' });
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [launchMode, setLaunchMode] = useState('projcore');
  const [launchResult, setLaunchResult] = useState('');

  // B4: chat state (pure from agent_events WS per R18; active from B3 launch result; optimistic me + rail placeholder for B4)
  const [activeRunId, setActiveRunId] = useState(null);
  const [activeTmuxTarget, setActiveTmuxTarget] = useState(null);
  const [events, setEvents] = useState([]);
  const [composerText, setComposerText] = useState('');
  const [expanded, setExpanded] = useState(() => new Set());
  const [chatWsStatus, setChatWsStatus] = useState('idle');

  // B4 effects: WS subscribe from A3c agent-events (snapshot + live event push); smoke seed for render proof (pure events, no scrape)
  useEffect(() => {
    if (!activeRunId || !authToken) return;
    if (location.search.includes('b4smoke')) return;
    const url = (typeof buildAgentEventsWsUrl === 'function')
      ? buildAgentEventsWsUrl(authToken, activeRunId)
      : null;
    if (!url) { setChatWsStatus('no-url'); return; }
    const ws = new WebSocket(url);
    let closed = false;
    ws.onopen = () => setChatWsStatus('connected');
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'snapshot' && msg.run_id === activeRunId) setEvents(msg.events || []);
        else if (msg.type === 'event' && msg.run_id === activeRunId && msg.event) setEvents(prev => [...prev, msg.event]);
      } catch {}
    };
    ws.onerror = () => setChatWsStatus('error');
    ws.onclose = () => { if (!closed) setChatWsStatus('closed'); };
    return () => { closed = true; if (ws.readyState === 1) ws.close(); };
  }, [activeRunId, authToken]);

  useEffect(() => {
    if (location.search.includes('b4smoke') && !activeRunId) {
      setActiveRunId('agj-os-TEST');
      setActiveTmuxTarget('agj-os-TEST:0.0');
      setEvents([
        { id: 101, run_id: 'agj-os-TEST', role: 'projcore', type: 'status', state: 'PROPOSED', source: 'callback', body: { approach: 'split chat + rail' }, ts: '2026-06-13T10:42:00Z' },
        { id: 102, run_id: 'agj-os-TEST', role: 'me', type: 'message', state: null, source: 'post', body: { text: 'go ahead, keep effort medium' }, ts: '2026-06-13T10:43:00Z' },
        { id: 103, run_id: 'agj-os-TEST', role: 'grok-build', type: 'message', state: null, source: 'callback', body: { text: 'Added role_bindings table + binding UI; launcher now resolves role→provider from it.' }, ts: '2026-06-13T10:51:00Z' },
        { id: 104, run_id: 'agj-os-TEST', role: 'codex5.5', type: 'status', state: 'DONE', source: 'callback', body: { gate: 'PASS', q: 'Q0 closure confirmed' }, ts: '2026-06-13T10:54:00Z' }
      ]);
      // B5 test support only (b4smoke): seed real binding-shaped agent data so derivation shows provider/model "from the binding"; attach injector that drives setEvents (same path as real WS 'event')
      setBindings([
        {role: 'projcore', agent: {id: 1, name: 'grok-projcore', provider: 'grok', model: '4'}},
        {role: 'grok-build', agent: {id: 2, name: 'claude-opus', provider: 'claude', model: 'opus'}},
        {role: 'codex5.5', agent: {id: 3, name: 'codex5.5', provider: 'codex', model: '5.5'}}
      ]);
      window.__injectAgentEvent = (ev) => setEvents(prev => [...prev, { id: -Date.now(), run_id: 'agj-os-TEST', role: ev.role || 'agent', type: ev.type || 'status', state: ev.state, source: 'callback', body: ev.body || {}, ts: ev.ts || new Date().toISOString() }]);
    }
  }, [activeRunId]);

  async function sendToAgent() {
    const text = (composerText || '').trim();
    if (!text || !selectedProjectId) return;
    const run = activeRunId || `agj-os-${selectedProjectId}`;
    const target = activeTmuxTarget || `${run}:0.0`;
    // optimistic local echo (R18)
    const opt = { id: -Date.now(), run_id: run, role: 'me', type: 'message', state: null, source: 'post', body: { text }, ts: new Date().toISOString() };
    setEvents(prev => [...prev, opt]);
    const prevText = composerText;
    setComposerText('');
    try {
      await api(`/api/projects/${selectedProjectId}/agent-message`, { method: 'POST', body: JSON.stringify({ text, target }) });
    } catch (e) {
      setError('Send failed: ' + (e.message || ''));
      setComposerText(prevText);
    }
  }

  const ROLES = ['projcore', 'coord', 'implementer', 'validator', 'deliberation_1', 'deliberation_2', 'deliberation_3', 'redteam_1', 'redteam_2', 'redteam_3'];
  const PROVIDERS = ['claude', 'codex', 'grok'];
  const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

  async function loadAgents() {
    try {
      const d = await api('/api/agents');
      setAgents(d.agents || []);
    } catch (e) { setError(e.message || 'Failed to load agents'); }
  }
  async function loadProjects() {
    try {
      const d = await api('/api/projects');
      setProjects(d.projects || []);
    } catch (e) { /* non-fatal */ }
  }
  async function loadDefaults() {
    try {
      const d = await api('/api/role-defaults');
      setDefaults(d.defaults || []);
    } catch (e) { /* non-fatal */ }
  }
  async function loadBindings(pid) {
    if (!pid) { setBindings([]); return; }
    try {
      const d = await api(`/api/projects/${pid}/role-bindings`);
      setBindings(d.bindings || []);
    } catch (e) { setBindings([]); }
  }

  useEffect(() => {
    Promise.all([loadAgents(), loadProjects(), loadDefaults()]).then(() => setLoading(false)).catch(() => setLoading(false));
  }, []);

  // auto-select first project for convenience (once loaded)
  useEffect(() => {
    if (!selectedProjectId && projects.length > 0) {
      setSelectedProjectId(projects[0].id);
    }
  }, [projects, selectedProjectId]);

  useEffect(() => {
    if (selectedProjectId) loadBindings(selectedProjectId);
  }, [selectedProjectId]);

  function resetForm() {
    setForm({ name: '', provider: 'claude', model: '', default_effort: 'medium' });
    setEditingId(null);
  }

  async function saveAgent() {
    setError(''); setMsg('');
    const body = { ...form };
    try {
      if (editingId) {
        await api(`/api/agents/${editingId}`, { method: 'PATCH', body: JSON.stringify(body) });
        setMsg('Agent updated');
      } else {
        await api('/api/agents', { method: 'POST', body: JSON.stringify(body) });
        setMsg('Agent created (persists)');
      }
      resetForm();
      await loadAgents();
    } catch (e) { setError(e.message || 'Save failed'); }
  }

  function startEdit(a) {
    setForm({ name: a.name, provider: a.provider, model: a.model, default_effort: a.default_effort });
    setEditingId(a.id);
    setError(''); setMsg('');
  }

  async function deleteAgent(id) {
    if (!confirm('Delete this agent?')) return;
    setError(''); setMsg('');
    try {
      await api(`/api/agents/${id}`, { method: 'DELETE' });
      if (editingId === id) resetForm();
      await loadAgents();
    } catch (e) { setError(e.message || 'Delete failed'); }
  }

  async function applyMapping(role, agentIdValue) {
    if (!selectedProjectId) return;
    setError(''); setMsg('');
    try {
      const url = `/api/projects/${selectedProjectId}/role-bindings/${role}`;
      if (!agentIdValue || agentIdValue === '') {
        await api(url, { method: 'DELETE' });
        setMsg(`${role} cleared (now uses global default)`);
      } else {
        await api(url, { method: 'PUT', body: JSON.stringify({ agent_id: Number(agentIdValue) }) });
        setMsg(`${role} mapped (persisted)`);
      }
      await loadBindings(selectedProjectId);
    } catch (e) { setError(e.message || 'Mapping failed'); }
  }

  async function setGlobalDefault(role, agentIdValue) {
    if (!agentIdValue || agentIdValue === '') return;
    setError(''); setMsg('');
    try {
      await api(`/api/role-defaults/${role}`, { method: 'PUT', body: JSON.stringify({ agent_id: Number(agentIdValue) }) });
      setMsg(`Global default for ${role} set`);
      await loadDefaults();
    } catch (e) { setError(e.message || 'Set default failed (owner?)'); }
  }

  if (loading) return html`<div class="loading">Loading Agent OS...</div>`;

  const defaultsMap = {};
  defaults.forEach(d => { if (d && d.role) defaultsMap[d.role] = d.agent; });
  const bindingsMap = {};
  bindings.forEach(b => { if (b && b.role) bindingsMap[b.role] = b.agent; });

  // B5: REAL derivation (latest state per role from agent_events + bindingsMap/defaultsMap for agent provider/model per A1; session from activeRunId/B3; state from event). Replaces B4 placeholders only. Live: existing setEvents re-renders this. No A1/A2/A3/A4 changes.
  const roleToAv = (r) => (r||'').includes('projcore') ? 'PC' : (r||'').includes('grok') ? 'GB' : (r||'').includes('codex') ? 'CX' : String(r||'').slice(0,2).toUpperCase();
  const stateClass = (s) => { const u = (s||'').toUpperCase(); if (u.includes('DONE') || u === 'PASS') return 'success'; if (u.includes('WORK') || u.includes('PROPOS')) return 'work'; if (u.includes('IDLE')) return 'idle'; return 'coord'; };
  const getWhosWorking = () => {
    const run = activeRunId || (location.search.includes('b4smoke') ? 'agj-os-TEST' : null);
    if (!run) return [];
    const latest = {};
    (events || []).forEach(ev => {
      if (!ev || !ev.role || ev.role === 'me') return;
      if (ev.run_id && ev.run_id !== run) return;
      if (!latest[ev.role] || (ev.ts || '') > (latest[ev.role].ts || '')) latest[ev.role] = ev;
    });
    return Object.keys(latest).map(role => {
      const ev = latest[role];
      const ag = bindingsMap[role] || defaultsMap[role] || { name: 'unbound', provider: '?', model: '?' };
      const sess = run;
      const st = ev.state || (ev.type === 'message' ? 'output' : 'active');
      return { role, agent: ag, session: sess, state: st };
    }).sort((a,b) => a.role.localeCompare(b.role));
  };

  return html`
    <div>
      <h2>Agent OS</h2>
      <p style="font-size:12px;color:var(--text-secondary);margin-bottom:12px">Reusable agents (create/edit/delete) + per-project role mappings. All persist via A1 API. Unmapped roles show global default.</p>
      ${error ? html`<p style="color:var(--danger);font-size:12px;margin:4px 0">${error}</p>` : ''}
      ${msg ? html`<p style="color:var(--success);font-size:12px;margin:4px 0">${msg}</p>` : ''}

      <div class="action-bar" style="margin-top:8px">
        <h3 style="margin:0">Agents</h3>
        <button class="btn btn-sm" onclick=${() => loadAgents()}>Refresh</button>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin:8px 0">
        <input style="flex:1;min-width:140px" placeholder="Name (e.g. grok-projcore)" value=${form.name} onInput=${e => setForm({...form, name: e.target.value})} />
        <select value=${form.provider} onChange=${e => setForm({...form, provider: e.target.value})}>
          ${PROVIDERS.map(p => html`<option value=${p}>${p}</option>`)}
        </select>
        <input style="flex:1;min-width:120px" placeholder="Model (e.g. grok-3)" value=${form.model} onInput=${e => setForm({...form, model: e.target.value})} />
        <select value=${form.default_effort} onChange=${e => setForm({...form, default_effort: e.target.value})}>
          ${EFFORTS.map(e => html`<option value=${e}>${e}</option>`)}
        </select>
        <button class="btn btn-sm btn-primary" onclick=${saveAgent}>${editingId ? 'Update Agent' : 'Create Agent'}</button>
        ${editingId ? html`<button class="btn btn-sm" onclick=${resetForm}>Cancel</button>` : ''}
      </div>
      <div class="item-list">
        ${agents.length === 0 ? html`<div style="font-size:12px;color:var(--text-secondary);padding:4px">No agents yet. Create one above — it will persist.</div>` : ''}
        ${agents.map(a => html`
          <div class="item-card" style="padding:6px 10px;display:flex;align-items:center;gap:8px;margin-bottom:4px">
            <div style="flex:1;font-size:13px">
              <strong>${a.name}</strong>
              <span style="color:var(--text-secondary);font-size:11px;margin-left:6px">${a.provider} / ${a.model} · effort=${a.default_effort}</span>
            </div>
            <button class="btn btn-sm" onclick=${() => startEdit(a)}>Edit</button>
            <button class="btn btn-sm btn-danger" onclick=${() => deleteAgent(a.id)}>Del</button>
          </div>
        `)}
      </div>

      <!-- GAP-1: global-default SETTER (near role-defaults display/usage ~621x); wires PUT /api/role-defaults/:role so unmapped fallbacks can be set + shown -->
      <div style="margin-top:16px">
        <div class="action-bar">
          <h3 style="margin:0">Global Role Defaults</h3>
        </div>
        <div style="font-size:11px;color:var(--text-secondary);margin-bottom:4px">Set the global default agent per role (PUT /api/role-defaults/:role). Unmapped roles (in mappings below) fall back to these.</div>
        <div style="border:1px solid var(--border);border-radius:4px;padding:4px 8px;font-size:12px">
          ${ROLES.map(role => {
            const defAgent = defaultsMap[role];
            const val = defAgent ? String(defAgent.id) : '';
            return html`
              <div style="display:flex;align-items:center;gap:6px;padding:3px 0;border-bottom:1px solid var(--border)">
                <div style="width:120px;font-family:monospace">${role}</div>
                <select style="min-width:180px;font-size:11px" value=${val} onChange=${e => setGlobalDefault(role, e.target.value)}>
                  <option value="">— none —</option>
                  ${agents.map(ag => html`<option value=${ag.id}>${ag.name}</option>`)}
                </select>
                <span style="font-size:11px;color:var(--text-secondary)">${defAgent ? defAgent.name : '—'}</span>
              </div>
            `;
          })}
        </div>
      </div>

      <div style="margin-top:16px">
        <div class="action-bar">
          <h3 style="margin:0">Per-project Role Mappings (10 roles)</h3>
          <button class="btn btn-sm" onclick=${() => selectedProjectId && loadBindings(selectedProjectId)}>Re-fetch</button>
        </div>
        <div style="margin:6px 0">
          <span style="font-size:12px">Project: </span>
          <select value=${selectedProjectId || ''} onChange=${e => setSelectedProjectId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">— select project —</option>
            ${projects.map(p => html`<option value=${p.id}>${p.display_name || p.directory_name || ('#' + p.id)}</option>`)}
          </select>
          <span style="font-size:11px;color:var(--text-secondary);margin-left:8px">Select agent (or blank) for a role — saves immediately. Blank = global default.</span>
        </div>
        ${!selectedProjectId ? html`<div style="font-size:12px;color:var(--text-secondary)">Select a project to map roles. Unmapped = shows the global default from role_defaults.</div>` : html`
          <div style="border:1px solid var(--border);border-radius:4px;padding:4px 8px;font-size:12px">
            ${ROLES.map(role => {
              const bound = bindingsMap[role];
              const defAgent = defaultsMap[role];
              const val = bound ? String(bound.id) : '';
              const label = bound ? bound.name : (defAgent ? defAgent.name : '—');
              const usingDefault = !bound;
              return html`
                <div style="display:flex;align-items:center;gap:6px;padding:3px 0;border-bottom:1px solid var(--border)">
                  <div style="width:120px;font-family:monospace">${role}</div>
                  <select style="min-width:180px;font-size:11px" value=${val} onChange=${e => applyMapping(role, e.target.value)}>
                    <option value="">— global default —</option>
                    ${agents.map(ag => html`<option value=${ag.id}>${ag.name}</option>`)}
                  </select>
                  <span style="font-size:11px;${usingDefault ? 'color:var(--text-secondary)' : 'color:var(--success)'}">
                    ${usingDefault ? `using global default: ${label}` : `bound → ${label}`}
                    ${usingDefault ? html`<span class="badge badge-draft" style="font-size:9px;margin-left:4px">default</span>` : html`<span class="badge badge-active" style="font-size:9px;margin-left:4px">project</span>`}
                  </span>
                </div>
              `;
            })}
          </div>
          <div style="font-size:10px;color:var(--text-secondary);margin-top:4px">Persistence: change persists on server; re-fetch or re-select project reads back exactly what was set. Fallback indicator appears for unmapped.</div>
        `}
      </div>

      <!-- B3 minimal launch hook (per brief): mode selector (R7) + Launch button (behind owner auth). Live who-is-working = B5, chat = B4. -->
      <div style="margin-top:16px">
        <div class="action-bar">
          <h3 style="margin:0">Launch (B3)</h3>
        </div>
        <div style="font-size:11px;color:var(--text-secondary);margin-bottom:4px">Select mode (picks CORE prompt + coordinator role binding). One tmux session per project (R9). Owner auth enforced.</div>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          <select value=${launchMode} onChange=${e => setLaunchMode(e.target.value)} style="min-width:120px;font-size:11px">
            <option value="projcore">projcore</option>
            <option value="coord">coord</option>
          </select>
          <button class="btn btn-sm btn-primary" onclick=${async () => {
            if (!selectedProjectId) { setError('Select a project first'); return; }
            setError(''); setMsg(''); setLaunchResult('');
            try {
              const r = await api(`/api/projects/${selectedProjectId}/launch`, { method: 'POST', body: JSON.stringify({ mode: launchMode }) });
              setLaunchResult(`Launched ${r.mode} → ${r.sessionTarget} (${r.provider}/${r.model})`);
              // B4: capture run/target from B3 launch for WS + send (reuse sessionTarget)
              const runId = r.sessionTarget ? String(r.sessionTarget).split(':')[0] : `agj-os-${selectedProjectId}`;
              setActiveRunId(runId);
              setActiveTmuxTarget(r.sessionTarget || `${runId}:0.0`);
              setEvents([]);
              setMsg('Launch dispatched (session reuse if existed)');
            } catch (e) { setError(e.message || 'Launch failed (owner?)'); }
          }}>Launch</button>
        </div>
        ${launchResult ? html`<div style="font-size:11px;margin-top:4px;color:var(--success)">${launchResult}</div>` : ''}
      </div>

      <!-- B4 chat surface: renders PURELY from agent_events (WS snapshot + updates, R18); status→chips; internals collapsed via .exp; optimistic me; composer send.
           Desktop: split + 230px rail. Mobile ≤480px: real @media collapse to strip + full chat + pinned composer (R19). Matches grok-build/opus mocks. -->
      ${(activeRunId || location.search.includes('b4smoke')) ? html`
        <div class="agent-chat" style="margin-top:16px">
          <div style="border:1px solid var(--border); border-radius:8px; overflow:hidden; background:var(--surface);">
            <div class="appbar" style="height:38px;padding:0 10px;background:linear-gradient(180deg,#1b212b,var(--surface));border-bottom:1px solid var(--border);">
              <div class="brand"><span>Agent OS</span><span class="sep">·</span><span class="model">${activeRunId || 'chat'}</span></div>
              <div class="spacer"></div>
              <span class="live"><span class="dot"></span>live ${chatWsStatus}</span>
            </div>
            <div class="body" style="display:flex;min-height:260px;">
              <section class="chat" style="flex:1;display:flex;flex-direction:column;border-right:1px solid var(--border);">
                <details class="mobilestrip" open>
                  <summary>
                    <div class="strip-avatars" style="display:flex;gap:-5px;">
                      <div class="avatar av-pc" style="width:20px;height:20px;font-size:9px;">PC</div>
                      <div class="avatar av-gk" style="width:20px;height:20px;font-size:9px;">GB</div>
                      <div class="avatar av-cx" style="width:20px;height:20px;font-size:9px;">CX</div>
                    </div>
                    <span class="strip-label" style="flex:1;font-size:11px;margin-left:8px;">${getWhosWorking().length} agents · live</span>
                    <span class="strip-batch" style="font-family:monospace;font-size:10px;color:var(--text-secondary);">B4</span>
                  </summary>
                  <div class="strip-body" style="padding:4px 8px 8px;display:flex;flex-direction:column;gap:8px;font-size:11px;">
                    ${getWhosWorking().map(w => html`<div class="agent" data-role=${w.role}><div class="avatar av-pc">${roleToAv(w.role)}</div><div class="info"><div class="nm">${w.role} · ${w.agent.name} <span class="sub">(${w.agent.provider}/${w.agent.model})</span></div><div class=${'st ' + stateClass(w.state)}><span class="sd"></span>${w.state} <span class="sess" style="font-family:monospace;font-size:9px;opacity:0.7">${w.session}</span></div></div></div>`)}
                  </div>
                </details>
                <div class="transcript">
                  ${(events.length ? events : []).map(ev => {
                    const isMe = ev.role === 'me' || ev.source === 'post';
                    const roleClass = (ev.role||'').includes('projcore') ? 'projcore' : (ev.role||'').includes('grok') ? 'grok' : (ev.role||'').includes('codex') ? 'codex' : 'me';
                    const isStatusLike = ev.type === 'status' || !!ev.state;
                    if (isStatusLike) {
                      return html`<div class="mfoot"><span class=${'chip ' + (ev.state === 'DONE' || (ev.state||'').toUpperCase()==='PASS' ? 'success' : 'warning')}>${ev.state || 'STATUS'}</span></div>`;
                    }
                    const bodyText = ev.body && ev.body.text ? ev.body.text : (ev.body ? JSON.stringify(ev.body).slice(0,180) : '');
                    const hasInternals = ev.body && (ev.body.diff || ev.body.tool || ev.body.approach || ev.body.gate);
                    const isExp = expanded.has(ev.id);
                    return html`<div class=${'msg ' + (isMe ? 'me' : '')}>
                      <div class="meta"><span class=${'role ' + roleClass}>${ev.role || 'agent'}</span><span class="time">${(ev.ts || '').slice(11,16)}</span></div>
                      <div class="bubble">${bodyText}</div>
                      <div class="mfoot">
                        ${hasInternals ? html`<span class="exp" onClick=${() => { setExpanded(s => { const n = new Set(s); n.has(ev.id) ? n.delete(ev.id) : n.add(ev.id); return n; }); }}><span class="car">${isExp ? '▾' : '▸'}</span> internals</span>` : ''}
                        ${ev.state ? html`<span class="chip accent">${ev.state}</span>` : ''}
                      </div>
                      ${isExp && ev.body ? html`<div style="font-size:10px;font-family:monospace;opacity:.8;padding:2px 4px;">${JSON.stringify(ev.body)}</div>` : ''}
                    </div>`;
                  })}
                </div>
                <div class="composer">
                  <div class="inputrow">
                    <label class="field"><input value=${composerText} onInput=${e => setComposerText(e.target.value)} placeholder="talk to projcore…" /></label>
                    <button class="send" onClick=${sendToAgent}>send</button>
                  </div>
                </div>
              </section>
              <aside class="rail">
                <div class="rsection">
                  <div class="rtitle">WHO'S WORKING</div>
                  ${getWhosWorking().map(w => html`<div class="agent" data-role=${w.role}><div class="avatar av-pc">${roleToAv(w.role)}</div><div class="info"><div class="nm">${w.role} · ${w.agent.name} <span class="sub">(${w.agent.provider}/${w.agent.model})</span></div><div class=${'st ' + stateClass(w.state)}><span class="sd"></span>${w.state} <span class="sess" style="font-family:monospace;font-size:9px;opacity:0.7">${w.session}</span></div></div></div>`)}
                </div>
                <div class="rsection">
                  <div class="rtitle">BATCH</div>
                  <div class="batchcard"><div class="bh"><span class="bn">B4</span><span class="gl">gate: pending</span></div><div class="pbar"><i></i></div></div>
                </div>
              </aside>
            </div>
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

async function readMetricHistory(name, metric) {
  try {
    const body = await api('/api/xmachines/machines/' + encodeURIComponent(name) + '/history?metric=' + metric);
    return body && Array.isArray(body.series) ? body.series : [];
  } catch {
    return [];
  }
}

async function attachFleetHistory(payload) {
  const machines = payload && Array.isArray(payload.machines) ? payload.machines : [];
  await Promise.all(machines.map(async (machine) => {
    const name = machine && machine.name != null ? String(machine.name) : '';
    if (!name) return;
    const [temperature, power, utilization] = await Promise.all([
      readMetricHistory(name, 'temperature'),
      readMetricHistory(name, 'power'),
      readMetricHistory(name, 'utilization'),
    ]);
    machine._history = { temperature, power, utilization };
  }));
}

function XmachinesAuditPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const data = await api('/api/xmachines/audit?limit=200');
        if (cancelled) return;
        setRows(Array.isArray(data?.entries) ? data.entries : []);
      } catch (e) {
        if (!cancelled) setError(String(e.message || e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const id = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);
  return html`
    <div class="xmachines-view" data-testid="xmachines-power-audit">
      <h2>Power Audit</h2>
      ${loading ? html`<div>Loading...</div>` : ''}
      ${error ? html`<div style="color:red">${error}</div>` : ''}
      <table data-testid="xmachines-audit-table" style="width:100%;border-collapse:collapse">
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>Target</th>
            <th>Action</th>
            <th>Classification</th>
            <th>Actor</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r) => {
            let details = r.details;
            let parsed = null;
            try { parsed = typeof details === 'string' ? JSON.parse(details) : details; } catch {}
            const cls = parsed?.classification || '';
            const target = parsed?.target || '';
            const actor = parsed?.actor_id ?? parsed?.user_id ?? '';
            const requestId = parsed?.request_id || '';
            // Accepted ON/OFF/force rows are labeled allowed so they stay distinct
            // from a replay of the same action and target.
            const allowed = cls === 'on' || cls === 'off' || cls === 'force';
            const summary = allowed
              ? `allowed production ${cls} request_id=${requestId} target=${target} action=${parsed?.action || ''}`
              : '';
            return html`
              <tr data-testid="xmachines-audit-row">
                <td>${escapeHtml(r.timestamp || '')}</td>
                <td>${escapeHtml(target)}</td>
                <td>${escapeHtml(parsed?.action || '')}</td>
                <td>${escapeHtml(cls)}</td>
                <td>${escapeHtml(String(actor))}</td>
                <td>
                  <div data-testid="xmachines-audit-details">
                    ${summary ? html`<div>${escapeHtml(summary)}</div>` : ''}
                    ${parsed ? html`<pre>${JSON.stringify(parsed, null, 2)}</pre>` : html`${escapeHtml(String(details))}`}
                  </div>
                </td>
              </tr>
            `;
          })}
        </tbody>
      </table>
    </div>
  `;
}

function XmachinesFleetPage() {
  const [markup, setMarkup] = useState('');
  useEffect(() => {
    let cancelled = false;
    const fetchTelemetry = () => {
      api('/api/xmachines/telemetry')
        .then(async (payload) => {
          if (cancelled || !payload) return;
          await attachFleetHistory(payload);
          if (!cancelled) setMarkup(renderFleetOverview(payload));
        })
        .catch(() => { if (!cancelled) setMarkup(renderFleetOverview({ machines: [] })); });
    };
    fetchTelemetry();
    const intervalMs = 30_000;
    let intervalId = null;
    const tick = () => {
      if (cancelled) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      fetchTelemetry();
    };
    intervalId = setInterval(tick, intervalMs);
    const onVisibilityChange = () => { if (!document.hidden) fetchTelemetry(); };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => { cancelled = true; if (intervalId) clearInterval(intervalId); document.removeEventListener('visibilitychange', onVisibilityChange); };
  }, []);
  return html`<div class="xmachines-view" dangerouslySetInnerHTML=${{ __html: markup }}></div>`;
}

function XmachinesDetailPage({ name }) {
  const [payload, setPayload] = useState(null);
  const [markup, setMarkup] = useState('');
  const [range, setRange] = useState('1h');
  const editingRef = useRef(false);
  const authedFetch = useCallback((path, opts) => fetch(API_BASE + path, {
    ...opts,
    headers: { ...(opts && opts.headers), ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
  }), []);
  useEffect(() => {
    let cancelled = false;
    const fetchDetail = async () => {
      if (editingRef.current) return;
      try {
        const data = await api('/api/xmachines/machines/' + encodeURIComponent(name));
        if (cancelled) return;
        const rq = '&range=' + encodeURIComponent(range);
        const [tempHist, powerHist, utilHist] = await Promise.all([
          api('/api/xmachines/machines/' + encodeURIComponent(name) + '/history?metric=temperature' + rq),
          api('/api/xmachines/machines/' + encodeURIComponent(name) + '/history?metric=power' + rq),
          api('/api/xmachines/machines/' + encodeURIComponent(name) + '/history?metric=utilization' + rq)
        ]).catch(() => [null, null, null]);
        if (cancelled) return;
        if (data) {
          data._history = { temperature: tempHist?.series ?? [], power: powerHist?.series ?? [], utilization: utilHist?.series ?? [] };
          data._historyRange = range;
        }
        setPayload(data);
      } catch {
        if (!cancelled) setPayload(null);
      }
    };
    fetchDetail();
    const intervalMs = 30_000;
    let intervalId = null;
    const tick = () => {
      if (cancelled) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      if (editingRef.current) return;
      if (!location.hash.startsWith('#/xmachines/')) return;
      fetchDetail();
    };
    intervalId = setInterval(tick, intervalMs);
    const onVisibilityChange = () => { if (!document.hidden && !editingRef.current) fetchDetail(); };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => { cancelled = true; if (intervalId) clearInterval(intervalId); document.removeEventListener('visibilitychange', onVisibilityChange); };
  }, [name, range]);
  useEffect(() => {
    if (editingRef.current) return;
    setMarkup(payload ? renderMachineCostDetail(payload) : '');
  }, [payload]);
  const cancelRename = useCallback(() => {
    editingRef.current = false;
    setMarkup(payload ? renderMachineCostDetail(payload) : '');
  }, [payload]);
  const commitRename = useCallback(async () => {
    const input = document.getElementById('xm-name-input');
    const val = input ? String(input.value || '').trim() : '';
    editingRef.current = false;
    try {
      await authedFetch('/api/xmachines/machines/' + encodeURIComponent(name) + '/label', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: val }),
      });
    } catch {}
    try {
      const data = await api('/api/xmachines/machines/' + encodeURIComponent(name));
      if (data) { data._history = payload && payload._history ? payload._history : {}; data._historyRange = range; setPayload(data); }
      else setMarkup(payload ? renderMachineCostDetail(payload) : '');
    } catch { setMarkup(payload ? renderMachineCostDetail(payload) : ''); }
  }, [name, payload, range, authedFetch]);
  const beginRename = useCallback(() => {
    const row = document.getElementById('xm-name-row');
    if (!row || !payload || !payload.machine) return;
    const m = payload.machine;
    const current = (m.displayName && String(m.displayName).trim()) ? m.displayName : (m.name || '');
    editingRef.current = true;
    row.innerHTML = '<div class="xm-name-edit">'
      + '<input id="xm-name-input" maxlength="24" autocomplete="off" spellcheck="false">'
      + '<button type="button" class="xm-btn xm-btn-primary mini" data-action="rename-save">Save</button>'
      + '<button type="button" class="xm-btn xm-btn-ghost mini" data-action="rename-cancel">Cancel</button>'
      + '</div>';
    const input = document.getElementById('xm-name-input');
    if (input) {
      input.value = current;
      input.focus();
      input.select();
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') commitRename(); else if (e.key === 'Escape') cancelRename(); });
    }
  }, [payload, commitRename, cancelRename]);
  const onDetailClick = useCallback((event) => {
    const target = event && event.target;
    const actionEl = target && typeof target.closest === 'function' ? target.closest('[data-action]') : null;
    const action = actionEl ? actionEl.getAttribute('data-action') : '';
    if (action === 'range') { const r = actionEl.getAttribute('data-range') || '1h'; if (r !== range) setRange(r); return; }
    if (action === 'rename') { if (event.preventDefault) event.preventDefault(); beginRename(); return; }
    if (action === 'rename-save') { if (event.preventDefault) event.preventDefault(); commitRename(); return; }
    if (action === 'rename-cancel') { if (event.preventDefault) event.preventDefault(); cancelRename(); return; }
    if (!payload) return;
    handleMachineDetailClick(event, payload, { fetch: authedFetch }).then((next) => { if (next !== payload) setPayload(next); });
  }, [payload, range, beginRename, commitRename, cancelRename, authedFetch]);
  return html`<div class="xmachines-view" onClick=${onDetailClick} dangerouslySetInnerHTML=${{ __html: markup }}></div>`;
}

function TgApp() {
  const route = useRoute();
  const user = JSON.parse(localStorage.getItem('agj_user') || 'null');
  const [bottomNavTabIds, setBottomNavTabIds] = useState(() => readBottomNavTabIds());
  const [editingBottomNav, setEditingBottomNav] = useState(false);

  // JROM 2026-05-24: on a fresh page load, redirect away from any empty or
  // unknown hash to the user's preferred landing page (default: Home '/').
  // Deep linking still works — a known route in the hash is honored. This
  // fixes the "Page not found" the user saw on initial open when an old
  // stale hash (e.g. a removed page) survived in the URL.
  useEffect(() => {
    if (!authToken || !user) return;
    const initialHash = location.hash.slice(1);
    const KNOWN_PREFIXES = ['/project/', '/xmachines/'];
    const KNOWN_EXACT = new Set([
      '/', '/projects', '/terminals', '/tasks',
      '/notes', '/settings', '/agent-os', '/mcp-access', '/xmachines', '/xmachines/audit'
    ]);
    // Owner-only routing guard for KNOWN_EXACT
    if (initialHash === '/xmachines') {
      if (user?.role !== 'owner') {
        navigate('/');
        return;
      }
    }
    const isKnown =
      initialHash &&
      (KNOWN_EXACT.has(initialHash) || KNOWN_PREFIXES.some(p => initialHash.startsWith(p)));
    if (!isKnown) {
      const landing = readLandingTab();
      if (initialHash !== landing) navigate(landing);
    }
    // Only on mount — subsequent navigation respects the user's choices.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!authToken || !user) return html`<${Login} />`;

  function applyBottomNavTabIds(nextIds) {
    setBottomNavTabIds(writeBottomNavTabIds(nextIds));
  }

  const tabs = getBottomNavTabs(bottomNavTabIds);

  useEffect(() => {
  }, [route]);

  let content;
  if (route === '/' || route === '') {
    content = html`<${TgDashboard} onEditBottomNav=${() => setEditingBottomNav(true)} user=${user} />`;
  } else if (route === '/projects') {
    content = html`<${Projects} />`;
  } else if (route === '/terminals') {
    content = html`<${Terminals} />`;
  } else if (route === '/tasks') {
    content = html`<${TasksSection} />`;
  } else if (route === '/notes') {
    content = html`<${IosNotesPage} />`;
  } else if (route === '/settings') {
    content = html`<${Settings} onEditBottomNav=${() => setEditingBottomNav(true)} />`;
  } else if (route === '/agent-os') {
    content = html`<${AgentOS} />`;
  } else if (route === '/mcp-access') {
    content = user?.role === 'owner'
      ? html`<${McpAccessPage} />`
      : html`<div class="empty-state">Owner role required</div>`;
  } else if (route === '/xmachines' || route.startsWith('/xmachines/')) {
    if (user?.role !== 'owner') {
      content = html`<div class="empty-state">Owner role required</div>`;
    } else if (route === '/xmachines') {
      content = html`<${XmachinesFleetPage} />`;
    } else if (route === '/xmachines/audit') {
      content = html`<${XmachinesAuditPage} />`;
    } else {
      const name = decodeURIComponent(route.split('/')[2] || '');
      content = html`<${XmachinesDetailPage} name=${name} key=${name} />`;
    }
  } else if (route.startsWith('/project/')) {
    const id = route.split('/')[2];
    content = html`<${ProjectDetail} id=${id} key=${id} />`;
  } else {
    content = html`<div class="empty-state">Page not found</div>`;
  }

  const activeTab = tabs.find(t => t.id === route) ? route : (route === '' ? '/' : null);

  return html`
    <main class="main">${content}</main>
    ${editingBottomNav && html`
      <${BottomNavEditor}
        tabIds=${bottomNavTabIds}
        onChange=${applyBottomNavTabIds}
        onClose=${() => setEditingBottomNav(false)}
      />
    `}
    <nav class="tg-tab-bar">
      ${tabs.map(t => html`
        <button class=${'tg-tab-item' + (activeTab === t.id ? ' active' : '')}
                onclick=${() => {
                  navigate(t.id);
                  try { window.Telegram?.WebApp?.HapticFeedback?.selectionChanged(); } catch {}
                }}>
          <span class="tg-tab-icon">${t.icon}</span>
          <span class="tg-tab-label">${t.label}</span>
        </button>
      `)}
    </nav>
    <${SessionExpiredOverlay} />
  `;
}

const MCP_POOL_NAME_RE = /^[A-Za-z0-9_.-]{1,128}$/;
const MCP_ORCH_HINT = /(?:^x-|_validator_|_planner_|_impl_|projcore)/i;
const MCP_AUDIT_PAGE = 20;
const MCP_PERM_NAMES = ['list_sessions', 'read_session', 'send_message', 'send_keys', 'upload_image', 'read_image'];

function mcpAuditBlocked(details) {
  if (!details) return false;
  try {
    const parsed = typeof details === 'string' ? JSON.parse(details) : details;
    return parsed && parsed.blocked === true;
  } catch {
    return false;
  }
}

function parseGrantSessions(grant) {
  if (grant?.scope_type !== 'sessions') return [];
  try {
    const parsed = JSON.parse(grant.scope_ref);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function McpGrantRow({ grant, pool, groups, onUpdated, onRevoked }) {
  const [error, setError] = useState('');
  const [scopeType, setScopeType] = useState(grant.scope_type === 'group' ? 'group' : 'sessions');
  const [selectedSessions, setSelectedSessions] = useState(() => parseGrantSessions(grant));
  const [selectedGroup, setSelectedGroup] = useState(grant.scope_type === 'group' ? grant.scope_ref : '');
  const [perms, setPerms] = useState(() => (Array.isArray(grant.permissions) ? grant.permissions.slice() : []));
  const [lifetime, setLifetime] = useState(!!grant.lifetime);
  const [lifetimeStep, setLifetimeStep] = useState(null);
  const [lifetimeTyped, setLifetimeTyped] = useState('');
  const [revokeStep, setRevokeStep] = useState(false);

  const group = (groups || []).find((g) => g.id === (scopeType === 'group' ? selectedGroup : grant.scope_ref));

  async function patchScope(nextType, nextSessions, nextGroup) {
    setError('');
    const body = nextType === 'group'
      ? { scope_type: 'group', scope_ref: nextGroup }
      : { sessions: nextSessions };
    try {
      const data = await api(`/api/mcp/grants/${grant.id}/scope`, {
        method: 'PATCH',
        body: JSON.stringify(body)
      });
      setScopeType(data.scope_type === 'group' ? 'group' : 'sessions');
      if (data.scope_type === 'group') setSelectedGroup(data.scope_ref);
      else setSelectedSessions(parseGrantSessions({ scope_type: 'sessions', scope_ref: data.scope_ref }));
      onUpdated({ ...grant, scope_type: data.scope_type, scope_ref: data.scope_ref });
    } catch (e) {
      setError(e.message || 'Scope update failed');
    }
  }

  async function toggleSession(name) {
    const next = selectedSessions.includes(name)
      ? selectedSessions.filter((s) => s !== name)
      : selectedSessions.concat(name);
    setSelectedSessions(next);
    await patchScope('sessions', next, selectedGroup);
  }

  async function togglePerm(name) {
    setError('');
    const next = perms.includes(name) ? perms.filter((p) => p !== name) : perms.concat(name);
    try {
      const data = await api(`/api/mcp/grants/${grant.id}/permissions`, {
        method: 'PATCH',
        body: JSON.stringify({ permissions: next })
      });
      setPerms(Array.isArray(data.permissions) ? data.permissions : next);
      onUpdated({ ...grant, permissions: data.permissions || next });
    } catch (e) {
      setError(e.message || 'Permission update failed');
    }
  }

  async function confirmLifetime() {
    if (lifetimeTyped !== 'LIFETIME' || !lifetimeStep) return;
    setError('');
    const on = lifetimeStep === 'on';
    try {
      const data = await api(`/api/mcp/grants/${grant.id}/lifetime`, {
        method: 'PATCH',
        body: JSON.stringify({ lifetime: on, confirm: 'LIFETIME' })
      });
      setLifetime(!!data.lifetime);
      setLifetimeStep(null);
      setLifetimeTyped('');
      onUpdated({ ...grant, lifetime: !!data.lifetime, access_expires_at: data.lifetime ? null : grant.access_expires_at });
    } catch (e) {
      setError(e.message || 'Lifetime update failed');
    }
  }

  async function confirmRevoke() {
    setError('');
    try {
      await api(`/api/mcp/grants/${grant.id}/revoke`, { method: 'POST' });
      onRevoked(grant.id);
    } catch (e) {
      setError(e.message || 'Revoke failed');
      setRevokeStep(false);
    }
  }

  return html`
    <article class="mcp-grant-row" data-testid="mcp-grant-row" data-grant-id=${String(grant.id)}>
      <header class="mcp-grant-head">
        <div>
          <div class="mcp-grant-name" data-testid="mcp-grant-name">${grant.client_name || 'Unknown'}</div>
          <div class="mcp-grant-id" data-testid="mcp-grant-id">id …${grant.client_id_suffix || (grant.client_id || '').slice(-8)}</div>
        </div>
        <div class="mcp-grant-meta">
          <span data-testid="mcp-grant-granted">granted ${grant.granted_at || '—'}</span>
          <span data-testid="mcp-grant-last-used">last-used ${grant.last_used_at || '—'}</span>
          ${lifetime
            ? html`<span class="mcp-grant-badge" data-testid="mcp-grant-lifetime-badge">Lifetime</span>`
            : html`<span class="mcp-grant-badge" data-testid="mcp-grant-expiry-badge">${grant.access_expires_at || 'expires'}</span>`}
        </div>
      </header>
      ${scopeType === 'group' && group ? html`<p class="mcp-access-hint" data-testid="mcp-grant-group-live">live with group ${group.name}</p>` : ''}

      <div class="mcp-scope-picker" data-testid="mcp-scope-picker">
        <label class="mcp-check"><input type="radio" name=${'mcp-scope-type-' + grant.id} checked=${scopeType === 'sessions'}
          onChange=${() => { setScopeType('sessions'); patchScope('sessions', selectedSessions, selectedGroup); }} /> Sessions</label>
        <label class="mcp-check"><input type="radio" name=${'mcp-scope-type-' + grant.id} checked=${scopeType === 'group'}
          onChange=${() => { setScopeType('group'); if (selectedGroup) patchScope('group', selectedSessions, selectedGroup); }} /> Group</label>
        ${scopeType === 'sessions'
          ? (pool || []).map((name) => html`
              <label class="mcp-check" data-testid="mcp-scope-option" data-session=${name}>
                <input type="checkbox" checked=${selectedSessions.includes(name)} onChange=${() => toggleSession(name)} />
                ${name}
              </label>
            `)
          : (groups || []).map((g) => html`
              <label class="mcp-check" data-testid="mcp-scope-option" data-group=${g.id}>
                <input type="radio" name=${'mcp-scope-group-' + grant.id} checked=${selectedGroup === g.id}
                  onChange=${() => { setSelectedGroup(g.id); patchScope('group', selectedSessions, g.id); }} />
                ${g.name}
              </label>
            `)}
      </div>

      <div class="mcp-perm-list">
        ${MCP_PERM_NAMES.map((name) => html`
          <label class="mcp-check" data-testid="mcp-perm-toggle" data-perm=${name}>
            <input type="checkbox" checked=${perms.includes(name)} onChange=${() => togglePerm(name)} />
            ${name}
          </label>
        `)}
      </div>

      <div class="mcp-grant-actions">
        <label class="mcp-check">
          <input type="checkbox" data-testid="mcp-lifetime-toggle" checked=${lifetime}
            onClick=${(e) => {
              e.preventDefault();
              setLifetimeTyped('');
              setLifetimeStep(lifetime ? 'off' : 'on');
            }} />
          Lifetime
        </label>
        ${lifetimeStep && html`
          <div class="mcp-confirm" data-testid="mcp-lifetime-confirm">
            <p>Type LIFETIME to ${lifetimeStep === 'on' ? 'enable' : 'disable'} lifetime access.</p>
            <input data-testid="mcp-lifetime-confirm-input" value=${lifetimeTyped}
              onInput=${(e) => setLifetimeTyped(e.target.value)} placeholder="LIFETIME" />
            <button type="button" class="btn btn-primary btn-sm" data-testid="mcp-lifetime-confirm-btn"
              disabled=${lifetimeTyped !== 'LIFETIME'} onclick=${confirmLifetime}>Confirm</button>
            <button type="button" class="btn btn-sm" onclick=${() => { setLifetimeStep(null); setLifetimeTyped(''); }}>Cancel</button>
          </div>
        `}
        ${!revokeStep
          ? html`<button type="button" class="btn btn-danger btn-sm" data-testid="mcp-revoke" onclick=${() => setRevokeStep(true)}>Revoke</button>`
          : html`<div class="mcp-confirm" data-testid="mcp-revoke-confirm">
              <p>Revoke this agent’s access?</p>
              <button type="button" class="btn btn-danger btn-sm" data-testid="mcp-revoke-confirm-btn" onclick=${confirmRevoke}>Confirm revoke</button>
              <button type="button" class="btn btn-sm" onclick=${() => setRevokeStep(false)}>Cancel</button>
            </div>`}
      </div>
      ${error && html`<p class="mcp-access-error" data-testid="mcp-grant-error">${error}</p>`}
    </article>
  `;
}

function McpAccessPage() {
  const user = JSON.parse(localStorage.getItem('agj_user') || 'null');
  const [pool, setPool] = useState([]);
  const [poolDraft, setPoolDraft] = useState('');
  const [poolError, setPoolError] = useState('');
  const [groups, setGroups] = useState([]);
  const [grants, setGrants] = useState([]);
  const [auditRows, setAuditRows] = useState([]);
  const [auditOffset, setAuditOffset] = useState(0);
  const [auditMore, setAuditMore] = useState(false);
  const [loading, setLoading] = useState(true);

  async function loadPool() {
    const data = await api('/api/mcp/pool');
    setPool(Array.isArray(data.sessions) ? data.sessions : []);
  }

  async function savePool(next) {
    const data = await api('/api/mcp/pool', { method: 'PUT', body: JSON.stringify({ sessions: next }) });
    setPool(Array.isArray(data.sessions) ? data.sessions : next);
  }

  async function loadAudit(offset) {
    const data = await api(`/api/mcp/audit?limit=${MCP_AUDIT_PAGE}&offset=${offset}`);
    const entries = Array.isArray(data.entries) ? data.entries : [];
    setAuditRows((prev) => (offset === 0 ? entries : prev.concat(entries)));
    setAuditOffset(offset + entries.length);
    setAuditMore(entries.length >= MCP_AUDIT_PAGE);
  }

  useEffect(() => {
    Promise.all([
      loadPool().catch((e) => setPoolError(e.message || 'Failed to load pool')),
      api('/api/terminal/groups').then((d) => setGroups(Array.isArray(d.groups) ? d.groups : [])).catch(() => setGroups([])),
      api('/api/mcp/grants').then((d) => setGrants((d.grants || []).filter((g) => g.status === 'active'))).catch(() => setGrants([])),
      loadAudit(0).catch(() => { setAuditRows([]); setAuditMore(false); })
    ]).finally(() => setLoading(false));
  }, []);

  if (user?.role !== 'owner') {
    return html`<div class="empty-state">Owner role required</div>`;
  }

  async function addToPool() {
    const name = poolDraft.trim();
    setPoolError('');
    if (!MCP_POOL_NAME_RE.test(name)) {
      setPoolError('Session names must be 1–128 letters, digits, _, ., or -');
      return;
    }
    if (pool.includes(name)) {
      setPoolDraft('');
      return;
    }
    try {
      await savePool(pool.concat(name));
      setPoolDraft('');
    } catch (e) {
      setPoolError(e.message || 'Save failed');
    }
  }

  async function removeFromPool(name) {
    setPoolError('');
    try {
      await savePool(pool.filter((s) => s !== name));
    } catch (e) {
      setPoolError(e.message || 'Save failed');
    }
  }

  return html`
    <div class="mcp-access" data-testid="mcp-access-page">
      <h2>MCP Access</h2>
      ${loading ? html`<div class="loading">Loading...</div>` : ''}

      <section class="mcp-access-section" data-testid="mcp-pool-manager">
        <h3>Grantable pool</h3>
        ${pool.length === 0
          ? html`<p class="mcp-access-empty" data-testid="mcp-pool-empty">Pool is empty. Add session names before granting access.</p>`
          : html`<div class="mcp-pool-chips">
              ${pool.map((name) => html`
                <span class=${'mcp-pool-chip' + (MCP_ORCH_HINT.test(name) ? ' mcp-pool-chip-hint' : '')} data-testid="mcp-pool-chip" data-session=${name}>
                  <span>${name}</span>
                  ${MCP_ORCH_HINT.test(name) ? html`<span class="mcp-pool-hint">orchestration</span>` : ''}
                  <button type="button" class="mcp-pool-remove" data-testid="mcp-pool-remove" aria-label=${'Remove ' + name}
                          onclick=${() => removeFromPool(name)}>×</button>
                </span>
              `)}
            </div>`}
        <div class="mcp-pool-add-row">
          <input data-testid="mcp-pool-add-input" value=${poolDraft}
                 placeholder="Session name"
                 onInput=${(e) => setPoolDraft(e.target.value)}
                 onKeyDown=${(e) => e.key === 'Enter' && addToPool()} />
          <button type="button" class="btn btn-primary btn-sm" data-testid="mcp-pool-add" onclick=${addToPool}>Add</button>
        </div>
        ${poolError && html`<p class="mcp-access-error">${poolError}</p>`}
      </section>

      <section class="mcp-access-section" data-testid="mcp-server-groups">
        <h3>Server groups</h3>
        <p class="mcp-access-hint">Read-only. Group grants use these memberships.</p>
        ${groups.length === 0
          ? html`<p class="mcp-access-empty">No groups defined.</p>`
          : html`<ul class="mcp-groups-list">
              ${groups.map((g) => html`
                <li class="mcp-group-row" data-testid="mcp-server-group" data-group-id=${g.id}>
                  <strong>${g.name}</strong>
                  <span>${(g.sessions || []).length ? (g.sessions || []).join(', ') : 'empty'}</span>
                </li>
              `)}
            </ul>`}
      </section>

      <section class="mcp-access-section" data-testid="mcp-connected-agents">
        <h3>Connected agents</h3>
        ${grants.length === 0
          ? html`<p class="mcp-access-hint">No active grants.</p>`
          : html`<div class="mcp-grant-list">
              ${grants.map((g) => html`<${McpGrantRow} key=${g.id} grant=${g} pool=${pool} groups=${groups}
                onUpdated=${(next) => setGrants((prev) => prev.map((row) => row.id === next.id ? { ...row, ...next } : row))}
                onRevoked=${(id) => setGrants((prev) => prev.filter((row) => row.id !== id))} />`)}
            </div>`}
      </section>

      <section class="mcp-access-section" data-testid="mcp-audit">
        <h3>Audit</h3>
        ${auditRows.length === 0
          ? html`<p class="mcp-access-empty" data-testid="mcp-audit-empty">No MCP audit rows yet.</p>`
          : html`<div class="mcp-audit-list">
              ${auditRows.map((row) => html`
                <div class="mcp-audit-row" data-testid="mcp-audit-row">
                  <span class="mcp-audit-time">${row.timestamp || ''}</span>
                  <span class="mcp-audit-agent">${row.agent_name || '—'}</span>
                  <span class="mcp-audit-action">${row.action_type || ''}</span>
                  <span class="mcp-audit-target">${row.tmux_target || '—'}</span>
                  <span class=${'mcp-audit-blocked' + (mcpAuditBlocked(row.details) ? ' on' : '')}>${mcpAuditBlocked(row.details) ? 'blocked' : ''}</span>
                </div>
              `)}
            </div>`}
        ${auditMore && html`<button type="button" class="btn btn-sm" data-testid="mcp-audit-load-more" onclick=${() => loadAudit(auditOffset)}>Load more</button>`}
      </section>
    </div>
  `;
}

// ========== Web App ==========

function App() {
  const route = useRoute();
  const user = JSON.parse(localStorage.getItem('agj_user') || 'null');

  if (!authToken || !user) return html`<${Login} />`;

  useEffect(() => {
  }, [route]);

  let content;
  if (route === '/' || route === '') {
    content = html`<${Dashboard} user=${user} />`;
  } else if (route === '/projects') {
    content = html`<${Projects} />`;
  } else if (route === '/terminals') {
    content = html`<${Terminals} />`;
  } else if (route === '/tasks') {
    content = html`<${TasksSection} />`;
  } else if (route === '/notes') {
    content = html`<${IosNotesPage} />`;
  } else if (route === '/settings') {
    content = html`<${Settings} />`;
  } else if (route === '/agent-os') {
    content = html`<${AgentOS} />`;
  } else if (route === '/mcp-access') {
    content = user?.role === 'owner'
      ? html`<${McpAccessPage} />`
      : html`<div class="empty-state">Owner role required</div>`;
  } else if (route === '/xmachines' || route.startsWith('/xmachines/')) {
    if (user?.role !== 'owner') {
      content = html`<div class="empty-state">Owner role required</div>`;
    } else if (route === '/xmachines') {
      content = html`<${XmachinesFleetPage} />`;
    } else if (route === '/xmachines/audit') {
      content = html`<${XmachinesAuditPage} />`;
    } else {
      const name = decodeURIComponent(route.split('/')[2] || '');
      content = html`<${XmachinesDetailPage} name=${name} key=${name} />`;
    }
  } else if (route.startsWith('/project/')) {
    const id = route.split('/')[2];
    content = html`<${ProjectDetail} id=${id} key=${id} />`;
  } else {
    content = html`<div class="empty-state">Page not found</div>`;
  }

  return html`
    <${Header} user=${user} />
    <main class="main">${content}</main>
    <${SessionExpiredOverlay} />
  `;
}

render(html`<${isTgMiniApp ? TgApp : App} />`, document.getElementById('app'));
