import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { MCP_ERROR, MCP_TOOL_NAMES, type McpToolName } from "./mcp-constants.js";
import type { McpBearerContext } from "./mcp-bearer-service.js";
import { listSessions, readSession, type McpToolServices } from "./mcp-tools.js";

const TOOL_DESCRIPTIONS: Readonly<Record<McpToolName, string>> = {
  list_sessions: "List the live terminal sessions available to this grant",
  read_session: "Read output from an available terminal session",
  send_message: "Send a safety-checked message to an available terminal session",
  send_keys: "Send allowlisted named keys to an available terminal session",
  upload_image: "Upload an image within an available session's project",
  read_image: "Read an image within an available session's project"
};

export type McpServerFactoryDeps = McpToolServices;

function stubDenied() {
  return {
    content: [{ type: "text" as const, text: MCP_ERROR.toolDenied.text }],
    isError: true as const,
    structuredContent: { code: MCP_ERROR.toolDenied.code }
  };
}

export function createMcpServerForRequest(
  context: McpBearerContext,
  deps: McpServerFactoryDeps
): McpServer {
  const server = new McpServer({ name: "agjassist", version: "0.1.0" });

  for (const toolName of MCP_TOOL_NAMES) {
    if (!context.permissions.has(toolName)) continue;
    if (toolName === "list_sessions") {
      server.registerTool(toolName, { description: TOOL_DESCRIPTIONS[toolName] }, async () =>
        listSessions(context, deps)
      );
      continue;
    }
    if (toolName === "read_session") {
      server.registerTool(
        toolName,
        {
          description: TOOL_DESCRIPTIONS[toolName],
          inputSchema: {
            session: z.string(),
            lines: z.number().int().min(20).max(2000).optional(),
            raw: z.boolean().optional()
          }
        },
        async (args) => readSession(context, deps, args)
      );
      continue;
    }
    server.registerTool(toolName, { description: TOOL_DESCRIPTIONS[toolName] }, async () =>
      stubDenied()
    );
  }

  if (context.permissions.size === 0) {
    server.server.registerCapabilities({ tools: {} });
    server.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }));
  }

  return server;
}
