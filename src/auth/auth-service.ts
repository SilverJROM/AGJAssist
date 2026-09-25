import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import * as otplib from "otplib";
import QRCode from "qrcode";
import { DatabaseService } from "../db/database.js";
import { validateTelegramInitData, TelegramWebAppUser } from "./telegram-auth.js";

export interface SessionUser {
  id: number;
  telegramId: number;
  username: string | null;
  displayName: string | null;
  role: "owner" | "viewer";
}

export interface AuthResult {
  token: string;
  user: SessionUser;
}

interface UserRow {
  id: number;
  telegram_id: number;
  username: string | null;
  display_name: string | null;
  role: string;
  totp_secret: string | null;
  totp_enabled: number;
  active: number;
}

export class AuthService {
  private loginCodes = new Map<string, { telegramId: number; expiresAt: number; sessionHours?: number }>();

  constructor(
    private readonly db: DatabaseService,
    private readonly botToken: string,
    private readonly jwtSecret: string,
    private readonly sessionExpiryHours: number
  ) {}

  generateLoginCode(telegramId: number, sessionHours?: number): string {
    // Clean expired codes
    const now = Date.now();
    for (const [code, entry] of this.loginCodes) {
      if (entry.expiresAt < now) this.loginCodes.delete(code);
    }

    const code = crypto.randomBytes(6).toString("base64url").slice(0, 12);
    this.loginCodes.set(code, { telegramId, expiresAt: now + 5 * 60 * 1000, sessionHours });
    return code;
  }

  authenticateWithCode(code: string, totp?: string): AuthResult | null {
    const entry = this.loginCodes.get(code);
    if (!entry || entry.expiresAt < Date.now()) {
      this.loginCodes.delete(code);
      return null;
    }

    const userRow = this.db
      .prepare("SELECT * FROM users WHERE telegram_id = ? AND active = 1")
      .get(entry.telegramId) as UserRow | undefined;

    if (!userRow) return null;

    // If 2FA is enabled, verify TOTP
    if (userRow.totp_enabled && userRow.totp_secret) {
      if (!totp || !otplib.verifySync({ token: totp, secret: userRow.totp_secret }).valid) {
        return null;
      }
    }

    const sessionHours = entry.sessionHours;
    this.loginCodes.delete(code); // one-time use, only after all checks pass

    const hours = sessionHours || this.sessionExpiryHours;
    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(
      Date.now() + hours * 3600 * 1000
    ).toISOString();

    const token = jwt.sign(
      { sub: userRow.id, sid: sessionId, tid: userRow.telegram_id },
      this.jwtSecret,
      { expiresIn: `${hours}h` }
    );

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    this.db
      .prepare(
        "INSERT INTO sessions (id, user_id, token_hash, surface, expires_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run(sessionId, userRow.id, tokenHash, "web", expiresAt);

    return {
      token,
      user: {
        id: userRow.id,
        telegramId: userRow.telegram_id,
        username: userRow.username,
        displayName: userRow.display_name,
        role: userRow.role as "owner" | "viewer"
      }
    };
  }

  // ---- 2FA (TOTP) + Telegram number-match web login ----
  // start() verifies the TOTP then mints a short-lived number-match challenge; the
  // owner taps the matching number in Telegram (resolveTgChallenge), and the web
  // polls (pollTgChallenge) until it's verified, at which point a session is issued.
  private tgChallenges = new Map<string, {
    displayNumber: number;
    telegramId: number;
    expiresAt: number;
    status: "pending" | "verified" | "failed";
    sessionHours?: number;
  }>();
  private totpFailWindow = { count: 0, resetAt: 0 };

  private issueWebSession(userRow: UserRow, sessionHours?: number): AuthResult {
    const hours = sessionHours || this.sessionExpiryHours;
    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + hours * 3600 * 1000).toISOString();
    const token = jwt.sign(
      { sub: userRow.id, sid: sessionId, tid: userRow.telegram_id },
      this.jwtSecret,
      { expiresIn: `${hours}h` }
    );
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    this.db
      .prepare("INSERT INTO sessions (id, user_id, token_hash, surface, expires_at) VALUES (?, ?, ?, ?, ?)")
      .run(sessionId, userRow.id, tokenHash, "web", expiresAt);
    return {
      token,
      user: {
        id: userRow.id,
        telegramId: userRow.telegram_id,
        username: userRow.username,
        displayName: userRow.display_name,
        role: userRow.role as "owner" | "viewer"
      }
    };
  }

  /** Verify the owner's TOTP, then mint a number-match challenge to send via Telegram. */
  startTgChallenge(ownerTelegramId: number, totp: string, sessionHours?: number): {
    challengeId: string;
    displayNumber: number;
    buttons: number[];
  } | null {
    const now = Date.now();
    // Brute-force guard on the TOTP: 5 failures per 5 minutes.
    if (now > this.totpFailWindow.resetAt) this.totpFailWindow = { count: 0, resetAt: now + 5 * 60 * 1000 };
    if (this.totpFailWindow.count >= 5) return null;

    const userRow = this.db
      .prepare("SELECT * FROM users WHERE telegram_id = ? AND active = 1")
      .get(ownerTelegramId) as UserRow | undefined;
    if (!userRow || !userRow.totp_enabled || !userRow.totp_secret ||
        !totp || !otplib.verifySync({ token: totp, secret: userRow.totp_secret }).valid) {
      this.totpFailWindow.count += 1;
      return null;
    }
    this.totpFailWindow.count = 0;

    for (const [id, c] of this.tgChallenges) if (c.expiresAt < now) this.tgChallenges.delete(id);

    const challengeId = crypto.randomUUID();
    const displayNumber = 10 + Math.floor(Math.random() * 90);
    const buttons = new Set<number>([displayNumber]);
    while (buttons.size < 3) buttons.add(10 + Math.floor(Math.random() * 90));
    this.tgChallenges.set(challengeId, {
      displayNumber,
      telegramId: ownerTelegramId,
      status: "pending",
      expiresAt: now + 2 * 60 * 1000,
      sessionHours
    });
    return { challengeId, displayNumber, buttons: [...buttons].sort(() => Math.random() - 0.5) };
  }

  /** Called from the bot when the owner taps a number button. */
  resolveTgChallenge(challengeId: string, selected: number): "verified" | "failed" | "expired" | "unknown" {
    const c = this.tgChallenges.get(challengeId);
    if (!c) return "unknown";
    if (c.expiresAt < Date.now()) { this.tgChallenges.delete(challengeId); return "expired"; }
    if (c.status !== "pending") return c.status;
    c.status = selected === c.displayNumber ? "verified" : "failed";
    return c.status;
  }

  /** Polled by the web; issues a session once the challenge is verified (one-time). */
  pollTgChallenge(challengeId: string): AuthResult | { status: "pending" | "failed" | "expired" } {
    const c = this.tgChallenges.get(challengeId);
    if (!c || c.expiresAt < Date.now()) { if (c) this.tgChallenges.delete(challengeId); return { status: "expired" }; }
    if (c.status === "pending") return { status: "pending" };
    this.tgChallenges.delete(challengeId);
    if (c.status === "failed") return { status: "failed" };
    const userRow = this.db
      .prepare("SELECT * FROM users WHERE telegram_id = ? AND active = 1")
      .get(c.telegramId) as UserRow | undefined;
    if (!userRow) return { status: "failed" };
    return this.issueWebSession(userRow, c.sessionHours);
  }

  authenticateTelegram(initData: string, surface: "miniapp" | "web"): AuthResult | null {
    const tgUser = validateTelegramInitData(initData, this.botToken);
    if (!tgUser) return null;

    const userRow = this.db
      .prepare("SELECT * FROM users WHERE telegram_id = ? AND active = 1")
      .get(tgUser.id) as UserRow | undefined;

    if (!userRow) return null;
    // Owner-only: even an active non-owner row can never obtain a token.
    if (userRow.role !== "owner") return null;

    // Update user info from Telegram
    this.db
      .prepare("UPDATE users SET username = ?, display_name = ?, updated_at = datetime('now') WHERE id = ?")
      .run(
        tgUser.username || null,
        [tgUser.first_name, tgUser.last_name].filter(Boolean).join(" ") || null,
        userRow.id
      );

    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(
      Date.now() + this.sessionExpiryHours * 3600 * 1000
    ).toISOString();

    const token = jwt.sign(
      { sub: userRow.id, sid: sessionId, tid: tgUser.id },
      this.jwtSecret,
      { expiresIn: `${this.sessionExpiryHours}h` }
    );

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    this.db
      .prepare(
        "INSERT INTO sessions (id, user_id, token_hash, surface, expires_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run(sessionId, userRow.id, tokenHash, surface, expiresAt);

    return {
      token,
      user: {
        id: userRow.id,
        telegramId: tgUser.id,
        username: tgUser.username || null,
        displayName:
          [tgUser.first_name, tgUser.last_name].filter(Boolean).join(" ") || null,
        role: userRow.role as "owner" | "viewer"
      }
    };
  }

  verifyToken(token: string): SessionUser | null {
    try {
      const payload = jwt.verify(token, this.jwtSecret) as unknown as {
        sub: number;
        sid: string;
        tid: number;
      };

      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

      const session = this.db
        .prepare(
          "SELECT id FROM sessions WHERE id = ? AND token_hash = ? AND expires_at > datetime('now')"
        )
        .get(payload.sid, tokenHash) as { id: string } | undefined;

      if (!session) return null;

      // Update last activity
      this.db
        .prepare("UPDATE sessions SET last_activity = datetime('now') WHERE id = ?")
        .run(payload.sid);

      const userRow = this.db
        .prepare("SELECT * FROM users WHERE id = ? AND active = 1")
        .get(payload.sub) as UserRow | undefined;

      if (!userRow) return null;

      return {
        id: userRow.id,
        telegramId: userRow.telegram_id,
        username: userRow.username,
        displayName: userRow.display_name,
        role: userRow.role as "owner" | "viewer"
      };
    } catch {
      return null;
    }
  }

  logout(token: string): boolean {
    try {
      const payload = jwt.verify(token, this.jwtSecret, {
        ignoreExpiration: true
      }) as unknown as { sid: string };

      const result = this.db
        .prepare("DELETE FROM sessions WHERE id = ?")
        .run(payload.sid);

      return result.changes > 0;
    } catch {
      return false;
    }
  }

  getUser(userId: number): SessionUser | null {
    const row = this.db
      .prepare("SELECT * FROM users WHERE id = ? AND active = 1")
      .get(userId) as UserRow | undefined;

    if (!row) return null;

    return {
      id: row.id,
      telegramId: row.telegram_id,
      username: row.username,
      displayName: row.display_name,
      role: row.role as "owner" | "viewer"
    };
  }

  addUser(telegramId: number, role: "owner" | "viewer"): SessionUser {
    this.db
      .prepare(
        "INSERT OR IGNORE INTO users (telegram_id, role, active) VALUES (?, ?, 1)"
      )
      .run(telegramId, role);

    const row = this.db
      .prepare("SELECT * FROM users WHERE telegram_id = ?")
      .get(telegramId) as UserRow;

    return {
      id: row.id,
      telegramId: row.telegram_id,
      username: row.username,
      displayName: row.display_name,
      role: row.role as "owner" | "viewer"
    };
  }

  removeUser(telegramId: number): boolean {
    const result = this.db
      .prepare("UPDATE users SET active = 0 WHERE telegram_id = ? AND role != 'owner'")
      .run(telegramId);
    return result.changes > 0;
  }

  listUsers(): SessionUser[] {
    const rows = this.db
      .prepare("SELECT * FROM users WHERE active = 1 ORDER BY id")
      .all() as UserRow[];

    return rows.map((r) => ({
      id: r.id,
      telegramId: r.telegram_id,
      username: r.username,
      displayName: r.display_name,
      role: r.role as "owner" | "viewer"
    }));
  }

  // 2FA methods

  codeRequires2FA(code: string): boolean {
    const entry = this.loginCodes.get(code);
    if (!entry || entry.expiresAt < Date.now()) return false;

    const row = this.db
      .prepare("SELECT totp_enabled FROM users WHERE telegram_id = ? AND active = 1")
      .get(entry.telegramId) as { totp_enabled: number } | undefined;

    return row?.totp_enabled === 1;
  }

  getUserRow(userId: number): UserRow | null {
    return (this.db
      .prepare("SELECT * FROM users WHERE id = ? AND active = 1")
      .get(userId) as UserRow | undefined) ?? null;
  }

  is2FAEnabled(userId: number): boolean {
    const row = this.db
      .prepare("SELECT totp_enabled FROM users WHERE id = ?")
      .get(userId) as { totp_enabled: number } | undefined;
    return row?.totp_enabled === 1;
  }

  async setup2FA(userId: number): Promise<{ secret: string; qrDataUrl: string } | null> {
    const row = this.db
      .prepare("SELECT * FROM users WHERE id = ? AND active = 1")
      .get(userId) as UserRow | undefined;

    if (!row || row.role !== "owner") return null;

    const secret = otplib.generateSecret();
    const otpauth = otplib.generateURI({
      label: row.username || row.telegram_id.toString(),
      issuer: "AGJAssist",
      secret
    });

    const qrDataUrl = await QRCode.toDataURL(otpauth);

    // Store secret but don't enable yet — user must confirm with a valid code first
    this.db
      .prepare("UPDATE users SET totp_secret = ?, updated_at = datetime('now') WHERE id = ?")
      .run(secret, userId);

    return { secret, qrDataUrl };
  }

  confirm2FA(userId: number, token: string): boolean {
    const row = this.db
      .prepare("SELECT totp_secret FROM users WHERE id = ? AND active = 1")
      .get(userId) as { totp_secret: string | null } | undefined;

    if (!row?.totp_secret) return false;

    const valid = otplib.verifySync({ token, secret: row.totp_secret }).valid;
    if (!valid) return false;

    this.db
      .prepare("UPDATE users SET totp_enabled = 1, updated_at = datetime('now') WHERE id = ?")
      .run(userId);

    return true;
  }

  disable2FA(userId: number): boolean {
    const result = this.db
      .prepare("UPDATE users SET totp_enabled = 0, totp_secret = NULL, updated_at = datetime('now') WHERE id = ?")
      .run(userId);
    return result.changes > 0;
  }

  revokeAllWebSessions(userId: number): number {
    const result = this.db
      .prepare("DELETE FROM sessions WHERE user_id = ? AND surface IN ('web', 'miniapp')")
      .run(userId);
    return result.changes;
  }
}
