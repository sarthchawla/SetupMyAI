# Repo Mirroring Guardrail Plan

## Goal

Make every agent check whether a change belongs in the GitLab private repo only, or should be mirrored into both the GitLab and GitHub repos.

## Repository Roles

- `SetupMyAi`: private GitLab repo. May contain shared/public content and Agoda-only content.
- `SetupMyAi-public`: public GitHub repo. Must contain only shared/public content.

## Guardrail

Before editing, classify the intended change:

- Agoda-only: keep it only in `SetupMyAi`.
- Shared/public: apply the equivalent update in both `SetupMyAi` and `SetupMyAi-public`.

Before finishing, re-check the changed files and confirm the classification still holds.
