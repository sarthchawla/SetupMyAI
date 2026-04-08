---
description: Removes all git worktrees except the main working tree. Keeps local branches intact.
---

## Your Task

Remove all git worktrees in the current repository except the main working tree. Do NOT delete the associated local branches -- only remove the worktree directories.

## Commands to Execute

1. **List all current worktrees to show the user what exists**
   Execute this command:
   ```bash
   git worktree list
   ```

   The first entry is the main working tree -- it must NOT be removed. All other entries are secondary worktrees that should be removed.

2. **Remove all secondary worktrees**
   Execute this command:
   ```bash
   main_worktree=$(git worktree list | head -1 | awk '{print $1}')
   git worktree list --porcelain | grep '^worktree ' | awk '{print $2}' | while read wt; do
     if [ "$wt" != "$main_worktree" ]; then
       echo "Removing worktree: $wt"
       git worktree remove --force "$wt"
     fi
   done
   ```

3. **Prune any stale worktree references**
   Execute this command:
   ```bash
   git worktree prune -v
   ```

4. **Verify cleanup by listing remaining worktrees**
   Execute this command:
   ```bash
   git worktree list
   ```

## Expected Behavior

After executing these commands:

- All secondary worktrees are removed (directories deleted, git tracking cleaned up)
- The main working tree remains untouched
- All local branches are preserved
- Stale worktree references are pruned
- The final `git worktree list` should show only the main working tree

If there are no secondary worktrees, report that no cleanup was needed.
