export function normalizeTerminalOutput(text) {
  return (text || "").replace(/\r\n/g, "\n").trim();
}

/** Flatten C0 controls and DEL the same way TmuxService.sendCommand rejects them. */
export function sanitizeOutgoingCommand(text) {
  return String(text ?? "").replace(/[\u0000-\u001F\u007F]/g, " ");
}

// Content markers (Codex/Claude paragraph leaders + markdown bullets) are NOT chrome.
const _contentMarkerGlyphs = "◦•●○";
const _trueSpinnerGlyphs = "✻✶✢⎿⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⣾⣽⣻⢿⡿⣟⣯⣷";
const _leadingTrueSpinnerRe = new RegExp(`^\\s*[${_trueSpinnerGlyphs}]\\s*(.*)$`, "u");
const _leadingContentMarkerRe = new RegExp(`^\\s*[${_contentMarkerGlyphs}]\\s*(.*)$`, "u");
const _spinnerStatusRemainderRe = /^(?:Working|Thinking|Compacting|Waiting for|Worked for|Drizzl\w*|esc to interrupt)/i;
const _boxCharRe = /[┌┐└┘├┤┬┴┼─│╭╮╰╯═║╔╗╚╝╠╣╦╩╬━┃]/u;
const _boxOnlyRe = /^[\s┌┐└┘├┤┬┴┼─│╭╮╰╯═║╔╗╚╝╠╣╦╩╬━┃]+$/u;
const _boxFramedRe = /^[┌┐└┘├┤┬┴┼─│╭╮╰╯═║╔╗╚╝╠╣╦╩╬━┃].*[┌┐└┘├┤┬┴┼─│╭╮╰╯═║╔╗╚╝╠╣╦╩╬━┃]$/u;
// C1 footer/shortcut — anchored to a complete footer/composer row, not a prose substring.
const _statusChromeRe = /^(?:(?:⏵⏵|▶▶|⏸)\s*)?(?:bypass permissions|accept edits|plan mode)\b|^(?:shift\+tab\s+to cycle|ctrl\+t(?:\s+for agents)?|↓\s+to manage|Ctrl\+\.|ctrl\+c:cancel)\b|^(?:⏵⏵|▶▶)/i;
// C3 model+cwd: model-name · ~/ at line start — not any mid-dot+tilde.
const _modelFooterRe = /^\s*[\w.+-]+\s*[·•]\s*~\//;
const _tipChromeRe = /^\s*Tip:/;
// C4 KEEP (inverted): former delete class is now preserved as status telemetry.
const _turnChromeRe = /(\d+[hms]|\d+m \d+s)|tokens|effort|Drizzl\w*|Working|Thinking|Compacting|Waiting for|Worked for/i;
const _tmuxConfRe = /~\/\.tmux\.conf/;
const _composerGlyphRe = /^[❯›▌]/u;
const _composerPlaceholderRe = /^\s*Type a message\b/i;
const _interruptChromeRe = /^\s*esc to interrupt\s*$/i;

function _isStatusChromeLine(line) {
  const trimmed = (line || "").trim();
  if (!trimmed) return false;
  return _statusChromeRe.test(trimmed);
}

function _isSpinnerChromeLine(line) {
  const trimmed = (line || "").trim();
  if (!trimmed) return false;
  const spin = trimmed.match(_leadingTrueSpinnerRe);
  if (spin) {
    const remainder = (spin[1] || "").trim();
    if (!remainder) return true;
    if (_spinnerStatusRemainderRe.test(remainder)) return true;
    if (_isC4StatusLine(remainder)) return true;
    return false;
  }
  const mark = trimmed.match(_leadingContentMarkerRe);
  if (mark) {
    const remainder = (mark[1] || "").trim();
    if (!remainder) return false;
    if (_isC4StatusLine(remainder)) return true;
    if (_spinnerStatusRemainderRe.test(remainder) && /(?:tokens|effort|\(\d)/i.test(remainder)) return true;
    return false;
  }
  return false;
}

function _isChromeLine(line) {
  const trimmed = line.trim();
  if (trimmed === "") return false;
  // Order: C1, then C3, then C4 keep, then C2.
  if (_isStatusChromeLine(line)) return true;
  if (_modelFooterRe.test(trimmed) || _tipChromeRe.test(trimmed)) return true;
  if (_turnChromeRe.test(line)) return false;
  return _composerGlyphRe.test(trimmed)
    || _composerPlaceholderRe.test(trimmed)
    || _isBoxDrawingLine(line)
    || /^[─=]{3,}$/.test(trimmed)
    || _interruptChromeRe.test(trimmed)
    || _isSpinnerChromeLine(line)
    || _tmuxConfRe.test(line);
}

function _isC1C3ChromeLine(line) {
  const trimmed = (line || "").trim();
  if (!trimmed) return false;
  return _isStatusChromeLine(trimmed) || _modelFooterRe.test(trimmed) || _tipChromeRe.test(trimmed);
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

export function extractStrippedChromeLines(text) {
  const clean = normalizeTerminalOutput(text);
  if (!clean) return "";
  return clean
    .split("\n")
    .filter((line) => _isChromeLine(line))
    .join("\n")
    .trim();
}

/**
 * Strip ANSI escape sequences and filter Claude-Code TUI chrome lines.
 * Untrimmed: the overlap-diff path needs stable per-line text across polls.
 */
function _cleanTerminalLines(text) {
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
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (_isRoundBoxOpener(trimmed)) {
      let closer = -1;
      for (let j = i + 1; j < lines.length; j += 1) {
        if (_isRoundBoxCloser(lines[j])) {
          closer = j;
          break;
        }
      }
      if (closer >= 0) {
        i = closer;
        continue;
      }
      // Unterminated opener must not eat the remainder of the capture.
      continue;
    }
    if (!_isChromeLine(line)) kept.push(line);
  }
  return kept.join("\n");
}

/**
 * Strip ANSI escape sequences and filter Claude-Code TUI chrome lines.
 * Returns the cleaned text with blank lines collapsed.
 */
export function cleanTerminalOutput(text) {
  return _cleanTerminalLines(text).trim();
}

function _isBlankLine(line) {
  return line.trim() === "";
}

function _isBoxDrawingLine(line) {
  const trimmed = (line || "").trim();
  if (!trimmed || !_boxCharRe.test(trimmed)) return false;
  // Complete box/rule, or a framed chrome row that starts AND ends with a box glyph.
  return _boxOnlyRe.test(trimmed) || _boxFramedRe.test(trimmed);
}

function _isRoundBoxOpener(line) {
  const trimmed = (line || "").trim();
  if (!trimmed.includes("╭")) return false;
  return _isBoxDrawingLine(trimmed) || /^╭[─━═\s╮]*$/.test(trimmed);
}

function _isRoundBoxCloser(line) {
  const trimmed = (line || "").trim();
  if (!trimmed.includes("╰")) return false;
  return _isBoxDrawingLine(trimmed) || /╰/.test(trimmed);
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

function _slidingDelta(beforeText, afterText) {
  // Newlines only — whole-string trim would mutate a window-edge blank or indent
  // and desync exact-line suffix/prefix overlap across adjacent polls.
  const before = (beforeText || "").replace(/\r\n/g, "\n");
  const after = (afterText || "").replace(/\r\n/g, "\n");
  if (!after) return { delta: "", overlap: 0, contained: !before };
  if (!before) return { delta: after, overlap: 0, contained: false };
  if (after === before) {
    return { delta: "", overlap: after.split("\n").length, contained: true };
  }
  if (after.startsWith(before)) {
    return {
      delta: after.slice(before.length).replace(/^\n/, ""),
      overlap: before.split("\n").length,
      contained: false
    };
  }
  if (before.includes(after) || before.endsWith(after)) {
    return { delta: "", overlap: after.split("\n").length, contained: true };
  }

  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const max = Math.min(beforeLines.length, afterLines.length);
  for (let n = max; n > 0; n -= 1) {
    if (_linesEqual(beforeLines.slice(-n), afterLines.slice(0, n))) {
      return { delta: afterLines.slice(n).join("\n"), overlap: n, contained: false };
    }
  }
  // Zero overlap is a capture gap / repaint — never "everything is new".
  return { delta: "", overlap: 0, contained: false };
}

export function diffTerminalOutput(beforeText, afterText) {
  return _slidingDelta(beforeText, afterText).delta.trim();
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
  if (_isStatusChromeLine(trimmed)) return false;
  if (_modelFooterRe.test(trimmed) || _tipChromeRe.test(trimmed)) return false;
  // Require the C4 *shape* (duration / tokens), not a leading verb alone
  // so prose like "Working on the tests" stays in the agent body.
  if (_c4VerbRe.test(trimmed) && (_c4DurationRe.test(trimmed) || /(?:tokens|effort)/i.test(trimmed))) {
    return true;
  }
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
  return text.split("\n").filter((line) => !_isC4StatusLine(line)).join("\n");
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
  // Zero overlap: keep the accumulated body. Never replace with an unproven window.
  return prev;
}

function _removeUserText(body, entries, { lastUserOnly = false } = {}) {
  let next = body || "";
  const users = (entries || []).filter((entry) => entry && entry.role === "user");
  const targets = lastUserOnly && users.length ? [users[users.length - 1]] : users;
  for (const entry of targets) {
    if (entry.sentContent) next = _removeExactText(next, entry.sentContent);
    if (entry.content) next = _removeExactText(next, entry.content);
  }
  return next.trim();
}

function _prepareDiffText(text) {
  return _stripStatusLines(_cleanTerminalLines(text || ""));
}

function _agentBodyFromSnapshot(snapshot, entries, excludeLastAgent) {
  let body = _prepareDiffText(snapshot);
  body = _removeUserText(body, entries, { lastUserOnly: false });
  const agents = entries.filter((entry) => entry && entry.role === "agent");
  const priorAgents = excludeLastAgent ? agents.slice(0, -1) : agents;
  for (const entry of priorAgents) {
    if (entry.content) body = _removeExactText(body, entry.content);
  }
  return body.trim();
}

/**
 * Proven delta between two snapshots. Diffes cleaned+status-stripped text
 * with sliding suffix/prefix overlap. Zero overlap yields an empty delta.
 */
function _agentBodyFromCleanedDiff(beforeText, afterText, entries) {
  const { delta, overlap, contained } = _slidingDelta(
    _prepareDiffText(beforeText),
    _prepareDiffText(afterText)
  );
  if (!delta) return { body: "", overlap, contained };
  return {
    body: _removeUserText(delta, entries, { lastUserOnly: true }),
    overlap,
    contained
  };
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
export function appendYou(entries, text, { now = Date.now(), sentContent } = {}) {
  const content = (text || "").trim();
  const list = Array.isArray(entries) ? entries : [];
  if (!content) return list;
  const entry = makeEntry("you-" + now, "user", "You", content, new Date(now).toLocaleTimeString());
  if (typeof sentContent === "string" && sentContent) {
    entry.sentContent = sentContent;
  }
  return list.concat([entry]);
}

/**
 * Patch the last AGENT in place, or open a new AGENT only after a YOU send.
 * Aged capture tails do not rebuild prior turns or restamp identities.
 *
 * `baselineAtSend` is used only for the FIRST post-YOU body (exclude pre-send
 * text). Later growth diffs `previousSnapshot` -> current and accumulates.
 * Zero-overlap windows never replace the accumulated body.
 */
export function applyAgentPatch(entries, snapshot, { now = Date.now(), baselineAtSend, previousSnapshot } = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const lastAgentIdx = _lastIndexByRole(list, "agent");
  const lastUserIdx = _lastIndexByRole(list, "user");
  const openNew = lastAgentIdx < 0 || lastUserIdx > lastAgentIdx;
  const hasBaseline = typeof baselineAtSend === "string" && baselineAtSend.length > 0;
  const hasPrevious = typeof previousSnapshot === "string" && previousSnapshot.length > 0;

  if (openNew) {
    let body = "";
    if (hasBaseline) {
      const cut = _agentBodyFromCleanedDiff(baselineAtSend, snapshot, list);
      body = cut.body;
    } else {
      body = _agentBodyFromSnapshot(snapshot, list, false);
    }
    body = (body || "").trim();
    if (!body) return list;
    return list.concat([
      makeEntry("agent-" + now, "agent", "Agent", body, new Date(now).toLocaleTimeString())
    ]);
  }

  const last = list[lastAgentIdx];
  let merged = last.content;
  if (hasPrevious) {
    const cut = _agentBodyFromCleanedDiff(previousSnapshot, snapshot, list);
    if (cut.overlap === 0 && !cut.contained) {
      merged = last.content;
    } else if (cut.body) {
      if (last.content.endsWith(cut.body)) {
        merged = last.content;
      } else {
        merged = last.content ? `${last.content}\n${cut.body}` : cut.body;
      }
    }
  } else if (hasBaseline) {
    const cut = _agentBodyFromCleanedDiff(baselineAtSend, snapshot, list);
    merged = _mergeAgedTail(last.content, cut.body);
  } else {
    const body = _agentBodyFromSnapshot(snapshot, list, true);
    merged = _mergeAgedTail(last.content, body);
  }

  merged = (merged || "").trim();
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
