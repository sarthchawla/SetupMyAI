---
description: Run all repo tests, then fix failures — works with any test runner
---

You are the orchestrator for a full test suite run. Your job is to discover all test commands in the project, run them, and fix any failures found.

## Step 1: Discover Test Commands

Auto-detect the project's test setup by checking:

```bash
# Check package.json scripts
if [ -f "package.json" ]; then
    cat package.json | jq '.scripts | to_entries[] | select(.key | test("test|lint|check|build")) | "\(.key): \(.value)"'
fi

# Check for monorepo workspaces
if [ -f "pnpm-workspace.yaml" ] || [ -f "lerna.json" ] || grep -q "workspaces" package.json 2>/dev/null; then
    echo "Monorepo detected"
fi

# Check for other build systems
[ -f "Makefile" ] && echo "Makefile found"
[ -f "build.gradle" ] || [ -f "build.gradle.kts" ] && echo "Gradle found"
[ -f "Cargo.toml" ] && echo "Cargo found"
[ -f "pyproject.toml" ] || [ -f "setup.py" ] && echo "Python project found"
[ -f "go.mod" ] && echo "Go module found"
```

Build a list of test categories. Common ones include:
- Unit tests
- Integration tests
- Lint checks
- Type checks / Build
- Architecture tests
- BDD / E2E tests

## Step 2: Run Tests

Run each test category and capture results. Start with faster tests first:

**Priority order:**
1. Type checks / Build (blocks everything)
2. Lint checks (fast)
3. Unit tests
4. Architecture tests
5. Integration / BDD / E2E tests (slowest, may need setup)

For each test:
```bash
# Run the test command and capture exit code + output
<test-command> 2>&1
```

## Step 3: Analyze Failures

For each failed test:
1. Parse the output to identify:
   - Which specific tests/files failed
   - Error messages and stack traces
   - File paths and line numbers
2. Categorize the failure type:
   - Build/compile error
   - Lint error
   - Test assertion failure
   - Runtime error
   - Configuration issue

## Step 4: Fix Failures

For each failure:
1. Read the affected file(s)
2. Analyze the root cause
3. Apply the fix using the Edit tool
4. Show what was changed

**Fix Priority:**
- Build/compile errors first (they block everything)
- Lint errors second
- Test assertion mismatches third (update test expectations or fix source code)
- Configuration issues fourth

**Rules:**
- NEVER lower coverage thresholds -- add more tests to meet coverage instead
- Never suppress lint errors -- fix root cause
- For test failures, determine if test or code needs fixing
- Prefer fixing source code over tests (unless the test itself is wrong)

## Step 5: Re-run Failed Tests

After applying fixes, re-run only the previously failed tests to verify:
```bash
<specific-test-command-for-failed-tests>
```

If still failing, iterate (max 3 attempts per test).

## Step 6: Present Summary

```
| Test Type | Status | Issues Found | Fixed? |
|-----------|--------|-------------|--------|
| Build     | PASS   | -           | -      |
| Lint      | PASS   | 2 errors    | Yes    |
| Unit      | PASS   | 1 failure   | Yes    |
| E2E       | SKIP   | Needs setup | -      |
```

If any tests remain unfixed, explain what went wrong and suggest next steps.

## Guidelines

- Always read files before editing
- Run local validation after fixes before declaring success
- Never suppress lint errors -- fix root cause
- For test failures, determine if test or code needs fixing
- Keep changes minimal and focused
- Do NOT commit any changes -- show the user for review
