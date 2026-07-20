import path from "node:path";
import crypto from "node:crypto";
import dotenv from "dotenv";

dotenv.config();

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

function optionalNumber(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid numeric env var: ${name}`);
  }
  return parsed;
}

function optionalEnum<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  if (allowed.includes(raw as T)) return raw as T;
  throw new Error(`Invalid env var: ${name}`);
}

function parseBool(value: string): boolean {
  return value.trim().toLowerCase() === "true";
}

function parseAllowedPrefixes(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface AppConfig {
  telegram: {
    botToken: string;
    authorizedUserId: number;
    authorizedChatIds: number[];
    testMode: boolean;
    updateMode: "webhook" | "polling";
    webhookUrl: string | null;
    webhookPath: string;
    webhookSecretToken: string;
  };
  runtime: {
    workspaceRoot: string;
    allowedCommandPrefixes: string[];
    maxToolIterations: number;
    defaultTimeoutMinutes: number;
  };
  api: {
    port: number;
    host: string;
    jwtSecret: string;
    sessionExpiryHours: number;
  };
  db: {
    path: string;
  };
  projects: {
    root: string;
  };
  tmux: {
    historyRetentionDays: number;
    outputBufferLines: number;
    streamIntervalMs: number;
  };
  overmind: {
    token: string;
  };
}

export function loadConfig(): AppConfig {
  const botToken = required("BOT_TOKEN");
  const authorizedUserId = Number(required("AUTHORIZED_USER_ID"));
  if (Number.isNaN(authorizedUserId)) {
    throw new Error("AUTHORIZED_USER_ID must be numeric");
  }

  let authorizedChatIds: number[] = [authorizedUserId];
  const chatIdsEnv = optional("AUTHORIZED_CHAT_IDS", "").trim();
  if (chatIdsEnv) {
    authorizedChatIds = chatIdsEnv
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0);
    if (authorizedChatIds.length === 0) {
      authorizedChatIds = [authorizedUserId];
    }
  }

  const workspaceRoot = optional("WORKSPACE_ROOT", "/home/agjrom");
  const webAppUrl = optional("WEB_APP_URL", "").replace(/\/+$/, "");
  const webhookPath = optional("TELEGRAM_WEBHOOK_PATH", "/api/telegram/webhook");
  const explicitWebhookUrl = optional("TELEGRAM_WEBHOOK_URL", "");
  const webhookUrl = explicitWebhookUrl || (webAppUrl ? `${webAppUrl}${webhookPath}` : "");
  const defaultUpdateMode = webhookUrl ? "webhook" : "polling";
  const updateMode = optionalEnum("TELEGRAM_UPDATE_MODE", ["webhook", "polling"] as const, defaultUpdateMode);
  const defaultWebhookSecret = crypto
    .createHash("sha256")
    .update(`agjassist:${botToken}`)
    .digest("hex");

  return {
    telegram: {
      botToken,
      authorizedUserId,
      authorizedChatIds,
      testMode: parseBool(optional("TEST_MODE", "false")),
      updateMode,
      webhookUrl: webhookUrl || null,
      webhookPath,
      webhookSecretToken: optional("TELEGRAM_WEBHOOK_SECRET", defaultWebhookSecret)
    },
    runtime: {
      workspaceRoot: path.resolve(workspaceRoot),
      allowedCommandPrefixes: parseAllowedPrefixes(
        optional("ALLOWED_COMMAND_PREFIXES", "tmux,ls,pwd,cat,tail,head,rg,git,npm,node,python3,pm2")
      ),
      maxToolIterations: optionalNumber("MAX_TOOL_ITERATIONS", 6),
      defaultTimeoutMinutes: optionalNumber("DEFAULT_TIMEOUT_MINUTES", 60)
    },
    api: {
      port: optionalNumber("API_PORT", 3100),
      host: optional("API_HOST", "0.0.0.0"),
      jwtSecret: optional("JWT_SECRET", "agjassist-dev-secret-change-me"),
      sessionExpiryHours: optionalNumber("SESSION_EXPIRY_HOURS", 24)
    },
    db: {
      path: optional("DB_PATH", "data/agjassist.db")
    },
    projects: {
      root: path.resolve(optional("PROJECTS_ROOT", "/home/agjrom/websites"))
    },
    tmux: {
      historyRetentionDays: optionalNumber("TMUX_HISTORY_RETENTION_DAYS", 7),
      outputBufferLines: optionalNumber("TMUX_OUTPUT_BUFFER_LINES", 5000),
      streamIntervalMs: optionalNumber("TMUX_STREAM_INTERVAL_MS", 100)
    },
    overmind: {
      token: optional("OVERMIND_TOKEN", "REDACTED_OVERMIND_TOKEN")
    }
  };
}
