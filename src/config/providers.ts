export const PROVIDER_BANDS = ["cheap-fast", "mid", "frontier", "auditor"] as const;
export type ProviderBand = (typeof PROVIDER_BANDS)[number];

export const PROVIDER_ROLES = [
  "implementer",
  "validator",
  "deliberation",
  "red-team",
  "planner",
  "coordinator",
  "routine-implementer",
  "panelist"
] as const;
export type ProviderRole = (typeof PROVIDER_ROLES)[number];

export interface ProviderModelDefinition {
  model: string;
  band: ProviderBand;
  eligibleRoles: ProviderRole[];
  sessionSuffix?: string;
}

export interface ProviderLaunchDefinition {
  defaultMode: "tui" | "headless" | "skill";
  templates: {
    tui?: string;
    headless?: string;
    skill?: string;
  };
}

export interface ProviderEffortDefinition {
  mechanism: string;
  flagTemplate: string | null;
  allowedValues?: string[];
}

export interface ProviderWorktreeDefinition {
  supported: boolean;
  flag: string | null;
}

export interface ProviderDefinition {
  provider: string;
  launch: ProviderLaunchDefinition;
  bypassFlag: string | null;
  effort: ProviderEffortDefinition;
  callbackMechanism: string;
  worktree: ProviderWorktreeDefinition;
  sessionSuffix: string;
  models: ProviderModelDefinition[];
}

export type ProviderRegistry = Record<string, ProviderDefinition>;

export const PROVIDERS = {
  grok: {
    provider: "grok",
    launch: {
      defaultMode: "tui",
      templates: {
        tui: "grok --always-approve --agent <agent> --effort <effort>",
        headless: "grok -p <prompt> -m <model>"
      }
    },
    bypassFlag: "--always-approve",
    effort: {
      mechanism: "--effort",
      flagTemplate: "--effort <effort>",
      allowedValues: ["low", "medium", "high", "xhigh", "max"]
    },
    callbackMechanism: "status-file",
    worktree: {
      supported: true,
      flag: "-w"
    },
    sessionSuffix: "grok",
    models: [
      {
        model: "grok-build",
        band: "frontier",
        eligibleRoles: ["implementer", "validator", "deliberation", "red-team"]
      },
      {
        model: "grok-compose-2.5-fast",
        band: "cheap-fast",
        eligibleRoles: ["routine-implementer", "panelist"]
      }
    ]
  },
  codex: {
    provider: "codex",
    launch: {
      defaultMode: "tui",
      templates: {
        tui: "codex -m <model> --dangerously-bypass-approvals-and-sandbox"
      }
    },
    bypassFlag: "--dangerously-bypass-approvals-and-sandbox",
    effort: {
      mechanism: "-m / /model",
      flagTemplate: "-m <model>"
    },
    callbackMechanism: "callbacks.md + emit-status",
    worktree: {
      supported: false,
      flag: null
    },
    sessionSuffix: "codex",
    models: [
      {
        model: "gpt-5.5",
        band: "auditor",
        eligibleRoles: ["validator", "coordinator", "deliberation"],
        sessionSuffix: "codex55"
      },
      {
        model: "gpt-5.4",
        band: "mid",
        eligibleRoles: ["implementer", "validator", "deliberation"]
      },
      {
        model: "gpt-5.3-codex-spark",
        band: "cheap-fast",
        eligibleRoles: ["implementer", "panelist"]
      }
    ]
  },
  claude: {
    provider: "claude",
    launch: {
      defaultMode: "skill",
      templates: {
        skill: "/<skill>"
      }
    },
    bypassFlag: null,
    effort: {
      mechanism: "thinking markers",
      flagTemplate: "thinking:<effort>"
    },
    callbackMechanism: "callbacks.md + emit-status",
    worktree: {
      supported: false,
      flag: null
    },
    sessionSuffix: "claude",
    models: [
      {
        model: "claude-opus-4-8",
        band: "auditor",
        eligibleRoles: ["coordinator", "validator"],
        sessionSuffix: "opus"
      },
      {
        model: "claude-sonnet-4-6",
        band: "mid",
        eligibleRoles: ["implementer"],
        sessionSuffix: "sonnet"
      },
      {
        model: "claude-haiku-4-5",
        band: "cheap-fast",
        eligibleRoles: ["panelist"],
        sessionSuffix: "haiku"
      }
    ]
  }
} satisfies ProviderRegistry;

export function generateProvidersMarkdown(registry: ProviderRegistry = PROVIDERS): string {
  const lines = [
    "# PROVIDERS Registry",
    "",
    "Derived from `src/config/providers.ts`, which is the single source of truth for provider launch behavior.",
    "Regenerate this document from the typed registry when the registry changes; resolver behavior does not parse this file.",
    ""
  ];

  for (const provider of Object.values(registry)) {
    lines.push(`## ${provider.provider}`, "");
    lines.push(`- Launch mode: ${provider.launch.defaultMode}`);
    for (const [mode, template] of Object.entries(provider.launch.templates)) {
      if (template) lines.push(`- ${mode} launch: \`${template}\``);
    }
    lines.push(`- Bypass flag: ${formatNullable(provider.bypassFlag)}`);
    lines.push(`- Effort: ${provider.effort.mechanism}`);
    lines.push(`- Effort flag: ${formatNullable(provider.effort.flagTemplate)}`);
    if (provider.effort.allowedValues?.length) {
      lines.push(`- Effort values: ${provider.effort.allowedValues.join(", ")}`);
    }
    lines.push(`- Callback: ${provider.callbackMechanism}`);
    lines.push(
      `- Worktree: ${provider.worktree.supported ? `supported (${provider.worktree.flag})` : "not supported"}`
    );
    lines.push(`- Session suffix: ${provider.sessionSuffix}`, "");
    lines.push("| Model | Band | Eligible roles | Session suffix |");
    lines.push("| --- | --- | --- | --- |");
    for (const model of provider.models) {
      lines.push(
        `| ${model.model} | ${model.band} | ${model.eligibleRoles.join(", ")} | ${
          model.sessionSuffix ?? provider.sessionSuffix
        } |`
      );
    }
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function formatNullable(value: string | null): string {
  return value === null ? "none" : `\`${value}\``;
}
