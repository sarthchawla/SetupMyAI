---
description: Monitor MR/PR - fix review comments and CI failures in a loop until green
---

Monitor the current branch's MR/PR until CI is green and there are no unresolved review comments. Automatically fix issues as they appear.

## Step 0: Detect Platform

```bash
REMOTE_URL=$(git remote get-url origin 2>/dev/null)
```

| Remote URL pattern | Platform | Tool |
|-------------------|----------|------|
| `github.com` | GitHub | `gh` CLI |
| `gitlab` (any instance) | GitLab | `glab` CLI / GitLab MCP |

For GitLab, auto-detect the project ID:
```bash
PROJECT_ID=$(git remote get-url origin | sed 's|.*gitlab[^/]*/||; s|\.git$||')
```

If `PROJECT_ID` is empty for GitLab, **stop and report** that the git remote URL is not recognized.

## Step 1: Find Merge/Pull Request

**GitHub:**
```bash
gh pr view --json number,url,state
```

**GitLab (glab):**
```bash
glab mr view --source-branch $(git branch --show-current)
```

**GitLab (MCP fallback):**
Use `mcp__gitlab__get_merge_request` with `source_branch: current branch`

Extract the MR IID / PR number. If none exists, inform user and exit.

## Step 2: Check Unresolved Review Comments

**GitHub:**
```bash
gh api repos/{owner}/{repo}/pulls/{number}/reviews --jq '.[] | select(.state == "CHANGES_REQUESTED")'
gh api repos/{owner}/{repo}/pulls/{number}/comments
```

**GitLab (glab):**
```bash
glab api "projects/:fullpath/merge_requests/<iid>/discussions?per_page=50"
```
Filter for unresolved discussions.

**GitLab (MCP fallback):**
Use `mcp__gitlab__get_mr_discussions` with `only_unresolved_comments: true`

### If unresolved comments exist:

For each unresolved comment:

1. **Present** the comment summary table:
   | # | File:Line | Author | Comment Summary |
   |---|-----------|--------|-----------------|

2. **Read** the affected file and analyze what change is requested.

3. **Propose** the fix as a diff and apply it (auto-apply without asking -- this is autonomous mode).

4. **Validate** after all fixes:
   - Auto-detect build/lint/test commands from the project
   - Run relevant validation

5. **Commit** with format:
   ```
   fix: address review comments

   - Fix description 1
   - Fix description 2

   Co-Authored-By: Claude <noreply@anthropic.com>
   ```

6. **Push**: `git push`

7. **Reply** to each comment thread and resolve it.

### If no unresolved comments:

Report "No unresolved review comments." and proceed to Step 3.

## Step 3: Check CI Status

**GitHub:**
```bash
gh run list --branch $(git branch --show-current) --limit 5
```

**GitLab (glab):**
```bash
glab api "projects/:fullpath/pipelines?ref=$(git branch --show-current)&per_page=1"
```

**GitLab (MCP):**
Use `mcp__gitlab__list_pipelines` with `ref: current branch`, `per_page: 1`

### If pipeline/workflow is `running` or `pending`:
Report it's still in progress. No action needed -- will check on next iteration.

### If pipeline/workflow is `success`:
Report "CI is green!"

### If pipeline/workflow `failed`:

1. **Get failed jobs** and their logs (see `/fix-ci` command for details).

2. **Analyze** logs for build errors, test failures, lint errors, runtime errors.

3. **For fixable issues**: Read affected files, apply fixes, validate, commit, and push.

4. **For flaky tests**: Retry the pipeline/workflow if the failure is clearly flaky.

5. **For unfixable issues**: Report what went wrong and suggest manual intervention.

## Step 4: Status Report

Always end with a status summary:

```
## MR/PR Monitor Status

| Check | Status |
|-------|--------|
| Unresolved Comments | 0 / X fixed |
| CI Pipeline | green / running / failed |

Next action: <what will happen next iteration or "All clear - ready to merge">
```

## Autonomous Behavior

This command is designed to run in a loop. Key principles:

- **Auto-fix without asking** for straightforward changes (lint fixes, reviewer suggestions, simple type fixes)
- **Ask for approval** only if a fix is ambiguous, risky, or changes business logic
- **Always validate** before committing (build + relevant tests)
- **Report status** concisely each iteration -- don't repeat context from previous runs
- **Exit early** if both CI is green and no unresolved comments -- report "All clear"
