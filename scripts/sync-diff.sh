#!/bin/bash
# sync-diff.sh — Compare tracked files between SetupMyAi and source repos
# Called by the /sync-repo Claude command
# Usage: bash sync-diff.sh [repo-alias]
#   If repo-alias is provided, only check that repo. Otherwise check all.
# Compatible with bash 3.2+ (macOS default)

set -euo pipefail

SETUP_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCES_FILE="$SETUP_ROOT/sources.yml"
REPO_FILTER="${1:-}"

if [ ! -f "$SOURCES_FILE" ]; then
  echo "ERROR: sources.yml not found at $SOURCES_FILE"
  exit 1
fi

echo "=== SYNC DIFF ==="
echo "SetupMyAi: $SETUP_ROOT"
echo "Date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Filter: ${REPO_FILTER:-all repos}"
echo ""

# ── Parse repos section ───────────────────────────────────────────────────
# Store repo keys and paths in parallel arrays (bash 3.2 compatible)
repo_keys=()
repo_paths=()

echo "--- REPOS ---"
in_repos=false
current_repo=""

while IFS= read -r line; do
  if [[ "$line" =~ ^repos: ]]; then
    in_repos=true
    continue
  fi
  if [[ "$line" =~ ^files: ]]; then
    in_repos=false
    continue
  fi

  if $in_repos; then
    if [[ "$line" =~ ^[[:space:]][[:space:]]([a-z0-9_-]+):$ ]]; then
      current_repo="${BASH_REMATCH[1]}"
    fi
    if [[ "$line" =~ ^[[:space:]]+path:[[:space:]]+(.*) ]]; then
      rp="${BASH_REMATCH[1]}"
      repo_keys+=("$current_repo")
      repo_paths+=("$rp")
      echo "REPO|$current_repo|$rp|exists=$([ -d "$rp" ] && echo yes || echo no)"
    fi
  fi
done < "$SOURCES_FILE"
echo ""

# Helper: look up repo path by key from parallel arrays
get_repo_path() {
  local key="$1"
  local i=0
  for k in "${repo_keys[@]}"; do
    if [ "$k" = "$key" ]; then
      echo "${repo_paths[$i]}"
      return
    fi
    i=$((i + 1))
  done
  echo ""
}

# ── Parse files section and compare ───────────────────────────────────────
echo "--- FILES ---"
in_files=false
current_local=""
current_package=""
current_type=""
current_sources=()

process_entry() {
  if [ -z "$current_local" ]; then return; fi

  local local_path="$SETUP_ROOT/$current_local"
  local local_exists="no"
  local local_mtime="0"

  if [ -e "$local_path" ]; then
    local_exists="yes"
    if [ -d "$local_path" ]; then
      local_mtime=$(find "$local_path" -type f -exec stat -f '%m' {} \; 2>/dev/null | sort -rn | head -1 || echo "0")
    else
      local_mtime=$(stat -f '%m' "$local_path" 2>/dev/null || echo "0")
    fi
  fi

  for source_info in "${current_sources[@]}"; do
    local repo_key
    local source_rel
    repo_key=$(echo "$source_info" | cut -d'|' -f1)
    source_rel=$(echo "$source_info" | cut -d'|' -f2)

    if [ -n "$REPO_FILTER" ] && [ "$repo_key" != "$REPO_FILTER" ]; then
      continue
    fi

    local repo_path
    repo_path=$(get_repo_path "$repo_key")
    if [ -z "$repo_path" ]; then continue; fi

    local source_path="$repo_path/$source_rel"
    local source_exists="no"
    local source_mtime="0"
    local status="unknown"

    if [ -e "$source_path" ]; then
      source_exists="yes"
      if [ -d "$source_path" ]; then
        source_mtime=$(find "$source_path" -type f -exec stat -f '%m' {} \; 2>/dev/null | sort -rn | head -1 || echo "0")
      else
        source_mtime=$(stat -f '%m' "$source_path" 2>/dev/null || echo "0")
      fi
    fi

    if [ "$local_exists" = "no" ] && [ "$source_exists" = "no" ]; then
      status="both-missing"
    elif [ "$local_exists" = "no" ]; then
      status="local-missing"
    elif [ "$source_exists" = "no" ]; then
      status="source-missing"
    elif [ -f "$local_path" ] && [ -f "$source_path" ]; then
      if diff -q "$local_path" "$source_path" > /dev/null 2>&1; then
        status="identical"
      elif [ "$source_mtime" -gt "$local_mtime" ]; then
        status="source-newer"
      elif [ "$local_mtime" -gt "$source_mtime" ]; then
        status="local-newer"
      else
        status="different"
      fi
    elif [ -d "$local_path" ] && [ -d "$source_path" ]; then
      if [ "$source_mtime" -gt "$local_mtime" ]; then
        status="source-newer"
      elif [ "$local_mtime" -gt "$source_mtime" ]; then
        status="local-newer"
      else
        status="identical"
      fi
    else
      status="type-mismatch"
    fi

    local source_date
    local local_date
    source_date=$(date -r "$source_mtime" '+%Y-%m-%d %H:%M' 2>/dev/null || echo "N/A")
    local_date=$(date -r "$local_mtime" '+%Y-%m-%d %H:%M' 2>/dev/null || echo "N/A")

    echo "FILE|$status|$current_type|$current_package|$current_local|$repo_key|$source_rel|source_time=$source_date|local_time=$local_date"
  done
}

while IFS= read -r line; do
  if [[ "$line" =~ ^files: ]]; then
    in_files=true
    continue
  fi

  if ! $in_files; then continue; fi

  # New entry
  if [[ "$line" =~ ^[[:space:]][[:space:]]-[[:space:]]local:[[:space:]]+(.*) ]]; then
    process_entry

    current_local="${BASH_REMATCH[1]}"
    current_local="${current_local%\"}"
    current_local="${current_local#\"}"
    current_package=""
    current_type=""
    current_sources=()
  fi

  if [[ "$line" =~ ^[[:space:]]+package:[[:space:]]+(.*) ]]; then
    current_package="${BASH_REMATCH[1]}"
  fi

  if [[ "$line" =~ ^[[:space:]]+type:[[:space:]]+(.*) ]]; then
    current_type="${BASH_REMATCH[1]}"
  fi

  if [[ "$line" =~ repo:[[:space:]]*([a-z0-9_-]+).*path:[[:space:]]*(.*)[[:space:]]*\} ]]; then
    local_repo_key="${BASH_REMATCH[1]}"
    local_source_path="${BASH_REMATCH[2]}"
    local_source_path="${local_source_path%\"}"
    local_source_path="${local_source_path#\"}"
    local_source_path="${local_source_path% }"
    current_sources+=("$local_repo_key|$local_source_path")
  fi

done < "$SOURCES_FILE"

# Process last entry
process_entry

echo ""
echo "--- SUMMARY ---"
echo "Done. Parse FILE| lines above for status breakdown."
