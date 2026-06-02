export function normalizeTerminalOutput(text) {
  return (text || "").replace(/\r\n/g, "\n").trim();
}

const _spinnerGlyphs = "◦•✻✶✢●○⎿⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⣾⣽⣻⢿⡿⣟⣯⣷";
const _leadingSpinnerRe = new RegExp(`^\\s*[${_spinnerGlyphs}]`, "u");
const _statusChromeRe = /bypass permissions|ctrl\+t|to manage|for agents|\/ps to view|\/stop|\bshells?\b|\bmonitors?\b|\/model|shift\+tab|to cycle|focus-events|\/effort/i;
const _modelFooterRe = /^\s*(gpt-5|sonnet|opus|haiku)\b/i;
const _cwdFooterRe = /[·•]\s*~\/\S*\s*$/;
const _turnChromeRe = /esc to interrupt|Working \(|Waiting for|Compacting|Thinking/i;
const _tmuxConfRe = /~\/\.tmux\.conf/;

function _isChromeLine(line) {
  const trimmed = line.trim();
  if (trimmed === "") return false;
  return /^[❯›]/u.test(trimmed)
    || /^[─=]{3,}$/.test(trimmed)
    || _leadingSpinnerRe.test(line)
    || _statusChromeRe.test(line)
    || _modelFooterRe.test(trimmed)
    || _cwdFooterRe.test(line)
    || _turnChromeRe.test(line)
    || _tmuxConfRe.test(line);
}

/**
 * Strip ANSI escape sequences and filter Claude-Code TUI chrome lines.
 * Returns the cleaned text with blank lines collapsed.
 */
export function cleanTerminalOutput(text) {
  if (!text) return "";
  return text
    .replace(/\r\n/g, "\n")
    // Strip CSI sequences (ESC [ ... final byte)
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    // Strip OSC sequences (ESC ] ... ST/BEL)
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    // Strip remaining lone ESC + one char
    .replace(/\x1b./g, "")
    // Strip other control chars except newline/tab
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "")
    .split("\n")
    .filter(line => !_isChromeLine(line))
    .join("\n")
    .trim();
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
