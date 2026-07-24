# Fix CI Failures

Fetch failed CI job logs, analyze the issues, propose fixes, and optionally apply them. Works with both GitHub Actions and GitLab CI.

## Step 0: Detect Platform

Auto-detect the CI platform from the git remote URL:

```bash
REMOTE_URL=$(git remote get-url origin 2>/dev/null)
```

| Remote URL pattern | Platform | CI System | Tool |
|-------------------|----------|-----------|------|
| `github.com` | GitHub | GitHub Actions | `gh` CLI |
| `gitlab` (any instance) | GitLab | GitLab CI | `glab` CLI / GitLab MCP |

## Context

- Current branch: `{{ git.currentBranch }}`

## Step 1: Get Pipeline/Workflow Status

Ask the user if they want to check:
- The latest pipeline for the current branch
- A specific pipeline/workflow run ID

**GitHub:**
```bash
gh run list --branch $(git branch --show-current) --limit 10
```

**GitLab (glab - preferred):**
```bash
glab api "projects/:fullpath/pipelines?ref=$(git branch --show-current)&per_page=1"
```

**GitLab (MCP fallback):**
Use `mcp__gitlab__list_pipelines` with `ref: current branch`, `per_page: 1`

For GitLab, always check child pipelines before deciding the CI status. After selecting the parent pipeline, inspect bridge jobs and collect every downstream pipeline ID:

```bash
glab api "projects/:fullpath/pipelines/<parent_pipeline_id>/bridges?per_page=100"
glab api "projects/:fullpath/pipelines/<child_pipeline_id>"
```

Treat the full CI status as the aggregate of the parent pipeline plus all child pipelines:

- If any parent or child pipeline is `running`, `pending`, `created`, or `waiting_for_resource`, CI is still in progress.
- If any parent or child pipeline is `failed`, `canceled`, or `skipped`, inspect that pipeline before reporting success.
- Only report CI as green when the parent pipeline and every child pipeline are `success`.

If using MCP and there is no dedicated child-pipeline helper, use the GitLab API endpoint above through `glab api` or the available generic API tool.

## Step 2: Get Failed Jobs

**GitHub:**
```bash
gh run view <run-id> --log-failed
```

**GitLab (glab - preferred):**
```bash
glab api "projects/:fullpath/pipelines/<pipeline_id>/jobs?scope=failed"
```

Run this for the parent pipeline and for every discovered child pipeline. Keep the source pipeline ID with each failed job so the analysis and commit message identify whether the failure came from the parent or a child pipeline.

**GitLab (MCP fallback):**
Use `mcp__gitlab__list_pipeline_jobs` with `scope: failed` for the parent pipeline and each child pipeline.

If no failed jobs are found but any parent or child pipeline is still running or pending, inform the user that CI is still in progress and exit. If no failed jobs are found and all parent and child pipelines succeeded, inform the user that all jobs passed and exit.

## Step 3: Analyze Each Failed Job

For each failed job:

**GitHub:**
```bash
gh run view <run-id> --log-failed 2>&1 | tail -500
```

**GitLab (glab):**
```bash
glab ci trace <job_id> | tail -n 500
```

**GitLab (MCP fallback):**
Use `mcp__gitlab__get_pipeline_job_output` with `limit: 500`

Analyze the logs to identify issue type:
- **Build Errors**: `error TS`, `Cannot find module`, type mismatches, compilation failures
- **Test Failures**: `FAIL`, `Expected`, `Received`, assertion errors, `AssertionError`
- **Lint Errors**: ESLint rules, detekt errors, `--max-warnings` exceeded
- **Runtime Errors**: Stack traces, exceptions, `NullPointerException`

Extract:
- File paths and line numbers
- Error messages
- Root cause analysis

## Step 4: Present Analysis Summary

```markdown
## CI Failure Analysis

### Pipeline/Workflow #<id> | Branch: `<branch-name>`

Parent pipeline: `<parent_pipeline_id>`
Child pipelines checked: `<child_pipeline_id_1>, <child_pipeline_id_2>, ...` or `none`

### Summary Table
| Pipeline | Job | Stage | Failure Type | Files Affected |
|----------|-----|-------|--------------|----------------|
| ... | ... | ... | ... |

### Detailed Analysis

#### Job: <job-name>
**Type**: <Build/Test/Lint/Runtime Error>
**Root Cause**: <description>

**Issues Found**:
1. `path/to/file.ts:42` - <issue description>
2. `path/to/file2.ts:15` - <issue description>

**Proposed Fix**:
<description of what needs to change>
```

## Step 5: Ask User for Action

Ask the user what they want to do:

1. **Fix Selection**:
   - Fix all issues
   - Fix specific issues (provide numbered list)
   - Just view analysis (no fixes)

2. **After Fixing** (if fixing):
   - Fix only (no commit)
   - Fix and commit
   - Fix, commit, and push

## Step 6: Apply Fixes

For each issue to fix:
1. Read the affected file
2. Apply the fix using the Edit tool
3. Show what was changed

## Step 7: Validate Fixes

Run appropriate validation based on the project. Auto-detect available commands from `package.json`, `Makefile`, `build.gradle`, etc.:

- **Build**: `pnpm build`, `npm run build`, `./gradlew build`, `make build`
- **Lint**: `pnpm lint`, `npm run lint`, `./gradlew detekt`
- **Tests**: Run only the affected test files to save time
- **Type check**: `pnpm typecheck`, `tsc --noEmit`

## Step 8: Commit and Push (if requested)

If user chose to commit:
1. Stage changes: `git add <files>`
2. Commit with message:
   ```
   fix: resolve CI failures from pipeline/workflow #<id>

   - <brief description of fix 1>
   - <brief description of fix 2>
   ```
3. If push requested: `git push`

## Error Detection Patterns

### TypeScript/JavaScript Errors
- `error TS\d+:` - TypeScript compiler errors
- `Type '.*' is not assignable` - Type mismatch
- `Cannot find module` - Missing import
- `Property '.*' does not exist` - Missing property

### Test Failures
- `FAIL ` - Jest/Vitest test failure
- `Expected:` and `Received:` - Assertion mismatch
- `Timeout` - Test timeout
- `FAILED`, `expect.toBeVisible`, `locator.click` - Playwright failures

### Lint Errors
- `error  ` with rule name - ESLint error
- `warning  ` with rule name - ESLint warning

### Backend Errors
- `Exception` - Java/Kotlin exception
- `PrismaClientKnownRequestError`, `P\d{4}` - Prisma/Database error
- Stack trace patterns
- `NullPointerException`, `IllegalArgumentException`

## Guidelines

- Always read files before editing
- Run validation after fixes
- Never suppress lint errors - fix root cause
- For test failures, determine if test or code needs fixing
- Keep commit messages concise but descriptive
