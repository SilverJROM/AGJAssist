# Provider Registry Format

## Decision

Use `src/config/providers.ts` as the single source of truth for provider launch metadata, with `PROVIDERS.md` as a derived human-readable companion document.

## Why

The resolver needs reliable structured input, and the app already keeps runtime configuration in TypeScript under `src/config`. A typed registry avoids introducing a YAML/TOML parser dependency and lets TypeScript validate the provider schema at build time.

## Consequences

- Adding a provider for resolver behavior is one edit to the TypeScript registry.
- `PROVIDERS.md` is documentation only and is explicitly labeled as derived.
- Tests can prove provider extensibility by injecting an extended registry without changing resolver code.
