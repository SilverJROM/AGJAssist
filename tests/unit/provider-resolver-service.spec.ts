import { describe, expect, it } from "vitest";
import { PROVIDERS, ProviderRegistry } from "../../src/config/providers.js";
import {
  ProviderResolverService,
  resolveAgentLaunchSpec,
  resolveProviderModelForRoleBand
} from "../../src/services/provider-resolver-service.js";

describe("ProviderResolverService", () => {
  it("returns concrete launch specs for the seeded real providers", () => {
    expect(
      resolveAgentLaunchSpec({
        provider: "grok",
        model: "grok-build",
        effort: "xhigh",
        agent: "builder"
      })
    ).toEqual({
      provider: "grok",
      model: "grok-build",
      launch_cmd: "grok --always-approve --agent builder --effort xhigh",
      bypass_flag: "--always-approve",
      effort_flag: "--effort xhigh",
      callback_mechanism: "status-file",
      session_suffix: "grok",
      worktree_support: {
        supported: true,
        flag: "-w"
      }
    });

    expect(
      resolveAgentLaunchSpec({
        provider: "codex",
        model: "gpt-5.5"
      })
    ).toEqual({
      provider: "codex",
      model: "gpt-5.5",
      launch_cmd: "codex -m gpt-5.5 --dangerously-bypass-approvals-and-sandbox",
      bypass_flag: "--dangerously-bypass-approvals-and-sandbox",
      effort_flag: "-m gpt-5.5",
      callback_mechanism: "callbacks.md + emit-status",
      session_suffix: "codex55",
      worktree_support: {
        supported: false,
        flag: null
      }
    });

    expect(
      resolveAgentLaunchSpec({
        provider: "claude",
        model: "claude-sonnet-4-6",
        effort: "high",
        skill: "dev"
      })
    ).toEqual({
      provider: "claude",
      model: "claude-sonnet-4-6",
      launch_cmd: "/dev",
      bypass_flag: null,
      effort_flag: "thinking:high",
      callback_mechanism: "callbacks.md + emit-status",
      session_suffix: "sonnet",
      worktree_support: {
        supported: false,
        flag: null
      }
    });
  });

  it("selects an eligible provider model by role and band", () => {
    expect(resolveProviderModelForRoleBand({ role: "implementer", band: "frontier" })).toEqual({
      provider: "grok",
      model: "grok-build"
    });

    expect(resolveProviderModelForRoleBand({ role: "coordinator", band: "auditor" })).toEqual({
      provider: "codex",
      model: "gpt-5.5"
    });

    expect(resolveProviderModelForRoleBand({ role: "panelist", band: "cheap-fast" })).toEqual({
      provider: "grok",
      model: "grok-compose-2.5-fast"
    });
  });

  it("proves adding a provider is one registry edit", () => {
    const registry: ProviderRegistry = {
      ...PROVIDERS,
      dummy: {
        provider: "dummy",
        launch: {
          defaultMode: "tui",
          templates: {
            tui: "dummy-agent --model <model> --name <agent>"
          }
        },
        bypassFlag: "--dummy-bypass",
        effort: {
          mechanism: "--level",
          flagTemplate: "--level <effort>"
        },
        callbackMechanism: "dummy-callback",
        worktree: {
          supported: true,
          flag: "--worktree"
        },
        sessionSuffix: "dummy",
        models: [
          {
            model: "dummy-frontier",
            band: "frontier",
            eligibleRoles: ["planner"]
          }
        ]
      }
    };
    const resolver = new ProviderResolverService(registry);

    expect(resolver.resolveProviderModelForRoleBand({ role: "planner", band: "frontier" })).toEqual({
      provider: "dummy",
      model: "dummy-frontier"
    });
    expect(
      resolver.resolveAgentLaunchSpec({
        provider: "dummy",
        model: "dummy-frontier",
        effort: "max",
        agent: "dummy-planner"
      })
    ).toMatchObject({
      launch_cmd: "dummy-agent --model dummy-frontier --name dummy-planner",
      bypass_flag: "--dummy-bypass",
      effort_flag: "--level max",
      callback_mechanism: "dummy-callback",
      session_suffix: "dummy",
      worktree_support: {
        supported: true,
        flag: "--worktree"
      }
    });
  });

  it("rejects unknown providers, models, and invalid provider-specific effort bands", () => {
    expect(() =>
      resolveAgentLaunchSpec({ provider: "unknown", model: "grok-build" })
    ).toThrow(/Unknown provider/);
    expect(() =>
      resolveAgentLaunchSpec({ provider: "grok", model: "missing" })
    ).toThrow(/Unknown model/);
    expect(() =>
      resolveAgentLaunchSpec({ provider: "grok", model: "grok-build", effort: "extreme" })
    ).toThrow(/Invalid effort/);
  });
});
