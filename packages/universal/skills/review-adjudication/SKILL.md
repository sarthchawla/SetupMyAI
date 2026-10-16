---
name: review-adjudication
description: Verify generated or human review findings before fixing, defending, replying, resolving, or reusing them as learned guidance. Use within a review, review-comment fix, monitor, or readiness workflow.
---

# Review adjudication

Use one evidence gate for findings from every reviewer. This procedure is extracted from the existing preflight workflow; it does not replace that workflow's specialist checks, acceptance thresholds, or coverage requirements. Review-only requests stay read-only. Existing authorization and repository instructions govern edits, commits, replies and resolutions.

## Verify the claim and each remedy

Separate generation from judgment. For every candidate, record a stable ID, exact base/head or working-diff identity, affected contract/callers, proposed remedy and concrete failure sequence. Recheck the diff, surrounding implementation, tests, repository rules and verified product intent; actively seek counterevidence. Reviewer confidence, a resolved thread or an initial corrective commit is not proof.

Split a comment that proposes multiple remedies into independently judged child IDs. A real defect does not validate every suggested change. Merge same-defect reports only when one correction covers the same failure mechanism, retaining reviewer/source IDs and all affected locations.

Assign each claim/remedy:

- `FIX`: real, in scope and sufficiently evidenced; apply the smallest root-cause correction when authorized.
- `DEFEND`: a plausible reviewer claim or remedy is wrong, inapplicable, already handled or conflicts with verified intent; preserve sound code and prepare a concise evidence-backed reply.
- `DISCARD`: duplicate, withdrawn or rejected by the applicable review guardrails; retain the reason and any link to the surviving claim.
- `CLARIFY`: missing intent, ownership, runtime or contract evidence could change the decision; investigate or ask a focused question before editing that claim.

When challenged, reopen the judgment and show supporting evidence, counterevidence, current decision and what fact would change it. A remembered judgment is a lead, never authority. Revalidate against current code, requirements, tests and reviewer baseline before reuse.

## Validate and retain the outcome

Apply only authorized `FIX` remedies. Run proportionate checks and inspect the final diff, including sibling callers. Mark a remedy `FIXED` only after its correction is present and validation passes at the recorded final revision. A failed or unavailable check remains explicit; it cannot become a successful validation record.

Track each remedy separately through proposed, applied, validated, retained, rejected, removed or reverted outcomes. After later commits/review, compare the final retained code with the proposed correction. Keep rejected/reverted outcomes and superseding evidence; do not silently overwrite history or count an initial fix, thread resolution or accepted sibling remedy as final acceptance.

Only a source-verified, validated correction retained in the final reviewed revision can support a learned positive rule. If final retention is unavailable, record it as unverified and defer that learning. Rejected or reverted suggestions remain counterexamples with their actual scope; they do not imply a universal ban. Future guidance changes still require their own approval and evaluation.

## Keep one local ledger

Resolve `git rev-parse --git-common-dir` to an absolute path. Read existing adjudication ledgers under its `codex/` directory and reuse the applicable ledger, including a workflow's legacy ledger path. If none exists, use `<git-common-dir>/codex/review-adjudications.md`. Keep it outside tracked files; create it only for finalized reusable judgments. If storage is unavailable, disclose session-only retention.

Record finalized `DEFEND`, validated `FIXED` and materially reusable `DISCARD` outcomes, including rejected/reverted remedies. Keep active `FIX`/`CLARIFY` in the run report until settled. Each ledger record needs:

- Repository identity, stable parent/child IDs, semantic claim signature, symbols/contracts, reviewer/prompt family and baseline.
- Exact reviewed revision, decisive evidence and counterevidence, checks/results, relevant confirmed intent and invalidating conditions.
- Judgment, per-remedy lifecycle/final retention, source/comment/fix/final-revision references, date and superseded-entry link when applicable.
- Prepared reply when useful. Store concise reasoning and references, never credentials, secrets, PII or raw logs.

## Act and report within authorization

Draft replies from current evidence. Post or resolve only when the user has authorized those actions; human-reply restrictions from the calling workflow still apply. Claim a remote fix only after the validated correction is present at the published revision. Resolve a mixed thread only when every child remedy is settled; an unresolved child stays visible.

Report unresolved `FIX` as `NOT READY`, unresolved `CLARIFY` or missing required validation as `BLOCKED`, and verified `DEFEND` separately as a possible false-positive comment risk. Never relabel a defense as a fixed defect. Include the ledger path, reused/added/superseded IDs, per-remedy outcomes and remaining evidence gaps. The calling workflow's stricter readiness and review gates still apply.
