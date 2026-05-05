# Remove Private Review Automation Plan

## Goal

Keep public command documentation free of private review automation details while preserving shared CI monitoring behavior.

## Scope

- Update `packages/universal/commands/monitor-mr.md` in `SetupMyAi-public`.
- Remove the public plan that described private review automation.

## Result

- Public `/monitor-mr` keeps normal review-comment handling and child-pipeline CI checks.
- Private review automation remains only in the private GitLab repository.
