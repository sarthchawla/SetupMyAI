#!/bin/bash
# Claude Code Notification Script
# Sends macOS notifications with click-to-open functionality
# Only runs for Claude Code CLI app (not Cursor or VS Code integrations)
#
# Usage: notify.sh <title> <message> [sound]
#
# Environment variables:
#   CLAUDE_CODE_SILENT=1  - Suppress all notifications
#   CLAUDE_SESSION_ID     - Session ID for opening specific chat
#   CLAUDE_WORKING_DIR    - Working directory of the session
#
# File-based flag (more reliable than env vars for Claude hooks):
#   /tmp/.claude_code_silent - If this file exists, notifications are suppressed

# Only run for Claude Code CLI (not Cursor's Claude integration)
is_claude_code_cli() {
    [[ "${CLAUDE_CODE_ENTRYPOINT:-}" == "cli" ]] && return 0
    return 1
}

if ! is_claude_code_cli; then
    exit 0
fi

# Exit silently if in silent mode
if [[ "${CLAUDE_CODE_SILENT:-0}" == "1" ]] || [[ -f "/tmp/.claude_code_silent" ]]; then
    exit 0
fi

# Read JSON input from stdin (when called as a hook)
INPUT=""
if read -t 1 -r line 2>/dev/null; then
    INPUT="$line"
    while read -t 1 -r line 2>/dev/null; do
        INPUT="$INPUT$line"
    done
fi

# Parse notification details from hook JSON input
parse_notification() {
    if [[ -z "$INPUT" ]] || ! command -v jq &>/dev/null; then
        return
    fi

    local notification_type tool_name message tool_input_cmd tool_input_file

    notification_type=$(echo "$INPUT" | jq -r '.notification_type // empty' 2>/dev/null)
    tool_name=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)
    message=$(echo "$INPUT" | jq -r '.message // empty' 2>/dev/null)
    tool_input_cmd=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
    tool_input_file=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)

    case "$notification_type" in
        "permission_prompt")
            if [[ -n "$tool_name" ]]; then
                case "$tool_name" in
                    "Bash")
                        if [[ -n "$tool_input_cmd" ]]; then
                            local short_cmd="${tool_input_cmd:0:60}"
                            [[ ${#tool_input_cmd} -gt 60 ]] && short_cmd="${short_cmd}..."
                            echo "Run: $short_cmd"
                        else
                            echo "Permission: Bash command"
                        fi
                        ;;
                    "Edit"|"Write")
                        if [[ -n "$tool_input_file" ]]; then
                            echo "Edit: $(basename "$tool_input_file")"
                        else
                            echo "Permission: $tool_name file"
                        fi
                        ;;
                    "Read")
                        if [[ -n "$tool_input_file" ]]; then
                            echo "Read: $(basename "$tool_input_file")"
                        else
                            echo "Permission: Read file"
                        fi
                        ;;
                    *)
                        echo "Permission: $tool_name"
                        ;;
                esac
            else
                echo "Permission required"
            fi
            ;;
        "idle_prompt")
            echo "Waiting for your input"
            ;;
        "elicitation_dialog")
            if [[ -n "$message" ]]; then
                echo "Question: ${message:0:80}"
            else
                echo "Claude has a question"
            fi
            ;;
        "auth_success")
            echo "Authentication successful"
            ;;
        *)
            if [[ -n "$message" ]]; then
                echo "${message:0:80}"
            else
                echo "Needs your attention"
            fi
            ;;
    esac
}

# Get context about current work from hook input
get_task_context() {
    if [[ -z "$INPUT" ]] || ! command -v jq &>/dev/null; then
        return
    fi

    local cwd
    cwd=$(echo "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)
    if [[ -n "$cwd" ]]; then
        echo "[$(basename "$cwd")]"
        return
    fi
}

# Build notification message
PARSED_MESSAGE=$(parse_notification)
TASK_CONTEXT=$(get_task_context)

# Use parsed message if available, otherwise fall back to arguments
if [[ -n "$PARSED_MESSAGE" ]]; then
    TITLE="${TASK_CONTEXT:-Claude Code}"
    MESSAGE="$PARSED_MESSAGE"
else
    TITLE="${1:-Claude Code}"
    MESSAGE="${2:-Needs attention}"
fi
SOUND="${3:-default}"

# Get the terminal app that's likely running Claude Code
get_terminal_app() {
    # If running inside tmux, check the parent terminal
    if [[ -n "${TMUX:-}" ]]; then
        case "${LC_TERMINAL:-}" in
            "iTerm2")
                echo "com.googlecode.iterm2"
                return
                ;;
        esac
        if pgrep -q "iTerm2"; then
            echo "com.googlecode.iterm2"
            return
        elif pgrep -q "Warp"; then
            echo "dev.warp.Warp-Stable"
            return
        fi
        echo "com.apple.Terminal"
        return
    fi

    case "${TERM_PROGRAM:-}" in
        "iTerm.app")
            echo "com.googlecode.iterm2"
            return
            ;;
        "Apple_Terminal")
            echo "com.apple.Terminal"
            return
            ;;
        "WarpTerminal")
            echo "dev.warp.Warp-Stable"
            return
            ;;
        "vscode")
            if [[ -n "${CURSOR_TRACE_ID:-}" ]] || pgrep -q "Cursor"; then
                echo "com.todesktop.230313mzl4w4u92"
            else
                echo "com.microsoft.VSCode"
            fi
            return
            ;;
    esac

    if pgrep -q "iTerm2"; then
        echo "com.googlecode.iterm2"
    elif pgrep -q "Warp"; then
        echo "dev.warp.Warp-Stable"
    else
        echo "com.apple.Terminal"
    fi
}

TERMINAL_APP=$(get_terminal_app)

# Use terminal-notifier for clickable notifications
if command -v terminal-notifier &> /dev/null; then
    terminal-notifier \
        -title "$TITLE" \
        -message "$MESSAGE" \
        -sound "$SOUND" \
        -activate "$TERMINAL_APP" \
        -group "claude-code" \
        -sender "$TERMINAL_APP" \
        >/dev/null 2>&1
else
    # Fallback to osascript (no click-to-open)
    osascript -e "display notification \"$MESSAGE\" with title \"$TITLE\" sound name \"$SOUND\"" >/dev/null 2>&1
fi
