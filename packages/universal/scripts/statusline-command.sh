#!/bin/bash

# Read JSON input from stdin
input=$(cat)

# Extract values from JSON
model_display=$(echo "$input" | jq -r '.model.display_name // "Claude"')
cwd=$(echo "$input" | jq -r '.workspace.current_dir // .cwd')
remaining=$(echo "$input" | jq -r '.context_window.remaining_percentage // empty')
output_style=$(echo "$input" | jq -r '.output_style.name // empty')
vim_mode=$(echo "$input" | jq -r '.vim.mode // empty')
agent_name=$(echo "$input" | jq -r '.agent.name // empty')

# Get short directory name (last 2 components)
short_dir=$(echo "$cwd" | awk -F/ '{if (NF > 2) print $(NF-1)"/"$NF; else print $0}')

# Git information (skip locks for performance)
git_info=""
if [ -d "$cwd/.git" ] || git -C "$cwd" rev-parse --git-dir > /dev/null 2>&1; then
    branch=$(git -C "$cwd" rev-parse --abbrev-ref HEAD 2>/dev/null)
    if [ -n "$branch" ]; then
        git_status=$(git -C "$cwd" status --porcelain --no-optional-locks 2>/dev/null)
        if [ -n "$git_status" ]; then
            modified=$(echo "$git_status" | grep -c '^ M' 2>/dev/null || echo 0)
            added=$(echo "$git_status" | grep -c '^A' 2>/dev/null || echo 0)
            untracked=$(echo "$git_status" | grep -c '^??' 2>/dev/null || echo 0)

            status_symbols=""
            [ "$modified" -gt 0 ] && status_symbols="${status_symbols}~${modified}"
            [ "$added" -gt 0 ] && status_symbols="${status_symbols}+${added}"
            [ "$untracked" -gt 0 ] && status_symbols="${status_symbols}?${untracked}"

            git_info=$(printf " \033[33m(%s%s)\033[0m" "$branch" "$status_symbols")
        else
            git_info=$(printf " \033[32m(%s)\033[0m" "$branch")
        fi
    fi
fi

# Context usage
context_info=""
if [ -n "$remaining" ]; then
    remaining_int=$(printf "%.0f" "$remaining")
    if [ "$remaining_int" -lt 20 ]; then
        context_info=$(printf " \033[31m[ctx:%s%%]\033[0m" "$remaining_int")
    elif [ "$remaining_int" -lt 50 ]; then
        context_info=$(printf " \033[33m[ctx:%s%%]\033[0m" "$remaining_int")
    else
        context_info=$(printf " \033[32m[ctx:%s%%]\033[0m" "$remaining_int")
    fi
fi

# Output style info
style_info=""
if [ -n "$output_style" ] && [ "$output_style" != "default" ]; then
    style_info=$(printf " \033[35m[%s]\033[0m" "$output_style")
fi

# Vim mode info
vim_info=""
if [ -n "$vim_mode" ]; then
    if [ "$vim_mode" = "INSERT" ]; then
        vim_info=$(printf " \033[36m[INS]\033[0m")
    else
        vim_info=$(printf " \033[34m[NOR]\033[0m")
    fi
fi

# Agent info
agent_info=""
if [ -n "$agent_name" ]; then
    agent_info=$(printf " \033[95m[@%s]\033[0m" "$agent_name")
fi

# Build the complete status line
printf "\033[1;34m%s\033[0m \033[36m%s\033[0m%s%s%s%s%s" \
    "$model_display" \
    "$short_dir" \
    "$git_info" \
    "$context_info" \
    "$style_info" \
    "$vim_info" \
    "$agent_info"
