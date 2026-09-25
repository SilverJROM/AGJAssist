import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseService } from "../../src/db/database.js";
import { AuthService } from "../../src/auth/auth-service.js";

const TEST_DB = path.join("data", "test-xmachines-session-revocation.sqlite");
const BOT_TOKEN = "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11";
const JWT_SECRET = "test-secret";

function cleanup(): void {
  for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

function createInitData(user: Record<string, unknown>, botToken: string): string {
  const userJson = JSON.stringify(user);
  const authDate = Math.floor(Date.now() / 1000).toString();
  const params = new URLSearchParams();
  params.set("user", userJson);
  params.set("auth_date", authDate);
  const entries = Array.from(params.entries());
  entries.sort(([a], [b]) => a.localeCompare(b));
  const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join("\n");
  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  params.set("hash", hash);
  return params.toString();
}

describe("xmachines session revocation", () => {
  let db: DatabaseService;
  let auth: AuthService;

  beforeEach(() => {
    cleanup();
    db = new DatabaseService(TEST_DB);
    db.ensureOwner(111222);
    // Short lifetime for power-capable web sessions
    auth = new AuthService(db, BOT_TOKEN, JWT_SECRET, 1);
  });

  afterEach(() => {
    db.close();
    cleanup();
  });

  it("L6f DB/schema check: power-capable web sessions have short configured lifetime", () => {
    const initData = createInitData({ id: 111222, first_name: "Test" }, BOT_TOKEN);
    const res = auth.authenticateTelegram(initData, "web");
    expect(res).not.toBeNull();
    // Verify session row exists with expires_at within short window
    const userRow = db.prepare("SELECT id FROM users WHERE telegram_id = ?").get(111222) as { id: number };
    const rows = db.prepare("SELECT expires_at, surface FROM sessions WHERE user_id = ?").all(userRow.id) as { expires_at: string; surface: string }[];
    expect(rows.length).toBeGreaterThan(0);
    const row = rows[0];
    expect(row!.surface).toBe("web");
    const expires = new Date(row!.expires_at).getTime();
    const now = Date.now();
    const diffHours = (expires - now) / 3600000;
    // With sessionExpiryHours = 1, expires within ~1h
    expect(diffHours).toBeGreaterThan(0.9);
    expect(diffHours).toBeLessThan(1.1);
  });

  it("L6g HTTP auth matrix: revoke all web sessions invalidates prior tokens immediately", () => {
    const initData = createInitData({ id: 111222, first_name: "Test" }, BOT_TOKEN);
    const res1 = auth.authenticateTelegram(initData, "web");
    const res2 = auth.authenticateTelegram(initData, "miniapp");
    expect(res1).not.toBeNull();
    expect(res2).not.toBeNull();
    const token1 = res1!.token;
    const token2 = res2!.token;
    expect(auth.verifyToken(token1)).not.toBeNull();
    expect(auth.verifyToken(token2)).not.toBeNull();

    // Revoke all web sessions for user
    const userRow = db.prepare("SELECT id FROM users WHERE telegram_id = ?").get(111222) as { id: number };
    const deleted = auth.revokeAllWebSessions(userRow.id);
    expect(deleted).toBeGreaterThanOrEqual(2);

    // Prior tokens must fail immediately
    expect(auth.verifyToken(token1)).toBeNull();
    expect(auth.verifyToken(token2)).toBeNull();
  });
});
