interface Logger {
  log(message?: unknown, ...optionalParams: unknown[]): void;
  error(message?: unknown, ...optionalParams: unknown[]): void;
}

export interface TelegramStarter {
  start(): Promise<void>;
}

const NETWORK_CODES = new Set([
  "ETIMEDOUT",
  "ESOCKETTIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "EAI_AGAIN",
  "ENOTFOUND",
  "ENETUNREACH",
  "EHOSTUNREACH"
]);

let processGuardsInstalled = false;

export function isTelegramNetworkError(error: unknown): boolean {
  const parts = collectErrorParts(error);
  const haystack = parts.join("\n").toLowerCase();
  const codes = collectErrorCodes(error);

  const hasNetworkCode = codes.some((code) => NETWORK_CODES.has(code.toUpperCase()));
  const hasTelegramRequestMarker =
    haystack.includes("node-telegram-bot-api") ||
    haystack.includes("request-promise-core") ||
    haystack.includes("@cypress/request") ||
    haystack.includes("api.telegram.org");
  const hasRequestErrorName =
    haystack.includes("requesterror") ||
    haystack.includes("aggregateerror");
  const hasNetworkMessage =
    haystack.includes("timed out") ||
    haystack.includes("timeout") ||
    haystack.includes("socket hang up") ||
    haystack.includes("getaddrinfo") ||
    haystack.includes("aggregateerror");

  return hasTelegramRequestMarker && (hasNetworkCode || hasRequestErrorName || hasNetworkMessage);
}

export function installTelegramProcessGuards(logger: Logger = console): void {
  if (processGuardsInstalled) return;
  processGuardsInstalled = true;

  process.on("unhandledRejection", (reason) => {
    if (isTelegramNetworkError(reason)) {
      logger.error("Non-fatal Telegram network rejection:", formatError(reason));
      return;
    }

    logger.error("Unhandled rejection:", formatError(reason));
  });

  process.on("uncaughtException", (error) => {
    if (isTelegramNetworkError(error)) {
      logger.error("Non-fatal Telegram network exception:", formatError(error));
      return;
    }

    logger.error("Fatal uncaught exception:", formatError(error));
    process.exit(1);
  });
}

export async function startTelegramNonFatal(
  telegramAssistant: TelegramStarter | null,
  logger: Logger = console
): Promise<boolean> {
  if (!telegramAssistant) {
    logger.log("AGJAssist booted in TEST_MODE=true (Telegram polling not started)");
    return false;
  }

  try {
    await telegramAssistant.start();
    logger.log("AGJAssist Telegram bot started");
    return true;
  } catch (error) {
    logger.error(
      "Telegram bot startup failed; API, dashboard, and Overmind watcher remain online:",
      formatError(error)
    );
    return false;
  }
}

export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack || error.message;
  }
  return String(error);
}

function collectErrorParts(error: unknown, seen = new Set<unknown>()): string[] {
  if (!error || seen.has(error)) return [];
  seen.add(error);

  if (error instanceof Error) {
    const parts = [
      error.name,
      error.message,
      error.stack || ""
    ];
    const withCause = error as Error & { cause?: unknown; errors?: unknown[]; code?: unknown };
    if (withCause.code) parts.push(String(withCause.code));
    if (withCause.cause) parts.push(...collectErrorParts(withCause.cause, seen));
    if (Array.isArray(withCause.errors)) {
      for (const nested of withCause.errors) {
        parts.push(...collectErrorParts(nested, seen));
      }
    }
    return parts;
  }

  if (typeof error === "object") {
    const record = error as Record<string, unknown>;
    const parts = Object.entries(record)
      .filter(([key]) => ["name", "message", "stack", "code"].includes(key))
      .map(([, value]) => String(value));
    if (record.cause) parts.push(...collectErrorParts(record.cause, seen));
    if (Array.isArray(record.errors)) {
      for (const nested of record.errors) {
        parts.push(...collectErrorParts(nested, seen));
      }
    }
    return parts;
  }

  return [String(error)];
}

function collectErrorCodes(error: unknown, seen = new Set<unknown>()): string[] {
  if (!error || seen.has(error)) return [];
  seen.add(error);

  if (typeof error !== "object") return [];

  const record = error as Record<string, unknown>;
  const codes = typeof record.code === "string" ? [record.code] : [];
  if (record.cause) codes.push(...collectErrorCodes(record.cause, seen));
  if (Array.isArray(record.errors)) {
    for (const nested of record.errors) {
      codes.push(...collectErrorCodes(nested, seen));
    }
  }
  return codes;
}
