#!/bin/bash
# scan-repo.sh — Deterministic inventory of AI config files in a repo
# Called by the /scan-repo Claude command
# Usage: bash scan-repo.sh /path/to/repo

set -euo pipefail

REPO_PATH="${1:?Usage: scan-repo.sh /path/to/repo}"
REPO_PATH="$(cd "$REPO_PATH" && pwd)"
REPO_NAME="$(basename "$REPO_PATH")"

echo "=== SCAN RESULTS: $REPO_NAME ==="
echo "Path: $REPO_PATH"
echo "Date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""

# ── Scan function ──────────────────────────────────────────────────────────
scan_dir() {
  local tool_dir="$1"   # .claude or .cursor
  local sub_dir="$2"    # commands, rules, agents, skills, hooks, scripts
  local type="$3"       # command, rule, agent, skill, hook, script
  local base="$REPO_PATH/$tool_dir/$sub_dir"

  if [ ! -d "$base" ]; then return; fi

  for entry in "$base"/*; do
    [ -e "$entry" ] || continue
    local name="$(basename "$entry")"
    local rel_path="$tool_dir/$sub_dir/$name"

    if [ -d "$entry" ]; then
      local file_count=$(find "$entry" -type f | wc -l | tr -d ' ')
      local has_skill="no"
      [ -f "$entry/SKILL.md" ] || [ -f "$entry/SKILL.MD" ] && has_skill="yes"
      echo "DIR|$type|${tool_dir#.}|$rel_path|$name|files=$file_count|skill=$has_skill"
    else
      local size=$(wc -c < "$entry" | tr -d ' ')
      local lines=$(wc -l < "$entry" | tr -d ' ')
      local modified=$(stat -f '%Sm' -t '%Y-%m-%dT%H:%M:%S' "$entry" 2>/dev/null || stat -c '%y' "$entry" 2>/dev/null | cut -d. -f1)
      echo "FILE|$type|${tool_dir#.}|$rel_path|$name|size=${size}B|lines=$lines|modified=$modified"
    fi
  done
}

# ── Root files ─────────────────────────────────────────────────────────────
echo "--- ROOT FILES ---"
for f in CLAUDE.md AGENTS.md .cursorrules; do
  if [ -f "$REPO_PATH/$f" ]; then
    local_lines=$(wc -l < "$REPO_PATH/$f" | tr -d ' ')
    echo "ROOT|$f|lines=$local_lines"
  fi
done
echo ""

# ── Claude configs ─────────────────────────────────────────────────────────
echo "--- .claude/ ---"
scan_dir ".claude" "commands" "command"
scan_dir ".claude" "rules" "rule"
scan_dir ".claude" "agents" "agent"
scan_dir ".claude" "skills" "skill"
scan_dir ".claude" "hooks" "hook"
scan_dir ".claude" "scripts" "script"

# Check for settings.json
if [ -f "$REPO_PATH/.claude/settings.json" ]; then
  echo "CONFIG|settings|claude|.claude/settings.json"
fi
echo ""

# ── Cursor configs ─────────────────────────────────────────────────────────
echo "--- .cursor/ ---"
scan_dir ".cursor" "commands" "command"
scan_dir ".cursor" "rules" "rule"
scan_dir ".cursor" "agents" "agent"
scan_dir ".cursor" "skills" "skill"

if [ -f "$REPO_PATH/.cursor/mcp.json" ]; then
  echo "CONFIG|mcp|cursor|.cursor/mcp.json"
fi
echo ""

# ── Nested tool configs (e.g., ui/.claude/, bff-server/.cursor/) ───────────
echo "--- NESTED ---"
for nested in "$REPO_PATH"/*/; do
  [ -d "$nested" ] || continue
  local_name="$(basename "$nested")"
  # Skip node_modules, .git, etc.
  case "$local_name" in
    node_modules|.git|.cache|dist|build|coverage) continue ;;
  esac

  for tool_dir in .claude .cursor; do
    if [ -d "$nested/$tool_dir" ]; then
      for sub in commands rules agents skills hooks; do
        if [ -d "$nested/$tool_dir/$sub" ]; then
          for entry in "$nested/$tool_dir/$sub"/*; do
            [ -e "$entry" ] || continue
            local entry_name="$(basename "$entry")"
            local rel="$local_name/$tool_dir/$sub/$entry_name"
            if [ -d "$entry" ]; then
              echo "DIR|${sub%s}|${tool_dir#.}|$rel|$entry_name|nested=$local_name"
            else
              echo "FILE|${sub%s}|${tool_dir#.}|$rel|$entry_name|nested=$local_name"
            fi
          done
        fi
      done
    fi
  done
done
echo ""

# ── Summary ────────────────────────────────────────────────────────────────
echo "--- SUMMARY ---"
total_claude=0
total_cursor=0
if [ -d "$REPO_PATH/.claude" ]; then
  total_claude=$(find "$REPO_PATH/.claude" -type f -not -name '*.json' -not -name '.DS_Store' 2>/dev/null | wc -l | tr -d ' ')
fi
if [ -d "$REPO_PATH/.cursor" ]; then
  total_cursor=$(find "$REPO_PATH/.cursor" -type f -not -name '*.json' -not -name '.DS_Store' 2>/dev/null | wc -l | tr -d ' ')
fi
echo "Claude files: $total_claude"
echo "Cursor files: $total_cursor"
echo "Total: $((total_claude + total_cursor))"
