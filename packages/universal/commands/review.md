# Review — policy-driven Codex + specialists

Run the review bundle defined in `~/.claude/scripts/codex-policy.md` on the current change set. This is user-invoked only — there is no hook enforcing it.

Use the current runtime's native delegation tools and available reviewer roles for the illustrative agent calls below. Preserve the required review tier and scope; disclose unavailable reviewers instead of executing unsupported provider APIs or silently dropping coverage.

Arguments: `$ARGUMENTS`

## Step 1: Determine tier

Default tier: `normal`.

Parse `$ARGUMENTS`:
- If first token is `adversarial` → tier = adversarial.
- If first token is `normal` → tier = normal.
- Remaining arguments are focus/context notes to forward to reviewers.

Then open `~/.claude/scripts/codex-policy.md` and confirm the chosen tier matches the change (Tier 3 triggers bump tier up; never down). If the tier should escalate, tell the user and proceed at the higher tier.

## Step 2: Gather scope

Collect the diff to review:

```bash
# Prefer staged; fall back to working tree; fall back to last commit.
git diff --cached --stat 2>/dev/null | tail -1
if [ -z "$(git diff --cached --name-only)" ]; then
  git diff --stat 2>/dev/null | tail -1
fi
```

Produce:
- `CHANGED_FILES` — newline-separated list of files in the diff
- `DIFF` — the full diff text (staged if present, else working tree, else `HEAD~1..HEAD`)
- `CONTEXT` — 1-2 sentences from conversation about what the change does and why

If there is no diff at all, tell the user and stop.

## Step 3: Decide specialist routing

Include available approved domain review supplements only for their applicable changed scopes. Preserve their evidence/coverage limitations and contributor IDs when consolidating; multiple reviewers are not independent proof of a defect.

From `CHANGED_FILES` and `CONTEXT`, determine which specialists to spawn in parallel with Codex. Conservative default — only spawn a specialist when the area clearly applies.

| Signal | Specialist |
|---|---|
| auth / session / token / oauth / jwt / permission files | `security` |
| schema migration / model file / SQL / query logic | `data-integrity` |
| `.gitlab-ci.yml` / `.github/workflows/` / Dockerfile / k8s / deployment config | `ci` |
| `*.tsx` / `*.jsx` / CSS / a11y attrs / component files | `frontend` |
| benchmark / hot-path / algorithm file flagged in context | `performance` |

Multiple specialists may apply — spawn all that do.

## Step 4: Prepare the reviews directory

```bash
mkdir -p .claude/reviews
TS=$(date +%Y-%m-%d-%H%M)
SLUG=<short kebab-case slug summarizing the change, from CONTEXT, max 30 chars>
```

Every reviewer writes to `.claude/reviews/${TS}-${SLUG}-<reviewer>.md`.

## Step 5: Spawn reviewers in parallel (single message, multiple Agent calls)

### 5a. Codex (mandatory)

```
Agent({
  subagent_type: "codex:codex-rescue",
  description: "Codex <tier> review of <SLUG>",
  prompt: <see template below>
})
```

**Codex prompt template:**

> Run a **<tier>** code review on the attached diff per the policy at `~/.claude/scripts/codex-policy.md`.
>
> Context: <CONTEXT>
>
> Focus notes (if any): <remaining $ARGUMENTS>
>
> Diff:
> ```
> <DIFF>
> ```
>
> Write findings to `.claude/reviews/<TS>-<SLUG>-codex.md`. Each finding: severity (CRITICAL / HIGH / MEDIUM / LOW), location (file:line), issue, suggested fix.
>
> For **adversarial** tier, also challenge: chosen approach, tradeoffs, assumptions, failure modes, hidden coupling, whether the change should exist at all.
>
> Return ONLY: one-paragraph summary, severity counts, and the markdown file path. Do not paste full findings back.

### 5b. Each selected specialist (in the same message, parallel)

```
Agent({
  subagent_type: <specialist agent type, or "general-purpose" if no dedicated agent exists>,
  description: "<area> review of <SLUG>",
  prompt: <see template below>
})
```

**Specialist prompt template:**

> You are a <area> reviewer.
>
> **Step 0 (MANDATORY):** Before reviewing, check for and invoke relevant skills via `ToolSearch` (keywords: <area>, review, <change keywords>), `.claude/skills/`, `.cursor/rules/`, and MCP agent-skills for this domain. Company-verified skills take priority over general knowledge. If a reviewer skill like `security-review` exists, invoke it first and incorporate its guidance into your review.
>
> Context: <CONTEXT>
>
> Focus notes: <remaining $ARGUMENTS>
>
> Diff:
> ```
> <DIFF>
> ```
>
> Review for <area>-specific issues. Write findings to `.claude/reviews/<TS>-<SLUG>-<area>.md`. Each finding: severity, location, issue, suggested fix, skill reference if applicable.
>
> Return ONLY: one-paragraph summary, severity counts, and the markdown file path.

## Step 6: Collect results

Each Agent returns a summary + counts + markdown path. Aggregate:

```
| Reviewer | CRITICAL | HIGH | MEDIUM | LOW | Path |
|----------|----------|------|--------|-----|------|
| codex    | …        | …    | …      | …   | …    |
| security | …        | …    | …      | …   | …    |
| …        | …        | …    | …      | …   | …    |
```

If any reviewer errored or was unavailable → disclose explicitly; do not silently drop.

## Step 7: Adjudicate reviewer claims

Load `review-adjudication` and reuse its evidence gate and ledger for every reviewer candidate; if unavailable, report that prerequisite before applying findings. Severity prioritizes inspection, not truth or edit authorization. Split mixed remedies, check current code/callers and counterevidence, consolidate same-defect reports with contributor IDs, and retain `FIX` / `DEFEND` / `DISCARD` / `CLARIFY` judgments.

A review-only request stays read-only. When fixes are authorized, apply only verified `FIX` remedies, validate the final correction and record final retained/rejected/reverted outcomes before reusing any lesson. Preserve sound code for `DEFEND` and investigate `CLARIFY` before editing that claim. Report the ledger path and evidence gaps with the existing reviewer reports.

Do NOT re-paste full findings into this thread. Only show:
- The aggregate table
- A short bullet list of CRITICAL/HIGH findings with status (fixed / surfaced / disagreed)
- Count of MEDIUM/LOW deferred
- File paths so the user can read them if they want

## Step 8: Offer next step

End with:

> Review complete. <N> CRITICAL+HIGH addressed, <M> MEDIUM/LOW deferred. Reports in `.claude/reviews/`. Want me to act on any MEDIUM/LOW findings?

---

## Notes

- This command is **user-invoked only** — there is no automatic enforcement. The Stop hook has been removed.
- The canonical policy lives at `~/.claude/scripts/codex-policy.md` — read it if uncertain which tier applies.
- Reviews run in isolated Agent contexts. Full findings stay in markdown, out of this thread's context.
- If `~/.claude/scripts/codex-policy.md` is missing, stop and tell the user — do not proceed without the policy.
