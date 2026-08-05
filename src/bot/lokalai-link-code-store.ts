import crypto from "node:crypto";

export const LOKALAI_LINK_CODE_TTL_MS = 300_000;

interface LokalaiLinkCodeEntry {
  telegramUserId: number;
  expiresAt: number;
}

export type LokalaiLinkCodeConsumeResult =
  | { ok: true; telegramUserId: number }
  | { ok: false; reason: "missing" | "expired" };

class LokalaiLinkCodeStore {
  private readonly codes = new Map<string, LokalaiLinkCodeEntry>();

  issue(telegramUserId: number, ttlMs: number = LOKALAI_LINK_CODE_TTL_MS): string {
    this.sweep();
    const code = crypto.randomBytes(9).toString("base64url");
    this.codes.set(code, { telegramUserId, expiresAt: Date.now() + ttlMs });
    return code;
  }

  consume(code: string): LokalaiLinkCodeConsumeResult {
    const entry = this.codes.get(code);
    if (!entry) return { ok: false, reason: "missing" };

    // Delete before any further check: a replayed/concurrent consume of the same
    // code sees "missing" instead of racing this call for the same entry.
    this.codes.delete(code);

    if (entry.expiresAt <= Date.now()) {
      return { ok: false, reason: "expired" };
    }

    return { ok: true, telegramUserId: entry.telegramUserId };
  }

  sweep(now = Date.now()): void {
    for (const [code, entry] of this.codes) {
      if (entry.expiresAt <= now) this.codes.delete(code);
    }
  }

  clear(): void {
    this.codes.clear();
  }
}

export const lokalaiLinkCodeStore = new LokalaiLinkCodeStore();
