# Update Merge/Pull Request Title and Description

Update an existing merge request (GitLab) or pull request (GitHub) with a concise title and reviewer-friendly description (max 10 bullet points).

## Step 0: Detect Platform and Tool

Auto-detect the hosting platform and select the best available tool.

**Platform Detection:**
```bash
REMOTE_URL=$(git remote get-url origin 2>/dev/null)
```

| Remote URL pattern | Platform | Primary Tool | Fallback |
|-------------------|----------|-------------|----------|
| `github.com` | GitHub | `gh` CLI | - |
| `gitlab` (any instance) | GitLab | `glab` CLI | GitLab MCP tools |

**Decision Matrix:**
| Platform | Condition | Use |
|----------|-----------|-----|
| GitHub | `gh` available | `gh` CLI |
| GitLab | `glab` available & authenticated | `glab` CLI (preferred) |
| GitLab | `glab` unavailable, MCP available | GitLab MCP tools |

## Step 1: Identify the MR/PR

Ask the user which MR/PR to update:
- Use current branch to find it automatically?
- Provide specific MR IID / PR number?
- Search by title or branch name?

Current branch: `{{ git.currentBranch }}`

**GitHub:**
```bash
gh pr list --head {{ git.currentBranch }}
gh pr view --json title,body
```

**GitLab (glab):**
```bash
glab mr view --source-branch $(git branch --show-current)
```

**GitLab (MCP fallback):**
Use `mcp__gitlab__get_merge_request` with source branch or MR IID.

## Step 2: Analyze Changes

Analyze git diff and commit messages to understand what changed:
```bash
DEFAULT_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo "main")
git diff origin/${DEFAULT_BRANCH}...HEAD
git log origin/${DEFAULT_BRANCH}..HEAD --oneline
```

Check existing MR/PR description for any links/references to preserve.

## Step 3: Generate Title

### Title Format

Auto-detect title style from the branch name:
- **Ticket-prefixed branches** (e.g., `CWS-2838-add-feature`): `CWS-2838 - Add feature description`
- **Conventional branches** (e.g., `feature/add-auth`): `feat: Add auth`
- **Other branches**: Concise descriptive title

**Guidelines:**
- Keep it concise and descriptive
- Focus on the main change or feature

## Step 4: Generate Concise Description

### Description Format (MAX 10 BULLET POINTS)

```markdown
## Summary
Brief 1-2 sentence description of what this MR/PR does.

## Changes Made
- [List 3-5 key changes with specific details]
- [Group by category if needed: Frontend, Backend, Database, Tests]
- [Be precise - avoid vague terms like "improved" or "fixed"]

## Technical Details (Optional - use ONE format if helpful)

**Option A - Before/After:**
- **Before:** Old behavior
- **After:** New behavior

**Option B - Table (for config/data changes):**
| Field | Before | After | Reason |
|-------|--------|-------|--------|
| ... | ... | ... | ... |

## Testing
- [ ] Tests pass locally
- [ ] Manually verified key flows

## Related Links
- Ticket: [TICKET-ID](link) (if applicable)
- Related MRs/PRs: (if any)
```

**IMPORTANT:** Keep total bullet points under 10. Combine related items if needed.

## Step 5: Update the MR/PR

**GitHub:**
```bash
gh pr edit <number> --title "[type]: New title" --body "$(cat <<'EOF'
## Summary
...

## Changes Made
...
EOF
)"
```

**GitLab (glab - preferred):**
```bash
glab mr update <iid> \
  --title "[BRANCH-PREFIX] - Description" \
  --remove-source-branch \
  --description "$(cat <<'EOF'
## Summary
...

## Changes Made
...
EOF
)"
```

**GitLab (MCP fallback):**
Use `mcp__gitlab__update_merge_request` with:
- `project_id`: Auto-detect from git remote URL
- MR IID from Step 1
- Title and description as generated
- Preserve any important links from the original description

**Note:** If primary tool fails, automatically fall back to the alternative without asking the user.

## Guidelines

1. **Be Precise:** Explain what and how, not just "fixed" or "improved"
2. **Use Visual Aids Sparingly:** Only if it significantly helps understanding
3. **Stay Concise:** Max 10 bullet points total across all sections
4. **Think Like a Reviewer:** What's the minimum info needed to review?
5. **Preserve Context:** Keep important links or references from original description

## Final Step

After updating the MR/PR, provide:
- MR/PR URL
- Brief summary of what was updated
- Confirmation that both title and description follow the concise format

## Useful Commands

```bash
# GitHub
gh pr view
gh pr edit --add-reviewer username
gh pr edit --add-label "enhancement"
gh pr ready  # Convert draft to ready

# GitLab
glab mr view
glab mr update <iid> --remove-source-branch
```
