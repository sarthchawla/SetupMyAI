---
name: worktree-cleanup
description: Remove worktree(s) - by name, interactively, or via flags
arguments:
  - name: target
    description: Branch name or worktree path (optional - omit for interactive mode)
    required: false
  - name: flags
    description: Optional flags like --all, --dry-run, --force
    required: false
---

# Worktree Cleanup Command

This command removes git worktrees and frees their associated resources.

## Usage

```
/worktree-cleanup                    -> Interactive: show list, select one or more
/worktree-cleanup <branch-or-path>   -> Remove specific worktree
/worktree-cleanup --all              -> Remove all secondary worktrees
/worktree-cleanup --dry-run          -> Preview what would be removed
```

## Behavior

### Mode 1: Remove Specific Worktree

If a `target` is provided (branch name or path):

**Check for project-specific cleanup:**
```bash
if [ -f "package.json" ] && grep -q "worktree:cleanup" package.json; then
    pnpm worktree:cleanup "$TARGET"
else
    # Find worktree path from branch name if needed
    WORKTREE_PATH=$(git worktree list --porcelain | grep -B1 "branch.*$TARGET" | grep '^worktree' | awk '{print $2}')
    if [ -z "$WORKTREE_PATH" ]; then
        WORKTREE_PATH="$TARGET"  # Assume it's a path
    fi
    git worktree remove "$WORKTREE_PATH"
fi
```

### Mode 2: Interactive Selection

If no target is provided and no flags:

1. List all secondary worktrees with numbers
2. Ask the user to select which to remove:
   - Numbers (e.g., "1,3" or "1-3")
   - "all" - Remove all
   - "cancel" - Exit

### Mode 3: Remove All

```bash
# Remove all secondary worktrees
main_worktree=$(git worktree list | head -1 | awk '{print $1}')
git worktree list --porcelain | grep '^worktree ' | awk '{print $2}' | while read wt; do
  if [ "$wt" != "$main_worktree" ]; then
    echo "Removing worktree: $wt"
    git worktree remove --force "$wt"
  fi
done
git worktree prune -v
```

### Mode 4: Dry Run

Add `--dry-run` to any mode to preview without making changes.

### Skip Confirmation

Add `--force` or `-f` to skip confirmation prompts.

## What Gets Removed

For each worktree:
- Git worktree directory
- Git worktree tracking metadata
- Any project-specific resources (Docker containers, volumes, etc. if project setup supports it)
- **NOT** the git branch (preserved - delete manually if needed)

## Post-Cleanup

After removal:
```bash
git worktree prune -v
git worktree list
```

## Related Commands

- `/worktree` - Create a new worktree
- `/worktree-list` - List all worktrees
- `/clean-worktrees` - Quick remove all secondary worktrees
