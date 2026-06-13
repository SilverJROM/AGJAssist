# Batch A2 Scenarios

## A2-TS-001 Agent launch spec resolution

Given an agent assignment with provider, model, and optional effort, the provider resolver returns the concrete launch command, bypass flag, effort flag, callback mechanism, session suffix, and worktree support from the registry.

## A2-TS-002 Role and band model selection

Given a requested role and capability band, the provider resolver returns an eligible provider and model according to the registry tags.

## A2-TS-003 One-edit provider extensibility

Given a registry object extended with a dummy provider, the resolver can select and launch the dummy provider without any resolver code changes.

## A2-TS-004 Registry validation failures

Given an unknown provider, unknown model, or invalid provider-specific effort value, the resolver throws a clear error instead of returning a partial launch spec.
