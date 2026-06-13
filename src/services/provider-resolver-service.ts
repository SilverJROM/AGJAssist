import {
  PROVIDERS,
  ProviderBand,
  ProviderDefinition,
  ProviderRegistry,
  ProviderRole
} from "../config/providers.js";

export interface AgentLaunchRequest {
  provider: string;
  model: string;
  effort?: string | null;
  agent?: string;
  prompt?: string;
  skill?: string;
  mode?: "tui" | "headless" | "skill";
}

export interface ProviderLaunchSpec {
  provider: string;
  model: string;
  launch_cmd: string;
  bypass_flag: string | null;
  effort_flag: string | null;
  callback_mechanism: string;
  session_suffix: string;
  worktree_support: {
    supported: boolean;
    flag: string | null;
  };
}

export interface RoleBandRequest {
  role: ProviderRole;
  band: ProviderBand;
}

export interface ProviderModelSelection {
  provider: string;
  model: string;
}

export class ProviderResolverService {
  constructor(private readonly registry: ProviderRegistry = PROVIDERS) {}

  resolveAgentLaunchSpec(input: AgentLaunchRequest): ProviderLaunchSpec {
    const provider = this.requireProvider(input.provider);
    const model = provider.models.find((candidate) => candidate.model === input.model);
    if (!model) {
      throw new Error(`Unknown model for provider ${input.provider}: ${input.model}`);
    }

    const mode = input.mode ?? provider.launch.defaultMode;
    const template = provider.launch.templates[mode];
    if (!template) {
      throw new Error(`Provider ${input.provider} does not define a ${mode} launch template`);
    }

    return {
      provider: provider.provider,
      model: model.model,
      launch_cmd: fillTemplate(template, {
        agent: input.agent ?? model.model,
        effort: normalizeEffort(input.effort),
        model: model.model,
        prompt: input.prompt ?? "",
        skill: input.skill ?? roleSkillForModel(model.model)
      }),
      bypass_flag: provider.bypassFlag,
      effort_flag: renderEffortFlag(provider, model.model, input.effort),
      callback_mechanism: provider.callbackMechanism,
      session_suffix: model.sessionSuffix ?? provider.sessionSuffix,
      worktree_support: { ...provider.worktree }
    };
  }

  resolveProviderModelForRoleBand(input: RoleBandRequest): ProviderModelSelection {
    for (const provider of Object.values(this.registry)) {
      const model = provider.models.find(
        (candidate) =>
          candidate.band === input.band && candidate.eligibleRoles.includes(input.role)
      );
      if (model) {
        return {
          provider: provider.provider,
          model: model.model
        };
      }
    }

    throw new Error(`No provider model is eligible for role ${input.role} at band ${input.band}`);
  }

  private requireProvider(providerId: string): ProviderDefinition {
    const provider = this.registry[providerId];
    if (!provider) {
      throw new Error(`Unknown provider: ${providerId}`);
    }
    return provider;
  }
}

export function resolveAgentLaunchSpec(
  input: AgentLaunchRequest,
  registry: ProviderRegistry = PROVIDERS
): ProviderLaunchSpec {
  return new ProviderResolverService(registry).resolveAgentLaunchSpec(input);
}

export function resolveProviderModelForRoleBand(
  input: RoleBandRequest,
  registry: ProviderRegistry = PROVIDERS
): ProviderModelSelection {
  return new ProviderResolverService(registry).resolveProviderModelForRoleBand(input);
}

function renderEffortFlag(
  provider: ProviderDefinition,
  model: string,
  effortInput?: string | null
): string | null {
  if (!provider.effort.flagTemplate) return null;
  const effort = normalizeEffort(effortInput);

  if (provider.effort.allowedValues?.length && !provider.effort.allowedValues.includes(effort)) {
    throw new Error(
      `Invalid effort for provider ${provider.provider}: ${effort}. Expected one of ${provider.effort.allowedValues.join(", ")}`
    );
  }

  return fillTemplate(provider.effort.flagTemplate, {
    agent: model,
    effort,
    model,
    prompt: "",
    skill: roleSkillForModel(model)
  });
}

function normalizeEffort(effort?: string | null): string {
  return effort?.trim() || "medium";
}

function roleSkillForModel(model: string): string {
  if (model.includes("opus")) return "lead";
  if (model.includes("sonnet")) return "fast_lead";
  if (model.includes("haiku")) return "qa";
  return "lead";
}

function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/<([a-z_]+)>/g, (match, key) => {
    if (!(key in values)) {
      throw new Error(`Unknown launch template token: ${match}`);
    }
    return shellQuoteIfNeeded(values[key]);
  });
}

function shellQuoteIfNeeded(value: string): string {
  if (value === "") return "''";
  if (/^[A-Za-z0-9._/@:=+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}
