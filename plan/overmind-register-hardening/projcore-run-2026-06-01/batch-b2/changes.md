# Batch B2 Changes

- Added a uniform register rejection envelope for attach-register 4xx failures while preserving legacy `error` fields.
- Added live `validProjects` guidance for `no-project-for-run-dir`, derived from `overmindService.listProjects()` as `[{ slug, app_path }]`.
- Added field-specific corrective guidance for `forbidden-derived-field`, pointing agents to `GET /api/overmind/register/describe`.
- Updated route tests to assert the rejection outcomes and corrective hints.
