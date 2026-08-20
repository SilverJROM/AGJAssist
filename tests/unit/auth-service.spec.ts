import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import { DatabaseService } from "../../src/db/database.js";
import { AuthService } from "../../src/auth/auth-service.js";
import fs from "node:fs";
import path from "node:path";

const TEST_DB = path.join("data", "test-auth.sqlite");
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

describe("AuthService", () => {
  let db: DatabaseService;
  let auth: AuthService;

  beforeEach(() => {
    cleanup();
    db = new DatabaseService(TEST_DB);
    db.ensureOwner(111222);
    auth = new AuthService(db, BOT_TOKEN, JWT_SECRET, 24);
  });

  afterEach(() => {
    db.close();
    cleanup();
  });

  it("authenticates valid Telegram initData", () => {
    const initData = createInitData(
      { id: 111222, first_name: "Test", username: "testuser" },
      BOT_TOKEN
    );

    const result = auth.authenticateTelegram(initData, "web");

    expect(result).not.toBeNull();
    expect(result!.user.telegramId).toBe(111222);
    expect(result!.user.role).toBe("owner");
    expect(result!.token).toBeTruthy();
  });

  it("rejects invalid initData hash", () => {
    const initData = createInitData(
      { id: 111222, first_name: "Test" },
      "wrong-token"
    );

    const result = auth.authenticateTelegram(initData, "web");
    expect(result).toBeNull();
  });

  it("rejects unauthorized user", () => {
    const initData = createInitData(
      { id: 999999, first_name: "Stranger" },
      BOT_TOKEN
    );

    const result = auth.authenticateTelegram(initData, "web");
    expect(result).toBeNull();
  });

  it("verifies issued token", () => {
    const initData = createInitData(
      { id: 111222, first_name: "Test" },
      BOT_TOKEN
    );

    const authResult = auth.authenticateTelegram(initData, "web");
    expect(authResult).not.toBeNull();

    const user = auth.verifyToken(authResult!.token);
    expect(user).not.toBeNull();
    expect(user!.telegramId).toBe(111222);
  });

  it("rejects invalid token", () => {
    const user = auth.verifyToken("invalid-token");
    expect(user).toBeNull();
  });

  it("logout invalidates session", () => {
    const initData = createInitData(
      { id: 111222, first_name: "Test" },
      BOT_TOKEN
    );

    const authResult = auth.authenticateTelegram(initData, "web")!;
    auth.logout(authResult.token);

    const user = auth.verifyToken(authResult.token);
    expect(user).toBeNull();
  });

  it("manages users", () => {
    const added = auth.addUser(333444, "viewer");
    expect(added.role).toBe("viewer");

    const users = auth.listUsers();
    expect(users.length).toBe(2); // owner + viewer

    const removed = auth.removeUser(333444);
    expect(removed).toBe(true);

    // Cannot remove owner
    const ownerRemoved = auth.removeUser(111222);
    expect(ownerRemoved).toBe(false);
  });

  it("rejects an active non-owner (viewer) even with valid initData (owner-only)", () => {
    auth.addUser(333444, "viewer");
    const initData = createInitData(
      { id: 333444, first_name: "Viewer", username: "viewer" },
      BOT_TOKEN
    );
    // Valid signature + active row, but role !== owner -> no token.
    expect(auth.authenticateTelegram(initData, "miniapp")).toBeNull();
    expect(auth.authenticateTelegram(initData, "web")).toBeNull();
  });
});
