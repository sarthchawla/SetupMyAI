#!/usr/bin/env bats

# Tests for scripts/scan-repo.sh

SCRIPT="$(cd "$(dirname "$BATS_TEST_FILENAME")/../.." && pwd)/scripts/scan-repo.sh"
MOCK_REPO="$(cd "$(dirname "$BATS_TEST_FILENAME")/../.." && pwd)/tests/fixtures/mock-repo"

@test "exits 0 on valid repo" {
  run bash "$SCRIPT" "$MOCK_REPO"
  [ "$status" -eq 0 ]
}

@test "exits non-zero on missing repo path (no args)" {
  run bash "$SCRIPT"
  [ "$status" -ne 0 ]
}

@test "output contains ROOT section with CLAUDE.md" {
  run bash "$SCRIPT" "$MOCK_REPO"
  [ "$status" -eq 0 ]
  [[ "$output" == *"ROOT|CLAUDE.md|lines="* ]]
}

@test "output contains ROOT section with AGENTS.md" {
  run bash "$SCRIPT" "$MOCK_REPO"
  [ "$status" -eq 0 ]
  [[ "$output" == *"ROOT|AGENTS.md|lines="* ]]
}

@test "output contains FILE entries for .claude/commands/" {
  run bash "$SCRIPT" "$MOCK_REPO"
  [ "$status" -eq 0 ]
  [[ "$output" == *"FILE|command|claude|"* ]]
}

@test "output contains FILE entry for deploy.md with type command and tool claude" {
  run bash "$SCRIPT" "$MOCK_REPO"
  [ "$status" -eq 0 ]
  [[ "$output" == *"FILE|command|claude|.claude/commands/deploy.md|deploy.md|size="* ]]
}

@test "output contains DIR entry for sample-skill with skill=yes" {
  run bash "$SCRIPT" "$MOCK_REPO"
  [ "$status" -eq 0 ]
  [[ "$output" == *"DIR|skill|claude|.claude/skills/sample-skill|sample-skill|files="*"skill=yes"* ]]
}

@test "output contains CONFIG entry for settings.json" {
  run bash "$SCRIPT" "$MOCK_REPO"
  [ "$status" -eq 0 ]
  [[ "$output" == *"CONFIG|settings|claude|.claude/settings.json"* ]]
}

@test "output contains FILE entry for .cursor/rules/react-patterns.mdc" {
  run bash "$SCRIPT" "$MOCK_REPO"
  [ "$status" -eq 0 ]
  [[ "$output" == *"FILE|rule|cursor|.cursor/rules/react-patterns.mdc|react-patterns.mdc|"* ]]
}

@test "output contains SUMMARY section" {
  run bash "$SCRIPT" "$MOCK_REPO"
  [ "$status" -eq 0 ]
  [[ "$output" == *"--- SUMMARY ---"* ]]
  [[ "$output" == *"Claude files:"* ]]
  [[ "$output" == *"Cursor files:"* ]]
  [[ "$output" == *"Total:"* ]]
}

@test "script does not scan node_modules" {
  # Create a temporary node_modules dir with a .claude inside
  local nm_dir="$MOCK_REPO/node_modules"
  local nm_claude="$nm_dir/.claude/commands"
  mkdir -p "$nm_claude"
  echo "# should be ignored" > "$nm_claude/ignored.md"

  run bash "$SCRIPT" "$MOCK_REPO"

  # Clean up
  rm -rf "$nm_dir"

  [ "$status" -eq 0 ]
  [[ "$output" != *"node_modules"* ]]
}
