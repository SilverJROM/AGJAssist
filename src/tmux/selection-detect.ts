// Server-side wrapper around the shared (pure JS, browser+node) selection-prompt
// detector in the web bundle. Lets the API flag panes that are blocked waiting on
// an interactive options selection, so the UI can highlight them (and a watcher
// can nag after they sit unanswered).
//
// The module is imported lazily via a variable specifier so tsc does not try to
// type-resolve the untyped .js; at runtime Node resolves it relative to the
// compiled file (dist/tmux -> dist/web/public), which exists because the build
// copies src/web into dist/.

type SelectionResult = { question?: string; title?: string; options?: Array<{ n: number; label: string }> } | null;
type DetectFn = (snapshot: string) => SelectionResult;

let _detect: DetectFn | null = null;
let _loaded = false;

async function loadDetector(): Promise<DetectFn | null> {
  if (_loaded) return _detect;
  _loaded = true;
  try {
    const modPath = "../web/public/terminal-chat-state.js";
    const mod: { detectSelectionPrompt?: DetectFn } = await import(modPath);
    _detect = typeof mod.detectSelectionPrompt === "function" ? mod.detectSelectionPrompt : null;
  } catch {
    _detect = null;
  }
  return _detect;
}

/** A pane is "awaiting selection" when the detector finds a live prompt with 2+ options. */
export function isAwaitingSelection(sel: SelectionResult): boolean {
  return !!(sel && Array.isArray(sel.options) && sel.options.length >= 2);
}

/** Run the detector against a pane snapshot. Returns null if unavailable or no prompt. */
export async function detectPaneSelection(snapshot: string): Promise<SelectionResult> {
  const detect = await loadDetector();
  if (!detect) return null;
  try {
    return detect(snapshot);
  } catch {
    return null;
  }
}
