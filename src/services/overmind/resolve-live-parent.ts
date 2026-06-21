import { listTmuxSessions, selectParentCandidate } from "./parent-session-resolver.js";
import { FallbackParentBrain, defaultBrainProviders, type ParentBrain } from "./parent-brain.js";

export interface LiveParentResolverDeps {
  capturePane?: (target: string) => Promise<string>;
  brain?: ParentBrain;
}

export function makeLiveParentResolver(deps: LiveParentResolverDeps = {}): (stored: string) => Promise<string> {
  const capturePane = deps.capturePane;
  const brain = deps.brain ?? new FallbackParentBrain(defaultBrainProviders());
  return async (stored: string): Promise<string> => {
    try {
      const sessions = await listTmuxSessions();
      const res = selectParentCandidate(stored, sessions);
      if (res.session === null) {
        return stored;
      }
      if (res.ambiguous && capturePane) {
        for (const name of res.candidates) {
          let tail = "";
          try {
            tail = await capturePane(name);
          } catch {
            tail = "";
          }
          const v = await brain.judgeParent(name, tail);
          if (v.verdict === "good") {
            return name;
          }
        }
        // none good → fall through to res.session
      }
      return res.session;
    } catch {
      // ANY internal error → return stored unchanged (pm2 nudge path safety)
      return stored;
    }
  };
}
