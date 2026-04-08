---
description: Fix unresolved MR/PR review comments
---

Fix unresolved code review comments on the merge request or pull request for the current branch.

## Step 0: Detect Platform and Tool

Auto-detect the hosting platform from the git remote URL.

```bash
REMOTE_URL=$(git remote get-url origin 2>/dev/null)
```

| Remote URL pattern | Platform | Primary Tool | Fallback |
|-------------------|----------|-------------|----------|
| `github.com` | GitHub | `gh` CLI | - |
| `gitlab` (any instance) | GitLab | `glab` CLI | GitLab MCP tools |

For GitLab, auto-detect the project ID:
```bash
PROJECT_ID=$(git remote get-url origin | sed 's|.*gitlab[^/]*/||; s|\.git$||')
```

## Step 1: Find Merge/Pull Request

**GitHub:**
```bash
gh pr view --json number,url,reviewDecision
```

**GitLab (glab - preferred):**
```bash
glab api "projects/:fullpath/merge_requests?source_branch=$(git branch --show-current)"
```

**GitLab (MCP fallback):**
Use `mcp__gitlab__get_merge_request` with `source_branch: current branch`

If no MR/PR exists, inform user and suggest `/create-mr`. Exit.

## Step 2: Get Unresolved Comments

**GitHub:**
```bash
gh api repos/{owner}/{repo}/pulls/{number}/comments --jq '.[] | select(.in_reply_to_id == null) | {id, path, line: .original_line, body, user: .user.login}'
```

**GitLab (glab - preferred):**
```bash
glab api "projects/:fullpath/merge_requests/<iid>/discussions?per_page=50"
```
Filter: keep discussions where `resolved` is false. Extract `id`, `notes[].body`, `notes[].author`, and position info.

**GitLab (MCP fallback):**
Use `mcp__gitlab__get_mr_discussions` with:
- `merge_request_iid`: MR IID
- `only_unresolved_comments`: `true`
- `per_page`: 50

If no unresolved comments, inform user "No unresolved comments found." Exit.

## Step 3: Present Comments

For each unresolved comment, display:

| # | File:Line | Author | Comment Summary |
|---|-----------|--------|-----------------|
| 1 | `file.ts:42` | @reviewer | Brief request |

Then show detailed comments:

### Comment #1 - `file.ts:42`
**Author:** @reviewer
**Request:** Full comment text
**Analysis:** What needs to change

## Step 4: Propose Fixes

For each comment:
1. Read the affected file
2. Analyze what change is requested
3. Show proposed fix as diff:

### Fix #1 - `file.ts:42`
```diff
- old code
+ new code
```

## Step 5: Get Approval

Ask user which fixes to apply:
1. **All** - Apply all fixes
2. **Select** - Specify by number (e.g., "1, 3, 4")
3. **Cancel** - Don't apply any

## Step 6: Apply Fixes

For each approved fix:
1. Read file if not already read
2. Apply fix using Edit tool
3. Show what was changed

## Step 7: Validate

Run appropriate validation based on the project:
- Check for build/compile commands in `package.json`, `Makefile`, `build.gradle`, etc.
- Run linting if available
- Run relevant tests

If validation fails, ask user whether to revert or continue.

## Step 8: Commit

Ask user preference:
1. **Commit now** - Stage and commit all fixes
2. **Don't commit** - Leave unstaged

If committing, use format:
```
fix: address review comments

- Fix 1 description
- Fix 2 description

Addresses comments from MR !<iid> / PR #<number>

Co-Authored-By: Claude <noreply@anthropic.com>
```

## Step 9: Reply to Comments

For each applied fix, reply to the thread and resolve it.

**GitHub:**
```bash
gh api repos/{owner}/{repo}/pulls/{number}/comments/{id}/replies -f body="Fixed in commit <sha>. <brief description>"
```

**GitLab (glab - preferred):**
```bash
glab api --method POST "projects/:fullpath/merge_requests/<iid>/discussions/<discussion_id>/notes" --raw-field "body=Fixed in commit <sha>. <brief description>"
glab api --method PUT "projects/:fullpath/merge_requests/<iid>/discussions/<discussion_id>?resolved=true"
```

**GitLab (MCP fallback):**
Use `mcp__gitlab__reply_to_thread` with:
- `discussion_id`: from step 2
- `body`: "Fixed in commit `<sha>`. <brief description>"
- `resolve_thread`: `true`

## Step 10: Push

After committing, push the changes:
```bash
git push
```

## Step 11: Summary

| # | File | Status | Commit |
|---|------|--------|--------|
| 1 | `file.ts` | Fixed & Replied | abc123 |
| 2 | `file2.ts` | Skipped | - |

**Status:** Changes pushed.
