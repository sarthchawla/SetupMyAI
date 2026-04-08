---
description: Find and create missing tests for current branch changes vs default branch
---

# Create Missing Tests for Branch Changes

Analyze all changes on the current branch compared to the default branch, then create missing tests.

## Context

- **Current branch**: `{{ git.currentBranch }}`

## Step 1: Detect Project Structure

Auto-detect the project's test setup:

```bash
# Detect default branch
DEFAULT_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo "main")

# Detect test framework
[ -f "package.json" ] && cat package.json | jq -r '.devDependencies // {} | keys[]' | grep -E 'jest|vitest|mocha|playwright|cypress|cucumber'
[ -f "build.gradle" ] || [ -f "build.gradle.kts" ] && echo "gradle-test"
[ -f "Cargo.toml" ] && echo "cargo-test"
[ -f "pyproject.toml" ] && echo "pytest"
[ -f "go.mod" ] && echo "go-test"
```

Identify the test file naming convention by looking at existing tests:
```bash
# Find existing test files to understand naming patterns
find . -name "*.test.*" -o -name "*.spec.*" -o -name "*_test.*" -o -name "test_*" | head -20
```

## Step 2: Analyze Branch Changes

Get all changed/added files:

```bash
git diff ${DEFAULT_BRANCH}...HEAD --name-only --diff-filter=ACMR
```

Categorize the changed files:
- **Source files**: Application code (not tests, configs, or docs)
- **Test files**: Already modified tests (skip these)
- **Config files**: Skip
- **Documentation**: Skip

For each source file, determine if a corresponding test file exists using the detected naming convention.

## Step 3: Present Analysis

```markdown
## Missing Tests Analysis -- `<branch>` vs `<default-branch>`

| Source File | Test File | Status |
|------------|-----------|--------|
| src/utils/format.ts | src/utils/format.test.ts | EXISTS |
| src/hooks/useAuth.ts | - | MISSING |
| src/api/client.ts | src/api/client.test.ts | EXISTS (needs update) |
```

## Step 4: Create Missing Tests

For each source file missing tests:

1. **Read the source file** to understand its exports and behavior
2. **Read the diff** to understand what specifically changed:
   ```bash
   git diff ${DEFAULT_BRANCH}...HEAD -- <source-file>
   ```
3. **Read nearby existing test files** to understand patterns and conventions
4. **Create the test file** following existing patterns
5. **Run the new test** to verify it passes

For each source file with existing but incomplete tests:

1. **Read the source changes** and existing test file
2. **Add new test cases** for new/changed functionality
3. **Run the updated tests**

## Step 5: Validate

Run the newly created/updated tests:
```bash
# Auto-detect test runner and run specific files
<test-command> <test-file-paths>
```

If tests fail, fix them iteratively (max 3 attempts).

## Step 6: Present Summary

```markdown
## Test Creation Summary -- `<branch>` vs `<default-branch>`

### Created/Updated Test Files

| File | Action | Status |
|------|--------|--------|
| src/hooks/useAuth.test.ts | Created | PASS |
| src/api/client.test.ts | Updated (+2 cases) | PASS |

### Summary
- Tests created: X
- Tests updated: X
- All tests passing: YES/NO
```

## Guidelines

- NEVER lower coverage thresholds -- add more tests to meet coverage instead
- Follow existing test patterns and conventions in the codebase
- Do not over-test: focus on behavior, not implementation details
- Keep mocks minimal and focused
- Do NOT commit any changes -- show the user for review
- When creating new test files, follow the naming convention of adjacent test files
