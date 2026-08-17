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
const _boxAllRe = /[┌┐└┘├┤┬┴┼─│╭╮╰╯═║╔╗╚╝╠╣╦╩╬━┃]/gu;
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
// Editor-tabs indicator ("⧉ index · index · index · ctrl+] to open") and related
// CLI hint chrome ("… to run in background", "… +N completed/more/lines") — pure
// chrome that eats chat space; strip it.
const _editorTabsChromeRe = /^\s*⧉/u;
const _bgRunHintRe = /to run in background\)?\s*$/i;
const _overflowChromeRe = /^\s*(?:…|\.\.\.)\s*\+\d+\s+(?:completed|more|lines?)\b/i;
// Claude TUI paints a right-aligned "HH:MM:SS [N/M]" counter over the first
// physical line of the wrapped user box. The tail of the message survives.
const _paneCounterRe = /\b\d{2}:\d{2}:\d{2}\s+\[\d+\/\d+\]/;

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
    || _editorTabsChromeRe.test(trimmed)
    || _bgRunHintRe.test(trimmed)
    || _overflowChromeRe.test(trimmed)
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
  // Pure frame/rule (all box glyphs + whitespace) is chrome → strip.
  if (_boxOnlyRe.test(trimmed)) return true;
  // A framed row (starts AND ends with a box glyph) is kept ONLY when it is a
  // MULTI-COLUMN data-table row: alphanumeric content AND 3+ vertical bars (2+
  // cells), e.g. "│ Tree hash │ 6ae244fc5 │ 6ae244fc5 │". A single-cell framed
  // line is chrome (claude's composer/dialog box, e.g. "│ Type a message │") and
  // is stripped.
  if (_boxFramedRe.test(trimmed)) {
    const inner = trimmed.replace(_boxAllRe, "").trim();
    const hasContent = /[A-Za-z0-9]/.test(inner);
    const vbars = (trimmed.match(/[│┃]/gu) || []).length;
    return !(hasContent && vbars >= 3);
  }
  return false;
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
    if (entry.sent && entry.sent !== entry.sentContent) next = _removeExactText(next, entry.sent);
    if (entry.content) next = _removeExactText(next, entry.content);
  }
  return next.trim();
}

function _lastYouSentText(entries) {
  const idx = _lastIndexByRole(entries, "user");
  if (idx < 0) return "";
  const entry = entries[idx];
  const sent = (typeof entry.sentContent === "string" && entry.sentContent)
    || (typeof entry.sent === "string" && entry.sent)
    || "";
  return String(sent).trim();
}

function _entryNeedles(entry) {
  const needles = [];
  const add = (value) => {
    if (typeof value === "string" && value && !needles.includes(value)) needles.push(value);
  };
  add(entry && entry.content);
  add(entry && entry.sentContent);
  add(entry && entry.sent);
  return needles;
}

/**
 * Drop already-displayed prior YOU/AGENT turns from a cleaned snapshot so the
 * first remaining sentContent echo is this turn's echo, not a stale identical one.
 */
function _removePriorTurnContents(text, entries) {
  let next = text || "";
  const list = Array.isArray(entries) ? entries : [];
  const lastUserIdx = _lastIndexByRole(list, "user");
  const lastAgentIdx = _lastIndexByRole(list, "agent");
  const openNew = lastAgentIdx < 0 || lastUserIdx > lastAgentIdx;
  for (let i = 0; i < list.length; i += 1) {
    const entry = list[i];
    if (!entry) continue;
    if (entry.role === "user" && i !== lastUserIdx) {
      const before = next;
      for (const needle of _entryNeedles(entry)) {
        next = _removeExactText(next, needle);
      }
      // Wrapped/counter-clobbered prior echo is not an exact block — drop its
      // tail run only when exact removal did not already take an occurrence.
      if (next === before) {
        const priorSent = (entry.sentContent || entry.sent || entry.content || "").trim();
        if (priorSent) next = _removeFirstTailEcho(next, priorSent);
      }
    }
    if (entry.role === "agent" && (openNew || i !== lastAgentIdx) && entry.content) {
      next = _removeExactText(next, entry.content);
    }
  }
  return next;
}

function _firstEchoLineIndex(lines, needle) {
  const target = (needle || "").trim();
  if (!target) return -1;
  for (let i = 0; i < lines.length; i += 1) {
    if ((lines[i] || "").trim() === target) return i;
  }
  return -1;
}

function _compactSpaces(text) {
  return String(text || "").replace(/\s+/g, "");
}

/**
 * Shortest consecutive run that reconstitutes a hard-wrapped pane echo of `needle`.
 * tmux capture-pane without -J splits one logical line across physical rows.
 */
function _findWrappedEchoRun(lines, needle) {
  const target = (needle || "").trim();
  if (!target) return null;
  const compactTarget = _compactSpaces(target);
  if (!compactTarget) return null;
  let best = null;
  for (let start = 0; start < lines.length; start += 1) {
    let joined = "";
    let joinedTrimmed = "";
    for (let end = start; end < lines.length; end += 1) {
      const raw = String(lines[end] ?? "");
      joined += raw;
      joinedTrimmed += raw.trim();
      const runLen = end - start + 1;
      if (runLen < 2) continue;
      const matches = joined.trim() === target
        || joinedTrimmed === target
        || _compactSpaces(joined) === compactTarget
        || _compactSpaces(joinedTrimmed) === compactTarget;
      if (matches) {
        if (!best || runLen < (best.end - best.start + 1)) {
          best = { start, end };
        }
        break;
      }
      if (
        _compactSpaces(joined).length > compactTarget.length
        && _compactSpaces(joinedTrimmed).length > compactTarget.length
      ) {
        break;
      }
    }
    if (best && (best.end - best.start + 1) === 2) break;
  }
  return best;
}

function _joinStaysSentPrefix(left, right, target) {
  const compactTarget = _compactSpaces(target);
  if (!left || !right || !compactTarget) return false;
  const variants = [left + right, `${left} ${right}`];
  for (const joined of variants) {
    if (target.startsWith(joined) || joined === target) return true;
    const compact = _compactSpaces(joined);
    if (compactTarget.startsWith(compact) || compact === compactTarget) return true;
  }
  return false;
}

/**
 * Drop leftover wrapped-echo PREFIX fragments only when they are provably a
 * mid-wrap run (this line plus the next still prefixes / equals sentContent).
 * A standalone heading that merely equals a prefix of the command is kept.
 */
function _stripSentPrefixFragments(text, sent) {
  const target = (sent || "").trim();
  if (!text || !target) return text || "";
  const lines = text.split("\n");
  const kept = [];
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = (lines[i] || "").trim();
    if (!trimmed || trimmed === target || !target.startsWith(trimmed)) {
      kept.push(lines[i]);
      continue;
    }
    const next = (lines[i + 1] || "").trim();
    if (next && _joinStaysSentPrefix(trimmed, next, target)) continue;
    kept.push(lines[i]);
  }
  return kept.join("\n");
}

/**
 * Agent body = rows AFTER the current YOU-message boundary.
 *
 * Primary path (real Claude TUI): ANSI-stripped but otherwise unfiltered rows.
 * Identify structural ❯ user runs, strip only the HH:MM:SS [N/M] counter inside
 * the run, fold whitespace, and match by suffix-at-end (64→48→32→20 ladder).
 * Choose the LAST current-send run — never a ●-reply quote, never the first
 * global substring. Only the rows below that run's final physical row are
 * chrome-cleaned into the reply.
 *
 * Legacy path (fixtures without ❯ structure): exact line, wrapped full-echo,
 * then cleaned tail key. Not used when any structural ❯ run is present.
 */
function _agentBodyFromEchoAnchor(snapshot, entries) {
  const sent = _lastYouSentText(entries);
  if (!sent) return { found: false, body: "" };

  const rawLines = _ansiStrippedRows(snapshot);
  const userRuns = _collectUserRuns(rawLines);
  const matched = _lastMatchingUserRun(userRuns, sent);
  if (matched) {
    const afterRaw = rawLines.slice(matched.cutAfter + 1).join("\n");
    const body = _prepareDiffText(afterRaw);
    return { found: true, body: _removeUserText(body, entries, { lastUserOnly: false }) };
  }
  // Structural ❯ runs exist but none are a trustworthy current-send match.
  // Do NOT fall through to a global substring search (reply-quote false-anchor).
  if (userRuns.length) return { found: false, body: "" };

  const prepared = _prepareDiffText(snapshot);
  if (!prepared) return { found: false, body: "" };
  const candidate = _removePriorTurnContents(prepared, entries);
  const lines = candidate.split("\n");
  const echoAt = _firstEchoLineIndex(lines, sent);
  if (echoAt >= 0) {
    const after = lines.slice(echoAt + 1).join("\n");
    return { found: true, body: _removeUserText(after, entries, { lastUserOnly: false }) };
  }
  const wrapped = _findWrappedEchoRun(lines, sent);
  if (wrapped) {
    const after = lines.slice(wrapped.end + 1).join("\n");
    return { found: true, body: _removeUserText(after, entries, { lastUserOnly: false }) };
  }
  const tailKey = _anchorKeyFromSent(sent);
  const tailAt = _findTailAnchor(lines, tailKey);
  if (tailAt >= 0) {
    const after = lines.slice(tailAt + 1).join("\n");
    return { found: true, body: _removeUserText(after, entries, { lastUserOnly: false }) };
  }
  return { found: false, body: "" };
}

function _fallbackOpenBody(snapshot, entries, baselineAtSend, previousSnapshot) {
  const rawLines = _ansiStrippedRows(snapshot);
  const userRuns = _collectUserRuns(rawLines);
  const hasBaseline = typeof baselineAtSend === "string" && baselineAtSend.length > 0;
  if (userRuns.length) {
    const newest = userRuns[userRuns.length - 1];
    const bullet = _latestBulletBlocks(rawLines.slice(newest.end + 1));
    if (bullet) {
      const cleaned = _prepareDiffText(bullet);
      if (cleaned) return cleaned;
    }
    const proven = _provenPostSendDelta(snapshot, entries, baselineAtSend, previousSnapshot);
    if (proven) return proven;
    // No reply BELOW the newest ❯ and no proven send-delta. When we are NOT in an
    // active send waiting for a fresh reply (no baseline), the agent's latest
    // output sits ABOVE the trailing prompt — e.g. background-command completions
    // or an auto-recap after the last exchange (the hris "chat ≠ terminal" case).
    // Show the latest ● block above the prompt so the chat reflects the pane
    // instead of freezing on a stale/empty body.
    if (!hasBaseline) {
      const above = _latestBulletBlocks(rawLines.slice(0, newest.start));
      if (above) {
        const cleaned = _prepareDiffText(above);
        if (cleaned) return _removeUserText(cleaned, entries, { lastUserOnly: false });
      }
    }
    return proven;
  }
  const proven = _provenPostSendDelta(snapshot, entries, baselineAtSend, previousSnapshot);
  if (proven) return proven;
  return _agentBodyFromSnapshot(snapshot, entries, false);
}

function _stripPaneCounters(text) {
  return String(text || "")
    .split("\n")
    .map((line) => line.replace(_paneCounterRe, "").replace(/[ \t]+$/g, ""))
    .join("\n");
}

function _normalizeWs(text) {
  return String(text || "")
    .replace(/[\s\u00A0\u1680\u2000-\u200B\u2028\u2029\u202F\u205F\u3000\uFEFF]+/g, " ")
    .trim();
}

function _ansiStrippedRows(text) {
  if (!text) return [];
  return String(text)
    .replace(/\r\n/g, "\n")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b./g, "")
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "")
    .split("\n");
}

function _isUserPromptGlyph(line) {
  return /^\s*[│┃║]?\s*❯/u.test(line || "");
}

function _stripUserRunLine(line, isFirst) {
  let text = String(line ?? "").replace(_paneCounterRe, "");
  text = text.replace(/^\s*[│┃║]\s?/, "").replace(/\s*[│┃║]\s*$/, "");
  if (isFirst) text = text.replace(/^\s*❯\s*/u, "");
  return text.replace(/[ \t\u00A0]+$/g, "");
}

function _isUserPromptLine(line) {
  if (!_isUserPromptGlyph(line)) return false;
  return Boolean(_normalizeWs(_stripUserRunLine(line, true)));
}

function _isUserRunBoundary(line) {
  const trimmed = (line || "").trim();
  if (!trimmed) return true;
  if (_isUserPromptGlyph(line)) return true;
  if (/^\s*[│┃║]?\s*●/u.test(line || "")) return true;
  if (/^[─━═]{3,}/u.test(trimmed) || /[─━═]{5,}/u.test(trimmed)) return true;
  if (_isRoundBoxOpener(line) || _isRoundBoxCloser(line)) return true;
  if (_isStatusChromeLine(line) || _isC4StatusLine(line) || _isSpinnerChromeLine(line)) return true;
  if (_statusChromeRe.test(trimmed) || _modelFooterRe.test(trimmed) || _tipChromeRe.test(trimmed)) return true;
  if (/^[›▌]/u.test(trimmed) || _composerPlaceholderRe.test(trimmed)) return true;
  return false;
}

function _normalizeUserRun(rawLines, start, end) {
  const charToRow = [];
  const pieces = [];
  for (let i = start; i <= end; i += 1) {
    const piece = _normalizeWs(_stripUserRunLine(rawLines[i], i === start));
    if (!piece) continue;
    if (pieces.length) charToRow.push(i);
    for (let k = 0; k < piece.length; k += 1) charToRow.push(i);
    pieces.push(piece);
  }
  const cutAfter = charToRow.length ? charToRow[charToRow.length - 1] : end;
  return {
    start,
    end,
    cutAfter,
    normalized: pieces.join(" "),
    glued: pieces.join(""),
    charToRow
  };
}

function _collectUserRuns(rawLines) {
  const runs = [];
  const lines = Array.isArray(rawLines) ? rawLines : [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!_isUserPromptLine(lines[i])) continue;
    const start = i;
    let end = i;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (_isUserRunBoundary(lines[j])) break;
      end = j;
    }
    runs.push(_normalizeUserRun(lines, start, end));
    i = end;
  }
  return runs;
}

function _suffixLadder(normalizedSent) {
  const lengths = [64, 48, 32, 20];
  const out = [];
  const seen = new Set();
  const push = (suf) => {
    if (suf && !seen.has(suf)) {
      seen.add(suf);
      out.push(suf);
    }
  };
  const sent = _normalizeWs(normalizedSent);
  if (!sent) return out;
  if (sent.length <= 64) push(sent);
  for (const len of lengths) {
    if (sent.length < len) continue;
    let start = sent.length - len;
    if (start > 0 && sent[start] !== " " && sent[start - 1] !== " ") {
      const prevSpace = sent.lastIndexOf(" ", start);
      if (prevSpace >= 0) start = prevSpace + 1;
    } else if (start < sent.length && sent[start] === " ") {
      start += 1;
    }
    push(sent.slice(start).trim());
  }
  if (!out.length) push(sent);
  return out;
}

function _lastMatchingUserRun(runs, sent) {
  const ladder = _suffixLadder(sent);
  if (!ladder.length || !runs.length) return null;
  for (const suffix of ladder) {
    const gluedSuffix = suffix.replace(/ /g, "");
    const hits = runs.filter((run) =>
      run.normalized.endsWith(suffix)
      || run.glued.endsWith(suffix)
      || (gluedSuffix && run.glued.endsWith(gluedSuffix))
    );
    if (hits.length) return hits[hits.length - 1];
  }
  return null;
}

function _latestBulletBlocks(lines) {
  let first = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\s*[│┃║]?\s*●/u.test(lines[i] || "")) {
      first = i;
      break;
    }
  }
  if (first < 0) return "";
  return lines.slice(first).join("\n");
}

function _provenPostSendDelta(snapshot, entries, baselineAtSend, previousSnapshot) {
  const hasBaseline = typeof baselineAtSend === "string" && baselineAtSend.length > 0;
  const hasPrevious = typeof previousSnapshot === "string" && previousSnapshot.length > 0;
  if (hasBaseline) {
    const cut = _agentBodyFromCleanedDiff(baselineAtSend, snapshot, entries);
    if (cut.body) return (cut.body || "").trim();
  }
  if (hasPrevious) {
    const cut = _agentBodyFromCleanedDiff(previousSnapshot, snapshot, entries);
    if (cut.body) return (cut.body || "").trim();
  }
  return "";
}

/**
 * Robust ANCHOR KEY = the message TAIL (last ~40-60 chars at a word boundary).
 * The TUI counter only clobbers the first physical line, so the tail survives.
 */
function _anchorKeyFromSent(sent) {
  const normalized = _normalizeWs(sent);
  if (!normalized) return "";
  const MIN = 40;
  const MAX = 60;
  const TARGET = 50;
  if (normalized.length <= MAX) return normalized;
  let start = Math.max(0, normalized.length - TARGET);
  if (start > 0 && normalized[start] !== " " && normalized[start - 1] !== " ") {
    const prevSpace = normalized.lastIndexOf(" ", start);
    const nextSpace = normalized.indexOf(" ", start);
    const fromPrev = prevSpace >= 0 ? prevSpace + 1 : -1;
    const fromNext = nextSpace >= 0 ? nextSpace + 1 : -1;
    const lenPrev = fromPrev >= 0 ? normalized.length - fromPrev : Infinity;
    const lenNext = fromNext >= 0 ? normalized.length - fromNext : -1;
    if (fromPrev >= 0 && lenPrev >= MIN && lenPrev <= MAX) start = fromPrev;
    else if (fromNext >= 0 && lenNext >= MIN && lenNext <= MAX) start = fromNext;
    else if (fromPrev >= 0 && lenPrev <= MAX) start = fromPrev;
    else if (fromNext >= 0 && lenNext >= MIN) start = fromNext;
  } else if (normalized[start] === " ") {
    start += 1;
  }
  return normalized.slice(start).trim();
}

function _joinedContainsKey(lines, start, end, key) {
  let spaced = "";
  let glued = "";
  for (let i = start; i <= end; i += 1) {
    spaced = _normalizeWs(`${spaced} ${lines[i] || ""}`);
    glued = _normalizeWs(glued + String(lines[i] || ""));
  }
  return spaced.includes(key) || glued.includes(key);
}

/**
 * First occurrence of the normalized tail key, joining wrapped continuation
 * lines of the user box so a tail split across physical rows still matches.
 * Returns the last physical line index of the matching run (the boundary).
 */
function _findTailAnchor(lines, key) {
  const needle = _normalizeWs(key);
  if (!needle) return -1;
  // Scan from the top, joining up to 8 physical rows so a wrap-split tail
  // that appears ABOVE a later verbatim quote is the first hit.
  for (let start = 0; start < lines.length; start += 1) {
    for (let end = start; end < Math.min(lines.length, start + 8); end += 1) {
      if (_joinedContainsKey(lines, start, end, needle)) return end;
    }
  }
  return -1;
}

function _removeFirstTailEcho(text, sent) {
  const key = _anchorKeyFromSent(sent);
  if (!text || !key) return text || "";
  const lines = text.split("\n");
  const at = _findTailAnchor(lines, key);
  if (at < 0) return text;
  let runStart = at;
  for (let s = at; s >= Math.max(0, at - 7); s -= 1) {
    if (_joinedContainsKey(lines, s, at, key)) runStart = s;
  }
  return lines.slice(0, runStart).concat(lines.slice(at + 1)).join("\n");
}

function _prepareDiffText(text) {
  return _stripStatusLines(_stripPaneCounters(_cleanTerminalLines(text || "")));
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
  const sent = (typeof sentContent === "string" && sentContent)
    ? sentContent
    : sanitizeOutgoingCommand(content).trim();
  if (sent) {
    entry.sentContent = sent;
    entry.sent = sent;
  }
  return list.concat([entry]);
}

/**
 * Patch the last AGENT in place, or open a new AGENT only after a YOU send.
 * Aged capture tails do not rebuild prior turns or restamp identities.
 *
 * Primary body is everything AFTER the current YOU-message boundary
 * (recomputed each poll). On real Claude TUI panes the boundary is the LAST
 * structural ❯ user run whose normalized text ends with a suffix-ladder match
 * (64→48→32→20, word-bounded, Unicode-whitespace folded). Rows below that
 * run are chrome-cleaned; a ● quote of the tail cannot become the anchor.
 * If no trustworthy ❯ run matches: latest complete ● block(s) below the newest
 * ❯, or a proven post-send adjacent-snapshot delta — never whole-snapshot
 * minus prior turns when ❯ structure is present. Legacy snapshots without ❯
 * keep exact/wrapped/tail + the unstructured never-freeze fallback.
 */
// A full-screen interactive dialog (not a conversational reply): Claude's Login /
// OAuth flow, or an "Esc to cancel" prompt. Used to allow a stale-turn repaint on
// ❯-less panes WITHOUT disturbing the normal conversational sliding-window flow.
const _DIALOG_RE = /(paste code here|browser didn'?t open|oauth\/authorize\?code|use the url below to sign in|\bEsc to cancel\b|Select login method|Opening browser to sign in)/i;
function _isInteractiveDialogPane(snapshot) {
  const rows = _ansiStrippedRows(snapshot);
  return rows.slice(-30).some((l) => _DIALOG_RE.test(l));
}

// Does a pane ❯ run correspond to a stored sent message (suffix-ladder tail)?
function _runMatchesSent(run, sent) {
  if (!run || !sent) return false;
  const ladder = _suffixLadder(sent);
  for (const suffix of ladder) {
    const glued = suffix.replace(/ /g, "");
    if (run.normalized.endsWith(suffix) || run.glued.endsWith(suffix) || (glued && run.glued.endsWith(glued))) return true;
  }
  return false;
}

// Reconcile a pane that has MOVED ON past the seeded entries. Happens when you
// switch back to a tab (seeded from stale recent-message memory) or when the pane
// was driven outside the app (SSH): the newest ❯ run no longer matches the last
// stored user turn, so the normal anchor freezes the old reply. Detect that and
// append the newest run as a fresh user turn + its live reply, so the chat shows
// current data. Returns null when the pane is already in sync (normal live flow).
function _reconcileMovedOnPane(list, snapshot, now) {
  const lastUserIdx = _lastIndexByRole(list, "user");
  const lastAgentIdx = _lastIndexByRole(list, "agent");
  // Only reconcile a SETTLED exchange (last turn is an agent reply). During an
  // active send (last turn is the user, awaiting a reply — openNew) the normal
  // anchor path handles it, incl. counter-clobbered short messages.
  if (!(lastAgentIdx >= 0 && lastAgentIdx >= lastUserIdx)) return null;

  const rawLines = _ansiStrippedRows(snapshot);
  const runs = _collectUserRuns(rawLines);

  // No ❯ prompt AND the pane is a full-screen interactive DIALOG (Claude's Login
  // dialog: "Browser didn't open? … <url> … Paste code here", or a "… Esc to
  // cancel" prompt). The normal diff sees a full repaint with zero overlap and
  // freezes the old turn, so the URL + paste prompt never appear. Patch the last
  // agent turn to the live cleaned snapshot. Gated to dialogs so the normal
  // conversational sliding-window accumulate flow (also ❯-less) is untouched.
  if (!runs.length) {
    if (!_isInteractiveDialogPane(snapshot)) return null;
    const live = _agentBodyFromSnapshot(snapshot, list.filter((e) => e !== list[lastAgentIdx]), false).trim();
    if (!live) return null;
    const cur = (list[lastAgentIdx].content || "").trim();
    if (cur === live || cur.endsWith(live) || live.endsWith(cur)) return null;
    const next = list.slice();
    next[lastAgentIdx] = { ...list[lastAgentIdx], content: live };
    return next;
  }

  const newest = runs[runs.length - 1];
  const newestText = (newest.normalized || "").trim();
  if (!newestText) return null;

  const lastUser = lastUserIdx >= 0 ? list[lastUserIdx] : null;
  // In sync? The last stored user turn corresponds to the newest pane run.
  if (lastUser) {
    const sent = lastUser.sentContent || lastUser.sent || lastUser.content || "";
    if (_runMatchesSent(newest, sent)) return null;
    if ((lastUser.content || "").trim() === newestText) return null;
  }

  const afterRaw = rawLines.slice(newest.cutAfter + 1).join("\n");
  const body = _removeUserText(_prepareDiffText(afterRaw), list, { lastUserOnly: false }).trim();

  if (body) {
    // A real reply below the newest ❯ — this is a new exchange the chat missed
    // (tab switch / SSH-driven). Append it as a user + agent turn.
    if (lastAgentIdx >= 0 && (list[lastAgentIdx].content || "").trim().endsWith(body)) return null;
    const ts = new Date(now).toLocaleTimeString();
    const userEntry = makeEntry("you-reco-" + now, "user", "You", newestText, ts);
    userEntry.sentContent = newestText;
    userEntry.sent = newestText;
    const agentEntry = makeEntry("agent-reco-" + now, "agent", "Agent", body, ts);
    return list.concat([userEntry, agentEntry]);
  }

  // No reply BELOW the newest ❯: the agent's latest output sits ABOVE the trailing
  // prompt — background-command completions or an auto-recap produced after the
  // last exchange (the hris "chat frozen while terminal moved on" case). Keep the
  // shown reply current by patching the last agent turn to that live block.
  const aboveBullet = _latestBulletBlocks(rawLines.slice(0, newest.start));
  const aboveBody = aboveBullet
    ? _removeUserText(_prepareDiffText(aboveBullet), list, { lastUserOnly: false }).trim()
    : "";
  if (!aboveBody) return null;
  if (lastAgentIdx >= 0) {
    const cur = (list[lastAgentIdx].content || "").trim();
    if (cur === aboveBody || cur.endsWith(aboveBody) || aboveBody.endsWith(cur)) return null;
    const next = list.slice();
    next[lastAgentIdx] = { ...list[lastAgentIdx], content: aboveBody };
    return next;
  }
  return null;
}

export function applyAgentPatch(entries, snapshot, { now = Date.now(), baselineAtSend, previousSnapshot } = {}) {
  const list = Array.isArray(entries) ? entries : [];
  // A moved-on pane (stale-memory tab switch / SSH-driven) must reflect live data
  // rather than freeze on the seeded turn.
  const reconciled = _reconcileMovedOnPane(list, snapshot, now);
  if (reconciled) return reconciled;
  const lastAgentIdx = _lastIndexByRole(list, "agent");
  const lastUserIdx = _lastIndexByRole(list, "user");
  const openNew = lastAgentIdx < 0 || lastUserIdx > lastAgentIdx;
  const hasBaseline = typeof baselineAtSend === "string" && baselineAtSend.length > 0;
  const hasPrevious = typeof previousSnapshot === "string" && previousSnapshot.length > 0;
  const echo = _agentBodyFromEchoAnchor(snapshot, list);

  if (openNew) {
    let body = "";
    if (echo.found) {
      body = echo.body;
    } else {
      body = _fallbackOpenBody(snapshot, list, baselineAtSend, previousSnapshot);
      body = _stripSentPrefixFragments(body, _lastYouSentText(list));
    }
    body = (body || "").trim();
    if (!body) return list;
    return list.concat([
      makeEntry("agent-" + now, "agent", "Agent", body, new Date(now).toLocaleTimeString())
    ]);
  }

  const last = list[lastAgentIdx];
  let merged = last.content;
  if (echo.found && echo.body) {
    merged = echo.body;
  } else if (hasPrevious) {
    const cut = _agentBodyFromCleanedDiff(previousSnapshot, snapshot, list);
    if (cut.overlap === 0 && !cut.contained) {
      if (!cut.body) {
        const snapBody = _agentBodyFromSnapshot(snapshot, list, true);
        merged = _mergeAgedTail(last.content, snapBody);
      } else {
        merged = last.content;
      }
    } else if (cut.body) {
      if (last.content.endsWith(cut.body)) {
        merged = last.content;
      } else {
        merged = last.content ? `${last.content}\n${cut.body}` : cut.body;
      }
    }
  } else if (hasBaseline) {
    const cut = _agentBodyFromCleanedDiff(baselineAtSend, snapshot, list);
    if (cut.body) {
      merged = _mergeAgedTail(last.content, cut.body);
    } else {
      const snapBody = _agentBodyFromSnapshot(snapshot, list, true);
      merged = _mergeAgedTail(last.content, snapBody);
    }
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

// Interactive selection detection: when the CLI is waiting on a numbered choice
// (tool-permission "Do you want to proceed? 1. Yes 2. No", or an AskUserQuestion
// menu with an "Enter to select · ↑/↓ to navigate" footer), surface the options
// so the chat can render tappable buttons. Returns null when no active selection
// is present. Conservative on purpose: a bare numbered list in prose must NOT
// trigger it — we require a footer signal, a ❯ cursor glyph, or a question line.
// A genuine selection footer. NB: does NOT match "esc to interrupt" (Working
// spinner) or "shift+tab to cycle" (mode-cycle chrome) — those are handled by
// _SELECT_CHROME_RE below and must never be read as a selection.
const _SELECT_FOOTER_RE = /(enter to (?:select|confirm|submit|continue)|↑\s*\/\s*↓|\bto navigate\b|esc to (?:cancel|reject|go back|exit)|tab to switch|space to (?:toggle|select)|to add notes|use arrows)/i;
// CLI chrome / status lines that resemble a footer but are NOT selection prompts.
const _SELECT_CHROME_RE = /(bypass permissions|shift[\s+]*\+?[\s+]*tab|to cycle|esc to interrupt|to hide tasks|to manage|\bctrl\b|shell still running|auto-?update|for shortcuts)/i;
const _SELECT_QUESTION_RE = /(do you want to proceed|would you like|which\b|select (?:an?|one|the)|choose\b|\bpick\b)/i;
// Only real cursor glyphs (no *,> which appear in markdown/prose).
const _SELECT_OPTION_RE = /^\s*(?:[│┃║]\s*)?(❯|›|»|▶)?\s*(\d{1,2})[.)]\s+(\S.*?)\s*$/u;
const _SELECT_MULTI_RE = /(to switch questions|\bcheckbox|space to (?:toggle|select)|\[[ x✓]\]|☐|☑)/i;

export function detectSelectionPrompt(rawSnapshot) {
  const rows = _ansiStrippedRows(rawSnapshot);
  if (!rows.length) return null;
  const tail = rows.slice(-45);

  // Parse a contiguous numbered option list, tracking each option's line index.
  let options = [];
  let optLineIdx = [];
  let selectedIndex = -1;
  for (let i = 0; i < tail.length; i++) {
    const m = tail[i].match(_SELECT_OPTION_RE);
    if (!m) continue;
    const n = Number(m[2]);
    const cursor = !!m[1];
    // Drop trailing columnar/wrapped junk after a 2+ space gap.
    const label = m[3].replace(/\s{2,}\S.*$/, "").replace(/[│┃║]\s*$/, "").trim();
    if (!label) continue;
    if (n === options.length + 1) {
      options.push({ n, label });
      optLineIdx.push(i);
      if (cursor) selectedIndex = options.length - 1;
    } else if (n === 1) {
      options = [{ n, label }];
      optLineIdx = [i];
      selectedIndex = cursor ? 0 : -1;
    }
  }

  if (options.length < 2) return null;
  const firstOptIdx = optLineIdx[0];
  const lastOptIdx = optLineIdx[optLineIdx.length - 1];

  // A real selection footer must appear JUST BELOW the options (not chrome, and
  // not buried elsewhere in scrollback). This is the structural anchor that
  // distinguishes an active prompt from a numbered list printed in prose.
  let footerIdx = -1;
  for (let i = lastOptIdx + 1; i < tail.length && i <= lastOptIdx + 8; i++) {
    if (_SELECT_CHROME_RE.test(tail[i])) continue;
    if (_SELECT_FOOTER_RE.test(tail[i])) { footerIdx = i; break; }
  }
  const hasFooter = footerIdx >= 0;
  const hasCursor = selectedIndex >= 0; // ❯ on a numbered option = tool dialog

  // Require a structural signal: a footer directly under the options, or a
  // cursor on an option. A bare numbered list in prose has neither → null.
  if (!hasFooter && !hasCursor) return null;

  // Title: nearest question-ish line just above the first option.
  let title = "";
  for (let i = firstOptIdx - 1; i >= 0 && i >= firstOptIdx - 8; i--) {
    const l = tail[i];
    if (!l.trim()) continue;
    if (_SELECT_CHROME_RE.test(l)) break;
    if (_SELECT_QUESTION_RE.test(l) || /\?\s*$/.test(l)) {
      title = l.replace(/^[\s│┃║╭╰─╮╯]+/, "").replace(/[\s│┃║]+$/, "").trim();
      break;
    }
  }

  return {
    active: true,
    title,
    options,
    selectedIndex,
    multi: _SELECT_MULTI_RE.test(tail.join("\n")),
  };
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
