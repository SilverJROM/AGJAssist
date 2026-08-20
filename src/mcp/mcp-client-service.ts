import crypto from "node:crypto";
import { DatabaseService } from "../db/database.js";
import {
  MCP_CLIENT_NAME_MAX,
  MCP_CLIENT_NAME_MIN,
  MCP_MAX_REDIRECT_URIS
} from "./mcp-constants.js";

export class McpClientRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpClientRegistrationError";
  }
}

export interface McpClientRow {
  id: string;
  client_name: string;
  redirect_uris: string[];
  token_endpoint_auth_method: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  last_used_at: string | null;
}

interface RegisterInput {
  client_name?: unknown;
  redirect_uris?: unknown;
  token_endpoint_auth_method?: unknown;
  [key: string]: unknown;
}

function isLoopbackHttpHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1";
}

/** Validate a redirect URI. Persist the original `raw` string, never a decoded form. */
export function validateRedirectUriRaw(raw: unknown): asserts raw is string {
  if (typeof raw !== "string" || raw.length === 0) {
    throw new McpClientRegistrationError("redirect_uri must be a non-empty string");
  }
  if (raw.includes("*") || raw.includes("#") || raw.includes("\\")) {
    throw new McpClientRegistrationError("redirect_uri rejected");
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new McpClientRegistrationError("redirect_uri rejected");
  }
  if (parsed.username || parsed.password || parsed.hash) {
    throw new McpClientRegistrationError("redirect_uri rejected");
  }
  const protocol = parsed.protocol.toLowerCase();
  if (protocol === "javascript:" || protocol === "data:" || protocol === "file:") {
    throw new McpClientRegistrationError("redirect_uri rejected");
  }
  if (protocol === "https:") {
    if (parsed.hostname === "0.0.0.0" || parsed.hostname.includes(":")) {
      throw new McpClientRegistrationError("redirect_uri rejected");
    }
    return;
  }
  if (protocol === "http:") {
    if (!isLoopbackHttpHost(parsed.hostname)) {
      throw new McpClientRegistrationError("redirect_uri rejected");
    }
    if (!parsed.port) {
      throw new McpClientRegistrationError("redirect_uri rejected");
    }
    return;
  }
  throw new McpClientRegistrationError("redirect_uri rejected");
}

export class McpClientService {
  constructor(private readonly db: DatabaseService) {}

  register(input: RegisterInput): McpClientRow {
    const name = typeof input.client_name === "string" ? input.client_name.trim() : "";
    if (name.length < MCP_CLIENT_NAME_MIN || name.length > MCP_CLIENT_NAME_MAX) {
      throw new McpClientRegistrationError("client_name must be 1..80 characters");
    }
    if (!Array.isArray(input.redirect_uris) || input.redirect_uris.length === 0) {
      throw new McpClientRegistrationError("redirect_uris is required");
    }
    if (input.redirect_uris.length > MCP_MAX_REDIRECT_URIS) {
      throw new McpClientRegistrationError("too many redirect_uris");
    }
    const rawUris: string[] = [];
    for (const uri of input.redirect_uris) {
      validateRedirectUriRaw(uri);
      rawUris.push(uri);
    }
    if (input.token_endpoint_auth_method != null && input.token_endpoint_auth_method !== "none") {
      throw new McpClientRegistrationError("token_endpoint_auth_method must be none");
    }
    const id = crypto.randomUUID();
    const metadata: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      if (key === "client_name" || key === "redirect_uris" || key === "token_endpoint_auth_method") continue;
      metadata[key] = value;
    }
    const metadataJson = Object.keys(metadata).length ? JSON.stringify(metadata) : null;
    this.db
      .prepare(
        `INSERT INTO mcp_clients (id, client_name, redirect_uris, token_endpoint_auth_method, metadata)
         VALUES (?, ?, ?, 'none', ?)`
      )
      .run(id, name, JSON.stringify(rawUris), metadataJson);
    const row = this.get(id);
    if (!row) throw new McpClientRegistrationError("failed to persist client");
    return row;
  }

  get(id: string): McpClientRow | null {
    const row = this.db
      .prepare(
        `SELECT id, client_name, redirect_uris, token_endpoint_auth_method, metadata, created_at, last_used_at
         FROM mcp_clients WHERE id = ?`
      )
      .get(id) as
      | {
          id: string;
          client_name: string;
          redirect_uris: string;
          token_endpoint_auth_method: string;
          metadata: string | null;
          created_at: string;
          last_used_at: string | null;
        }
      | undefined;
    if (!row) return null;
    let uris: string[] = [];
    try {
      const parsed = JSON.parse(row.redirect_uris) as unknown;
      uris = Array.isArray(parsed) ? parsed.map((u) => String(u)) : [];
    } catch {
      uris = [];
    }
    let metadata: Record<string, unknown> | null = null;
    if (row.metadata) {
      try {
        const parsed = JSON.parse(row.metadata) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          metadata = parsed as Record<string, unknown>;
        }
      } catch {
        metadata = null;
      }
    }
    return {
      id: row.id,
      client_name: row.client_name,
      redirect_uris: uris,
      token_endpoint_auth_method: row.token_endpoint_auth_method,
      metadata,
      created_at: row.created_at,
      last_used_at: row.last_used_at
    };
  }

  list(): McpClientRow[] {
    const ids = this.db.prepare("SELECT id FROM mcp_clients ORDER BY created_at").all() as { id: string }[];
    return ids.map((row) => this.get(row.id)).filter((row): row is McpClientRow => row != null);
  }

  /** Refuse delete when the client has grant history so audit rows stay anchored. */
  remove(id: string): "missing" | "in_use" | "deleted" {
    if (!this.get(id)) return "missing";
    const n = (
      this.db.prepare("SELECT COUNT(*) AS n FROM mcp_grants WHERE client_id = ?").get(id) as { n: number }
    ).n;
    if (n > 0) return "in_use";
    this.db.prepare("DELETE FROM mcp_clients WHERE id = ?").run(id);
    return "deleted";
  }
}
