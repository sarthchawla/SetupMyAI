---
description: Smart rebase onto a target branch with intelligent conflict resolution
---

# Smart Rebase with Conflict Resolution

Rebase the current branch onto a target branch, intelligently resolving merge conflicts by analyzing code context and intent.

**Input:** Target branch to rebase onto (e.g., `main`, `develop`, `feature/other-branch`)
**Target branch:** $ARGUMENTS

> **Default:** If `$ARGUMENTS` is empty, auto-detect the default branch:
> ```bash
> DEFAULT_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo "main")
> ```

## Step 0: Pre-Flight Checks

1. Verify the working tree is clean:
   ```bash
   git status --porcelain
   ```
   - If there are uncommitted changes, **STOP** and ask the user to commit or stash first. Do NOT stash automatically.

2. Verify the target branch exists:
   ```bash
   git ls-remote --heads origin "$TARGET_BRANCH" | grep -q .
   ```
   - If the target branch doesn't exist locally, try fetching it:
     ```bash
     git fetch origin $TARGET_BRANCH
     ```
   - If it still doesn't exist, **STOP** and inform the user.

3. Record the current branch name and commit history for the summary:
   ```bash
   git branch --show-current
   git log --oneline $TARGET_BRANCH..HEAD
   ```
   Save the number of commits that will be rebased and their messages.

4. Fetch the latest from the remote:
   ```bash
   git fetch origin
   ```

## Step 1: Analyze Potential Conflicts Before Rebasing

Preview what files might conflict:
```bash
git diff --name-only $TARGET_BRANCH...HEAD
```

Check what the target branch has changed since the common ancestor:
```bash
git merge-base HEAD $TARGET_BRANCH
git diff --name-only $(git merge-base HEAD $TARGET_BRANCH)..$TARGET_BRANCH
```

Find overlapping files (files changed on both sides):
```bash
comm -12 <(git diff --name-only $(git merge-base HEAD $TARGET_BRANCH)..HEAD | sort) <(git diff --name-only $(git merge-base HEAD $TARGET_BRANCH)..$TARGET_BRANCH | sort)
```

Inform the user about potentially conflicting files before proceeding.

## Step 2: Start the Rebase

```bash
git rebase $TARGET_BRANCH
```

- If rebase completes successfully with no conflicts, skip to **Step 5** (Summary).
- If conflicts occur, proceed to **Step 3**.

## Step 3: Resolve Each Conflict Set

For each round of conflicts during the rebase:

### 3a: Identify Conflicted Files

```bash
git diff --name-only --diff-filter=U
```

### 3b: For EACH Conflicted File, Analyze Context

1. **Read the full conflicted file** to see conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`)

2. **Understand BOTH sides of the conflict:**
   - **Ours (current branch):** What was the intent of our changes?
     ```bash
     git log --oneline -5 -- <file>
     ```
   - **Theirs (target branch):** What was the intent of the target branch changes?
     ```bash
     git log --oneline -n 5 "$TARGET_BRANCH" -- <file>
     ```

3. **Read surrounding context** -- if the conflict is in a function or class, read the full function/class.

4. **Check for related changes:**
   ```bash
   git log --oneline --name-only -3 -- <file>
   ```

### 3c: Make a Conscious Resolution Decision

| Scenario | Strategy |
|----------|----------|
| Both sides add different code in different logical sections | **Combine both** -- keep additions from both sides in logical order |
| Both sides modify the same line/logic differently | **Analyze intent** -- determine which change is more correct or if they can be merged |
| Our side refactors while theirs adds features | **Apply our refactoring + their feature** -- integrate the new feature into the refactored code |
| Their side deletes code we modified | **Check if deletion is intentional** -- read commit messages, prefer deletion if the feature was removed |
| Import conflicts (both sides add imports) | **Keep all unique imports** -- merge both sets, remove duplicates |
| Package.json / lock file conflicts | **Accept theirs, then re-apply our additions** -- target branch is source of truth for shared deps |
| Generated files (OpenAPI types, etc.) | **Accept theirs** -- these should be regenerated anyway |
| Test files with both sides adding tests | **Keep all tests** -- combine both test suites |

### 3d: Apply the Resolution

1. Use the **Edit** tool to resolve the conflict -- remove ALL conflict markers and produce clean, correct code
2. Verify the resolution makes sense by reading the resolved file
3. Stage the resolved file:
   ```bash
   git add <file>
   ```

### 3e: Record the Resolution

For the final summary, record for each conflict:
- **File:** path to file
- **Conflict type:** (e.g., "both sides modified same function", "divergent imports")
- **Resolution strategy:** what you chose and why
- **Risk level:** Low (trivial merge) / Medium (logic changes) / High (complex interleaved changes)

### 3f: Continue the Rebase

```bash
GIT_EDITOR=true git rebase --continue
```

If more conflicts arise, **repeat Step 3** from 3a.

## Step 4: Post-Rebase Validation

After the rebase completes successfully:

1. **Verify commit history:**
   ```bash
   git log --oneline -20
   ```

2. **Check for obvious issues** -- only if conflicts were resolved in Step 3 (skip for clean rebases):
   - Auto-detect build/lint commands from the project and run them
   - Check output for errors related to resolved files

3. If build/lint fails due to a resolution error, inform the user and offer to fix it.

## Step 5: Present Rebase Summary

```markdown
## Rebase Summary

### Overview
| Detail | Value |
|--------|-------|
| Current Branch | `<branch-name>` |
| Rebased Onto | `<target-branch>` |
| Commits Rebased | <count> |
| Conflicts Encountered | <count> files across <count> commits |
| Resolution Status | All resolved / Needs review |

### Commits Rebased
1. `<short-hash>` <commit message>
2. `<short-hash>` <commit message>

### Conflict Resolutions (if any)

#### `<file-path>`
- **Conflict Type:** <description>
- **Resolution:** <what was done and why>
- **Risk Level:** <Low/Medium/High>
- **Action Needed:** None / Review recommended

### Post-Rebase Validation
- Build: Pass / Fail / Skipped
- Lint: Pass / Fail / Skipped

### Recommended Next Steps
- [ ] Review high-risk conflict resolutions (if any)
- [ ] Run full test suite
- [ ] Force push to update remote: `git push --force-with-lease`
```

## Step 6: Ask User for Next Action

1. **Review specific resolutions** -- show detailed diffs for any conflict
2. **Run tests** -- execute the test suite to validate
3. **Force push** -- push the rebased branch (`--force-with-lease` for safety)
4. **Abort** -- undo with `git reset --hard ORIG_HEAD`
5. **Done** -- everything looks good

## Emergency: Rebase Abort

If at ANY point the situation becomes too complex or risky:
1. **STOP resolving**
2. Inform the user about the complexity
3. Offer to abort: `git rebase --abort`
4. Suggest alternatives: merge instead, cherry-pick, or `git rebase --onto`

## Guidelines

- **NEVER force-push without explicit user approval**
- **NEVER silently discard changes** -- always explain what was kept and what was removed
- **Prefer combining over choosing sides** -- when both changes are valid, merge them
- **Read before resolving** -- always read the full context of a conflicted area
- **Record everything** -- the summary should give the user confidence in what happened
- **When in doubt, ask** -- if a resolution is ambiguous, ask the user
- **Respect the target branch** -- for shared config files, the target branch is generally the source of truth
