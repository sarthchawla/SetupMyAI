# Behavioral skill evaluations

Run a baseline and candidate on identical blind review inputs, then independently adjudicate each emitted explanation against a frozen semantic oracle. A rule ID, file or line match alone earns no credit. Complete execution and demonstrated improvement are separate results.

```sh
pnpm exec node --test scripts/skill-eval/*.test.js cli/lib/skill-reconciler.test.js
pnpm exec node scripts/skill-eval/index.js \
  --cases scripts/skill-eval/fixtures/smoke-cases.json \
  --baseline-skill scripts/skill-eval/fixtures/baseline \
  --candidate-skill scripts/skill-eval/fixtures/candidate \
  --adapter scripts/skill-eval/fixtures/smoke-adapter.json \
  --judge-adapter scripts/skill-eval/fixtures/smoke-adapter.json \
  --output /private/tmp/skill-eval-smoke.json
```

Smoke fixtures exercise wiring only and always remain ineligible for promotion. The fabricated `promotion-fixture.js` supports gate unit tests; it is not model evidence. Keep private source cases, guidance snapshots and reports outside this directory and public repositories.

## Runtime

`codex-adapter.js` requires explicit `--model MODEL --reasoning-effort EFFORT`. The sample configuration pins a verified compatible selection; verify account access with a harmless probe before using it for private review. No global model/settings are changed. The observed model is the runtime-confirmed service alias; an immutable backend model snapshot is not exposed. The wrapper uses isolated configuration, an empty workspace, read-only ephemeral execution, disabled tool surfaces and runtime-confirmed model/effort/version. It fails closed on unsupported settings, unknown identity or remaining inherited skills. Current CLI/account support, rather than a stale bundled model list, determines compatibility.

Adapter JSON: `{command, args: string[], mode: "model" | "smoke", model, reasoningEffort, timeoutMs?, maxOutputBytes?}`. Commands use `spawn` without a shell; relative script arguments resolve from the configuration directory. Pin the same settings for both arms. Before a promotable run, also set `runtimeCommand` to the resolved Codex executable path and `runtimeBinaryHash` to its SHA256 in each adapter config. Execution checks the observed path/hash against those predeclared values. The portable sample omits machine-specific binary pins and therefore cannot promote until configured. Use `--adapter adapter.json --judge-adapter judge.json`; the reviewer and judge may use separate pinned configurations.

The CLI writes private reports atomically. Exit zero means execution completed; inspect the promotion gate separately. A failed execution retains partial findings and never becomes a clean review.

## Cases and holdouts

Version 1 cases remain runnable for smoke/legacy measurement but cannot promote. Version 2 adds a semantic oracle and whole-MR context. See `fixtures/smoke-cases.json` for the base shape. Each case has:

```json
{
  "id": "stable-case", "split": "development", "kind": "offending",
  "ruleIds": ["check-id"], "pairId": "defect-pair",
  "source": {
    "mrId": "project!123", "defectGroupId": "same-underlying-defect",
    "createdAt": "2026-01-01T00:00:00Z", "disposition": "accepted_and_fixed"
  },
  "code": {"file": "src/a.js", "content": "return items.length;"},
  "context": "Caller contract: items may be null.",
  "reviewContext": {
    "scope": "whole-mr", "baseRevision": "base", "headRevision": "head",
    "diff": "complete bounded review diff", "contracts": ["Nullable input contract"],
    "files": [{"file": "src/a.js", "content": "return items.length;"}, {"file": "src/caller.js", "content": "count(null);"}]
  },
  "expectedFindings": [{
    "ruleId": "check-id", "file": "src/a.js", "lineStart": 1, "lineEnd": 1,
    "defect": "Null input throws at length access", "scope": "Nullable input path",
    "remedy": "Guard the nullable input before dereferencing"
  }]
}
```

Top level: `{version: 2, evidenceKind: "real" | "synthetic", rules: [{id, description, evidenceFindingIds?}], holdout: {frozenAt, author, independentFromGuidance: true}, cases}`. Every tested rule needs offending/corrected pairs and clean/rejected/boundary controls in both splits. Real pairs additionally require source `findingId`, `urls`, `acceptanceEvidence` and `fixEvidence`; all real cases require provenance URLs. Rejected dispositions are `pushed_back`, `false_positive` or `withdrawn`. A resolved flag alone does not establish acceptance.

Split by MR and underlying defect group. Every heldout MR must be newer than every development MR. Freeze guidance and independent holdouts before model execution; never tune against heldout outputs. Retain useful baseline-positive targets alongside candidate-specific defects. Holdout metadata records authoring discipline, which schema checks cannot prove. Whole-MR context must include a diff, revisions, at least two unique files, and caller/contracts information; it cannot certify omitted repository context as complete.

The reviewer sees only selected guidance, neutral code/context, full supplied MR context and rule IDs. Rule descriptions, labels, disposition, case kind/split, expected defects and opposite-arm outputs are withheld. Do not put adjudication hints in code/context. The judge sees the code/context, expected semantic targets and findings, with no arm identity or guidance.

## Semantic adjudication

The judge receives `task: "adjudicate_findings"` and returns:

```json
{"judgments":[{"actualIndex":0,"expectedIndex":0,"defect":true,"scope":true,"remedy":true,"reason":"Code-grounded explanation of the matching mechanism, consequence and scoped remedy"}],"model":{"name":"observed-model","runtime":"runtime","version":"version","effectiveReasoningEffort":"medium"}}
```

Every actual finding needs exactly one judgment; `expectedIndex: null` means unmatched. True positives require all three decisions plus target alignment. Duplicate claims cannot inflate recall. Wrong explanations, scope overreach and invalid remedies are false positives and leave the expected target missed. Useful adjacent findings outside the frozen oracle remain unmatched; retain their explanations and disclose oracle limitations instead of changing labels after execution. Model adjudication is fallible: audit disagreements and retain the original outputs.

Without a semantic judge, execution can complete but emitted findings earn no TP credit and promotion is blocked. `matchFindings` never falls back to location matching.

## Promotion and bindings

Thresholds freeze before the first execution. Defaults: heldout recall 1, recall gain at least 0.05, at least one additional heldout TP, zero false positives in both splits, and no loss of any individual useful baseline target. `--policy thresholds.json` can predeclare alternative positive gain/FP thresholds; zero gain and unknown options are rejected. A tie cannot establish improvement.

Reports retain exact suite/oracle bytes and their hash, full baseline/candidate tree hashes, selected guidance hashes, adapter/judge executable and script hashes, observed per-case runtimes, the frozen policy, semantic decisions, metrics and result hashes. `validatePromotionEvidence(report)` recomputes suite coverage, matching, metrics, nonregression and gain; reconciliation calls the same gate. Old reports, missing controls, relabeled outcomes, unbound edits, drifted settings and fabricated eligibility flags fail closed. Hashes bind saved evidence, not the honesty of a trusted adapter or adjudicator.

Guidance allowlists remain mandatory when skill packages contain evals/results/oracles. `--guidance-manifest manifest.json` accepts exactly `{version:1, baselineFiles:["SKILL.md",...], candidateFiles:["SKILL.md",...]}`. Safe relative paths, complete selected-file hashes, no symlinks and no evaluation artifacts are required. Full tree hashes still include auxiliary files. Keep reports outside evaluated directories. Renaming/disguising natural-language answers cannot be ruled out automatically; audit selections.

## Integration

The Node CLI/library is shared by editor clients. Cursor and Codex should invoke this same interface rather than fork scorers. Central skill entrypoint/installation owners supply approved guidance snapshots, private cases, pinned adapter configs and promotion policy; rerun after guidance changes. This runner does not install skills, modify collectors/schedules, merge MRs or run an optimizer.
