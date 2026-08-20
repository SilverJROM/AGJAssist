export const TMUX_BUSY_RE = /(✻|✳|✶|◐|◓|◑|◒).*(for \d|esc to interrupt|running|\btokens?\b)/i;

export function paneLooksBusy(output: string): boolean {
  return TMUX_BUSY_RE.test(output) || /esc to interrupt/i.test(output);
}
