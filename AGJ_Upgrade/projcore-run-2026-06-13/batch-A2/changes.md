# Batch A2 Changes

## Feature Statement

Added a single app-owned provider registry and resolver for provider/model launch metadata. The registry is typed TypeScript under `src/config/providers.ts`; `PROVIDERS.md` is a derived human-readable companion and is not parsed by the app.

## Code Changes

- `src/config/providers.ts`
  - Defines the provider registry schema and seeds `grok`, `codex`, and `claude` with launch templates, bypass flags, effort mechanisms, callback mechanisms, worktree support, session suffixes, model capability bands, and role eligibility.
  - Exports `generateProvidersMarkdown()` so the companion document can be regenerated from the typed registry.

- `src/services/provider-resolver-service.ts`
  - Adds `ProviderResolverService`.
  - Resolves `agent { provider, model, effort }` into concrete launch specs.
  - Resolves `{ role, band }` into an eligible provider/model from the registry.
  - Allows resolver tests and future callers to inject an extended registry, proving provider additions are data-only.

- `PROVIDERS.md`
  - Adds the derived human-readable registry document for operators.
  - Labels `src/config/providers.ts` as the single source of truth.

- `tests/unit/provider-resolver-service.spec.ts`
  - Covers launch specs for `grok`, `codex`, and `claude`.
  - Covers role+band selection.
  - Covers dummy provider extension without resolver code changes.
  - Covers failure outcomes for unknown provider/model and invalid effort.

- `AGJ_Upgrade/projcore-run-2026-06-13/decisions/2026-06-13-provider-registry-format.md`
  - Records the approved structured TypeScript registry decision.

## Commits

- `[batch-A2] PROVIDERS registry + resolver | scenarios: A2`
