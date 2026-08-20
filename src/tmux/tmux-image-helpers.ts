export const ATTACH_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const ATTACH_IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp"]);

export function sanitizeAttachImageBasename(filename: string): string | null {
  const raw = String(filename || "");
  const base = raw.replace(/\\/g, "/").split("/").pop() || "";
  const strippedDots = base.replace(/\.\./g, "");
  const cleaned = strippedDots.replace(/[^A-Za-z0-9._-]/g, "");
  if (!cleaned) return null;
  const dot = cleaned.lastIndexOf(".");
  if (dot <= 0 || dot === cleaned.length - 1) return null;
  const ext = cleaned.slice(dot + 1).toLowerCase();
  if (!ATTACH_IMAGE_EXTS.has(ext)) return null;
  const stem = cleaned.slice(0, dot).replace(/^\.+/, "") || "image";
  if (!stem) return null;
  return `${stem}.${ext}`;
}

export function utcAttachStamp(): string {
  return new Date().toISOString().replace(/[-:.]/g, "");
}

export function decodeAttachImageBase64(dataBase64: string): Buffer | null {
  const stripped = String(dataBase64 || "").replace(/^data:[^,]+,/, "").replace(/\s+/g, "");
  if (!stripped || !/^[A-Za-z0-9+/]+=*$/.test(stripped)) return null;
  const buf = Buffer.from(stripped, "base64");
  if (!buf.length) return null;
  return buf;
}
