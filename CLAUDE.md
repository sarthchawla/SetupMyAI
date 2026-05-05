# Claude Project Memory

## Repository Mirroring Guardrail

This workspace has two related git repositories:

- `SetupMyAi`: private GitLab repo. This repo may contain shared/public content and Agoda-only content.
- `SetupMyAi-public`: public GitHub repo. This repo must contain only shared/public content.

Before making any change, classify the intended update:

- **Agoda-only**: do not add it to `SetupMyAi-public`. Keep it only in `SetupMyAi`. This includes Agoda Jira, Agoda GitLab, Agoda Slack, Agoda analytics, internal domains, internal package registries, credentials/secrets, and anything under or specific to `packages/agoda-workflows`.
- **Shared/public**: apply the equivalent update in both `SetupMyAi-public` and `SetupMyAi`.

Before finishing, re-check the files changed in this turn and confirm the classification still holds. If a shared/public update was made in only one repo, mirror it to the sibling repo before reporting completion. If an Agoda-only detail appears here, stop and remove it instead of keeping or mirroring it.

Do not commit without explicit user approval.
