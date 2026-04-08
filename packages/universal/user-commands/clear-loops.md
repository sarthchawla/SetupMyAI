---
description: "Clear active loop entries from the statusline tracker. Pass a loop number to remove one, or nothing to clear all."
---

## Your Task

Clear tracked loops from `~/.claude/active-loops.json` and cancel matching scheduled tasks.

**Argument**: `$ARGUMENTS` (optional loop number -- 1-based index from `/list-loops`)

## Steps

1. **Show current loops first**
   Execute:
   ```bash
   ~/.claude/scripts/list-loops.sh
   ```

2. **Cancel active cron jobs**
   Use the `CronList` tool to check for active scheduled tasks. If any exist that match the loop(s) being removed, cancel them with `CronDelete`.

3. **Clear from tracking file**
   - If `$ARGUMENTS` is empty or not provided: clear all loops
     ```bash
     ~/.claude/scripts/clear-loops.sh
     ```
   - If `$ARGUMENTS` is a number: clear only that specific loop
     ```bash
     ~/.claude/scripts/clear-loops.sh $ARGUMENTS
     ```

4. **Confirm cleanup**
   Report what was removed and how many loops remain.
