# Waza Skill Evaluation Suite

## Goal

Add a substantial, public-safe evaluation suite for every repository skill using
Microsoft Waza `v0.38.3`, with an auditable strict-TDD sequence.

This follow-up is stacked on `chore/skills-sync-local-codex` so it covers the
skill inventory introduced or refreshed by that sync. Its pull request will
target the sync branch and link to the sync pull request.

## Guardrails

- Cover every exact `packages/*/skills/*/SKILL.md` entry.
- Author initial cases from YAML frontmatter, package metadata, and external
  invocation expectations only.
- Do not inspect a skill body, references, rules, scripts, or generated
  instructions until the first failing evaluation baseline is recorded.
- Keep prompts, fixtures, transcripts, and reports public-safe and free of
  credentials, private paths, internal hosts, and organization-only workflows.
- Keep shared/public infrastructure and cases reusable by downstream
  repositories; downstream-only cases and fixes stay outside this repository.
- Pin Waza and verify its published checksum before execution.
- Generate an offline `mock`/trigger-only layer so routing can be evaluated
  locally without transmitting skill bodies to an external model.
- Generate model-backed artifacts only with sanitized fixtures. Deterministic
  schema, inventory, and coverage checks must remain runnable without secrets.
- Default the runner to offline mode and fail closed on model execution until
  Waza host-home isolation is proven by a regression test. An acknowledgement
  alone must not override this boundary.
- Verify the platform-specific release checksum before invoking the supplied
  Waza binary, and require fresh parseable per-suite output before reporting a
  pass.
- Require a new output directory to be empty and a reused directory to carry a
  valid versioned runner-ownership manifest before removing prior artifacts.

## TDD Sequence

1. RED — inventory contract
   - Add tests that require exact `SKILL.md` casing, unique skill names, and a
     one-to-one mapping between repository skills and Waza suites.
   - Run the tests and record the expected failure.
   - Implement only the metadata/frontmatter inventory needed to pass.
2. RED — evaluation contract
   - Add tests that require varied cases for every skill: success behavior,
     boundary or negative-trigger behavior, constraints, and safety where
     applicable.
   - Run the tests and record the expected failure.
   - Add Waza `eval.yaml` and task files generated from the blind metadata-only
     case designs.
3. RED — Waza baseline
   - Validate every suite with Waza `v0.38.3` through the local mock executor
     and trigger grader, then attempt the approval-gated model path only when
     host isolation is proven.
   - Run all suites against the real skill behavior and save a sanitized
     baseline summary before reading any skill body.
   - Commit the cases and failing-baseline evidence as a dedicated checkpoint.
4. GREEN — narrow skill improvements
   - Inspect detailed skill instructions only for failed cases.
   - Make the smallest public-safe changes needed to fulfill each skill's
     advertised behavior.
   - Re-run the affected suite after each vertical slice.
5. GREEN — complete verification
   - Run deterministic contracts, all Waza suites, existing Node tests, Bats,
     package validation, diff checks, and public-safety scans.
   - Report skill/case coverage, initial failures, narrow fixes, residual
     limitations, and final results.

## Planned Layout

```text
evals/
  README.md
  baseline/
  lib/
  <package>/<skill>/
    eval.yaml
    mock.eval.yaml
    tasks/*.yaml
    mock-tasks/*.yaml
scripts/
  waza-evals.js
```

The Node runner exposes deterministic inventory/coverage validation and
orchestrates the pinned Waza binary. Model-backed specs remain generated for
future isolated execution, but the shared wrapper currently refuses to run
them.

## Validation Commands

```bash
pnpm test:eval
pnpm test
pnpm test:bats
pnpm test:validate
pnpm test:all
waza coverage --format markdown
node scripts/waza-evals.js run --mode offline --waza /path/to/pinned/waza
git diff --check
```
