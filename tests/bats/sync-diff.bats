#!/usr/bin/env bats

# Tests for scripts/sync-diff.sh
# Script uses parallel arrays (bash 3.2 compatible)

SETUP_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/../.." && pwd)"
SCRIPT="$SETUP_ROOT/scripts/sync-diff.sh"
FIXTURE_SOURCES="$SETUP_ROOT/tests/fixtures/sync-test-sources.yml"

setup() {
  if [ -f "$SETUP_ROOT/sources.yml" ]; then
    cp "$SETUP_ROOT/sources.yml" "$SETUP_ROOT/sources.yml.bats-backup"
  fi
}

teardown() {
  if [ -f "$SETUP_ROOT/sources.yml.bats-backup" ]; then
    mv "$SETUP_ROOT/sources.yml.bats-backup" "$SETUP_ROOT/sources.yml"
  else
    rm -f "$SETUP_ROOT/sources.yml"
  fi
}

@test "exits 0 when run with valid sources.yml" {
  cp "$FIXTURE_SOURCES" "$SETUP_ROOT/sources.yml"
  run bash "$SCRIPT"
  [ "$status" -eq 0 ]
}

@test "output contains REPO section" {
  cp "$FIXTURE_SOURCES" "$SETUP_ROOT/sources.yml"
  run bash "$SCRIPT"
  [ "$status" -eq 0 ]
  [[ "$output" == *"--- REPOS ---"* ]]
  [[ "$output" == *"REPO|mock|"* ]]
}

@test "output contains FILE section" {
  cp "$FIXTURE_SOURCES" "$SETUP_ROOT/sources.yml"
  run bash "$SCRIPT"
  [ "$status" -eq 0 ]
  [[ "$output" == *"--- FILES ---"* ]]
  [[ "$output" == *"FILE|"* ]]
}

@test "script handles missing sources.yml gracefully" {
  rm -f "$SETUP_ROOT/sources.yml"
  run bash "$SCRIPT"
  [ "$status" -ne 0 ]
  [[ "$output" == *"ERROR"* ]]
}
