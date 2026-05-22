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
