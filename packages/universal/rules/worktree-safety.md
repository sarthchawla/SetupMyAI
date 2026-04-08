---
paths: '**/*'
---
# Git Worktree Safety Rules

When working in a git worktree (path contains `.cursor/worktrees/` or is a secondary worktree):

## NEVER Do These - Current Window is OFF LIMITS

1. **Never switch branches in the current window's repository** - The user's current editor window can be on any branch. Switching branches there will disrupt their active work.

2. **Never stash changes in the current window** - This affects the user's active work session.

3. **Never checkout, pull, or push in the current window's repo** - All git operations should happen in the worktree path only.

4. **Worktree switching is NOT allowed** - Do not attempt to switch the worktree to point to a different branch or location.

## How to Identify You're in a Worktree

- Workspace path contains `.cursor/worktrees/` or is different from the main repository
- Check with: `git rev-parse --git-common-dir` (if it differs from `git rev-parse --git-dir`, you're in a worktree)
- The main repository is at a different path

## Correct Approach

- All git operations should use the **worktree path only**
- If you need to create branches or commits, do it in the worktree
- **Never touch the current window's repository** - ask the user first if current window changes are needed

## When Current Window Changes Are Needed

**Always use Direct File Comparison** as the preferred method:

### PRIMARY: Direct File Comparison (Recommended)

The worktree and current window are in **different folders** - use this to your advantage:
- **Simply read/compare/copy files between both paths directly** - no git operations needed!

### Alternative Git Commands (No Checkout Needed)

1. **Git diff between branches**:
   ```bash
   git diff main..other-branch -- path/to/file
   git diff origin/main...HEAD
   ```

2. **Git show from any branch**:
   ```bash
   git show other-branch:path/to/file
   ```
