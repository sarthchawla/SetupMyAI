---
name: worktree-list
description: List all active git worktrees with their status
arguments: []
---

# Worktree List Command

This command displays all registered worktrees with their branch, path, and status.

## Behavior

### Step 1: List Worktrees

**Check for project-specific list command:**
```bash
if [ -f "package.json" ] && grep -q "worktree:list" package.json; then
    pnpm worktree:list
else
    git worktree list
fi
```

For verbose output:
```bash
git worktree list --porcelain
```

### Step 2: Format Output

Present the results as a formatted table:

**Active Worktrees**

| # | Path | Branch | Status |
|---|------|--------|--------|
| 1 | /path/to/worktree-1 | feature/auth | clean |
| 2 | /path/to/worktree-2 | bugfix/123 | 3 modified files |

Include status info:
- Clean working tree vs. uncommitted changes
- Whether the branch has a remote tracking branch
- Whether the branch is ahead/behind remote

### Step 3: Empty State

If no secondary worktrees exist, show:

"No secondary worktrees found. The only worktree is the main repository. Create a new worktree with `/worktree`"

## Related Commands

- `/worktree` - Create a new worktree
- `/worktree-cleanup` - Remove worktree(s)
- `/clean-worktrees` - Remove all secondary worktrees
