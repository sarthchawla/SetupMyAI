#!/usr/bin/env bash
# List all active loops from the tracking file
LOOPS_FILE="$HOME/.claude/active-loops.json"

if [[ ! -f "$LOOPS_FILE" ]]; then
    echo "No active loops file found."
    exit 0
fi

COUNT=$(jq 'length' "$LOOPS_FILE" 2>/dev/null || echo 0)
if [[ "$COUNT" -eq 0 ]]; then
    echo "No active loops."
    exit 0
fi

echo "$COUNT active loop(s):"
echo ""
jq -r 'to_entries[] | "  \(.key + 1). \(.value.prompt)  [cron: \(.value.cron)]  [since: \(.value.created)]"' "$LOOPS_FILE"
