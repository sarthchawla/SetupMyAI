# SetupMyAi Installed Inventory And Update Plan

## Summary

Add first-class installed-state tracking so `setupmyai` can report what packages, skills, rules, commands, hooks, agents, MCP configs, and plugins are installed at user or project level, detect drift/outdated items, and update everything with one command.

## Key Changes

- Add an install manifest written by `installPackage()` at the same target level as the install:
  - project: `<project>/.setupmyai/installed.yml`
  - user: `~/.setupmyai/installed.yml`
  - Each record stores package key/name/version, tool, level, primitive type, destination path, source package path, source hash, installed hash, installed timestamp, and install mode.
- Add inventory APIs in a new CLI library module:
  - discover installed manifests for `--level project`, `--level user`, or `--level all`
  - scan actual target directories for unmanaged items under `.claude`, `.cursor`, `.codex`, `.opencode`, `.gemini`
  - compare installed hashes with current packaged source hashes
  - classify each item as `current`, `outdated`, `modified`, `missing`, `unmanaged`, or `orphaned`
- Replace the current broad `sync` behavior with update semantics:
  - `setupmyai status --dir <project> --level all --tool all`
  - `setupmyai update --dir <project> --level all --tool all`
  - `setupmyai update --check` exits non-zero when updates are needed
  - `setupmyai update --dry-run` prints planned changes without writing
  - keep `setupmyai sync` as a backwards-compatible alias that delegates to `update`
- Keep source-repo import sync separate:
  - existing `scanner.js` and `syncer.js` remain for maintaining SetupMyAi package sources
  - consumer install/update state must not use `sources.yml` or mtime comparison
- For modified installed files, default behavior is conservative:
  - report as `modified`
  - skip overwrite unless `--force` is passed
  - show exact path and package source that would overwrite it

## CLI Behavior

- `setupmyai list` continues listing available packages, and gains `--installed` for installed package summary.
- `setupmyai status` prints grouped output by level, tool, package, and status, with `--json` for automation.
- `setupmyai update` updates only items with manifest-backed provenance unless `--include-unmanaged` is explicitly added later.
- One-shot command:
  - `setupmyai update --level all --tool all --dir .`
  - updates user-level and project-level installs for all tools detected in manifests.

## Tests

- Unit test manifest creation during install for project and user levels.
- Unit test status classification for current, outdated, modified, missing, unmanaged, and orphaned files.
- Unit test update behavior for safe overwrite, skip modified, and `--force`.
- CLI smoke tests for `status --json`, `update --dry-run`, `update --check`, and `sync` alias.
- Regression test that scripts/hooks/MCP merge behavior still records provenance without clobbering unrelated user config.

## Assumptions

- Installed-state manifests are SetupMyAi-owned and may be rewritten by SetupMyAi.
- Unmanaged files are reported but not updated in v1.
- Hash comparison is based on final installed content, after Cursor `.md` to `.mdc` conversion.
- Public/shared implementation is mirrored to the private repository; private-only package content remains private.
