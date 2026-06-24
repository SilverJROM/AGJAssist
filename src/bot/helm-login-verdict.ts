import type { HelmLoginChallenge } from "./helm-login-store.js";

export type HelmLoginVerdict = "pass" | "fail";

export function decideHelmLoginVerdict(
  challenge: Pick<HelmLoginChallenge, "displayNumber">,
  selected: number
): HelmLoginVerdict {
  return selected === challenge.displayNumber ? "pass" : "fail";
}
