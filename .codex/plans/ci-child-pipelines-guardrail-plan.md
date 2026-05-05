# CI Child Pipelines Guardrail Plan

## Goal

Make MR/CI monitoring commands treat GitLab child pipelines as part of CI, not as optional follow-up context.

## Scope

- Update `packages/universal/commands/fix-ci.md`.
- Update `packages/universal/commands/monitor-mr.md`.
- Mirror the same shared/public command updates in `SetupMyAi` and `SetupMyAi-public`.

## Behavior

- For GitLab, after finding the latest parent pipeline, inspect bridge jobs for downstream child pipelines.
- Include every child pipeline status when deciding whether CI is green, running, pending, or failed.
- When fixing CI, collect failed jobs from both the parent pipeline and all discovered child pipelines.
- Do not report CI as green until the parent pipeline and every child pipeline succeeded.
