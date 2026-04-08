---
description: "List all active loops being tracked in the statusline"
---

## Your Task

Show all currently tracked loops.

## Steps

1. **List loops from tracking file**
   Execute:
   ```bash
   ~/.claude/scripts/list-loops.sh
   ```

2. **Check session crons**
   Use the `CronList` tool to show any active scheduled tasks in the current session.

3. **Report**
   Display the results. If there are loops in the tracking file but no matching crons, note they may be stale from a previous session and suggest `/clear-loops` to clean up.
