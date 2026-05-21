import { h, render, Component } from 'https://esm.sh/preact@10.19.3';
import { useState, useEffect, useCallback, useRef } from 'https://esm.sh/preact@10.19.3/hooks';
import htm from 'https://esm.sh/htm@3.1.1';
import { normalizeTerminalOutput, diffTerminalOutput, buildInitialFriendlyState, capTerminalOutput, formatFriendlyTerminalOutput } from './terminal-chat-state.js';
import {
  AVAILABLE_BOTTOM_NAV_TABS,
  DEFAULT_BOTTOM_NAV_TAB_IDS,
  addBottomNavTab,
  buildOvermindWsUrl,
  countDoneTasks,
  currentElapsedMs,
  formatElapsed,
  formatStuckDuration,
  getBottomNavTabs,
  groupOvermindHistoryByWorkflow,
  isActiveStatus,
  moveBottomNavTab,
  readBottomNavTabIds,
  removeBottomNavTab,
  statusColor,
  statusIcon,
  summarizeWorkflows,
  taskGlyph,
  totalElapsedMs,
  writeBottomNavTabIds
} from './overmind-helpers.js';

const html = htm.bind(h);

// Telegram Mini App detection
const isTgMiniApp = !!(window.Telegram?.WebApp?.initData);
if (isTgMiniApp) {
  document.body.classList.add('tg-miniapp');
  const tp = window.Telegram.WebApp.themeParams || {};
  const root = document.documentElement.style;
  // Force-apply TG theme params as CSS variables
  if (tp.bg_color) root.setProperty('--tg-theme-bg-color', tp.bg_color);
  if (tp.secondary_bg_color) root.setProperty('--tg-theme-secondary-bg-color', tp.secondary_bg_color);
  if (tp.text_color) root.setProperty('--tg-theme-text-color', tp.text_color);
  if (tp.hint_color) root.setProperty('--tg-theme-hint-color', tp.hint_color);
  if (tp.button_color) root.setProperty('--tg-theme-button-color', tp.button_color);
  if (tp.button_text_color) root.setProperty('--tg-theme-button-text-color', tp.button_text_color);
  if (tp.section_bg_color) root.setProperty('--tg-theme-section-bg-color', tp.section_bg_color);
  if (tp.section_separator_color) root.setProperty('--tg-theme-section-separator-color', tp.section_separator_color);
  if (tp.accent_text_color) root.setProperty('--tg-theme-accent-text-color', tp.accent_text_color);
  // Detect light/dark theme and set explicit fallback colors
  const bgColor = tp.bg_color || '#0d1117';
  const r = parseInt(bgColor.slice(1, 3), 16), g = parseInt(bgColor.slice(3, 5), 16), b = parseInt(bgColor.slice(5, 7), 16);
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  if (brightness > 128) {
    // Light theme — force dark text
    document.body.classList.add('tg-light');
    root.setProperty('--text', tp.text_color || '#1a1a1a');
    root.setProperty('--text-secondary', tp.hint_color || '#666666');
    root.setProperty('--bg', tp.bg_color || '#ffffff');
    root.setProperty('--surface', tp.secondary_bg_color || tp.section_bg_color || '#f0f0f0');
    root.setProperty('--border', tp.section_separator_color || '#d0d0d0');
  }
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

function workflowDisplayName(workflow) {
  return workflow.display_name || workflow.label;
}

function currentWorkflowTask(tasks, currentTask) {
  const rows = Array.isArray(tasks) ? tasks : [];
  const processingTask = rows.find(task => task?.state === 'processing');
  if (processingTask) {
    return {
      id: processingTask.id || rows.indexOf(processingTask) + 1,
      description: processingTask.label || currentTask || '—'
    };
  }

  const matchedTask = currentTask
    ? rows.find(task => task?.id === currentTask || task?.label === currentTask || (task?.id && currentTask.includes(task.id)))
    : null;
  return {
    id: matchedTask?.id || (matchedTask ? rows.indexOf(matchedTask) + 1 : '—'),
    description: matchedTask?.label || currentTask || '—'
  };
}

function childSessionStatus(workflow, session) {
  const childStatuses = Array.isArray(workflow.child_statuses) ? workflow.child_statuses : [];
  return childStatuses.find(child => child?.session === session)?.status || null;
}

function renderOvermindStatusValue(status, fallback = '—') {
  const label = status || fallback;
  const colorClass = status ? statusColor(status) : 'ovm-neutral';
  return html`<span class=${'overmind-session-status ' + colorClass}>${label}</span>`;
}

// Auth
function Login() {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Auto-auth in Telegram WebApp context
    const tg = window.Telegram?.WebApp;
    if (tg) {
      tg.ready();
      tg.expand();
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

  async function doAuth(initData, surface = 'web') {
    setLoading(true);
    setError('');
    try {
      const data = await api('/api/auth/telegram', {
        method: 'POST',
        body: JSON.stringify({ initData, surface })
      });
      authToken = data.token;
      localStorage.setItem('agj_token', data.token);
      localStorage.setItem('agj_user', JSON.stringify(data.user));
      location.reload();
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
      authToken = data.token;
      localStorage.setItem('agj_token', data.token);
      localStorage.setItem('agj_user', JSON.stringify(data.user));
      location.reload();
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }

  return html`
    <div class="login-container">
      <div class="login-card">
        <h2>AGJAssist</h2>
        ${window.Telegram?.WebApp?.initData ? html`
          <p>${loading ? 'Authenticating...' : 'Telegram WebApp detected. Authenticating automatically...'}</p>
        ` : step === 'code' ? html`
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
          <a href="#/overmind" class=${route === '/overmind' ? 'active' : ''}>Workflows</a>
          <a href="#/tasks" class=${route === '/tasks' ? 'active' : ''}>Tasks</a>
          <a href="#/notes" class=${route === '/notes' ? 'active' : ''}>Notes</a>
          <a href="#/conversations" class=${route === '/conversations' ? 'active' : ''}>Conversations</a>
          <a href="#/settings" class=${route === '/settings' ? 'active' : ''}>Settings</a>
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
function Dashboard() {
  const [stats, setStats] = useState({ projects: 0, tasks: 0, reminders: 0, conversations: 0, notes: 0, workflows: 0, activeWorkflows: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api('/api/projects').catch(() => ({ projects: [] })),
      api('/api/personal-tasks').catch(() => ({ tasks: [] })),
      api('/api/reminders').catch(() => ({ reminders: [] })),
      api('/api/conversations').catch(() => ({ conversations: [] })),
      api('/api/notes?status=open').catch(() => ({ notes: [] })),
      api('/api/overmind/workflows').catch(() => ({ workflows: [] }))
    ]).then(([p, t, r, c, n, w]) => {
      const workflowSummary = summarizeWorkflows(w.workflows);
      setStats({
        projects: p.projects?.length || 0,
        tasks: t.tasks?.length || 0,
        reminders: r.reminders?.length || 0,
        conversations: c.conversations?.length || 0,
        notes: n.notes?.length || 0,
        workflows: workflowSummary.total,
        activeWorkflows: workflowSummary.active
      });
      setLoading(false);
    });
  }, []);

  if (loading) return html`<div class="loading">Loading...</div>`;

  const cards = [
    { label: 'Projects', count: stats.projects, route: '/projects', desc: 'Manage your development projects' },
    { label: 'Terminals', count: null, route: '/terminals', desc: 'Tmux terminal sessions' },
    { label: 'Workflows', count: stats.workflows, route: '/overmind', desc: `${stats.workflows} workflows · ${stats.activeWorkflows} active` },
    { label: 'Tasks', count: stats.tasks, route: '/tasks', desc: 'Daily & weekly tasks, reminders' },
    { label: 'Notes', count: stats.notes, route: '/notes', desc: 'Quick notes, attach to any project' },
    { label: 'Conversations', count: stats.conversations, route: '/conversations', desc: 'Chat with LLMs' },
    { label: 'Settings', count: null, route: '/settings', desc: 'Templates, safety patterns, 2FA' }
  ];

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
      </div>
    </div>
  `;
}

function OvermindWorkflows() {
  const [workflows, setWorkflows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [streamStatus, setStreamStatus] = useState('connecting');
  const [now, setNow] = useState(Date.now());
  const [expandedWorkflows, setExpandedWorkflows] = useState({});
  const [expandedHistoryGroups, setExpandedHistoryGroups] = useState({});
  const [workflowTab, setWorkflowTab] = useState('active');
  const streamStatusRef = useRef(streamStatus);

  useEffect(() => {
    streamStatusRef.current = streamStatus;
  }, [streamStatus]);

  const loadWorkflows = useCallback(async () => {
    try {
      const data = await api('/api/overmind/workflows');
      setWorkflows(data.workflows || []);
      setError('');
    } catch (e) {
      setError(e.message || 'Failed to load workflows.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const data = await api('/api/overmind/history');
      setHistory(data.history || []);
      setHistoryError('');
    } catch (e) {
      setHistoryError(e.message || 'Failed to load workflow history.');
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    loadWorkflows();
  }, [loadWorkflows]);

  const toggleWorkflow = useCallback((workflowId) => {
    setExpandedWorkflows(prev => ({ ...prev, [workflowId]: !prev[workflowId] }));
  }, []);

  const toggleHistoryGroup = useCallback((groupKey) => {
    setExpandedHistoryGroups(prev => ({ ...prev, [groupKey]: prev[groupKey] === false }));
  }, []);

  const renameWorkflow = useCallback(async (workflow) => {
    const nextName = window.prompt('Rename workflow', workflow.display_name || workflow.label);
    if (nextName === null) return;

    try {
      const data = await api(`/api/overmind/workflows/${workflow.id}/name`, {
        method: 'POST',
        body: JSON.stringify({ name: nextName })
      });
      if (data.workflow) {
        setWorkflows(prev => prev.map(item => item.id === data.workflow.id ? data.workflow : item));
      }
      setError('');
    } catch (e) {
      setError(e.message || 'Failed to rename workflow.');
    }
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (workflowTab === 'history') {
      loadHistory();
    }
  }, [workflowTab, loadHistory]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (streamStatusRef.current !== 'connected') {
        loadWorkflows();
      }
    }, 15000);
    return () => clearInterval(timer);
  }, [loadWorkflows]);

  useEffect(() => {
    const wsUrl = buildOvermindWsUrl(authToken);
    if (!wsUrl) {
      setStreamStatus('polling');
      return;
    }

    const ws = new WebSocket(wsUrl);
    let closed = false;

    ws.onopen = () => setStreamStatus('connected');
    ws.onerror = () => setStreamStatus('polling');
    ws.onclose = () => {
      if (!closed) setStreamStatus('polling');
    };
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if ((msg.type === 'snapshot' || msg.type === 'update') && Array.isArray(msg.workflows)) {
          setWorkflows(msg.workflows);
          setLoading(false);
          setError('');
          setNow(Date.now());
        } else if (msg.type === 'error') {
          setError(msg.message || 'Workflow stream error.');
        }
      } catch {}
    };

    return () => {
      closed = true;
      ws.close();
    };
  }, []);

  if (loading) return html`<div class="loading">Loading workflows...</div>`;

  const activeWorkflows = workflows.filter(workflow => isActiveStatus(workflow.status));
  const completedWorkflows = workflows.filter(workflow => workflow.status === 'completed' || workflow.status === 'paused');
  const historyGroups = groupOvermindHistoryByWorkflow(history);
  const visibleWorkflows = workflowTab === 'completed' ? completedWorkflows : activeWorkflows;
  const tabEmptyText = workflowTab === 'completed' ? 'No completed workflows' : 'No active workflows';

  return html`
    <div class="overmind-page">
      <div class="action-bar">
        <h2>Workflows</h2>
        <div class="overmind-actions">
          <span class="badge badge-${streamStatus === 'connected' ? 'active' : 'pending'}">${streamStatus}</span>
          <button class="btn btn-sm" onclick=${workflowTab === 'history' ? loadHistory : loadWorkflows}>Refresh</button>
        </div>
      </div>

      ${error && html`<div class="overmind-alert">${error}</div>`}
      ${historyError && workflowTab === 'history' && html`<div class="overmind-alert">${historyError}</div>`}

      <div class="overmind-tabs" role="tablist" aria-label="Workflow status filters">
        <button
          type="button"
          role="tab"
          aria-selected=${workflowTab === 'active'}
          class=${'overmind-tab ' + (workflowTab === 'active' ? 'active' : '')}
          onclick=${() => setWorkflowTab('active')}
        >
          Active (${activeWorkflows.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected=${workflowTab === 'completed'}
          class=${'overmind-tab ' + (workflowTab === 'completed' ? 'active' : '')}
          onclick=${() => setWorkflowTab('completed')}
        >
          Completed (${completedWorkflows.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected=${workflowTab === 'history'}
          class=${'overmind-tab ' + (workflowTab === 'history' ? 'active' : '')}
          onclick=${() => setWorkflowTab('history')}
        >
          History (${history.length})
        </button>
      </div>

      ${workflowTab === 'history' ? html`
        ${historyLoading ? html`
          <div class="loading">Loading workflow history...</div>
        ` : historyGroups.length === 0 ? html`
          <div class="empty-state">No workflow history archived.</div>
        ` : html`
          <div class="item-list overmind-list">
            ${historyGroups.map(group => {
              const isExpanded = expandedHistoryGroups[group.key] !== false;
              return html`
                <section class="item-card overmind-card ovm-neutral overmind-history-group" key=${group.key}>
                  <div class="overmind-card-header">
                    <button
                      type="button"
                      class="overmind-card-toggle"
                      aria-expanded=${isExpanded}
                      onclick=${() => toggleHistoryGroup(group.key)}
                    >
                      <div class="overmind-title">
                        <span class="overmind-chevron" aria-hidden="true">${isExpanded ? '▾' : '▸'}</span>
                        <div>
                          <h3>${group.name}</h3>
                          <div class="overmind-current">${group.coordinator_session || '—'} · ${group.entries.length} ${group.entries.length === 1 ? 'entry' : 'entries'}</div>
                        </div>
                      </div>
                    </button>
                  </div>
                  ${isExpanded && html`
                    <div class="overmind-history-list overmind-history-archive-list">
                      ${group.entries.map(entry => html`
                        <div class="overmind-history-entry" key=${(entry.id || entry.at) + '-' + entry.done + '-' + entry.total}>
                          <time>${entry.at ? new Date(entry.at).toLocaleString() : '—'}</time>
                          <span>${entry.current_task || '—'}</span>
                          <strong>${entry.done ?? 0}/${entry.total ?? 0}</strong>
                        </div>
                      `)}
                    </div>
                  `}
                </section>
              `;
            })}
          </div>
        `}
      ` : workflows.length === 0 ? html`
        <div class="empty-state">No workflows registered.</div>
      ` : visibleWorkflows.length === 0 ? html`
        <div class="empty-state">${tabEmptyText}</div>
      ` : html`
        <div class="item-list overmind-list">
          ${visibleWorkflows.map(workflow => {
            const tasks = Array.isArray(workflow.tasks) ? workflow.tasks : [];
            const doneCount = countDoneTasks(tasks);
            const childSessions = Array.isArray(workflow.child_sessions) ? workflow.child_sessions : [];
            const firstChildSession = childSessions[0] || null;
            const extraChildSessions = childSessions.slice(1);
            const extraChildStatuses = extraChildSessions.map(session => ({
              session,
              status: childSessionStatus(workflow, session)
            }));
            const colorClass = statusColor(workflow.status);
            const isExpanded = !!expandedWorkflows[workflow.id];
            const runStartedAt = workflow.run_started_at || workflow.created_at;
            const currentElapsed = formatElapsed(currentElapsedMs(runStartedAt, workflow.ended_at, now));
            const totalElapsed = formatElapsed(totalElapsedMs(workflow.accumulated_ms, runStartedAt, workflow.ended_at, now));
            const displayName = workflowDisplayName(workflow);
            const currentTask = currentWorkflowTask(tasks, workflow.current_task);
            const parentStatus = workflow.parent_status || workflow.status;
            const firstChildStatus = firstChildSession ? childSessionStatus(workflow, firstChildSession) : null;
            const totalTasks = tasks.length;
            const doneTasks = tasks.filter(t => t && t.state === 'done').length;
            const pctComplete = totalTasks ? Math.round((doneTasks / totalTasks) * 100) : 0;
            return html`
              <section class=${'item-card overmind-card ' + colorClass} key=${workflow.id}>
                <div class="overmind-card-header">
                  <button
                    type="button"
                    class="overmind-card-toggle overmind-title-toggle"
                    aria-expanded=${isExpanded}
                    onclick=${() => toggleWorkflow(workflow.id)}
                  >
                    <div class="overmind-title">
                      <h3>${displayName}</h3>
                    </div>
                  </button>
                  <div class="overmind-status">
                    <span class="overmind-pct" title=${doneTasks + '/' + totalTasks + ' tasks complete'}>${pctComplete}%</span>
                    <button
                      type="button"
                      class="overmind-rename-button"
                      title="Rename workflow"
                      aria-label=${'Rename workflow ' + displayName}
                      onclick=${() => renameWorkflow(workflow)}
                    >✎</button>
                    <button
                      type="button"
                      class="overmind-chevron-button"
                      aria-label=${isExpanded ? 'Collapse workflow ' + displayName : 'Expand workflow ' + displayName}
                      aria-expanded=${isExpanded}
                      onclick=${() => toggleWorkflow(workflow.id)}
                    >
                      <span class="overmind-chevron" aria-hidden="true">${isExpanded ? '▾' : '▸'}</span>
                    </button>
                    <span class=${'badge overmind-status-badge ' + colorClass}>${statusIcon(workflow.status)} ${workflow.status}</span>
                  </div>
                </div>
                <div class="overmind-substatus">
                  <div class="overmind-task-line"><span><strong>task#${currentTask.id}:</strong> ${workflow.current_task || '—'}</span><span class="overmind-task-count">${doneTasks}/${totalTasks}</span></div>
                  <div>${currentTask.description}</div>
                </div>

                ${isExpanded && html`
                  <div class="overmind-expanded">
                    ${workflow.status === 'awaiting_decision' && workflow.pending_decision && html`
                      <div class="overmind-decision">
                        <strong>Pending decision</strong>
                        <pre>${workflow.pending_decision}</pre>
                      </div>
                    `}

                    <table class="overmind-detail-table">
                      <tbody>
                        <tr>
                          <th scope="row">parent</th>
                          <td>${workflow.coordinator_session || '—'}</td>
                          <th scope="row">child</th>
                          <td>
                            ${firstChildSession || 'n/a'}
                            ${extraChildSessions.length > 0 && html`<div class="overmind-extra-children">${extraChildSessions.join(', ')}</div>`}
                          </td>
                        </tr>
                        <tr>
                          <th scope="row">status</th>
                          <td>${renderOvermindStatusValue(parentStatus)}</td>
                          <th scope="row">status</th>
                          <td>
                            ${firstChildSession
                              ? renderOvermindStatusValue(firstChildStatus, '—')
                              : html`<span class="overmind-session-status ovm-neutral">n/a</span>`}
                            ${extraChildSessions.length > 0 && html`
                              <div class="overmind-extra-children">
                                ${extraChildStatuses.map(child => html`
                                  <span class=${'overmind-session-status overmind-extra-child-status ' + statusColor(child.status)} key=${child.session}>
                                    ${child.session}: ${child.status || '—'}
                                  </span>
                                `)}
                              </div>
                            `}
                          </td>
                        </tr>
                        <tr>
                          <th scope="row">Elapsed</th>
                          <td>${currentElapsed}${workflow.ended_at ? ' (done)' : ''}</td>
                          <th scope="row">Total</th>
                          <td>${totalElapsed}</td>
                        </tr>
                        <tr>
                          <th scope="row">Tier</th>
                          <td>${workflow.tier ?? 0}</td>
                          <th scope="row">Stuck</th>
                          <td>${workflow.stuck_since ? formatStuckDuration(workflow.stuck_since, now) : '—'}</td>
                        </tr>
                      </tbody>
                    </table>

                    <details class="overmind-tasklist" open=${tasks.length <= 6}>
                      <summary>Tasks ${doneCount}/${tasks.length}</summary>
                      ${tasks.length === 0 ? html`
                        <div class="overmind-task-empty">No tasklist published.</div>
                      ` : html`
                        <div class="overmind-tasks">
                          ${tasks.map(task => html`
                            <div class=${'overmind-task overmind-task-' + task.state} key=${task.id || task.label}>
                              <span class="overmind-task-glyph">${taskGlyph(task.state)}</span>
                              <span>${task.label}</span>
                            </div>
                          `)}
                        </div>
                      `}
                    </details>
                  </div>
                `}
              </section>
            `;
          })}
        </div>
      `}
    </div>
  `;
}

// Projects list (moved from old Dashboard)
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

// Project Detail
function ProjectDetail({ id }) {
  const [project, setProject] = useState(null);
  const [tab, setTab] = useState('code');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api(`/api/projects/${id}`).then(d => { setProject(d.project); setLoading(false); }).catch(() => setLoading(false));
  }, [id]);

  if (loading) return html`<div class="loading">Loading...</div>`;
  if (!project) return html`<div class="empty-state">Project not found</div>`;

  const tabs = ['code', 'notes', 'plans', 'tasks', 'activity'];

  return html`
    <div>
      <div class="action-bar">
        <h2 style="cursor:pointer" onclick=${() => navigate('/projects')}>← ${project.display_name || project.directory_name}</h2>
      </div>
      <div class="tabs">
        ${tabs.map(t => html`<div class="tab ${tab === t ? 'active' : ''}" onclick=${() => setTab(t)}>${t.charAt(0).toUpperCase() + t.slice(1)}</div>`)}
      </div>
      ${tab === 'code' && html`<${CodeTab} projectId=${id} projectRoot=${project.fullPath || ''} />`}
      ${tab === 'notes' && html`<${NotesTab} projectId=${id} />`}
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
  const [showNewSession, setShowNewSession] = useState(false);
  const [newSessionName, setNewSessionName] = useState('');
  const [friendlyMode, setFriendlyMode] = useState(isTgMiniApp);
  const [fullScreen, setFullScreen] = useState(false);

  const previousRoute = (() => {
    try { return sessionStorage.getItem('agj_prev_route') || '/'; } catch { return '/'; }
  })();

  function loadSessions() {
    setSessionsError(null);
    api('/api/tmux/sessions')
      .then(d => setSessions(d.sessions))
      .catch(e => setSessionsError(e.message || 'Failed to load sessions'));
  }

  useEffect(() => { loadSessions(); }, []);

  useEffect(() => {
    if (!isTgMiniApp) return;
    document.body.classList.toggle('tg-terminal-focus', fullScreen);
    return () => document.body.classList.remove('tg-terminal-focus');
  }, [fullScreen]);

  const exitFullScreen = useCallback(() => {
    setFullScreen(false);
    const targetRoute = previousRoute && previousRoute !== '/terminals' ? previousRoute : null;
    if (targetRoute) navigate(targetRoute);
  }, [previousRoute]);

  useEffect(() => {
    if (!isTgMiniApp) return undefined;
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
    } catch (e) { alert(e.message); }
  }

  const allPanes = sessions.flatMap(s => s.panes.map(p => ({ ...p, session_name: s.session_name })));
  const activePane = allPanes.find(p => p.target === activeTarget) || null;
  const hasTarget = !!activeTarget;

  const shell = html`
    <div class=${'terminal-shell' + (fullScreen ? ' terminal-shell-fullscreen' : '')}>
      <div class="terminal-shell-header">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          ${isTgMiniApp && fullScreen && html`
            <button class="btn btn-sm" onclick=${exitFullScreen}>Back</button>
          `}
          <strong>${friendlyMode ? 'Terminal Chat' : 'Raw Terminal'}</strong>
          ${activePane && html`<span class="badge badge-draft">${activePane.session_name}</span>`}
          ${activeTarget && html`<span class="badge badge-active">${activeTarget}</span>`}
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <button class=${'btn btn-sm' + (friendlyMode ? ' btn-primary' : '')}
                  onclick=${() => setFriendlyMode(true)}>Friendly</button>
          <button class=${'btn btn-sm' + (!friendlyMode ? ' btn-primary' : '')}
                  onclick=${() => setFriendlyMode(false)}>Raw</button>
          ${isTgMiniApp && html`
            <button class="btn btn-sm" onclick=${() => {
              if (fullScreen) {
                exitFullScreen();
              } else {
                setFullScreen(true);
              }
            }}>${fullScreen ? 'Close Full' : 'Full Screen'}</button>
          `}
          ${activeTarget && html`
            <button class="btn btn-sm btn-danger" onclick=${() => setActiveTarget(null)}>Disconnect</button>
          `}
        </div>
      </div>

      ${isTgMiniApp && html`
        <div class="terminal-mobile-picker">
          ${sessionsError
            ? html`<div style="color:var(--danger,#f85149);font-size:12px;flex:1">${sessionsError} <button class="btn btn-sm" onclick=${loadSessions}>Retry</button></div>`
            : html`<select value=${activeTarget || ''} onChange=${e => setActiveTarget(e.target.value || null)}>
                <option value="">${allPanes.length === 0 ? 'Loading panes...' : 'Select a pane...'}</option>
                ${allPanes.map(p => html`
                  <option value=${p.target}>${p.session_name} · ${p.target} · ${p.command}</option>
                `)}
              </select>`
          }
          <button class="btn btn-sm btn-primary" onclick=${() => {
            setNewSessionName('');
            setShowNewSession(true);
          }}>New</button>
        </div>
      `}

      <div class="terminal-container">
        ${!isTgMiniApp && html`
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
                  <div class="tree-item ${activeTarget === p.target ? 'active' : ''}"
                       onclick=${() => setActiveTarget(activeTarget === p.target ? null : p.target)}>
                    ${p.target} <span style="color:var(--text-secondary);font-size:11px">${p.command}</span>
                  </div>
                `)}
              </div>
            `)}
            ${sessions.length === 0 && html`<div style="color:var(--text-secondary);font-size:12px;padding:8px">No active sessions</div>`}
          </div>
        `}

        <div class=${'terminal-panel' + (friendlyMode ? ' terminal-panel-friendly' : '')}>
          ${hasTarget
            ? (friendlyMode
                ? html`<${FriendlyTerminalView}
                    target=${activeTarget}
                    sessionName=${activePane?.session_name || ''}
                    fullScreen=${fullScreen}
                    onToggleFullScreen=${isTgMiniApp ? () => {
                      if (fullScreen) {
                        exitFullScreen();
                      } else {
                        setFullScreen(true);
                      }
                    } : null}
                    onDisconnect=${() => setActiveTarget(null)}
                  />`
                : html`<${TerminalView} target=${activeTarget} key=${activeTarget} onDisconnect=${() => setActiveTarget(null)} />`)
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
    ${fullScreen && isTgMiniApp
      ? html`<div class="terminal-fullscreen-overlay">${shell}</div>`
      : shell}
  `;
}

function FriendlyTerminalView({ target, sessionName, fullScreen, onToggleFullScreen, onDisconnect }) {
  const [status, setStatus] = useState('loading');
  const [entries, setEntries] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [snapshot, setSnapshot] = useState('');
  const [lineLimit, setLineLimit] = useState(() => 25);
  const [lastCommand, setLastCommand] = useState('');
  const [lastUpdatedAt, setLastUpdatedAt] = useState(0);
  const transcriptRef = useRef(null);
  const snapshotRef = useRef('');
  const sendingRef = useRef(false);
  const pendingOutputRef = useRef('');
  const pendingSinceRef = useRef(0);
  const storageKey = 'agj_terminal_chat_' + target.replace(/[^a-zA-Z0-9_.-]/g, '_');
  const lineLimitKey = storageKey + '_line_limit';

  function getCaptureLines() {
    return lineLimit;
  }

  function queueBufferedOutput(chunk) {
    const trimmed = (chunk || '').trim();
    if (!trimmed) return;
    pendingOutputRef.current = pendingOutputRef.current
      ? `${pendingOutputRef.current}\n${trimmed}`
      : trimmed;
    if (!pendingSinceRef.current) {
      pendingSinceRef.current = Date.now();
    }
  }

  function flushBufferedOutput(force = false) {
    const pending = pendingOutputRef.current.trim();
    if (!pending) return;
    const wordCount = pending.split(/\s+/).filter(Boolean).length;
    const ageMs = Date.now() - (pendingSinceRef.current || Date.now());
    if (!force && wordCount < 10 && ageMs < 2500) return;
    pendingOutputRef.current = '';
    pendingSinceRef.current = 0;
    setEntries(prev => [...prev, {
      id: 'bg-' + Date.now(),
      role: 'terminal',
      label: 'Background output',
      content: pending,
      timestamp: new Date().toLocaleTimeString()
    }]);
  }

  useEffect(() => {
    try {
      const savedLineLimit = Number(sessionStorage.getItem(lineLimitKey) || '25');
      if ([25, 50, 100, 150, 200].includes(savedLineLimit)) {
        setLineLimit(savedLineLimit);
      }
    } catch {}
  }, [lineLimitKey]);

  useEffect(() => {
    try {
      sessionStorage.setItem(lineLimitKey, String(lineLimit));
    } catch {}
  }, [lineLimit, lineLimitKey]);

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
      setInput('');
      setEntries([]);
      setSnapshot('');
      snapshotRef.current = '';
      pendingOutputRef.current = '';
      pendingSinceRef.current = 0;
      let savedState = null;
      try {
        savedState = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
      } catch {}
      try {
        const data = await api(`/api/tmux/panes/${encodeURIComponent(target)}/output?lines=200`);
        if (!active) return;
        const output = capTerminalOutput(normalizeTerminalOutput(data.output), 200);
        const initialState = buildInitialFriendlyState({
          target,
          sessionName,
          liveOutput: output,
          savedState,
          now: Date.now()
        });
        setSnapshot(initialState.snapshot);
        snapshotRef.current = initialState.snapshot;
        setEntries(initialState.entries);
        setLastCommand(savedState?.lastCommand || '');
        setLastUpdatedAt(Date.now());
        setStatus('connected');
      } catch (e) {
        if (!active) return;
        setStatus('error');
        if (savedState?.entries?.length) {
          setSnapshot(capTerminalOutput(savedState.snapshot || '', 200));
          snapshotRef.current = capTerminalOutput(savedState.snapshot || '', 200);
          setEntries(savedState.entries);
          setLastCommand(savedState.lastCommand || '');
          setLastUpdatedAt(savedState.updatedAt || 0);
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
  }, [target, sessionName, storageKey, lineLimit]);

  useEffect(() => {
    let active = true;
    const refreshTimer = setInterval(async () => {
      if (!active || sendingRef.current) return;
      try {
        const data = await api(`/api/tmux/panes/${encodeURIComponent(target)}/output?lines=${getCaptureLines()}`);
        if (!active) return;
        const latest = capTerminalOutput(normalizeTerminalOutput(data.output), 200);
        const previous = snapshotRef.current;
        if (latest && latest !== previous) {
          const appended = diffTerminalOutput(previous, latest);
          if (appended) {
            queueBufferedOutput(appended);
          }
          snapshotRef.current = latest;
          setSnapshot(latest);
          setLastUpdatedAt(Date.now());
        }
        flushBufferedOutput();
      } catch {}
    }, 1000);

    return () => {
      active = false;
      clearInterval(refreshTimer);
    };
  }, [target]);

  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({
        entries: [],
        snapshot: capTerminalOutput(snapshot, 200),
        lastCommand,
        updatedAt: Date.now()
      }));
    } catch {}
  }, [entries, snapshot, lastCommand, storageKey]);

  async function captureCommandResult(beforeSnapshot) {
    let latest = beforeSnapshot;
    let changed = false;
    let stableReads = 0;

    for (let i = 0; i < 8; i += 1) {
      await sleep(i === 0 ? 250 : 450);
      const data = await api(`/api/tmux/panes/${encodeURIComponent(target)}/output?lines=${getCaptureLines()}`);
      const current = capTerminalOutput(normalizeTerminalOutput(data.output), 200);
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

  async function sendCommand() {
    const command = input.trim();
    if (!command || sending) return;

    flushBufferedOutput(true);
    const beforeSnapshot = snapshotRef.current;
    setInput('');
    setSending(true);
    setStatus('running');
    setLastCommand(command);
    setEntries(prev => [...prev, {
      id: 'cmd-' + Date.now(),
      role: 'user',
      label: 'You',
      content: command,
      timestamp: new Date().toLocaleTimeString()
    }]);

    try {
      await api(`/api/tmux/panes/${encodeURIComponent(target)}/send`, {
        method: 'POST',
        body: JSON.stringify({ command, enter: true })
      });
      const result = await captureCommandResult(beforeSnapshot);
      const cappedSnapshot = capTerminalOutput(result.snapshot, 200);
      snapshotRef.current = cappedSnapshot;
      setSnapshot(cappedSnapshot);
      setLastUpdatedAt(Date.now());
      setEntries(prev => [...prev, {
        id: 'out-' + Date.now(),
        role: 'terminal',
        label: 'Terminal',
        content: result.output || cappedSnapshot || 'Command sent. No new terminal output captured yet.',
        timestamp: new Date().toLocaleTimeString()
      }]);
      setStatus('connected');
    } catch (e) {
      setEntries(prev => [...prev, {
        id: 'err-' + Date.now(),
        role: 'error',
        label: 'Command failed',
        content: e.message || 'Failed to send command.',
        timestamp: new Date().toLocaleTimeString()
      }]);
      setStatus('error');
    }
    setSending(false);
  }

  async function sendManualEnter() {
    if (sending) return;

    flushBufferedOutput(true);
    const beforeSnapshot = snapshotRef.current;
    setSending(true);
    setStatus('running');

    try {
      await api(`/api/tmux/panes/${encodeURIComponent(target)}/send`, {
        method: 'POST',
        body: JSON.stringify({ send_enter_only: true })
      });
      const result = await captureCommandResult(beforeSnapshot);
      const cappedSnapshot = capTerminalOutput(result.snapshot, 200);
      snapshotRef.current = cappedSnapshot;
      setSnapshot(cappedSnapshot);
      setLastUpdatedAt(Date.now());
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

    setSending(false);
  }

  return html`
    <div class="terminal-chat-view">
      <div class="terminal-chat-header">
        <div>
          <strong>${sessionName || 'Terminal chat'}</strong>
          <div style="font-size:11px;color:var(--text-secondary)">${target}</div>
        </div>
        <div style="display:flex;align-items:center;gap:6px">
          <span class="badge badge-${status === 'connected' ? 'active' : status === 'running' ? 'pending' : status === 'loading' ? 'pending' : 'failed'}">${status}</span>
          <button class="btn btn-sm" onclick=${async () => {
            try {
              flushBufferedOutput(true);
              const data = await api(`/api/tmux/panes/${encodeURIComponent(target)}/output?lines=${getCaptureLines()}`);
              const latest = capTerminalOutput(normalizeTerminalOutput(data.output), 200);
              const previous = snapshotRef.current;
              const appended = diffTerminalOutput(previous, latest);
              if (appended) {
                setEntries(prev => [...prev, {
                  id: 'manual-' + Date.now(),
                  role: 'terminal',
                  label: 'Latest output',
                  content: appended,
                  timestamp: new Date().toLocaleTimeString()
                }]);
              }
              snapshotRef.current = latest;
              setSnapshot(latest);
              setLastUpdatedAt(Date.now());
              setStatus('connected');
            } catch (e) {
              setStatus('error');
            }
          }}>Refresh</button>
          <button class="btn btn-sm btn-danger" onclick=${onDisconnect}>Disconnect</button>
        </div>
      </div>

      <div class="terminal-chat-transcript" ref=${transcriptRef}>
        <div class="terminal-chat-controls">
          <label class="terminal-chat-line-picker">
            <span>Lines</span>
            <select value=${String(lineLimit)} onChange=${e => setLineLimit(Number(e.target.value))}>
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="150">150</option>
              <option value="200">200</option>
            </select>
          </label>
          ${onToggleFullScreen && html`
            <button class="btn btn-sm" onclick=${onToggleFullScreen}>
              ${fullScreen ? 'Collapse' : 'Full Screen'}
            </button>
          `}
        </div>
        <div class="terminal-chat-details">
          <span class="terminal-chat-detail-pill">${sessionName || 'Terminal chat'}</span>
          <span class="terminal-chat-detail-pill">${target}</span>
          <span class="terminal-chat-detail-pill">Showing ${lineLimit} lines</span>
          <span class="terminal-chat-detail-pill">Stored max 200</span>
          ${lastUpdatedAt ? html`<span class="terminal-chat-detail-pill">Updated ${new Date(lastUpdatedAt).toLocaleTimeString()}</span>` : ''}
        </div>
        <div class="terminal-chat-card terminal-chat-single-output">
          <div class="terminal-chat-meta">
            <span>${lastCommand ? `Last command · ${lastCommand}` : `Current output · ${sessionName || target}`}</span>
            <span>${lastUpdatedAt ? new Date(lastUpdatedAt).toLocaleTimeString() : status}</span>
          </div>
          <div class="terminal-chat-content">
            ${formatFriendlyTerminalOutput(snapshot, lineLimit) || (sending ? 'Running command...' : status === 'loading' ? 'Loading terminal output...' : status === 'error' ? 'Terminal output unavailable.' : `Connected to ${target}. Waiting for terminal output...`)}
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
      </div>

      <div class="terminal-chat-composer">
        <textarea value=${input}
                  rows="2"
                  placeholder="Type a terminal command..."
                  onInput=${e => setInput(e.target.value)}
                  onKeyDown=${e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      sendCommand();
                    }
                  }}></textarea>
        <button class="btn" onclick=${sendManualEnter} disabled=${sending}>
          Enter
        </button>
        <button class="btn btn-primary" onclick=${sendCommand} disabled=${sending || !input.trim()}>
          ${sending ? 'Running...' : 'Send'}
        </button>
      </div>
    </div>
  `;
}

// Terminal View (xterm.js)
function TerminalView({ target, onDisconnect }) {
  const [status, setStatus] = useState('connecting');

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
        fontSize: 13,
        lineHeight: 1.1,
        cursorBlink: false,
        scrollback: 5000,
        convertEol: false
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(container);
      fitAddon.fit();

      const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${wsProtocol}//${location.host}/ws/tmux/${encodeURIComponent(target)}?token=${authToken}`);

      ws.onopen = () => setStatus('connected');
      ws.onclose = () => { setStatus('disconnected'); term.write('\r\n\x1b[31m[Disconnected]\x1b[0m\r\n'); };
      ws.onerror = () => setStatus('error');

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
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
      };
    }

    init();
    return () => cleanup?.();
  }, [target]);

  const containerId = 'terminal-' + target.replace(/[:.]/g, '-');
  return html`
    <div style="height:100%;position:relative">
      <div style="position:absolute;top:4px;right:8px;z-index:10;font-size:11px;display:flex;align-items:center;gap:6px">
        <span class="badge badge-${status === 'connected' ? 'active' : status === 'connecting' ? 'pending' : 'failed'}">${status}</span>
        ${status === 'connected' && onDisconnect && html`
          <button class="btn btn-sm btn-danger" style="padding:2px 8px;font-size:10px" onclick=${onDisconnect}>Disconnect</button>
        `}
      </div>
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

function NotesTab({ projectId }) {
  const [notes, setNotes] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const [showAddToPlan, setShowAddToPlan] = useState(false);
  const [plans, setPlans] = useState([]);
  const [addMode, setAddMode] = useState('new'); // 'new' | 'existing'
  const [newPlanTitle, setNewPlanTitle] = useState('');
  const [selectedPlanId, setSelectedPlanId] = useState('');

  const load = useCallback(() => {
    api(`/api/projects/${projectId}/notes?status=open`).then(d => { setNotes(d.notes); setLoading(false); }).catch(() => setLoading(false));
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  function toggleSelect(id) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function selectAll() {
    if (selected.size === notes.length) setSelected(new Set());
    else setSelected(new Set(notes.map(n => n.id)));
  }

  async function openAddToPlan() {
    try {
      const d = await api(`/api/projects/${projectId}/plans`);
      setPlans(d.plans.filter(p => p.status !== 'completed'));
    } catch { setPlans([]); }
    setAddMode('new');
    setNewPlanTitle('');
    setSelectedPlanId('');
    setShowAddToPlan(true);
  }

  async function doAddToPlan() {
    const noteIds = [...selected];
    const body = addMode === 'new'
      ? { noteIds, projectId: Number(projectId), newPlanTitle: newPlanTitle.trim() }
      : { noteIds, projectId: Number(projectId), planId: Number(selectedPlanId) };

    if (addMode === 'new' && !newPlanTitle.trim()) return;
    if (addMode === 'existing' && !selectedPlanId) return;

    try {
      await api('/api/notes/add-to-plan', { method: 'POST', body: JSON.stringify(body) });
      setShowAddToPlan(false);
      setSelected(new Set());
      load();
    } catch (e) { alert(e.message); }
  }

  if (loading) return html`<div class="loading">Loading...</div>`;

  return html`
    <div>
      ${showAddToPlan && html`
        <div class="modal-overlay" onclick=${() => setShowAddToPlan(false)}>
          <div class="modal" style="max-width:450px" onclick=${e => e.stopPropagation()}>
            <h3>Add ${selected.size} note${selected.size > 1 ? 's' : ''} to plan</h3>
            <div style="display:flex;gap:8px;margin-bottom:16px">
              <button class="btn btn-sm ${addMode === 'new' ? 'btn-primary' : ''}" onclick=${() => setAddMode('new')}>New Plan</button>
              <button class="btn btn-sm ${addMode === 'existing' ? 'btn-primary' : ''}" onclick=${() => setAddMode('existing')}>Existing Plan</button>
            </div>
            ${addMode === 'new' ? html`
              <div class="form-group">
                <label>Plan Title</label>
                <input value=${newPlanTitle} onInput=${e => setNewPlanTitle(e.target.value)}
                       onKeyDown=${e => e.key === 'Enter' && doAddToPlan()}
                       placeholder="Enter plan title..." autofocus />
              </div>
            ` : html`
              <div class="form-group">
                <label>Select Plan</label>
                ${plans.length > 0 ? html`
                  <select value=${selectedPlanId} onChange=${e => setSelectedPlanId(e.target.value)}>
                    <option value="">Choose a plan...</option>
                    ${plans.map(p => html`<option value=${p.id}>${p.title} (${p.status})</option>`)}
                  </select>
                ` : html`<p style="color:var(--text-secondary);font-size:13px">No active plans. Create a new one instead.</p>`}
              </div>
            `}
            <div class="modal-actions">
              <button class="btn" onclick=${() => setShowAddToPlan(false)}>Cancel</button>
              <button class="btn btn-primary" onclick=${doAddToPlan}
                      disabled=${addMode === 'new' ? !newPlanTitle.trim() : !selectedPlanId}>
                Add to Plan
              </button>
            </div>
          </div>
        </div>
      `}

      <div class="action-bar">
        <div style="display:flex;align-items:center;gap:12px">
          <h3>${notes.length} Notes</h3>
          ${notes.length > 0 && html`
            <label style="font-size:12px;color:var(--text-secondary);cursor:pointer;display:flex;align-items:center;gap:4px">
              <input type="checkbox" checked=${selected.size === notes.length && notes.length > 0} onchange=${selectAll} />
              Select all
            </label>
          `}
        </div>
        <div style="display:flex;gap:8px">
          ${selected.size > 0 && html`
            <button class="btn btn-sm" onclick=${openAddToPlan}>Add to Plan (${selected.size})</button>
          `}
          <button class="btn btn-sm btn-primary" onclick=${() => setShowForm(!showForm)}>${showForm ? 'Cancel' : 'New Note'}</button>
        </div>
      </div>
      ${showForm && html`
        <div class="item-card" style="margin-bottom:16px">
          <div class="form-group"><label>Title (optional)</label><input id="noteTitle" /></div>
          <div class="form-group"><label>Body</label><textarea id="noteBody" rows="4"></textarea></div>
          <button class="btn btn-primary" onclick=${async () => {
            const title = document.getElementById('noteTitle').value;
            const body = document.getElementById('noteBody').value;
            if (!body) return;
            await api(`/api/projects/${projectId}/notes`, { method: 'POST', body: JSON.stringify({ title, body }) });
            setShowForm(false); load();
          }}>Save Note</button>
        </div>
      `}
      <div class="item-list">
        ${notes.map(n => html`
          <${NoteCard} key=${n.id} note=${n} selected=${selected.has(n.id)}
            onToggle=${() => toggleSelect(n.id)}
            onDelete=${async () => {
              if (!confirm('Delete this note?')) return;
              await api(`/api/notes/${n.id}`, { method: 'DELETE' });
              setSelected(prev => { const next = new Set(prev); next.delete(n.id); return next; });
              load();
            }}
            onSave=${async (updates) => {
              await api(`/api/notes/${n.id}`, { method: 'PATCH', body: JSON.stringify(updates) });
              load();
            }}
          />
        `)}
        ${notes.length === 0 && html`<div class="empty-state">No open notes. Notes added to plans are moved out.</div>`}
      </div>
    </div>
  `;
}

// ===================== STANDALONE NOTES PAGE =====================

function NotesPage() {
  const [notes, setNotes] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('open');
  const [sort, setSort] = useState('newest');
  const [search, setSearch] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [formBody, setFormBody] = useState('');
  const [formTitle, setFormTitle] = useState('');
  const [formProject, setFormProject] = useState('');
  const [formTags, setFormTags] = useState('');
  // Detail view state
  const [selectedNote, setSelectedNote] = useState(null);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');
  const [editProject, setEditProject] = useState('');
  const [editTags, setEditTags] = useState('');
  const bodyRef = useRef(null);
  const [perPage, setPerPage] = useState(10);
  // Bulk select state
  const [selected, setSelected] = useState(new Set());
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [moveTargetProject, setMoveTargetProject] = useState('');
  // Project filter dropdown state
  const [showProjectFilter, setShowProjectFilter] = useState(false);
  const [activeGroupOpen, setActiveGroupOpen] = useState(true);
  const [inactiveGroupOpen, setInactiveGroupOpen] = useState(false);
  const projectFilterRef = useRef(null);

  // Close project filter dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e) {
      if (projectFilterRef.current && !projectFilterRef.current.contains(e.target)) {
        setShowProjectFilter(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => { setSearchDebounced(search); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => { setPage(1); }, [filter, statusFilter, sort, perPage]);

  useEffect(() => {
    api('/api/projects').then(d => setProjects(d.projects || [])).catch(() => {});
    // Restore draft if available
    const draft = loadDraft();
    if (draft) {
      if (draft.type === 'new') {
        setShowForm(true);
        setFormBody(draft.formBody || '');
        setFormTitle(draft.formTitle || '');
      } else if (draft.type === 'edit') {
        setEditBody(draft.editBody || '');
        setEditTitle(draft.editTitle || '');
        setEditing(true);
      }
      clearDraft();
    }
  }, []);

  const loadNotes = useCallback(() => {
    const params = new URLSearchParams();
    if (filter === 'unattached') params.set('unattached', '1');
    else if (filter !== 'all') params.set('project_id', filter);
    if (statusFilter) params.set('status', statusFilter);
    if (searchDebounced) params.set('search', searchDebounced);
    params.set('sort', sort);
    params.set('page', String(page));
    params.set('limit', String(perPage));
    api(`/api/notes?${params.toString()}`).then(d => {
      setNotes(d.notes || []);
      setTotal(d.total || 0);
      setTotalPages(d.totalPages || 1);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [filter, statusFilter, searchDebounced, sort, page, perPage]);

  useEffect(() => { setLoading(true); loadNotes(); }, [loadNotes]);

  async function createNote() {
    if (!formBody.trim()) return;
    const body = {
      body: formBody.trim(),
      title: formTitle.trim() || undefined,
      project_id: formProject ? Number(formProject) : null,
      tags: formTags.trim() ? formTags.split(',').map(t => t.trim()).filter(Boolean) : undefined
    };
    await api('/api/notes', { method: 'POST', body: JSON.stringify(body) });
    setFormBody(''); setFormTitle(''); setFormProject(''); setFormTags('');
    setShowForm(false);
    setPage(1);
    loadNotes();
  }

  async function saveEdit() {
    if (!selectedNote) return;
    const updates = {
      title: editTitle.trim() || null,
      body: editBody.trim(),
      project_id: editProject ? Number(editProject) : null,
      tags: editTags.trim() ? editTags.split(',').map(t => t.trim()).filter(Boolean) : []
    };
    if (!updates.body) return;
    await api(`/api/notes/${selectedNote.id}`, { method: 'PATCH', body: JSON.stringify(updates) });
    const refreshed = await api(`/api/notes/${selectedNote.id}`);
    setSelectedNote(refreshed.note);
    setEditing(false);
    loadNotes();
  }

  async function deleteNote(id) {
    if (!confirm('Delete this note?')) return;
    await api(`/api/notes/${id}`, { method: 'DELETE' });
    setSelectedNote(null);
    loadNotes();
  }

  async function archiveNote(id) {
    await api(`/api/notes/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'archived' }) });
    const refreshed = await api(`/api/notes/${id}`);
    setSelectedNote(refreshed.note);
    loadNotes();
  }

  async function reopenNote(id) {
    await api(`/api/notes/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'open' }) });
    const refreshed = await api(`/api/notes/${id}`);
    setSelectedNote(refreshed.note);
    loadNotes();
  }

  function openNote(n) {
    setSelectedNote(n);
    setEditing(false);
  }

  function startEdit() {
    if (!selectedNote) return;
    setEditTitle(selectedNote.title || '');
    setEditBody(selectedNote.body);
    setEditProject(selectedNote.project_id != null ? String(selectedNote.project_id) : '');
    setEditTags(selectedNote.tags ? JSON.parse(selectedNote.tags).join(', ') : '');
    setEditing(true);
  }

  function startEditDirect(n) {
    setSelectedNote(n);
    setEditTitle(n.title || '');
    setEditBody(n.body);
    setEditProject(n.project_id != null ? String(n.project_id) : '');
    setEditTags(n.tags ? JSON.parse(n.tags).join(', ') : '');
    setEditing(true);
  }

  function toggleSelect(id) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function selectAllNotes() {
    if (selected.size === notes.length) setSelected(new Set());
    else setSelected(new Set(notes.map(n => n.id)));
  }

  async function moveToProject() {
    if (!moveTargetProject) return;
    const pid = Number(moveTargetProject);
    try {
      await Promise.all([...selected].map(id =>
        api(`/api/notes/${id}`, { method: 'PATCH', body: JSON.stringify({ project_id: pid, status: 'promoted' }) })
      ));
      setShowMoveModal(false);
      setSelected(new Set());
      setMoveTargetProject('');
      loadNotes();
    } catch (e) { alert(e.message); }
  }

  async function moveToOpen() {
    if (!confirm('Move ' + selected.size + ' note(s) back to open/unattached?')) return;
    try {
      await Promise.all([...selected].map(id =>
        api(`/api/notes/${id}`, { method: 'PATCH', body: JSON.stringify({ project_id: null, status: 'open' }) })
      ));
      setSelected(new Set());
      loadNotes();
    } catch (e) { alert(e.message); }
  }

  function getFilterLabel() {
    if (filter === 'all') return 'All Projects';
    if (filter === 'unattached') return 'Unattached';
    const p = projects.find(pr => String(pr.id) === String(filter));
    return p ? (p.display_name || p.directory_name) : 'Project #' + filter;
  }

  function getProjectName(pid) {
    if (!pid) return null;
    const p = projects.find(pr => pr.id === pid);
    return p ? (p.display_name || p.directory_name) : `Project #${pid}`;
  }

  function parseTags(tagsStr) {
    if (!tagsStr) return [];
    try { return JSON.parse(tagsStr); } catch { return []; }
  }

  // ── Detail View ──
  if (selectedNote) {
    const n = selectedNote;
    const projName = getProjectName(n.project_id);
    const tags = parseTags(n.tags);

    if (editing) {
      return html`
        <div style="display:flex;flex-direction:column;height:calc(100vh - 120px);min-height:400px">
          <div style="flex-shrink:0;margin-bottom:12px">
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
              <button class="btn btn-sm" onclick=${() => setEditing(false)}>Cancel</button>
              <button class="btn btn-sm btn-primary" onclick=${saveEdit}>Save</button>
            </div>
            <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:8px">
              <div class="form-group" style="flex:1;min-width:200px;margin:0">
                <label style="font-size:11px;color:var(--text-secondary)">Title</label>
                <input value=${editTitle} onInput=${e => setEditTitle(e.target.value)} placeholder="Title (optional)" />
              </div>
              <div class="form-group" style="flex:0 0 180px;margin:0">
                <label style="font-size:11px;color:var(--text-secondary)">Project</label>
                <select value=${editProject} onChange=${e => setEditProject(e.target.value)}>
                  <option value="">No project</option>
                  ${projects.map(p => html`<option value=${p.id}>${p.display_name || p.directory_name}</option>`)}
                </select>
              </div>
              <div class="form-group" style="flex:1;min-width:150px;margin:0">
                <label style="font-size:11px;color:var(--text-secondary)">Tags</label>
                <input value=${editTags} onInput=${e => setEditTags(e.target.value)}
                       placeholder="Tags (comma separated)" />
              </div>
            </div>
          </div>
          <div style="flex:1;display:flex;flex-direction:column;min-height:0">
            <textarea value=${editBody} onInput=${e => setEditBody(e.target.value)}
                      style="flex:1;padding:12px;font-size:14px;line-height:1.6;resize:none;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:var(--radius);font-family:inherit"
                      placeholder="Note content..."></textarea>
          </div>
        </div>
      `;
    }

    return html`
      <div style="display:flex;flex-direction:column;height:calc(100vh - 120px);min-height:400px">
        <div style="flex-shrink:0;margin-bottom:12px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">
            <button class="btn btn-sm" onclick=${() => setSelectedNote(null)}>Back</button>
            <button class="btn btn-sm" onclick=${startEdit}>Edit</button>
            ${n.status === 'open' && html`
              <button class="btn btn-sm" onclick=${() => archiveNote(n.id)}>Archive</button>
            `}
            ${n.status === 'archived' && html`
              <button class="btn btn-sm" onclick=${() => reopenNote(n.id)}>Reopen</button>
            `}
            <button class="btn btn-sm btn-danger" onclick=${() => deleteNote(n.id)}>Delete</button>
          </div>
          <h3 style="margin:0 0 6px 0;font-size:16px;color:var(--text)">${n.title || 'Untitled Note'}</h3>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            ${n.status !== 'open' && html`
              <span class="badge badge-${n.status === 'promoted' ? 'active' : 'draft'}" style="font-size:10px">${n.status}</span>
            `}
            ${projName && html`
              <span class="badge badge-open" style="font-size:11px">${projName}</span>
            `}
            ${!n.project_id && html`
              <span class="badge badge-draft" style="font-size:11px">unattached</span>
            `}
            ${tags.map(tag => html`
              <span style="font-size:11px;padding:2px 8px;background:rgba(63,185,80,0.15);color:var(--success);border-radius:10px">#${tag}</span>
            `)}
            <span style="font-size:11px;color:var(--text-secondary)">Created ${new Date(n.created_at).toLocaleString()}</span>
            ${n.updated_at !== n.created_at && html`
              <span style="font-size:11px;color:var(--text-secondary)">Updated ${new Date(n.updated_at).toLocaleString()}</span>
            `}
          </div>
        </div>
        <div class="item-card" style="flex:1;overflow-y:auto;padding:16px;min-height:0">
          <div style="white-space:pre-wrap;font-size:14px;line-height:1.7;color:var(--text)">${n.body}</div>
        </div>
      </div>
    `;
  }

  // ── List View ──
  if (loading && notes.length === 0) return html`<div class="loading">Loading...</div>`;

  return html`
    <div>
      <div class="action-bar" style="flex-wrap:wrap;gap:12px">
        <h2 style="color:var(--text)">Notes <span style="font-size:13px;font-weight:400;color:var(--text-secondary)">(${total})</span></h2>
        <button class="btn btn-primary" onclick=${() => { setShowForm(!showForm); if (!showForm) setTimeout(() => bodyRef.current?.focus(), 50); }}>
          ${showForm ? 'Cancel' : '+ New Note'}
        </button>
      </div>

      ${showForm && html`
        <div class="item-card" style="margin-bottom:16px;padding:16px">
          <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px">
            <div class="form-group" style="flex:1;min-width:200px;margin:0">
              <label style="font-size:11px;color:var(--text-secondary)">Title (optional)</label>
              <input value=${formTitle} onInput=${e => setFormTitle(e.target.value)}
                     placeholder="Note title..." style="padding:8px 10px" />
            </div>
            <div class="form-group" style="flex:0 0 180px;margin:0">
              <label style="font-size:11px;color:var(--text-secondary)">Project (optional)</label>
              <select value=${formProject} onChange=${e => setFormProject(e.target.value)} style="padding:8px 10px">
                <option value="">No project</option>
                ${projects.filter(p => p.active !== 0).map(p => html`<option value=${p.id}>${p.display_name || p.directory_name}</option>`)}
              </select>
            </div>
          </div>
          <div class="form-group" style="margin-bottom:12px">
            <textarea ref=${bodyRef} value=${formBody} onInput=${e => setFormBody(e.target.value)}
                      placeholder="Write your note..." rows="4"
                      onKeyDown=${e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) createNote(); }}
                      style="padding:10px;font-size:14px;resize:vertical"></textarea>
          </div>
          <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
            <div class="form-group" style="flex:1;min-width:150px;margin:0">
              <input value=${formTags} onInput=${e => setFormTags(e.target.value)}
                     placeholder="Tags (comma separated)" style="padding:8px 10px;font-size:12px" />
            </div>
            <button class="btn btn-primary" onclick=${createNote} disabled=${!formBody.trim()}>
              Save Note
            </button>
            <span style="font-size:11px;color:var(--text-secondary)">Ctrl+Enter to save</span>
          </div>
        </div>
      `}

      <div style="display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap;align-items:center">
        <div ref=${projectFilterRef} style="position:relative;flex-shrink:0">
          <button onclick=${() => setShowProjectFilter(!showProjectFilter)}
                  style="padding:6px 10px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);color:var(--text);cursor:pointer;font-size:13px;min-width:150px;text-align:left;display:flex;justify-content:space-between;align-items:center">
            <span>${getFilterLabel()}</span>
            <span style="margin-left:8px;font-size:10px">${showProjectFilter ? '\u25B2' : '\u25BC'}</span>
          </button>
          ${showProjectFilter && html`
            <div style="position:absolute;top:100%;left:0;z-index:100;margin-top:4px;min-width:220px;max-height:350px;overflow-y:auto;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);box-shadow:0 4px 12px rgba(0,0,0,0.3)">
              <div onclick=${() => { setFilter('all'); setShowProjectFilter(false); }}
                   style=${'padding:8px 12px;cursor:pointer;font-size:13px;color:var(--text);border-bottom:1px solid var(--border)' + (filter === 'all' ? ';background:rgba(88,166,255,0.15)' : '')}>
                All Projects
              </div>
              <div onclick=${() => { setFilter('unattached'); setShowProjectFilter(false); }}
                   style=${'padding:8px 12px;cursor:pointer;font-size:13px;color:var(--text);border-bottom:1px solid var(--border)' + (filter === 'unattached' ? ';background:rgba(88,166,255,0.15)' : '')}>
                Unattached
              </div>
              ${(() => {
                const activeProjs = projects.filter(p => p.active !== 0);
                const inactiveProjs = projects.filter(p => p.active === 0);
                return html`
                  ${activeProjs.length > 0 && html`
                    <div onclick=${() => setActiveGroupOpen(!activeGroupOpen)}
                         style="padding:6px 12px;cursor:pointer;font-size:11px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px;display:flex;align-items:center;gap:6px;border-bottom:1px solid var(--border);background:rgba(0,0,0,0.1)">
                      <span style="font-size:9px">${activeGroupOpen ? '\u25BC' : '\u25B6'}</span> Active (${activeProjs.length})
                    </div>
                    ${activeGroupOpen && activeProjs.map(p => html`
                      <div onclick=${() => { setFilter(String(p.id)); setShowProjectFilter(false); }}
                           style=${'padding:8px 12px 8px 24px;cursor:pointer;font-size:13px;color:var(--text)' + (String(filter) === String(p.id) ? ';background:rgba(88,166,255,0.15)' : '')}>
                        ${p.display_name || p.directory_name}
                      </div>
                    `)}
                  `}
                  ${inactiveProjs.length > 0 && html`
                    <div onclick=${() => setInactiveGroupOpen(!inactiveGroupOpen)}
                         style="padding:6px 12px;cursor:pointer;font-size:11px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px;display:flex;align-items:center;gap:6px;border-bottom:1px solid var(--border);background:rgba(0,0,0,0.1)">
                      <span style="font-size:9px">${inactiveGroupOpen ? '\u25BC' : '\u25B6'}</span> Inactive (${inactiveProjs.length})
                    </div>
                    ${inactiveGroupOpen && inactiveProjs.map(p => html`
                      <div onclick=${() => { setFilter(String(p.id)); setShowProjectFilter(false); }}
                           style=${'padding:8px 12px 8px 24px;cursor:pointer;font-size:13px;color:var(--text);opacity:0.7' + (String(filter) === String(p.id) ? ';background:rgba(88,166,255,0.15)' : '')}>
                        ${p.display_name || p.directory_name}
                      </div>
                    `)}
                  `}
                `;
              })()}
            </div>
          `}
        </div>

        <div style="display:flex;gap:4px">
          ${[{key: 'open', label: 'Open'}, {key: 'promoted', label: 'Promoted'}, {key: 'archived', label: 'Archived'}].map(s => html`
            <button class=${'btn btn-sm' + (statusFilter === s.key ? ' btn-primary' : '')}
                    onclick=${() => setStatusFilter(s.key)}
                    style="font-size:12px">${s.label}</button>
          `)}
        </div>
      </div>

      <div style="display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap;align-items:center">
        ${notes.length > 0 && html`
          <label style="font-size:12px;color:var(--text-secondary);cursor:pointer;display:flex;align-items:center;gap:4px;flex-shrink:0">
            <input type="checkbox" checked=${selected.size === notes.length && notes.length > 0} onchange=${selectAllNotes} />
            Select all
          </label>
        `}
        ${selected.size > 0 && statusFilter === 'open' && html`
          <button class="btn btn-sm btn-primary" onclick=${() => { setMoveTargetProject(''); setShowMoveModal(true); }}
                  style="font-size:12px;flex-shrink:0">Move to Project (${selected.size})</button>
        `}
        ${selected.size > 0 && (statusFilter === 'promoted' || statusFilter === 'archived') && html`
          <button class="btn btn-sm btn-primary" onclick=${moveToOpen}
                  style="font-size:12px;flex-shrink:0">Move to Open (${selected.size})</button>
        `}

        <div style="display:flex;gap:2px;align-items:center;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:2px;flex-shrink:0">
          ${[10, 20, 50].map(n => html`
            <button onclick=${() => setPerPage(n)}
                    style="padding:4px 8px;font-size:11px;border:none;border-radius:4px;cursor:pointer;background:${perPage === n ? 'var(--accent)' : 'transparent'};color:${perPage === n ? '#fff' : 'var(--text-secondary)'}">${n}</button>
          `)}
        </div>

        <select value=${sort} onChange=${e => setSort(e.target.value)}
                style="padding:6px 10px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);color:var(--text);font-size:12px;flex-shrink:0">
          <option value="newest">Newest First</option>
          <option value="oldest">Oldest First</option>
          <option value="updated">Recently Updated</option>
          <option value="title">Title A-Z</option>
        </select>

        <input type="text" value=${search} onInput=${e => setSearch(e.target.value)}
               placeholder="Search notes..."
               style="flex:1;min-width:120px;padding:6px 10px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);color:var(--text)" />
      </div>

      ${showMoveModal && html`
        <div class="modal-overlay" onclick=${() => setShowMoveModal(false)}>
          <div class="modal" style="max-width:400px" onclick=${e => e.stopPropagation()}>
            <h3 style="color:var(--text);margin-bottom:12px">Move ${selected.size} note${selected.size > 1 ? 's' : ''} to project</h3>
            <div style="max-height:300px;overflow-y:auto;display:flex;flex-direction:column;gap:4px">
              ${projects.filter(p => p.active !== 0).map(p => {
                const isSel = moveTargetProject === String(p.id);
                return html`
                  <div onclick=${() => setMoveTargetProject(String(p.id))}
                       style=${'padding:10px 12px;border-radius:6px;cursor:pointer;font-size:14px;color:#e6edf3;border:2px solid ' + (isSel ? '#58a6ff' : '#30363d') + ';background:' + (isSel ? 'rgba(88,166,255,0.15)' : '#161b22')}>
                    <span style="color:#e6edf3">${p.display_name || p.directory_name}</span>
                  </div>
                `;
              })}
            </div>
            <div class="modal-actions">
              <button class="btn" onclick=${() => setShowMoveModal(false)}>Cancel</button>
              <button class="btn btn-primary" onclick=${moveToProject} disabled=${!moveTargetProject}>Move</button>
            </div>
          </div>
        </div>
      `}

      <div class="item-list">
        ${notes.map(n => {
          const projName = getProjectName(n.project_id);
          const preview = n.title ? n.body.slice(0, 100) : (n.body.length > 80 ? n.body.slice(80, 180) : '');
          return html`
            <div class="item-card" style="padding:10px 16px;cursor:pointer" onclick=${() => openNote(n)}>
              <div style="display:flex;align-items:center;gap:8px;min-width:0">
                <input type="checkbox" checked=${selected.has(n.id)}
                       onclick=${e => e.stopPropagation()}
                       onchange=${() => toggleSelect(n.id)}
                       style="flex-shrink:0;cursor:pointer" />
                <div style="display:flex;gap:4px;flex-shrink:0" onclick=${e => e.stopPropagation()}>
                  <button class="btn btn-sm" onclick=${() => { openNote(n); startEditDirect(n); }} style="padding:2px 6px;font-size:11px">Edit</button>
                  <button class="btn btn-sm btn-danger" onclick=${() => deleteNote(n.id)} style="padding:2px 6px;font-size:11px">Del</button>
                </div>
                <div style="flex:1;min-width:0">
                  <div style="display:flex;align-items:center;gap:6px">
                    <span style="font-size:14px;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${n.title || n.body.slice(0, 80)}</span>
                    ${n.status === 'promoted' && html`<span class="badge badge-active" style="font-size:9px;flex-shrink:0">promoted</span>`}
                    ${n.status === 'archived' && html`<span class="badge badge-draft" style="font-size:9px;flex-shrink:0">archived</span>`}
                  </div>
                  ${preview && html`<div style="font-size:12px;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px">${preview}</div>`}
                </div>
                <div style="display:flex;gap:6px;align-items:center;flex-shrink:0">
                  ${projName && html`<span style="font-size:10px;padding:2px 6px;background:rgba(88,166,255,0.15);color:var(--accent);border-radius:8px;white-space:nowrap">${projName}</span>`}
                  <span style="font-size:10px;color:var(--text-secondary);white-space:nowrap">${new Date(n.created_at).toLocaleDateString()}</span>
                </div>
              </div>
            </div>
          `;
        })}
        ${notes.length === 0 && html`
          <div class="empty-state" style="padding:40px 20px;text-align:center">
            <p style="font-size:16px;margin-bottom:8px;color:var(--text)">No notes found</p>
            <p style="color:var(--text-secondary);font-size:13px">
              ${statusFilter === 'open' ? 'Create your first note using the button above.' : `No ${statusFilter} notes match your filters.`}
            </p>
          </div>
        `}
      </div>

      ${totalPages > 1 && html`
        <div class="pagination">
          <button onclick=${() => setPage(p => Math.max(1, p - 1))} disabled=${page <= 1}>Prev</button>
          ${Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
            let p;
            if (totalPages <= 7) {
              p = i + 1;
            } else if (page <= 4) {
              p = i + 1;
            } else if (page >= totalPages - 3) {
              p = totalPages - 6 + i;
            } else {
              p = page - 3 + i;
            }
            return html`<button class=${p === page ? 'active' : ''} onclick=${() => setPage(p)}>${p}</button>`;
          })}
          <button onclick=${() => setPage(p => Math.min(totalPages, p + 1))} disabled=${page >= totalPages}>Next</button>
          <span class="page-info">${total} notes</span>
        </div>
      `}
    </div>
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

// ===================== CONVERSATIONS (LLM CHAT) =====================

// Conversations
function Conversations() {
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeConv, setActiveConv] = useState(null);
  const [input, setInput] = useState('');
  const [sendingMap, setSendingMap] = useState({});
  const [showNew, setShowNew] = useState(false);
  const [newConvName, setNewConvName] = useState('');
  const [newProjectId, setNewProjectId] = useState('');
  const [projects, setProjects] = useState([]);
  const [newProvider, setNewProvider] = useState(localStorage.getItem('agj_chat_default_provider') || 'ollama');
  const [newModel, setNewModel] = useState('');
  const [availableModels, setAvailableModels] = useState([]);
  const [showChatSettings, setShowChatSettings] = useState(false);
  const [convCwd, setConvCwd] = useState('/home/agjrom/websites');
  const [cwdDirs, setCwdDirs] = useState([]);
  const [showDirPicker, setShowDirPicker] = useState(false);
  const chatEndRef = useRef(null);

  // Per-conversation provider/model stored in localStorage
  function getConvSettings(convId) {
    try { return JSON.parse(localStorage.getItem('agj_conv_' + convId) || '{}'); } catch { return {}; }
  }
  function setConvSettings(convId, settings) {
    const cur = getConvSettings(convId);
    localStorage.setItem('agj_conv_' + convId, JSON.stringify({ ...cur, ...settings }));
  }
  function getProvider(conv) {
    if (!conv) return newProvider;
    return getConvSettings(conv.id).provider || newProvider;
  }
  function getModel(conv) {
    if (!conv) return newModel;
    return getConvSettings(conv.id).model || '';
  }

  const loadConversations = useCallback(async () => {
    try {
      const data = await api('/api/conversations');
      setConversations(data.conversations);
      return data.conversations;
    } catch (e) { /* ignore */ }
    setLoading(false);
    return [];
  }, []);

  useEffect(() => {
    loadConversations().then(async (convs) => {
      if (convs && convs.length > 0) {
        try {
          const data = await api('/api/conversations/' + convs[0].id);
          setActiveConv(data.conversation);
        } catch (e) { /* ignore */ }
      }
      setLoading(false);
    });
  }, []);

  // Load models when active conversation's provider changes
  const activeProvider = getProvider(activeConv);
  useEffect(() => {
    const p = activeProvider;
    api('/api/chat/models/' + p).then(d => {
      setAvailableModels(d.models || []);
    }).catch(() => setAvailableModels([]));
  }, [activeProvider]);

  // Also load models for new conversation modal provider
  const [newModalModels, setNewModalModels] = useState([]);
  useEffect(() => {
    api('/api/chat/models/' + newProvider).then(d => {
      setNewModalModels(d.models || []);
      if (d.activeModel && !newModel) setNewModel(d.activeModel);
    }).catch(() => setNewModalModels([]));
  }, [newProvider]);

  // Auto-scroll chat to bottom
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollTop = chatEndRef.current.scrollHeight;
    }
  }, [activeConv?.messages?.length, activeConv?.id, sendingMap]);

  const isSending = activeConv ? !!sendingMap[activeConv.id] : false;

  async function loadConversation(id) {
    try {
      const data = await api(`/api/conversations/${id}`);
      setActiveConv(data.conversation);
    } catch (e) { /* ignore */ }
  }

  async function sendMessage() {
    if (!input.trim() || !activeConv || isSending) return;
    const convId = activeConv.id;
    const userMsg = input.trim();
    const convProvider = getProvider(activeConv);
    const convModel = getModel(activeConv);
    setInput('');
    setSendingMap(prev => ({ ...prev, [convId]: true }));

    // Optimistic: show user message immediately
    setActiveConv(prev => prev?.id === convId ? ({
      ...prev,
      messages: [...(prev.messages || []), { role: 'user', content: userMsg, timestamp: new Date().toISOString() }]
    }) : prev);

    if (convProvider === 'local') {
      await sendViaLocalRelay(convId, userMsg);
    } else {
      try {
        const sendBody = { conversation_id: convId, content: userMsg, provider: convProvider, model: convModel || undefined };
        if (['claude', 'codex'].includes(convProvider)) sendBody.cwd = convCwd;
        const data = await api('/api/chat/send', {
          method: 'POST',
          body: JSON.stringify(sendBody)
        });
        setActiveConv(prev => prev?.id === convId ? data.conversation : prev);
      } catch (e) {
        setActiveConv(prev => prev?.id === convId ? ({
          ...prev,
          messages: [...(prev.messages || []), { role: 'system', content: 'Error: ' + e.message, timestamp: new Date().toISOString() }]
        }) : prev);
      }
    }
    setSendingMap(prev => ({ ...prev, [convId]: false }));
  }

  async function sendViaLocalRelay(convId, content) {
    try {
      const data = await api('/api/local-llm/chat', {
        method: 'POST',
        body: JSON.stringify({ conversation_id: convId, content })
      });
      setActiveConv(prev => prev?.id === convId ? data.conversation : prev);
    } catch (e) {
      setActiveConv(prev => prev?.id === convId ? ({
        ...prev,
        messages: [...(prev.messages || []), { role: 'system', content: 'Error: ' + e.message, timestamp: new Date().toISOString() }]
      }) : prev);
    }
  }

  async function createConversation() {
    const providerLabel = { ollama: 'Ollama', openrouter: 'OpenRouter', claude: 'Claude', codex: 'Codex', local: 'Local LLM' }[newProvider] || newProvider;
    const modelLabel = newModel ? (' - ' + newModel.split('/').pop()) : '';
    const name = newConvName.trim() || (providerLabel + modelLabel);
    try {
      const data = await api('/api/conversations', {
        method: 'POST',
        body: JSON.stringify({
          agentName: name,
          projectId: newProjectId ? Number(newProjectId) : undefined
        })
      });
      // Save provider/model for this conversation
      setConvSettings(data.conversation.id, { provider: newProvider, model: newModel });
      setShowNew(false);
      setNewConvName('');
      setNewProjectId('');
      await loadConversations();
      setActiveConv(data.conversation);
    } catch (e) { /* ignore */ }
  }

  async function deleteConversation(id, e) {
    if (e) e.stopPropagation();
    if (!confirm('Delete this conversation?')) return;
    await api(`/api/conversations/${id}`, { method: 'DELETE' }).catch(() => {});
    if (activeConv?.id === id) setActiveConv(null);
    loadConversations();
  }

  async function loadDirs(dir) {
    try {
      const data = await api('/api/chat/directories?dir=' + encodeURIComponent(dir || '/home/agjrom/websites'));
      setCwdDirs(data.directories || []);
      setConvCwd(data.current);
    } catch { setCwdDirs([]); }
  }

  async function changeDir(newDir) {
    setConvCwd(newDir);
    await loadDirs(newDir);
    if (activeConv) {
      await api('/api/chat/cwd', { method: 'POST', body: JSON.stringify({ conversation_id: activeConv.id, cwd: newDir }) }).catch(() => {});
    }
  }

  // Check if active provider is a CLI provider (supports cwd)
  const isCliProvider = activeConv && ['claude', 'codex'].includes(getProvider(activeConv));

  if (loading) return html`<div class="loading">Loading conversations...</div>`;

  return html`
    <div class="action-bar">
      <h2>Conversations</h2>
      <div style="display:flex;gap:8px">
        <button class="btn btn-sm" onclick=${() => setShowChatSettings(!showChatSettings)}>
          ${showChatSettings ? 'Hide' : 'Chat'} Settings
        </button>
        <button class="btn btn-primary" onclick=${async () => {
          if (projects.length === 0) {
            const d = await api('/api/projects').catch(() => ({ projects: [] }));
            setProjects(d.projects || []);
          }
          setNewConvName('');
          setShowNew(true);
        }}>New Conversation</button>
      </div>
    </div>

    ${showChatSettings && html`
      <div class="settings-section" style="margin-bottom:16px">
        <h3 style="font-size:14px;margin-bottom:8px">Chat Settings (soul.md / context.md)</h3>
        <${ChatSettingsSection} />
      </div>
    `}

    ${showNew && html`
      <div class="modal-overlay" onclick=${() => setShowNew(false)}>
        <div class="modal" onclick=${e => e.stopPropagation()}>
          <h3>New Conversation</h3>
          <div class="form-group">
            <label>Provider</label>
            <select value=${newProvider} onChange=${e => {
              setNewProvider(e.target.value);
              localStorage.setItem('agj_chat_default_provider', e.target.value);
              setNewModel('');
            }}>
              <option value="ollama">Ollama (Server)</option>
              <option value="openrouter">OpenRouter</option>
              <option value="claude">Claude Code</option>
              <option value="codex">Codex</option>
              <option value="local">Local LLM (Relay)</option>
            </select>
          </div>
          ${newProvider !== 'local' ? html`
            <div class="form-group">
              <label>Model</label>
              <select value=${newModel} onChange=${e => setNewModel(e.target.value)}>
                ${newModalModels.length === 0 ? html`<option value="">Loading models...</option>` :
                  newModalModels.map(m => html`<option value=${m.id}>${m.name}</option>`)
                }
              </select>
            </div>
          ` : html`
            <div style="padding:10px 12px;background:var(--surface);border-radius:6px;font-size:12px;color:var(--text-secondary);margin-bottom:8px">
              Model is determined by the connected relay client. Run the relay script on your machine first (see Settings > Local LLM).
            </div>
          `}
          <div class="form-group">
            <label>Conversation Name (optional)</label>
            <input value=${newConvName} onInput=${e => setNewConvName(e.target.value)}
                   onKeyDown=${e => e.key === 'Enter' && createConversation()}
                   placeholder=${{ ollama: 'Ollama Chat', openrouter: 'OpenRouter Chat', claude: 'Claude Chat', codex: 'Codex Chat', local: 'Local LLM Chat' }[newProvider] || 'Chat'} />
          </div>
          <div class="form-group">
            <label>Project (optional)</label>
            <select value=${newProjectId} onChange=${e => setNewProjectId(e.target.value)}>
              <option value="">No project</option>
              ${projects.map(p => html`<option value=${p.id}>${p.display_name || p.directory_name}</option>`)}
            </select>
          </div>
          <div class="modal-actions">
            <button class="btn" onclick=${() => setShowNew(false)}>Cancel</button>
            <button class="btn btn-primary" onclick=${createConversation}>Create</button>
          </div>
        </div>
      </div>
    `}

    ${isTgMiniApp ? html`
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px">
        <select style="flex:1;font-size:12px;padding:6px 8px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px"
                value=${activeConv?.id || ''}
                onChange=${async (e) => {
                  const id = Number(e.target.value);
                  if (id) await loadConversation(id);
                }}>
          <option value="" disabled>Select conversation...</option>
          ${conversations.map(c => html`<option value=${c.id}>${c.agent_name} (${c.updated_at?.slice(5,16)})</option>`)}
        </select>
        ${activeConv && html`
          <button class="btn btn-sm btn-danger" style="padding:4px 8px;font-size:11px;white-space:nowrap"
                  onclick=${() => deleteConversation(activeConv.id)}>✕</button>
        `}
      </div>
    ` : ''}

    <div class="terminal-container" style="height: calc(100vh - ${isTgMiniApp ? '240' : '200'}px);">
      ${!isTgMiniApp ? html`
        <div class="session-tree">
          ${conversations.length === 0 ? html`<div class="empty-state" style="padding:16px;font-size:12px">No conversations yet</div>` :
            conversations.map(c => html`
              <div class="tree-item ${activeConv?.id === c.id ? 'active' : ''}"
                   onclick=${() => loadConversation(c.id)}>
                <div style="display:flex;justify-content:space-between;align-items:center">
                  <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${c.agent_name}</span>
                  <button class="btn btn-sm btn-danger" style="padding:2px 6px;font-size:10px"
                          onclick=${(e) => deleteConversation(c.id, e)}>x</button>
                </div>
                <div style="font-size:10px;color:var(--text-secondary)">${c.updated_at?.slice(0,16)}</div>
              </div>
            `)
          }
        </div>
      ` : ''}

      <div class="terminal-panel" style="display:flex;flex-direction:column;background:var(--surface)">
        ${!activeConv ? html`<div class="empty-state" style="flex:1;display:flex;align-items:center;justify-content:center">Select or create a conversation</div>` : html`
          <div style="padding:12px;border-bottom:1px solid var(--border);font-size:13px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
            <div>
              <strong>${activeConv.agent_name}</strong>
              ${activeConv.project_id ? html` <span class="badge badge-draft">Project #${activeConv.project_id}</span>` : ''}
              <span class="badge badge-active">${activeConv.messages?.length || 0} messages</span>
            </div>
            <div style="display:flex;gap:6px;align-items:center">
              <select value=${getProvider(activeConv)} onChange=${e => {
                setConvSettings(activeConv.id, { provider: e.target.value, model: '' });
                setActiveConv(prev => ({ ...prev, _refresh: Date.now() }));
              }}
                      style="font-size:12px;padding:2px 6px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px">
                <option value="ollama">Ollama (Server)</option>
                <option value="openrouter">OpenRouter</option>
                <option value="claude">Claude Code</option>
                <option value="codex">Codex</option>
                <option value="local">Local LLM</option>
              </select>
              <select value=${getModel(activeConv)} onChange=${e => {
                setConvSettings(activeConv.id, { model: e.target.value });
                setActiveConv(prev => ({ ...prev, _refresh: Date.now() }));
              }}
                      style="font-size:12px;padding:2px 6px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px;max-width:200px">
                ${availableModels.length === 0 ? html`<option value="">Loading...</option>` :
                  availableModels.map(m => html`<option value=${m.id}>${m.name}</option>`)
                }
              </select>
            </div>
          </div>
          ${isCliProvider ? html`
            <div style="padding:4px 12px;border-bottom:1px solid var(--border);font-size:11px;display:flex;align-items:center;gap:6px;background:var(--surface)">
              <span style="color:var(--text-secondary)">cwd:</span>
              <span style="font-family:monospace;color:var(--text)">${convCwd}</span>
              <button class="btn btn-sm" style="padding:1px 6px;font-size:10px;margin-left:auto"
                      onclick=${() => { loadDirs(convCwd); setShowDirPicker(!showDirPicker); }}>
                ${showDirPicker ? 'Close' : 'Change'}
              </button>
            </div>
            ${showDirPicker ? html`
              <div style="padding:6px 12px;border-bottom:1px solid var(--border);background:var(--bg);max-height:150px;overflow-y:auto">
                ${convCwd !== '/home/agjrom/websites' ? html`
                  <div style="padding:3px 0;cursor:pointer;font-size:11px;color:var(--accent)"
                       onclick=${() => changeDir(convCwd.split('/').slice(0, -1).join('/') || '/home/agjrom/websites')}>
                    .. (up)
                  </div>
                ` : ''}
                <div style="padding:3px 0;cursor:pointer;font-size:11px;color:var(--text-secondary)"
                     onclick=${() => { changeDir('/home/agjrom/websites'); setShowDirPicker(false); }}>
                  ~ (home: /home/agjrom/websites)
                </div>
                ${cwdDirs.map(d => html`
                  <div style="padding:3px 0;cursor:pointer;font-size:11px"
                       onclick=${() => changeDir(d.path)}>
                    📁 ${d.name}/
                  </div>
                `)}
                ${cwdDirs.length === 0 ? html`<div style="font-size:11px;color:var(--text-secondary)">No subdirectories</div>` : ''}
              </div>
            ` : ''}
          ` : ''}
          <div ref=${chatEndRef} style="flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px">
            ${(activeConv.messages || []).map(m => html`
              <div style="padding:8px 12px;border-radius:8px;max-width:80%;
                          ${m.role === 'user' ? 'align-self:flex-end;background:rgba(88,166,255,0.15);' :
                            m.role === 'system' ? 'align-self:center;background:rgba(139,148,158,0.15);font-size:12px;' :
                            'align-self:flex-start;background:var(--bg);border:1px solid var(--border);'}">
                <div style="font-size:11px;color:var(--text-secondary);margin-bottom:4px">${m.role}</div>
                <div style="white-space:pre-wrap;word-break:break-word">${m.content}</div>
              </div>
            `)}
            ${isSending && html`
              <div style="align-self:flex-start;padding:8px 16px;border-radius:8px;background:var(--bg);border:1px solid var(--border)">
                <span class="typing-dots">
                  <span class="typing-dot"></span>
                  <span class="typing-dot"></span>
                  <span class="typing-dot"></span>
                </span>
              </div>
            `}
          </div>
          <div style="padding:12px;border-top:1px solid var(--border);display:flex;gap:8px">
            <input style="flex:1" value=${input}
                   onInput=${e => setInput(e.target.value)}
                   onKeyDown=${e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
                   placeholder="Type a message..." />
            <button class="btn btn-primary" onclick=${sendMessage} disabled=${isSending}>
              ${isSending ? '...' : 'Send'}
            </button>
          </div>
        `}
      </div>
    </div>
  `;
}

// Settings
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

function ChatSettingsSection() {
  const [soulMd, setSoulMd] = useState('');
  const [contextMd, setContextMd] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      api('/api/chat-settings/soul_md').then(d => setSoulMd(d.value || '')).catch(() => {}),
      api('/api/chat-settings/context_md').then(d => setContextMd(d.value || '')).catch(() => {})
    ]).then(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true);
    try {
      if (soulMd.trim()) {
        await api('/api/chat-settings/soul_md', { method: 'PUT', body: JSON.stringify({ value: soulMd }) });
      } else {
        await api('/api/chat-settings/soul_md', { method: 'DELETE' }).catch(() => {});
      }
      if (contextMd.trim()) {
        await api('/api/chat-settings/context_md', { method: 'PUT', body: JSON.stringify({ value: contextMd }) });
      } else {
        await api('/api/chat-settings/context_md', { method: 'DELETE' }).catch(() => {});
      }
    } catch (e) { alert('Save failed: ' + e.message); }
    setSaving(false);
  }

  if (loading) return html`<div class="loading">Loading...</div>`;

  return html`
    <div>
      <div class="form-group" style="margin-bottom:12px">
        <label>soul.md (System Prompt — sent as first message to every LLM call)</label>
        <textarea rows="5" value=${soulMd} onInput=${e => setSoulMd(e.target.value)}
                  placeholder="You are a helpful assistant..." style="font-family:monospace;font-size:12px"></textarea>
      </div>
      <div class="form-group" style="margin-bottom:12px">
        <label>context.md (Additional context — sent as second system message)</label>
        <textarea rows="5" value=${contextMd} onInput=${e => setContextMd(e.target.value)}
                  placeholder="Project context, rules, etc..." style="font-family:monospace;font-size:12px"></textarea>
      </div>
      <button class="btn btn-primary" onclick=${save} disabled=${saving}>${saving ? 'Saving...' : 'Save Chat Settings'}</button>
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

// --- Local LLM Relay Status ---
function LocalLlmSettings() {
  const [status, setStatus] = useState(null);
  const [checking, setChecking] = useState(false);
  const [showToken, setShowToken] = useState(false);

  async function checkStatus() {
    setChecking(true);
    try {
      const d = await api('/api/local-llm/status');
      setStatus(d);
    } catch (e) {
      setStatus({ connected: false, clients: [], error: e.message });
    }
    setChecking(false);
  }

  useEffect(() => { checkStatus(); }, []);

  const wsUrl = (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/ws/local-llm?token=' + (showToken ? authToken : '***');
  const cmdExample = 'node local-relay.mjs "' + (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/ws/local-llm?token=' + (showToken ? authToken : '<YOUR_TOKEN>') + '" http://127.0.0.1:1234 openai your-model-name';

  return html`
    <div>
      <p style="font-size:12px;color:var(--text-secondary);margin-bottom:12px">
        Run a relay script on your machine to connect your local LLM (Ollama, LM Studio) to AGJAssist.
        The relay connects outbound to this server — no port forwarding needed.
      </p>

      <div style="margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <span style="font-size:13px;font-weight:600">Connected Relays</span>
          <button class="btn btn-sm" onclick=${checkStatus} disabled=${checking}
                  style="font-size:11px;padding:2px 10px">${checking ? 'Checking...' : 'Refresh'}</button>
        </div>
        ${status?.clients?.length > 0 ? status.clients.map(c => html`
          <div class="item-card" style="padding:10px 14px;margin-bottom:6px;display:flex;align-items:center;gap:12px">
            <span style="width:10px;height:10px;border-radius:50%;flex-shrink:0;background:var(--success)"></span>
            <div style="flex:1">
              <div style="font-weight:500">${c.name}</div>
              <div style="font-size:11px;color:var(--text-secondary)">
                Model: ${c.model} · Format: ${c.format} · Since: ${c.connectedAt?.slice(11,19) || 'N/A'}
              </div>
            </div>
          </div>
        `) : html`
          <div class="item-card" style="padding:12px 14px;display:flex;align-items:center;gap:12px">
            <span style="width:10px;height:10px;border-radius:50%;flex-shrink:0;background:var(--danger)"></span>
            <span style="font-size:13px;color:var(--text-secondary)">No relay connected</span>
          </div>
        `}
      </div>

      <div style="margin-bottom:12px">
        <div style="font-size:13px;font-weight:600;margin-bottom:6px">Setup Instructions</div>
        <ol style="font-size:12px;color:var(--text-secondary);margin:0;padding-left:20px;line-height:1.8">
          <li>Copy <code>tools/local-relay.mjs</code> to your machine</li>
          <li>Run the command below (requires Node.js 18+)</li>
          <li>Create a chat with provider "Local LLM"</li>
        </ol>
      </div>

      <div style="margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
          <span style="font-size:12px;font-weight:600">Relay Command</span>
          <div style="display:flex;gap:6px">
            <button class="btn btn-sm" onclick=${() => setShowToken(!showToken)}
                    style="font-size:10px;padding:2px 6px">${showToken ? 'Hide Token' : 'Show Token'}</button>
            <button class="btn btn-sm" onclick=${() => {
              const cmd = 'node local-relay.mjs "' + (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/ws/local-llm?token=' + authToken + '" http://127.0.0.1:1234 openai your-model-name';
              navigator.clipboard?.writeText(cmd);
            }} style="font-size:10px;padding:2px 6px">Copy</button>
          </div>
        </div>
        <div style="background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:10px;font-family:monospace;font-size:11px;word-break:break-all;line-height:1.5;color:var(--text-secondary)">
          ${cmdExample}
        </div>
        <div style="font-size:11px;color:var(--text-secondary);margin-top:6px">
          Replace <code>http://127.0.0.1:1234</code> with your LLM URL, <code>openai</code> with <code>ollama</code> if using Ollama, and <code>your-model-name</code> with your model.
        </div>
      </div>
    </div>
  `;
}

function LlmHealthCheck() {
  const [health, setHealth] = useState(null);
  const [checking, setChecking] = useState(false);

  async function checkHealth() {
    setChecking(true);
    try {
      const d = await api('/api/chat/health');
      setHealth(d.providers);
    } catch (e) { setHealth({ error: 'Failed to check health' }); }
    setChecking(false);
  }

  useEffect(() => { checkHealth(); }, []);

  const providers = health ? Object.entries(health).filter(([k]) => k !== 'error') : [];

  return html`
    <div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <span style="font-size:13px;color:var(--text-secondary)">Provider health status</span>
        <button class="btn btn-sm" onclick=${checkHealth} disabled=${checking}
                style="font-size:11px;padding:2px 10px">${checking ? 'Checking...' : 'Refresh'}</button>
      </div>
      ${!health && !checking ? html`<div class="empty-state" style="padding:12px;font-size:12px">Click Refresh to check provider status</div>` : ''}
      ${checking && !health ? html`<div style="padding:12px;font-size:12px;color:var(--text-secondary)">Checking providers...</div>` : ''}
      ${providers.map(([name, info]) => html`
        <div class="item-card" style="padding:10px 14px;margin-bottom:8px;display:flex;align-items:center;gap:12px">
          <span style="width:10px;height:10px;border-radius:50%;flex-shrink:0;background:${info.status === 'up' ? 'var(--success)' : 'var(--danger)'}"></span>
          <div style="flex:1">
            <div style="display:flex;align-items:center;gap:8px">
              <span style="font-weight:600;text-transform:capitalize">${name}</span>
              <span class="badge badge-${info.status === 'up' ? 'active' : 'danger'}" style="font-size:10px">${info.status === 'up' ? 'Online' : 'Offline'}</span>
              ${info.latency != null ? html`<span style="font-size:10px;color:var(--text-secondary)">${info.latency}ms</span>` : ''}
            </div>
            <div style="font-size:11px;color:var(--text-secondary);margin-top:2px">
              Model: ${info.model || 'N/A'}
              ${info.error ? html` · <span style="color:var(--danger)">${info.error}</span>` : ''}
            </div>
          </div>
        </div>
      `)}
    </div>
  `;
}

function Settings({ onEditBottomNav } = {}) {
  const [patterns, setPatterns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [userInfo, setUserInfo] = useState(null);

  useEffect(() => {
    Promise.all([
      api('/api/safety/patterns').then(d => setPatterns(d.patterns)).catch(() => {}),
      api('/api/auth/me').then(d => setUserInfo(d)).catch(() => {})
    ]).then(() => setLoading(false));
  }, []);

  return html`
    <div>
      <h2 style="margin-bottom:16px">Settings</h2>

      ${onEditBottomNav && html`
        <${SettingsSection} title="Bottom Navigation" defaultOpen=${true}>
          <button class="btn btn-sm" onclick=${onEditBottomNav}>Edit bottom nav</button>
        </${SettingsSection}>
      `}

      <${SettingsSection} title="Account" defaultOpen=${true}>
        <div style="margin-bottom:16px">
          ${userInfo ? html`
            <div class="item-card" style="padding:12px 16px;margin-bottom:12px">
              <div style="display:flex;justify-content:space-between;align-items:center">
                <div>
                  <div style="font-weight:500;margin-bottom:4px">${userInfo.display_name || userInfo.username || 'User'}</div>
                  <div style="font-size:12px;color:var(--text-secondary)">
                    Role: <span class="badge badge-${userInfo.role === 'owner' ? 'active' : 'draft'}">${userInfo.role}</span>
                    ${userInfo.totp_enabled ? html` <span class="badge badge-active" style="font-size:10px">2FA ON</span>` : ''}
                  </div>
                </div>
              </div>
            </div>
          ` : ''}
          <h4 style="font-size:13px;margin-bottom:8px">Two-Factor Authentication</h4>
          <${TwoFactorSetup} />
        </div>
      </${SettingsSection}>

      <${SettingsSection} title="LLM Providers" defaultOpen=${true}>
        <${LlmHealthCheck} />
      </${SettingsSection}>

      <${SettingsSection} title="Local LLM (Browser Relay)" defaultOpen=${false}>
        <${LocalLlmSettings} />
      </${SettingsSection}>

      <${SettingsSection} title="Chat Configuration" defaultOpen=${false}>
        <${ChatSettingsSection} />
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

// ========== Telegram Mini App Components ==========

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

function TgDashboard({ onEditBottomNav }) {
  const [stats, setStats] = useState({ projects: 0, tasks: 0, reminders: 0, conversations: 0, notes: 0, workflows: 0, activeWorkflows: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api('/api/projects').catch(() => ({ projects: [] })),
      api('/api/personal-tasks').catch(() => ({ tasks: [] })),
      api('/api/reminders').catch(() => ({ reminders: [] })),
      api('/api/conversations').catch(() => ({ conversations: [] })),
      api('/api/notes?status=open').catch(() => ({ notes: [] })),
      api('/api/overmind/workflows').catch(() => ({ workflows: [] }))
    ]).then(([p, t, r, c, n, w]) => {
      const workflowSummary = summarizeWorkflows(w.workflows);
      setStats({
        projects: p.projects?.length || 0,
        tasks: t.tasks?.length || 0,
        reminders: r.reminders?.length || 0,
        conversations: c.conversations?.length || 0,
        notes: n.notes?.length || 0,
        workflows: workflowSummary.total,
        activeWorkflows: workflowSummary.active
      });
      setLoading(false);
    });
  }, []);

  if (loading) return html`<div class="loading">Loading...</div>`;

  const cards = [
    { icon: '\u{1F4CB}', label: 'Tasks', count: stats.tasks, route: '/tasks', desc: 'Daily & weekly' },
    { icon: '\u{1F4DD}', label: 'Notes', count: stats.notes, route: '/notes', desc: 'Quick notes' },
    { icon: '\u{1F4AC}', label: 'Chat', count: stats.conversations, route: '/conversations', desc: 'LLM conversations' },
    { icon: '\u{1F5A5}', label: 'Terminals', count: null, route: '/terminals', desc: 'Tmux sessions' },
    { icon: '\u{25B6}', label: 'Workflows', count: stats.workflows, route: '/overmind', desc: `${stats.workflows} workflows · ${stats.activeWorkflows} active` },
    { icon: '\u{1F4C1}', label: 'Projects', count: stats.projects, route: '/projects', desc: 'Dev projects' },
    { icon: '\u{23F0}', label: 'Reminders', count: stats.reminders, route: '/tasks', desc: 'Upcoming events' },
    { icon: '\u{2699}', label: 'Settings', count: null, route: '/settings', desc: 'Config & templates' }
  ];

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
      </div>
    </div>
  `;
}

function TgApp() {
  const route = useRoute();
  const user = JSON.parse(localStorage.getItem('agj_user') || 'null');
  const [bottomNavTabIds, setBottomNavTabIds] = useState(() => readBottomNavTabIds());
  const [editingBottomNav, setEditingBottomNav] = useState(false);

  if (!authToken || !user) return html`<${Login} />`;

  function applyBottomNavTabIds(nextIds) {
    setBottomNavTabIds(writeBottomNavTabIds(nextIds));
  }

  const tabs = getBottomNavTabs(bottomNavTabIds);

  let content;
  if (route === '/' || route === '') {
    content = html`<${TgDashboard} onEditBottomNav=${() => setEditingBottomNav(true)} />`;
  } else if (route === '/projects') {
    content = html`<${Projects} />`;
  } else if (route === '/terminals') {
    content = html`<${Terminals} />`;
  } else if (route === '/overmind') {
    content = html`<${OvermindWorkflows} />`;
  } else if (route === '/tasks') {
    content = html`<${TasksSection} />`;
  } else if (route === '/notes') {
    content = html`<${NotesPage} />`;
  } else if (route === '/conversations') {
    content = html`<${Conversations} />`;
  } else if (route === '/settings') {
    content = html`<${Settings} onEditBottomNav=${() => setEditingBottomNav(true)} />`;
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

// ========== Web App ==========

function App() {
  const route = useRoute();
  const user = JSON.parse(localStorage.getItem('agj_user') || 'null');

  if (!authToken || !user) return html`<${Login} />`;

  let content;
  if (route === '/' || route === '') {
    content = html`<${Dashboard} />`;
  } else if (route === '/projects') {
    content = html`<${Projects} />`;
  } else if (route === '/terminals') {
    content = html`<${Terminals} />`;
  } else if (route === '/overmind') {
    content = html`<${OvermindWorkflows} />`;
  } else if (route === '/tasks') {
    content = html`<${TasksSection} />`;
  } else if (route === '/notes') {
    content = html`<${NotesPage} />`;
  } else if (route === '/conversations') {
    content = html`<${Conversations} />`;
  } else if (route === '/settings') {
    content = html`<${Settings} />`;
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
