#!/usr/bin/env bash
# ============================================================
# LOOP TRACKING HOOK — maintains ~/.claude/active-loops.json
# Called as PostToolUse hook for CronCreate and CronDelete
# To remove: delete this file and remove the PostToolUse hooks
# from ~/.claude/settings.json (search "LOOP TRACKING")
# ============================================================

LOOPS_FILE="$HOME/.claude/active-loops.json"
INPUT=$(cat)

TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')

# Ensure file exists with valid JSON array
if [[ ! -f "$LOOPS_FILE" ]] || ! jq empty "$LOOPS_FILE" 2>/dev/null; then
    echo '[]' > "$LOOPS_FILE"
fi

if [[ "$TOOL_NAME" == "CronCreate" ]]; then
    PROMPT=$(echo "$INPUT" | jq -r '.tool_input.prompt // empty')
    CRON=$(echo "$INPUT" | jq -r '.tool_input.cron // empty')
    RECURRING=$(echo "$INPUT" | jq -r '.tool_input.recurring // false')
    JOB_ID=$(echo "$INPUT" | jq -r '.tool_output' | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
    CREATED=$(date -u +%Y-%m-%dT%H:%M:%SZ)

    if [[ "$RECURRING" == "true" && -n "$PROMPT" ]]; then
        jq --arg id "$JOB_ID" --arg prompt "$PROMPT" --arg cron "$CRON" --arg created "$CREATED" \
            '. + [{"id": $id, "prompt": $prompt, "cron": $cron, "created": $created}]' \
            "$LOOPS_FILE" > "${LOOPS_FILE}.tmp" && mv "${LOOPS_FILE}.tmp" "$LOOPS_FILE"
    fi

elif [[ "$TOOL_NAME" == "CronDelete" ]]; then
    JOB_ID=$(echo "$INPUT" | jq -r '.tool_input.id // empty')
    if [[ -n "$JOB_ID" ]]; then
        jq --arg id "$JOB_ID" 'map(select(.id != $id))' \
            "$LOOPS_FILE" > "${LOOPS_FILE}.tmp" && mv "${LOOPS_FILE}.tmp" "$LOOPS_FILE"
    fi
fi
