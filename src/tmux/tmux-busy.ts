import { setTimeout as setTimeoutPromise } from "node:timers/promises";

export const TMUX_BUSY_SAMPLE_LINES = 40;
export const TMUX_BUSY_SAMPLE_DELAY_MS = 700;
export const TMUX_SPINNER_RE = /[✻✳✶◐◓◑◒⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/;

export interface PaneBusySampleOptions {
  lines?: number;
  delayMs?: number;
}

type PaneRef = { target: string };

function normalizedPaneTail(output: string): string {
  return output.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trimEnd();
}

function changedChars(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  let changed = 0;
  for (let i = 0; i < max; i++) {
    if (a[i] !== b[i]) changed++;
  }
  return changed;
}

function paneDiffLooksActive(before: string, after: string): boolean {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const max = Math.max(beforeLines.length, afterLines.length);
  let changed = 0;
  let spinnerOnChangedLine = false;

  for (let i = 0; i < max; i++) {
    const prior = beforeLines[i] ?? "";
    const current = afterLines[i] ?? "";
    if (prior === current) continue;
    changed += changedChars(prior, current);
    if (TMUX_SPINNER_RE.test(prior) || TMUX_SPINNER_RE.test(current)) {
      spinnerOnChangedLine = true;
    }
  }

  return spinnerOnChangedLine || changed > 4;
}

export function paneLooksBusyFromSamples(before: string, after: string): boolean {
  const first = normalizedPaneTail(before);
  const second = normalizedPaneTail(after);
  return first !== second && paneDiffLooksActive(first, second);
}

function defaultDelayMs(): number {
  const raw = process.env.TMUX_BUSY_SAMPLE_DELAY_MS;
  if (raw !== undefined) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return process.env.NODE_ENV === "test" || process.env.VITEST ? 0 : TMUX_BUSY_SAMPLE_DELAY_MS;
}

async function captureAll(
  targets: string[],
  lines: number,
  capture: (target: string, lines: number) => Promise<string>
): Promise<Map<string, string | null>> {
  const entries = await Promise.all(
    targets.map(async (target): Promise<[string, string | null]> => {
      try {
        return [target, await capture(target, lines)];
      } catch {
        return [target, null];
      }
    })
  );
  return new Map(entries);
}

export async function getPaneBusyStates<T extends PaneRef>(
  panes: T[],
  capture: (target: string, lines: number) => Promise<string>,
  options: PaneBusySampleOptions = {}
): Promise<Map<string, boolean>> {
  const targets = Array.from(new Set(panes.map((pane) => pane.target)));
  const busy = new Map(targets.map((target) => [target, false]));
  if (targets.length === 0) return busy;

  const lines = options.lines ?? TMUX_BUSY_SAMPLE_LINES;
  const delayMs = options.delayMs ?? defaultDelayMs();
  const first = await captureAll(targets, lines, capture);
  if (delayMs > 0) {
    await setTimeoutPromise(delayMs);
  }
  const second = await captureAll(targets, lines, capture);

  for (const target of targets) {
    const before = first.get(target);
    const after = second.get(target);
    busy.set(
      target,
      typeof before === "string" &&
        typeof after === "string" &&
        paneLooksBusyFromSamples(before, after)
    );
  }

  return busy;
}
