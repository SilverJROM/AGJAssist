import crypto from "node:crypto";

export interface TelegramWebAppUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export function validateTelegramInitData(
  initData: string,
  botToken: string
): TelegramWebAppUser | null {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;

  params.delete("hash");

  const entries = Array.from(params.entries());
  entries.sort(([a], [b]) => a.localeCompare(b));
  const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join("\n");

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();

  const computedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  if (computedHash !== hash) return null;

  const authDate = params.get("auth_date");
  if (authDate) {
    const authTimestamp = Number(authDate);
    const now = Math.floor(Date.now() / 1000);
    if (now - authTimestamp > 86400) return null;
  }

  const userJson = params.get("user");
  if (!userJson) return null;

  try {
    return JSON.parse(userJson) as TelegramWebAppUser;
  } catch {
    return null;
  }
}
