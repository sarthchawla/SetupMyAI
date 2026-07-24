# Metadata-only RED baseline — 2026-07-24

## Scope and sequence

- Inventory: 15 public skills, discovered from exact `SKILL.md` files.
- Cases: 60 total, four per skill.
- Framework: Microsoft Waza `v0.38.3`.
- Binary: official `waza-darwin-arm64` release asset.
- Verified SHA-256:
  `99aa4366b198f319145cffeef42d500eb9f6178235a0537d34c19dd8f2f46fec`.
- Execution layer: local `mock` executor with one heuristic `trigger` grader
  per case; no model execution, judge, or API call. The schema-required model
  label was `offline-mock`.

The case authors read only YAML frontmatter, package metadata, and directly
corresponding public invocation metadata. They attested that they did not open
skill bodies, rules, references, scripts, assets, or generated instructions.
The canonical cases were frozen before this run.

One model-backed smoke case had previously been used to correct Waza schema
integration: task-root grader placement, session-aware prompt grading, and
explicit pass/fail tool calls. That smoke did not change a case contract or a
skill. No failed case was diagnosed or tuned by inspecting its detailed skill
instructions before this baseline.

## RED result

The checksum-verified native Waza binary completed all offline cases:

| Measure | Result |
| --- | ---: |
| Skills with a complete pass | 1 / 15 |
| Cases passed | 38 / 60 |
| Cases failed | 22 / 60 |
| Execution errors | 0 |

The exact documented `pnpm eval:run:offline -- --waza ...` form was used for
the final reproduction. The conventional bare `--` separator is covered by a
regression test. All 30 eval files and 120 task files also passed the
checksum-pinned official Waza `v0.38.3` JSON Schemas.

Waza's native coverage command reported 15 of 15 skills covered (100%). Its
coverage summary counts each task glob as one entry; the repository's
deterministic coverage test expands those globs and verifies all 60 task files.

| Skill | Passed | Failed |
| --- | ---: | ---: |
| DB migrations and schema changes | 4 | 0 |
| bdd-test-workflow | 3 | 1 |
| better-auth-best-practices | 2 | 2 |
| better-auth-security-best-practices | 3 | 1 |
| component-refactoring | 1 | 3 |
| email-and-password-best-practices | 3 | 1 |
| frontend-code-review | 2 | 2 |
| frontend-testing | 3 | 1 |
| migrate-to-codex | 3 | 1 |
| nodejs-backend-patterns | 3 | 1 |
| organization-best-practices | 2 | 2 |
| postgresql-table-design | 3 | 1 |
| two-factor-authentication-best-practices | 2 | 2 |
| vercel-react-best-practices | 2 | 2 |
| web-design-guidelines | 2 | 2 |

Failed case IDs:

- `babp-02-paraphrased-positive`
- `babp-04-constraint`
- `basbp-03-boundary-negative`
- `epbp-04-safety`
- `tfabp-03-boundary-negative`
- `tfabp-04-safety`
- `bddtw-03-boundary-negative`
- `pgtd-04-constraint`
- `component-refactor-clear-positive`
- `component-refactor-negative-simple`
- `component-refactor-testing-opt-out`
- `frontend-review-paraphrased-positive`
- `frontend-review-read-only-file`
- `frontend-testing-paraphrased-positive`
- `node-backend-paraphrased-positive`
- `organization-guidance-only`
- `organization-paraphrased-positive`
- `vercel-react-paraphrased-positive`
- `vercel-react-read-only`
- `web-design-paraphrased-positive`
- `web-design-pattern-read-only`
- `migrate-codex-paraphrased-positive`

The failures include both false negatives on advertised trigger phrasing and
false positives on explicitly out-of-scope requests. The next TDD step is to
inspect only the affected skills, distinguish metadata drift from limitations
of Waza's heuristic trigger grader, make narrow public-safe corrections, and
then run the model-backed behavior contracts.

Raw Waza JSON was intentionally kept outside version control because it can
contain prompts, absolute paths, transcripts, and loaded skill content.
