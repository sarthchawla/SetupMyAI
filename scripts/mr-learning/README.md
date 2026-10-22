# Daily review learning

Run `pnpm exec node scripts/mr-learning/run.mjs --config <private-system.json>` in the tooling checkout. The configured output directory, collector config, adjudications, reconciliation state/report and historical handoff must remain private. The runner advances ingestion through the collector's successful durable checkpoint; reconciliation has its own content baseline. A source failure still permits the skill scan and produces an attention summary. Per-run skill reports are immutable under `skill-reports/`; the configured report remains the latest view. Read `latest-summary.json` for a durable result and `notify` to decide whether a scheduled chat should report.

Example system config (absolute paths are recommended):

```json
{
  "output": "/private/output/daily",
  "collector": {
    "config": "/private/output/daily/collector-config.json",
    "output": "/private/output/daily/collection",
    "adjudications": "/private/output/daily/adjudications.json"
  },
  "skills": {
    "config": "/private/output/daily/skill-config.json",
    "state": "/private/output/daily/skill-state.json",
    "report": "/private/output/daily/skill-report.json",
    "applyValidated": false
  },
  "historyHandoff": "/private/output/history/handoff.json"
}
```

The collector fetches source material; it does not infer acceptance from resolution or silently convert uncertain findings into learned rules. Review the new findings with original context and record acceptance/fix evidence in the adjudication manifest. Re-run to verify source evidence before recommending or promoting a rule. Historical and daily evidence remain separate and share stable source IDs.

The historical handoff is read without modifying its content. Until it includes actual passed behavioral results, the learned skill remains unpromoted. Inspect its coverage, candidate paths, exact integration needs and hash-bound eval artifact, then add an explicit skill mapping and normal review invocation. Do not substitute synthetic harness cases for real held-out MR evaluation.

An explicit `setupmyai skill-sync` invocation is the immediate synchronization workflow. The scheduled scan catches persisting changes at its next run. No daemon or watcher is installed. Deletion/conflict proposals and missing evals require a decision; missing paths or inaccessible sources are failures, not evidence that content was deleted.

W2 retention and W3 reviewer selection are enforced by the collector and reused by the daily summary. Each accepted remedy needs `finalRetention` (see [collector schema](collector-handoff.md)); a historical fix or unchanged author reply is insufficient. A changed head, unavailable/incomplete final file, stale validation or a removed/reverted outcome leaves it uncertain. Existing manifests without that proof require renewed adjudication. Accepted MRs stay in the revisit queue even when their update timestamps do not advance.

Only verified human accounts and explicitly configured `learningSecondaryAiUserIds` (a subset of `verifiedAiUserIds`) enter positive learning. Groups containing humans come first, followed by the configured secondary AI cohort. Explicit same-defect IDs count once and retain verified contributors. Unknown/service/author posts stay outside the learning list. Identity records and provenance belong in private configuration.

The daily runner holds `.daily.lock` across collection, reconciliation and report writes; the collector also holds `.collector.lock`. Deployment must acquire both locks and check for older active runner processes. Keep schedules and `skills.applyValidated` unchanged.
