#!/usr/bin/env bash
# Clear loops from the tracking file
# Usage: clear-loops.sh [index]  — index is 1-based; omit to clear all
LOOPS_FILE="$HOME/.claude/active-loops.json"

if [[ ! -f "$LOOPS_FILE" ]]; then
    echo "No active loops file found."
    exit 0
fi

COUNT=$(jq 'length' "$LOOPS_FILE" 2>/dev/null || echo 0)
if [[ "$COUNT" -eq 0 ]]; then
    echo "No active loops to clear."
    exit 0
fi

if [[ -z "$1" ]]; then
    echo "[]" > "$LOOPS_FILE"
    echo "Cleared all $COUNT loop(s)."
else
    INDEX=$(( $1 - 1 ))
    if [[ $INDEX -lt 0 || $INDEX -ge $COUNT ]]; then
        echo "Invalid index: $1 (valid range: 1-$COUNT)"
        exit 1
    fi
    REMOVED=$(jq -r ".[$INDEX].prompt" "$LOOPS_FILE")
    jq "del(.[$INDEX])" "$LOOPS_FILE" > "$LOOPS_FILE.tmp" && mv "$LOOPS_FILE.tmp" "$LOOPS_FILE"
    echo "Removed loop $1: $REMOVED"
    REMAINING=$(jq 'length' "$LOOPS_FILE" 2>/dev/null || echo 0)
    echo "$REMAINING loop(s) remaining."
fi
