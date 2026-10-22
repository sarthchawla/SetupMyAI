# Collector handoff

Ownership: `collector.mjs`, `collector.test.mjs`, and this handoff only. These files contain generic tooling and fictitious test identities; mirror them to the public sibling during parent integration. Runtime configuration, MR text, adjudications, raw API responses, checkpoints, and summaries belong exclusively in a private output directory. Nothing has been committed.

## Commands

From the repository root:

```sh
pnpm exec node --test scripts/mr-learning/collector.test.mjs
pnpm exec node scripts/mr-learning/collector.mjs --config /absolute/private/config.json --output /absolute/private/collection --adjudications /absolute/private/adjudications.json
```

The CLI performs only GitLab GET requests through `glab api --hostname <configured-host> --method GET --output json`. It emits a small JSON summary and exits nonzero on failure. It does not emit raw MR text, post comments, install skills, commit, push, merge, or schedule anything. The parent owns the initial production run.

## Configuration, version 1

```json
{
  "host": "code.example.invalid",
  "identity": { "id": 7, "username": "owner" },
  "initialSince": "2026-10-11T16:00:00Z",
  "initialIncludeOpen": true,
  "pageSize": 100,
  "overlapSeconds": 300,
  "verifiedAiUserIds": [],
  "verifiedHumanUserIds": [],
  "verifiedServiceUserIds": [],
  "revisitMrKeys": ["42:1"]
}
```

`host` and stable identity are required. `initialSince` is optional: omit it for full historical extraction. With a window, the first run still enumerates **all accessible authored MR metadata across all projects and states**, then extracts MRs created or updated in the window, all open MRs by default, and explicit revisit/adjudication keys. Older closed MRs outside the window remain listed as deferred. The historical handoff's unresolved keys should be merged into `revisitMrKeys` by the parent.

The authenticated `/user` and `/users/<id>` must both match the configured stable ID and username. Initial listing sorts by creation time, bounded by run start. Incremental listing uses `updated_after` with a five-minute default overlap and `updated_before` at run start. Every array endpoint explicitly supplies `page` and `per_page`; short/empty pages terminate. Repeated full pages, malformed responses, or an exhausted `maxPages` limit fail closed. Metadata is deduplicated by project ID and MR IID.

Prior open MRs and all nonaccepted candidates, including excluded pushbacks, stay in the revisit queue regardless of their age or `updated_at`. Configured historical revisit keys are retained. Accepted findings also stay in the revisit queue: every retention proof is checked against fresh final MR metadata, even without a changed update timestamp or author reply.

`verifiedAiUserIds` establishes verified AI. `verifiedHumanUserIds` establishes verified human accounts. `verifiedServiceUserIds` or an API `bot:true` establishes service automation. API `bot:false`, a name containing “bot,” and writing style do **not** establish human or AI attribution. Unknown accounts remain unknown. Reviewer profile failures retain the candidate with a warning and unknown attribution; they do not suppress findings. Required MR/discussion/note/commit/diff failures fail the run.

Optional operational settings: `fetchReviewerProfiles:false`, `glabPath`, `requestTimeoutMs` (120000 default), `maxResponseBytes` (64 MiB default), and `maxPages` (100000 default).

## Adjudication manifest

```json
{
  "schemaVersion": 1,
  "findings": [{
    "source": { "projectId": 42, "mrIid": 1, "discussionId": "discussion-a", "noteId": 91 },
    "findingKey": "1",
    "disposition": "accepted_and_fixed",
    "reason": "Author accepted the missing-user defect and added the guard.",
    "acceptance": { "noteId": 92, "quote": "Accepted: I added a missing-user guard." },
    "reviewedThroughNoteId": 92,
    "fix": {
      "commitSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "file": "frontend/Profile.tsx",
      "addedLines": ["if (!user) return null;"],
      "removedLines": [],
      "correction": "Guard before dereferencing user.name."
    },
    "area": "frontend",
    "pattern": "missing-user-guard"
  }]
}
```

A stable finding ID is `gitlab:<host>:project:<projectId>:mr:<iid>:discussion:<url-encoded-discussionId>:note:<noteId>:finding:<url-encoded-findingKey>`. Notes outside discussions use `standalone-<noteId>` as the discussion ID. The optional `findingId` must match the computed ID. Multiple entries for the same note with distinct `findingKey` values explicitly split mixed findings.

The default author-reply acceptance path requires all of:

- An exact source quote from an author reply, dated after the finding.
- `reviewedThroughNoteId` matching the latest non-system author reply in that discussion. Later replies invalidate stale acceptance pending re-adjudication.
- A full commit SHA retrieved from the authenticated API, verified to belong to the MR by the MR commit list or commit-associated-MR endpoint, with a post-finding commit timestamp. For a historical/rebased commit absent from those APIs, `fix.mrLink:{noteId,quote}` can establish linkage only when a nonsystem author reply in the same discussion quotes the exact full SHA after the finding. The actual target commit/diff and all correction checks still apply. The result records `association.kind:"author_linked_historical_fix"` with its quoted source URL, separately from `current_mr_commits_or_api_association`.
- The actual untruncated commit diff for the named file and exact added/removed code/config/test lines. A correction explanation is required; `diffSha256` can additionally pin the complete returned patch.
- The reviewed file must match the correction file, or `crossFileReason` must explain the relationship.

This manifest is the explicit **semantic adjudication**: code verifies source linkage and the claimed actual correction. It does not infer acceptance from text sentiment or establish review quality by itself. A nonempty semantic reason is mandatory. Resolution flags are retained only as provenance.

### Explicit author-owned revert action

A bounded alternative can establish acceptance by the author's verified corrective action when the source review has no acceptance reply. Keep the existing source, disposition, semantic reason and fix fields; use:

```json
{
  "acceptance": {
    "kind": "author_owned_revert",
    "action": { "noteId": 93, "quote": "mentioned in commit bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
    "mrLink": { "noteId": 94, "quote": "mentioned in merge request !2" },
    "revertMr": { "projectId": 42, "mrIid": 2 }
  },
  "reviewedThroughNoteId": null,
  "fix": {
    "commitSha": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "file": "config/flags.json",
    "addedLines": [],
    "removedLines": ["  \"selector-one\",", "  \"selector-two\","],
    "correction": "Reverse the complete source-file change."
  }
}
```

Both exact system-event bodies must come from the original source MR, have `system:true`, be authored by the configured MR author and postdate the review. The commit event contains the exact full fix SHA, and the MR event identifies the exact separate same-project revert IID. A generic mention, reviewer endorsement or merger identity is insufficient. Source and revert MRs must be author-owned and merged on the same target branch; the merger may be another account. The actual commit must appear in the revert MR's paginated commits or authenticated commit-associated-MR list, with a message line exactly `This reverts merge request !<SOURCE_IID>` (optional final period).

`reviewedThroughNoteId` is mandatory: use null only when the entire source MR has no nonsystem author notes; otherwise cite its latest nonsystem author note. A later author reply makes a previously null/older marker stale. System mention IDs belong in action/link provenance rather than this marker. An author reply is never fabricated from a system event.

This mode deliberately certifies only a complete **single-file** reversal. Both MRs must report `changes_count:"1"`, source/revert/fix-commit patches must each contain exactly that file, and all patches must be uncollapsed/untruncated with complete hunk counts. Hunk positions, surrounding context and all added/removed lines must match the exact reverse source patch; the merged revert-MR patch must equal the correction commit patch. The fix manifest must quote every correction line, and actual commit statistics must agree. Missing coverage, a partial reversal, moved identical tokens, rename, another author/branch/MR, unmerged work, invalid dates or stale author coverage stays uncertain. Existing fix timing, same-file, nonblank-line and optional diff-hash checks still apply. Unmerged/withdrawn companion work remains an exclusion and does not create a second accepted correction.

The collector fetches related revert metadata plus paginated commits/diffs, retaining them in `raw.revertMrs["<projectId>:<mrIid>"]` alongside the authenticated fix commit. Any required related-source fetch failure fails the run without advancing the last successful checkpoint. No new automatic semantic classifier or reclassification cache is introduced.

Nonaccepted dispositions are `pushed_back`, `false_positive`, `withdrawn`, `duplicate`, `unresolved`, or `uncertain`. Exclusions require `evidence:{noteId,quote}` from the discussion and a reason. A duplicate instead requires `duplicateOf:<stable canonical finding ID>`. Repeated same-defect findings can share `canonicalFindingId`, while accepted aggregate counts use one group and preserve separate contributor attribution; duplicate contributions are attached only when their canonical accepted group exists within the same MR. Deduplication and splitting require explicit adjudication and are never inferred from similar wording.

Unadjudicated external nonsystem notes remain **candidates**, not established actionable defects: unresolved resolvable notes are `unresolved`; otherwise they are `uncertain`. Bot advisory notes, questions, and re-posts therefore do not enter accepted metrics without validated adjudication. The parent must inspect and classify meaningful candidates. Only `learningEligible:true` records with final retention proof and a verified selected cohort enter learned-rule inputs.

Verified automation introduction markers, exact no-issues/unchanged templates, and entire short acknowledgements are retained in `nonFindingNotes` with `candidateStatus:"context_only"`. Ambiguous or substantive notes remain candidates. Confirmation-like followups are labelled `noteRole:"confirmation_followup"`; detailed confirmations require explicit source-quoted context adjudication before exclusion. A manifest can include `nonFindingNotes:[{source:{projectId,mrIid,discussionId,noteId},noteRole:"confirmation_followup",reason:"...",evidence:{noteId,quote}}]`; the quote must come from that same note. A finding adjudication overrides a context label. An MR containing only an introduction does not count toward `reviewCandidateMrCount`.

## Durable output

- `state.json`: the sole authoritative successful checkpoint and pointer to a corpus snapshot. It is atomically replaced only after all required requests and durable corpus/summary writes succeed. It pins the host and identity and refuses a missing prior corpus.
- `runs/<runId>/source-discovery.json`: durable completed listing metadata and explicit listing scope/query. It remains usable even if later extraction fails.
- `runs/<runId>/raw/<project>-<iid>.json`: raw MR details, discussions, notes, MR commits, current MR diffs, plus actual fix commit details/diffs for accepted adjudications. Explicit revert actions additionally retain `revertMrs` metadata/commits/diffs. Only adjudicated fix commits have per-commit diffs fetched; the complete MR commit list and current MR diff are always preserved.
- `runs/<runId>/identity.json`: minimal identity evidence, without full API user PII.
- `runs/<runId>/reviewer-profiles.json`: minimal ID/username/bot attribution evidence and attribution errors.
- `runs/<runId>/corpus.json`: metadata for all ever-discovered MRs, current candidate dispositions/provenance, separate context-only `nonFindingNotes`, accepted defect groups, persistent revisit keys, and explicit deferred coverage. Old untouched MR raw-file references point to their immutable prior run.
- `runs/<runId>/summary.json`: durable counts, source coverage, interval, full candidate/acceptance change IDs, warning/error details, and meaningful-change flag. The CLI returns this path, corpus path, checkpoint, interval and compact counts; accepted-change ID lists are capped at 20 and deferred coverage is a count. Full IDs remain in the durable summary/corpus rather than expanding terminal output.

State/corpus finding IDs are stable and reruns do not append duplicate findings. Run audit directories are intentionally immutable and repeated runs may create new audit snapshots. The next checkpoint is the **run start**, not completion time, so changes made while collecting are included next time. Failed runs preserve the prior state byte-for-byte and expose failure rather than an empty successful day. A successful empty incremental listing still revisits queued candidates.

Selected MRs replace their current observation set and partition context-only records into `nonFindingNotes`; previously unlabelled boilerplate does not linger as a candidate after migration. If a previously observed candidate note is absent from complete successful current discussions/notes, it remains `uncertain`, `sourceMissing:true`, with an immutable `archivedSourcePath` and original provenance. Disappearance alone neither proves withdrawal nor preserves acceptance. A later restored note is re-adjudicated normally.

The lock prevents concurrent collection against one output directory. A process crash can leave `.collector.lock`; inspect its PID/run ID before manually removing a proven stale lock. Do not silently clear a potentially live lock.

## Verification and practical limits

The collector suite exercises full pagination/all states/projects, minimal verified identity, stable reruns, pushback exclusion, old closed MR late acceptance without an `updated_at` change, stale acceptance withdrawal, false diff claims, unrelated/pre-review/truncated commits, same-thread historical fix linkage including absent/mismatched/non-author/other-thread controls, context-only templates versus substantive controls, quoted confirmation adjudication and introduction-only MR coverage, initial open-MR coverage, explicit historical revisits, partial-source failures/checkpoint preservation and successful retry, initial source failure, missing prior corpus, account attribution, mixed finding splits, same-defect contributor deduplication, and area classification.

The author-owned revert regressions cover the complete verified action chain, legacy reply behavior, critical linkage/identity/merge/branch/timestamp failures, exact reverse patch context/position/completeness, stale nonsystem author markers, related-source pagination/provenance, rerun idempotency, companion withdrawal exclusion and related metadata/commit/diff failure durability.

These are ingestion and evidence-linkage tests. They do not substitute for model behavioral evals using offending/corrected cases, clean controls, and held-out MRs; that infrastructure belongs to the parent/other workstream. No production MR collection was run by this worker.

GitLab responses can impose server diff limits; current returned collapsed/too-large file patches are recorded as coverage limitations. They cannot validate an accepted correction until a complete target commit patch is available. Accessible metadata enumeration is bounded by run start rather than an atomic server snapshot; newly created or updated MRs and changed access after that cutoff are catch-up inputs on the next successful interval. Historical completeness is separate when `initialSince` is used.

Primary API references: [merge requests](https://docs.gitlab.com/api/merge_requests/), [discussions](https://docs.gitlab.com/api/discussions/), [commits](https://docs.gitlab.com/api/commits/). Local `glab api --help` confirmed the explicit GET/hostname/output flags.

## Final revision retention proof

Each accepted child remedy requires a separate `finalRetention` object alongside its historical `fix`:

```json
{
  "finalRetention": {
    "revision": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "outcome": "retained",
    "reason": "The current implementation still prevents this remedy's concrete failure, including sibling callers.",
    "validation": {
      "revision": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "status": "passed",
      "evidence": "Exact check command/result and durable evidence reference at this revision"
    },
    "files": [{
      "file": "frontend/Profile.tsx",
      "blobId": "<complete Git blob ID>",
      "contentSha256": "<SHA-256 of the complete final file bytes>"
    }]
  }
}
```

The collector retrieves each cited complete file through the authenticated repository-files API at the current MR head. It checks the path, canonical base64, exact byte count, computed content hash and computed Git blob ID against the proof. The MR head is fetched again after file retrieval; a moving head invalidates the snapshot. Source failures remain explicit rather than becoming positive learning. For author-owned corrective revert MRs, pin the corrective MR's final head and source, separately from the original MR.

The adjudicator must inspect the entire relevant final implementation and caller contracts and run proportionate validation. A hash only verifies the source cited by that judgment; it cannot establish semantics by itself. A valid refactor or renamed file may be retained with renewed source and validation proof; old added-line presence is not required. Preserve `removed`, `reverted`, `superseded` and `unverified` histories, but none supports positive learning. Historical `fix` data and previous immutable raw runs remain intact.

`learningSecondaryAiUserIds` defaults to empty and must contain only explicitly verified AI IDs. Verified humans are the primary cohort. Unknown, service and author accounts cannot enter the selected list; duplicate contributors are limited to selected verified cohorts. Human-containing groups sort before secondary AI groups. The runner derives its notification list from the same canonical groups and includes final proof, so renewed or invalidated evidence changes the meaningful snapshot.
