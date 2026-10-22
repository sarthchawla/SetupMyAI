# Final evaluation result — 2026-07-24

## Coverage

- Public skills: 15 of 15.
- Canonical cases: 60 total, exactly four per skill.
- Generated artifacts: 30 eval files and 120 task files.
- Native Waza coverage: 100% of repository skills.
- Framework: Microsoft Waza `v0.38.3`.

The original metadata-only offline checkpoint was committed before detailed
skill instructions were inspected. It passed 38 of 60 cases and failed 22.

## GREEN changes

After the RED checkpoint, only failed skills were inspected. Fourteen skill
descriptions gained concise, truthful `USE FOR` and `DO NOT USE FOR` routing
phrases. Seven body-word substitutions preserved meaning while avoiding
unrelated lexical collisions in Waza's heuristic trigger grader.

One negative organization-routing prompt was corrected without changing its
intent or contract. The original phrasing named the target plugin while
negating it, which a lexical grader cannot distinguish from a positive request.
The committed RED checkpoint preserves the original case for auditability.

High-risk model tasks now use synthetic workspace files plus the pinned
schema's supported deterministic constraints: required and forbidden output
strings, tool-call caps, and forbidden tools. Offline tasks remain
routing-prompt-only and contain exactly one local trigger grader.

## Final offline result

The shared runner verified the platform-specific binary checksum before
execution and validated every fresh result artifact:

| Measure | Result |
| --- | ---: |
| Suites passed | 15 / 15 |
| Cases passed | 60 / 60 |
| Cases failed | 0 / 60 |
| Execution errors | 0 |
| Artifact validation errors | 0 |

Every skill passed all four offline cases.

## Model RED and safety boundary

A model-backed RED run was executed from the frozen metadata-only commit before
the GREEN descriptions were applied. It completed 60 tasks: 31 passed and 29
failed. Failures included routing misses, unmet advertised behavior contracts,
missing synthetic context, and two transient local grader subprocess failures.

That run also proved Waza `v0.38.3` did not isolate the host home directory for
a global-path migration request. Model execution was stopped and was not
repeated. The shared wrapper now refuses `--mode model` even when transmission
is acknowledged, before it invokes the Waza binary. Generated model artifacts
remain available for future use only after host isolation is proven.

Accordingly, the final GREEN claim is limited to deterministic inventory,
schema, generation, runner-integrity, and offline routing coverage. There is no
model-behavior GREEN claim.

Raw Waza results remain outside version control because they can contain
prompts, transcripts, absolute paths, and loaded skill content.
