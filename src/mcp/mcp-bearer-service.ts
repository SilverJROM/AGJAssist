import { TmuxService } from "../tmux/tmux-service.js";
import type { McpToolName } from "./mcp-constants.js";
import { McpGrantService, type McpGrantRow } from "./mcp-grant-service.js";
import { McpScopeService } from "./mcp-scope-service.js";
import { McpTokenService, type McpGrantBinding } from "./mcp-token-service.js";
import { mcpAudience } from "./oauth-metadata.js";

export interface McpBearerContext {
  binding: McpGrantBinding;
  grant: McpGrantRow;
  permissions: ReadonlySet<McpToolName>;
  effectiveScope: readonly string[];
}

export class McpBearerService {
  constructor(
    private readonly tokens: McpTokenService,
    private readonly grants: McpGrantService,
    private readonly scope: McpScopeService,
    private readonly tmux: TmuxService
  ) {}

  async resolve(
    authorizationHeader: string | string[] | null | undefined,
    origin: string
  ): Promise<McpBearerContext | null> {
    const binding = this.tokens.verifyAccessToken(authorizationHeader, mcpAudience(origin));
    if (!binding) return null;

    const grant = this.grants.get(binding.grantId);
    if (
      !grant ||
      grant.status !== "active" ||
      grant.clientId !== binding.clientId ||
      grant.grantedBy !== binding.grantedBy
    ) {
      return null;
    }

    let effectiveScope: string[] = [];
    try {
      const panes = await this.tmux.listPanes();
      effectiveScope = this.scope.resolve(grant, panes.map((pane) => pane.session));
    } catch {
      effectiveScope = [];
    }

    return {
      binding,
      grant,
      permissions: new Set(grant.permissions),
      effectiveScope
    };
  }
}
