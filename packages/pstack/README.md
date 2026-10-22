# pstack

Optional shared/public bundle of all 56 [pstack skills](https://github.com/backnotprop/pstack/tree/e44668c2aad92eacf4e84df47984121fefb11b82/skills), including 24 principles. The source is pinned to [`e44668c2aad92eacf4e84df47984121fefb11b82`](https://github.com/backnotprop/pstack/commit/e44668c2aad92eacf4e84df47984121fefb11b82) (upstream plugin version 0.15.28).

Install the complete bundle so sibling skill references resolve:

```sh
setupmyai install --tool codex pstack
```

Choose another supported tool with `--tool`. Installing does not invoke a skill, activate `poteto-mode`, change model settings, or create automations. Invoke `/poteto-help` for guidance or explicitly request `/poteto-mode` for its workflows. `/setup-pstack` is optional and confirms model choices before writing its settings file (`~/.agents/pstack-models.md` in Codex). Only that setup skill allows automatic invocation from matching requests; the other 55 preserve upstream's `disable-model-invocation: true` and include Codex-native `agents/openai.yaml` with `policy.allow_implicit_invocation: false`.

## Runtime requirements

Reading skills needs no extra runtime. Optional executable workflows need:

- Bun and authenticated GitHub CLI (`gh`) for `poteto-mode/scripts/watch-pr/watch-pr`. Its first run installs dependencies with `bun install --frozen-lockfile`; the pinned package and lockfile are retained.
- Bun, Git, and GitHub CLI or Origin for the orchestration CLI in `poteto-mode/scripts/orch/`.
- Node.js for `poteto-mode/scripts/check-plan.mjs`.
- Bash for `show-me-your-work/scripts/log.sh`; Bash, Git, and jq for `poteto-mode/scripts/worktree-audit.sh` (GitHub CLI or Origin adds PR data).

These tools are retained, never run by the installer. Upstream workflows can create commits, PRs, messages, settings, and cleanup actions when invoked; the host's permissions and the user's instructions still apply. The upstream Harness section supplies fallbacks for Cursor-specific tools and unavailable models.

## Provenance and refresh

[MIT LICENSE](LICENSE), copyright 2026 Lauren Tan. Every installed skill includes the same license. `UPSTREAM.json` records the repository, revision, and SHA-256 of every package file except itself.

From the repository root, regenerate from the pinned Git objects or verify the existing package:

```sh
node scripts/vendor-pstack.mjs [upstream-checkout]
node scripts/vendor-pstack.mjs --check [upstream-checkout]
```

Omitting the checkout clones upstream into a temporary bare repository. The script reads committed blobs at the pin, so local source edits cannot enter the bundle. It rebuilds this generated package and never installs dependencies or executes upstream scripts.

The complete recursive `skills/` tree is retained. To keep help portable after individual skill folders are installed, upstream README and docs (including images) live inside `poteto-help/`. The skill prose changes only in help/documentation paths, and 55 Codex policy files preserve upstream's explicit-invocation intent. Sibling skill links remain local; optional Cursor agent and automation pack links point to the pinned upstream files. Those optional packs are not installed or enabled.
