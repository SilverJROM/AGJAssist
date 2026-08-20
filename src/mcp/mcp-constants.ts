import { MCP_PUBLIC_HOST_DEFAULT, MCP_TOKEN_TTL_DAYS_DEFAULT, MCP_TOKEN_TTL_DAYS_MAX, MCP_TOKEN_TTL_DAYS_MIN } from "../config/config.js";

export const MCP_TOOL_NAMES = [
  "list_sessions",
  "read_session",
  "send_message",
  "send_keys",
  "upload_image",
  "read_image"
] as const;

export type McpToolName = (typeof MCP_TOOL_NAMES)[number];

export const MCP_PERMISSION_SET: ReadonlySet<McpToolName> = new Set(MCP_TOOL_NAMES);

export const MCP_ERROR = {
  sessionNotFound: { code: "mcp_session_not_found", text: "Session not found" },
  imageNotFound: { code: "mcp_image_not_found", text: "Image not found" },
  toolDenied: { code: "mcp_tool_denied", text: "Tool denied" },
  rateLimited: { code: "mcp_rate_limited", text: "Rate limited" }
} as const;

export const MCP_AUTH_CODE_TTL_MS = 10 * 60 * 1000;
export const MCP_ACCESS_TOKEN_TTL_DAYS_MIN = MCP_TOKEN_TTL_DAYS_MIN;
export const MCP_ACCESS_TOKEN_TTL_DAYS_MAX = MCP_TOKEN_TTL_DAYS_MAX;
export const MCP_ACCESS_TOKEN_TTL_DAYS_DEFAULT = MCP_TOKEN_TTL_DAYS_DEFAULT;
export const MCP_REFRESH_TOKEN_TTL_DAYS = 30;

export const MCP_IMAGE_MIME: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp"
};

export const MCP_IMAGE_EXTENSIONS = Object.freeze(Object.keys(MCP_IMAGE_MIME));

export const MCP_PUBLIC_HOST = MCP_PUBLIC_HOST_DEFAULT;
export const MCP_LOOPBACK_PORT = 3101;
export const MCP_ALLOWED_LOOPBACK_HOSTS = ["localhost", "127.0.0.1"] as const;

/** Canonical origins the AS advertises / accepts (tunnel host is https, any inbound port). */
export const MCP_ALLOWED_ORIGINS = [
  "http://localhost:3101",
  "http://127.0.0.1:3101",
  `https://${MCP_PUBLIC_HOST}`
] as const;

export const MCP_CLIENT_NAME_MIN = 1;
export const MCP_CLIENT_NAME_MAX = 80;
export const MCP_MAX_REDIRECT_URIS = 5;
