---
description: Analyze branch changes vs default branch and update all affected tests -- fully autonomous
---

# Update Tests for Branch Changes (Autonomous)

Automatically analyze all changes on the current branch compared to the default branch, then identify and update **all** affected tests. **No user input required** -- runs fully autonomously.

## Context

- **Current branch**: `{{ git.currentBranch }}`

## Step 1: Detect Project and Get Changes

```bash
# Detect default branch
DEFAULT_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo "main")

# Get the merge base
MERGE_BASE=$(git merge-base $DEFAULT_BRANCH HEAD)

# List all changed files with status
git diff --name-status $MERGE_BASE HEAD

# Get summary
git diff $MERGE_BASE HEAD --stat
```

Categorize changes into:
- **Source files** (application code, excluding test files)
- **Existing test files** (already modified tests)
- **Config/build files**
- **Shared/library files**

## Step 2: Map Changes to Tests

For each changed source file, find associated test files:

```bash
# Find test file for a source file (try common patterns)
SOURCE_FILE="$1"
DIR=$(dirname "$SOURCE_FILE")
BASE=$(basename "$SOURCE_FILE" | sed 's/\.[^.]*$//')
EXT=$(basename "$SOURCE_FILE" | grep -o '\.[^.]*$')

# Try common test file patterns
for pattern in "${DIR}/${BASE}.test${EXT}" "${DIR}/${BASE}.spec${EXT}" "${DIR}/__tests__/${BASE}${EXT}" "tests/${SOURCE_FILE}"; do
    [ -f "$pattern" ] && echo "$pattern"
done
```

## Step 3: Present Change Analysis

Briefly present findings:

```markdown
## Branch Change Analysis: `<branch>` vs `<default-branch>`

### Changed Files Summary
- Source files: X files changed
- Test files already modified: X files
- Config/build: X files

### Test Impact Matrix
| Source File | Associated Test | Status |
|------------|----------------|--------|
| src/foo.ts | src/foo.test.ts | Needs update |
| src/bar.ts | - | Missing test |
```

## Step 4: Update ALL Affected Tests (No User Input)

**Automatically update all affected tests.**

For each test file to update:

1. **Read the source file** that changed to understand what's different
2. **Read the existing test file** to understand current coverage
3. **Read the diff** for the source file:
   ```bash
   git diff $(git merge-base $DEFAULT_BRANCH HEAD) HEAD -- <source-file>
   ```
4. **Identify gaps**: New functions/exports without tests, changed behavior not reflected in tests, removed code with stale tests

### Update Strategy

- Update existing test cases to match changed behavior (props, API shapes, return values)
- Add new test cases for new functionality
- Remove stale test cases for deleted functionality
- Ensure mocks match updated contracts
- Follow existing test patterns in the file

## Step 5: Run Updated Tests

Run each updated test to verify:
```bash
<test-command> <updated-test-files>
```

## Step 6: Fix Failures (Automatically)

If any tests fail after updates:
1. Read the error output
2. Determine if the test logic is wrong or the source code has an issue
3. Fix the test (prefer fixing tests over source code unless there's clearly a bug)
4. Re-run the specific failing test
5. Repeat until all tests pass

## Step 7: Present Summary

```markdown
## Test Update Summary

### Updated Tests
| File | Changes Made | Status |
|------|-------------|--------|
| ... | ... | PASS/FAIL |

### New Tests Created
| File | Coverage | Status |
|------|----------|--------|
| ... | ... | PASS/FAIL |

### Removed/Cleaned Up
| File | Reason |
|------|--------|
| ... | Stale test for removed code |

### Results
- Tests updated: X
- Tests created: X
- All passing: YES/NO
```

## Guidelines

- **Do NOT ask the user any questions** -- make reasonable decisions autonomously
- Always read source AND test files before making changes
- Follow existing test patterns and conventions in each file
- Do not over-test: focus on behavior changes, not implementation details
- Keep mocks minimal and focused
- Preserve existing passing test cases unless they test removed functionality
- When creating new test files, follow the naming convention of adjacent test files
- NEVER lower coverage thresholds -- add more tests instead
