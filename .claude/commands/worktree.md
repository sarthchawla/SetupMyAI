---
name: worktree
description: Setup a new git worktree for parallel development
arguments:
  - name: branch
    description: Branch name for the worktree
    required: false
  - name: source
    description: Source branch to create from
    required: false
---

# Worktree Setup Command

This command creates a new git worktree for parallel development on a separate branch without disrupting your current work.

## Behavior

### Step 1: Gather Branch Name

If the `branch` argument is not provided or is empty, ask the user:

"What branch name would you like for this worktree?"

Provide these options:
- Let them type a custom branch name
- Suggest common patterns like `feature/[name]` or `bugfix/[name]`

Validate the branch name:
- Must only contain alphanumeric characters, `-`, `_`, or `/`
- Cannot have consecutive slashes
- Cannot start or end with `/`

### Step 2: Gather Source Branch

If the `source` argument is not provided or is empty, ask the user:

"What source branch should I create this from?"

Provide these options:
- Default branch (auto-detect with `git symbolic-ref refs/remotes/origin/HEAD`) - Recommended
- Current branch (run `git rev-parse --abbrev-ref HEAD` to get it)
- Let them specify another branch

### Step 3: Check for Project-Specific Setup

Check if the project has a worktree setup script:
```bash
# Check common locations for worktree setup scripts
if [ -f "package.json" ] && grep -q "worktree:setup" package.json; then
    echo "Found pnpm worktree:setup script"
elif [ -f "Makefile" ] && grep -q "worktree" Makefile; then
    echo "Found Makefile worktree target"
fi
```

### Step 4: Create the Worktree

**If project has a setup script:**
```bash
pnpm worktree:setup --branch "$BRANCH" --source "$SOURCE"
```

**Otherwise, use standard git worktree:**
```bash
# Fetch latest
git fetch origin

# Determine worktree path (sibling directory or .worktrees/)
REPO_NAME=$(basename "$(git rev-parse --show-toplevel)")
WORKTREE_DIR="../${REPO_NAME}-worktrees/${BRANCH//\//-}"

# Create worktree
git worktree add "$WORKTREE_DIR" -b "$BRANCH" "origin/$SOURCE"
```

### Step 5: Report Results

After successful execution, format the output as a clear summary:

**Worktree Setup Complete!**

| Resource  | Value                              |
|-----------|-----------------------------------|
| Path      | [worktree path]                   |
| Branch    | [branch name]                     |
| Source    | [source branch]                   |

Mention any additional setup needed (e.g., `pnpm install`, dependency installation).

### Error Handling

If the command fails, provide helpful guidance:
- **Invalid branch name**: Check the branch name format or if worktree already exists
- **Git operation failed**: The source branch may not exist, suggest `git fetch`
- **Branch already exists**: Suggest using the existing branch or a different name

## Examples

**Interactive mode (no arguments):**
```
User: /worktree

Claude: I'll help you set up a new worktree.
What branch name would you like?

User: feature/user-authentication

Claude: What source branch should I create this from?
- main (Recommended)
- Current branch: develop

User: main

Claude: Setting up worktree...
```

**With both arguments:**
```
User: /worktree feature/api-v2 main

Claude: Setting up worktree for 'feature/api-v2' from 'main'...
```
