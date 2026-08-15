export function normalizeTerminalOutput(text) {
  return (text || "").replace(/\r\n/g, "\n").trim();
}

const _spinnerGlyphs = "◦•✻✶✢●○⎿⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⣾⣽⣻⢿⡿⣟⣯⣷";
const _leadingSpinnerRe = new RegExp(`^\\s*[${_spinnerGlyphs}]`, "u");
// C1 footer/shortcut — listed tokens only (no /ps /stop /model /effort /shells /monitors).
const _statusChromeRe = /bypass permissions|accept edits|plan mode|shift\+tab|to cycle|ctrl\+t|for agents|↓ to manage|Ctrl\+\.|ctrl\+c:cancel|⏵⏵|▶▶/i;
// C3 model+cwd: model-name · ~/ at line start — not any mid-dot+tilde.
const _modelFooterRe = /^\s*[\w.+-]+\s*[·•]\s*~\//;
const _tipChromeRe = /^\s*Tip:/;
// C4 KEEP (inverted): former delete class is now preserved as status telemetry.
const _turnChromeRe = /(\d+[hms]|\d+m \d+s)|tokens|effort|Drizzl\w*|Working|Thinking|Compacting|Waiting for|Worked for/i;
const _tmuxConfRe = /~\/\.tmux\.conf/;
const _composerGlyphRe = /^[❯›▌]/u;
const _composerPlaceholderRe = /^\s*Type a message\b/i;
const _interruptChromeRe = /^\s*esc to interrupt\s*$/i;

function _isChromeLine(line) {
  const trimmed = line.trim();
  if (trimmed === "") return false;
  // Order: C1, then C3, then C4 keep, then C2.
  if (_statusChromeRe.test(line)) return true;
  if (_modelFooterRe.test(trimmed) || _tipChromeRe.test(trimmed)) return true;
  if (_turnChromeRe.test(line)) return false;
  return _composerGlyphRe.test(trimmed)
    || _composerPlaceholderRe.test(trimmed)
    || _isBoxDrawingLine(line)
    || /^[─=]{3,}$/.test(trimmed)
    || _interruptChromeRe.test(trimmed)
    || _leadingSpinnerRe.test(line)
    || _tmuxConfRe.test(line);
}

function _isC1C3ChromeLine(line) {
  const trimmed = (line || "").trim();
  if (!trimmed) return false;
  return _statusChromeRe.test(trimmed) || _modelFooterRe.test(trimmed) || _tipChromeRe.test(trimmed);
}

export function extractC1C3ChromeLines(text) {
  const clean = normalizeTerminalOutput(text);
  if (!clean) return "";
  return clean
    .split("\n")
    .filter((line) => _isC1C3ChromeLine(line))
    .join("\n")
    .trim();
}

/**
 * Strip ANSI escape sequences and filter Claude-Code TUI chrome lines.
 * Returns the cleaned text with blank lines collapsed.
 */
export function cleanTerminalOutput(text) {
  if (!text) return "";
  const lines = text
    .replace(/\r\n/g, "\n")
    // Strip CSI sequences (ESC [ ... final byte)
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    // Strip OSC sequences (ESC ] ... ST/BEL)
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    // Strip remaining lone ESC + one char
    .replace(/\x1b./g, "")
    // Strip other control chars except newline/tab
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "")
    .split("\n");

  const kept = [];
  let inRoundBox = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (inRoundBox) {
      if (/╰/.test(trimmed)) inRoundBox = false;
      continue;
    }
    if (/╭/.test(trimmed)) {
      inRoundBox = true;
      continue;
    }
    if (!_isChromeLine(line)) kept.push(line);
  }
  return kept.join("\n").trim();
}

function _isBlankLine(line) {
  return line.trim() === "";
}

function _isBoxDrawingLine(line) {
  return /[┌┐└┘├┤┬┴┼─│╭╮╰╯═║╔╗╚╝╠╣╦╩╬]/u.test(line);
}

function _isStructuredLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return true;
  return _isBoxDrawingLine(line)
    || /^\s{2,}\S/.test(line)
    || /^(?:[-*+]|\d+[.)])\s+/.test(trimmed)
    || /^[>|$#]\s?/.test(trimmed)
    || /^(?:at\s+\S+|\w*Error:|Traceback\b|File\s+".+")/.test(trimmed)
    || /^[\[{(].*[\]})]$/.test(trimmed)
    || /^[A-Za-z0-9_.-]+\s*[:=]\s*\S/.test(trimmed)
    || /\s{2,}\S/.test(trimmed)
    || /\t/.test(line)
    || /\|/.test(trimmed);
}

function _looksLikeWrappedContinuation(previousLine, nextLine) {
  const previous = previousLine.trim();
  const next = nextLine.trim();
  if (!previous || !next) return false;
  if (_isStructuredLine(previousLine) || _isStructuredLine(nextLine)) return false;
  if (previous.length < 35) return false;
  if (/[.!?;:)\]}]$/.test(previous)) return false;
  if (/^[A-Z][A-Z0-9_ -]{2,}:?$/.test(previous)) return false;
  if (/^[A-Z]/.test(next) && !/^(?:and|or|but|the|a|an|to|from|for|with|without|in|on|as|of)\b/i.test(next)) {
    return false;
  }
  return /^[a-z0-9('"`]/i.test(next);
}

function _reflowHardWrappedLines(lines) {
  const output = [];

  for (const line of lines) {
    if (output.length > 0 && _looksLikeWrappedContinuation(output[output.length - 1], line)) {
      output[output.length - 1] = `${output[output.length - 1].trimEnd()} ${line.trimStart()}`;
    } else {
      output.push(line);
    }
  }

  return output;
}

/**
 * Format a raw tmux pane capture for proportional app display.
 * Keeps structured output intact while making prose-like wrapped terminal text readable.
 */
export function formatTerminalOutput(raw) {
  const cleaned = cleanTerminalOutput(raw);
  if (!cleaned) return "";

  const normalizedLines = cleaned
    .split("\n")
    .map(line => line.replace(/[ \t]+$/g, ""));

  const collapsedBlankLines = [];
  for (const line of normalizedLines) {
    if (_isBlankLine(line) && _isBlankLine(collapsedBlankLines[collapsedBlankLines.length - 1] || "")) {
      continue;
    }
    collapsedBlankLines.push(line);
  }

  return _reflowHardWrappedLines(collapsedBlankLines)
    .join("\n")
    .trim();
}

export function diffTerminalOutput(beforeText, afterText) {
  const before = normalizeTerminalOutput(beforeText);
  const after = normalizeTerminalOutput(afterText);
  if (!after) return "";
  if (!before) return after;
  if (after === before) return "";
  if (after.startsWith(before)) {
    return after.slice(before.length).trim();
  }

  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  let idx = 0;
  while (idx < beforeLines.length && idx < afterLines.length && beforeLines[idx] === afterLines[idx]) {
    idx += 1;
  }
  return afterLines.slice(idx).join("\n").trim();
}

export function tailTerminalOutput(text, maxLines = 50) {
  const output = normalizeTerminalOutput(text);
  if (!output) return "";
  const safeMaxLines = Math.max(1, maxLines);
  const lines = output.split("\n");
  return lines.slice(-safeMaxLines).join("\n");
}

export function capTerminalOutput(text, maxLines = 200) {
  return tailTerminalOutput(text, maxLines);
}

export function formatFriendlyTerminalOutput(text, maxLines = 25) {
  return tailTerminalOutput(text, maxLines);
}

function makeEntry(id, role, label, content, timestamp) {
  return { id, role, label, content, timestamp };
}

const _c4VerbRe = /^(?:Working|Drizzl\w*|Thinking|Compacting|Waiting for|Worked for)\b/i;
const _c4DurationRe = /(?:\d+[hms]|\d+m \d+s)/i;

function _isC4StatusLine(line) {
  const trimmed = (line || "").trim();
  if (!trimmed) return false;
  if (_statusChromeRe.test(line)) return false;
  if (_modelFooterRe.test(trimmed) || _tipChromeRe.test(trimmed)) return false;
  if (_c4VerbRe.test(trimmed)) return true;
  return _c4DurationRe.test(trimmed) && /(?:tokens|effort)/i.test(trimmed);
}

function _lastIndexByRole(entries, role) {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (entries[i] && entries[i].role === role) return i;
  }
  return -1;
}

function _linesEqual(left, right) {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

function _findBlock(hayLines, needleLines) {
  if (!needleLines.length || hayLines.length < needleLines.length) return -1;
  const lastStart = hayLines.length - needleLines.length;
  for (let i = 0; i <= lastStart; i += 1) {
    if (_linesEqual(hayLines.slice(i, i + needleLines.length), needleLines)) return i;
  }
  return -1;
}

function _removeExactText(haystack, needle) {
  if (!haystack || !needle) return haystack || "";
  const hayLines = haystack.split("\n");
  const needleLines = needle.split("\n");
  const blockAt = _findBlock(hayLines, needleLines);
  if (blockAt >= 0) {
    return hayLines.slice(0, blockAt).concat(hayLines.slice(blockAt + needleLines.length)).join("\n");
  }
  for (let n = needleLines.length - 1; n > 0; n -= 1) {
    const suffix = needleLines.slice(-n);
    if (_linesEqual(hayLines.slice(0, n), suffix)) {
      return hayLines.slice(n).join("\n");
    }
  }
  if (needleLines.length === 1) {
    const target = needleLines[0].trim();
    return hayLines.filter((line) => line.trim() !== target).join("\n");
  }
  return haystack;
}

function _stripStatusLines(text) {
  if (!text) return "";
  return text.split("\n").filter((line) => !_isC4StatusLine(line)).join("\n").trim();
}

function _mergeAgedTail(previousContent, nextContent) {
  const prev = previousContent || "";
  const next = nextContent || "";
  if (!next) return prev;
  if (!prev) return next;
  if (next === prev) return prev;
  if (next.startsWith(prev)) return next;
  if (prev.endsWith(next) || prev.includes(next)) return prev;

  const prevLines = prev.split("\n");
  const nextLines = next.split("\n");
  const max = Math.min(prevLines.length, nextLines.length);
  for (let n = max; n > 0; n -= 1) {
    if (_linesEqual(prevLines.slice(-n), nextLines.slice(0, n))) {
      return prevLines.concat(nextLines.slice(n)).join("\n");
    }
  }
  return next;
}

function _agentBodyFromSnapshot(snapshot, entries, excludeLastAgent) {
  let body = _stripStatusLines(cleanTerminalOutput(snapshot));
  const removals = [];
  for (const entry of entries) {
    if (entry && entry.role === "user" && entry.content) removals.push(entry.content);
  }
  const agents = entries.filter((entry) => entry && entry.role === "agent");
  const priorAgents = excludeLastAgent ? agents.slice(0, -1) : agents;
  for (const entry of priorAgents) {
    if (entry.content) removals.push(entry.content);
  }
  for (const needle of removals) {
    body = _removeExactText(body, needle);
  }
  return body.trim();
}

/**
 * C4 telemetry from the latest snapshot. One status string, never a turn.
 */
export function extractStatus(text) {
  const cleaned = cleanTerminalOutput(text);
  if (!cleaned) return "";
  let last = "";
  for (const line of cleaned.split("\n")) {
    if (_isC4StatusLine(line)) last = line.trim();
  }
  return last;
}

/**
 * Append a YOU turn from composer text. Does not rebuild prior entries.
 */
export function appendYou(entries, text, { now = Date.now() } = {}) {
  const content = (text || "").trim();
  const list = Array.isArray(entries) ? entries : [];
  if (!content) return list;
  return list.concat([
    makeEntry("you-" + now, "user", "You", content, new Date(now).toLocaleTimeString())
  ]);
}

/**
 * Patch the last AGENT in place, or open a new AGENT only after a YOU send.
 * Aged capture tails do not rebuild prior turns or restamp identities.
 */
export function applyAgentPatch(entries, snapshot, { now = Date.now() } = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const lastAgentIdx = _lastIndexByRole(list, "agent");
  const lastUserIdx = _lastIndexByRole(list, "user");
  const openNew = lastAgentIdx < 0 || lastUserIdx > lastAgentIdx;
  const body = _agentBodyFromSnapshot(snapshot, list, !openNew);

  if (openNew) {
    if (!body) return list;
    return list.concat([
      makeEntry("agent-" + now, "agent", "Agent", body, new Date(now).toLocaleTimeString())
    ]);
  }

  const last = list[lastAgentIdx];
  const merged = _mergeAgedTail(last.content, body);
  if (merged === last.content) return list;
  const next = list.slice();
  next[lastAgentIdx] = { ...last, content: merged };
  return next;
}

export function buildInitialFriendlyState({
  target,
  sessionName,
  liveOutput,
  savedState,
  now = Date.now(),
  maxSavedAgeMs = 5 * 60 * 1000
}) {
  const output = normalizeTerminalOutput(liveOutput);
  const savedEntries = Array.isArray(savedState?.entries) ? savedState.entries : [];
  const savedSnapshot = normalizeTerminalOutput(savedState?.snapshot || "");
  const savedAt = typeof savedState?.updatedAt === "number" ? savedState.updatedAt : 0;
  const savedIsFresh = savedAt > 0 && now - savedAt <= maxSavedAgeMs;
  const timestamp = new Date(now).toLocaleTimeString();

  if (output) {
    const canResumeSaved = savedEntries.length > 0 && savedIsFresh && savedSnapshot && output.startsWith(savedSnapshot);
    if (canResumeSaved) {
      const appended = diffTerminalOutput(savedSnapshot, output);
      return {
        snapshot: output,
        entries: appended
          ? [
              ...savedEntries,
              makeEntry("resume-" + now, "terminal", "Latest output", appended, timestamp)
            ]
          : savedEntries
      };
    }

    return {
      snapshot: output,
      entries: [
        makeEntry("initial-output", "terminal", `Recent output · ${sessionName || target}`, output, timestamp)
      ]
    };
  }

  if (savedEntries.length > 0 && savedIsFresh) {
    return {
      snapshot: savedSnapshot,
      entries: savedEntries
    };
  }

  return {
    snapshot: "",
    entries: [
      makeEntry(
        "initial-system",
        "system",
        "Terminal ready",
        `Connected to ${target}. Type a command below to run it in tmux.`,
        timestamp
      )
    ]
  };
}
