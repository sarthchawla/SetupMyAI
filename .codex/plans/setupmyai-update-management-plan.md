# SetupMyAi Update Management

## Summary
Add first-class install state, status, and update commands for SetupMyAi-managed agent assets. The CLI will know what packages were installed, which tools they target, whether they are user-level or project-level, whether bundled content has changed, and whether the CLI itself has a newer npm release.

## Key Changes
- Track managed installs in SetupMyAi state so status and update commands can report installed packages, target tools, install level, missing files, local edits, and package drift.
- Update installed packages through a one-shot command, with `sync` kept as an alias for update behavior.
- Add npm-backed CLI version detection so `setupmyai status` can report whether a newer public CLI exists and `setupmyai update` can prompt before running the global self-update command.
- Include Codex plugin inventory paths when scanning installed assets.

## Test Plan
- Unit tests for state read/write, hashing, user/project path resolution, and legacy discovery.
- Installer tests for manifest entries after project and user installs across `claude`, `cursor`, and `codex`.
- Status/update tests for current, missing, modified, outdated, dry-run, package-filtered, and all-installed update behavior.
- Self-update tests with mocked npm registry responses.
- Run `pnpm test` and package validation when `pnpm` is available in the execution environment.

## Assumptions
- This is a shared/public feature and must stay free of organization-only details.
- The public repository keeps its existing public npm release configuration.
