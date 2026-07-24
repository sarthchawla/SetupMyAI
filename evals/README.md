# Skill evaluations

This directory contains [Microsoft Waza](https://github.com/microsoft/waza)
evaluations for every public skill shipped by this repository.

## Coverage and source policy

`cases.yaml` is the canonical case inventory. Each skill has four varied cases:
a clear success case, a paraphrased or boundary case, a negative-routing case,
and a constraint or safety case.

The initial cases were written from each skill's YAML frontmatter and
external-facing invocation metadata only. The skill bodies and supporting
instructions were deliberately not inspected until after the first failing
baseline was recorded. `lib/inventory.js` preserves that boundary by streaming
only the YAML frontmatter and closing the file as soon as the second delimiter
is reached.

Run the deterministic repository checks with:

```sh
pnpm eval:generate
pnpm test:eval
pnpm test:waza-schema
```

Generated Waza files carry a header directing contributors back to
`cases.yaml`; do not edit them directly.

## Execution modes

The suite has two intentionally separate modes:

- **Offline routing:** `mock.eval.yaml` uses Waza's local `mock` executor and
  heuristic `trigger` graders only. Its schema-required model value is inert:
  this mode makes no model execution or API calls and is safe for private skill
  bodies.
- **Model-backed behavior:** `eval.yaml` uses the Copilot SDK executor plus
  prompt graders to assess the response contract. Running it transmits prompts
  and loaded skill instructions to the configured model provider, so obtain any
  required approval first.

After installing the pinned Waza binary, run:

```sh
pnpm eval:run:offline -- --waza /path/to/waza
pnpm eval:run -- --waza /path/to/waza
```

Use `--output-dir` to keep raw Waza results outside the repository when they
may contain prompts, transcripts, absolute paths, or loaded skill content.
`evals/results/` is ignored for the same reason. Only sanitized aggregate
baseline reports belong in version control.

## Waza version

`waza.lock.yaml` pins Waza `v0.38.3` and the release checksums for each
supported binary. It also pins the immutable official eval and task schemas;
`pnpm test:waza-schema` downloads them, verifies their SHA-256 checksums, and
validates every generated Waza artifact. Download the matching binary from the official
[Waza releases](https://github.com/microsoft/waza/releases/tag/v0.38.3), verify
its SHA-256 checksum, and make it executable.

Example for Apple Silicon:

```sh
curl -fSLO https://github.com/microsoft/waza/releases/download/v0.38.3/waza-darwin-arm64
printf '%s  %s\n' \
  '99aa4366b198f319145cffeef42d500eb9f6178235a0537d34c19dd8f2f46fec' \
  'waza-darwin-arm64' | shasum -a 256 --check
chmod +x waza-darwin-arm64
```

## Native coverage

Waza's coverage report can scan all package roots:

```sh
waza coverage . \
  --path packages/auth-security/skills \
  --path packages/bdd-testing/skills \
  --path packages/database/skills \
  --path packages/react-frontend/skills \
  --path packages/universal/skills \
  --path evals \
  --format json
```

The repository test suite additionally verifies the exact 15-skill inventory,
all 60 canonical cases, the generated grader schema, and resolvable skill
directories.
