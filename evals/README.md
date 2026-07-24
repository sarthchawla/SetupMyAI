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
pnpm eval:check-generated
pnpm test:eval
pnpm test:waza-schema
```

Generated Waza files carry a header directing contributors back to
`cases.yaml`; do not edit them directly. Generation also removes suite
directories no longer present in the canonical inventory. CI regenerates the
suite and fails if any tracked or untracked eval artifact changes.

## Execution modes

The suite has two intentionally separate modes:

- **Offline routing:** `mock.eval.yaml` uses Waza's local `mock` executor and
  heuristic `trigger` graders only. Its schema-required model value is inert:
  this mode makes no model execution or API calls and is safe for private skill
  bodies. The wrapper also gives the verified Waza process a temporary isolated
  `HOME`/XDG tree and a minimal non-credential environment, then removes that
  tree after the run.
- **Model-backed behavior:** `eval.yaml` uses the Copilot SDK executor plus
  prompt graders to assess the response contract. The artifacts use synthetic
  fixtures and deterministic output/tool constraints where relevant. Wrapper
  execution is currently disabled because Waza `v0.38.3` did not isolate the
  host home directory during a global-path evaluation. Do not invoke
  `eval.yaml` directly. Model mode must remain disabled until host isolation is
  proven by a regression test.

After installing the pinned Waza binary, run:

```sh
pnpm eval:run:offline -- --waza /path/to/waza
```

Invoking `node scripts/waza-evals.js run` without `--mode` is also offline by
default. Even an explicitly acknowledged model invocation fails closed before
the Waza binary is executed.

Use `--output-dir` to keep raw Waza results outside the repository when they
may contain prompts, transcripts, absolute paths, or loaded skill content.
`evals/results/` is ignored for the same reason. Only sanitized aggregate
baseline reports belong in version control. A first-run output directory must
be absent or empty. On reuse, the runner requires its exact versioned ownership
manifest and refuses any invalid manifest or undeclared directory entry without
modifying the directory. The manifest is a local ownership marker, so do not
share an output directory with another concurrent writer.

## Waza version

`waza.lock.yaml` pins Waza `v0.38.3` and the release checksums for each
supported binary. It also pins the immutable official eval and task schemas;
`pnpm test:waza-schema` downloads them, verifies their SHA-256 checksums, and
validates every generated Waza artifact. Before invoking `--version`, the runner
maps the current platform and architecture to the release asset and verifies
the binary against the matching lockfile checksum. It removes stale result
files and the prior summary only after validating the output directory's
runner-owned manifest, then requires a fresh parseable artifact whose skill,
eval, engine, task IDs, task statuses, and task counts match the loaded suite.
Result filenames include a deterministic suite-identity hash so normalized
skill-name collisions cannot overwrite one another. Download the matching
binary from the official [Waza releases](https://github.com/microsoft/waza/releases/tag/v0.38.3)
and make it executable.

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
