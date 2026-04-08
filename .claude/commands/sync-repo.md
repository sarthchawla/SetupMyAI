# Sync Between SetupMyAi and Source Repos

Bidirectional sync between SetupMyAi packages and tracked source repos.

**Usage**: `$ARGUMENTS` should be one of:
- `from <repo-alias-or-path>` — Pull changes FROM a source repo into SetupMyAi
- `to <repo-alias-or-path>` — Push changes FROM SetupMyAi TO a source repo
- `status` — Show sync status for all tracked repos
- `status <repo-alias-or-path>` — Show sync status for a specific repo
- (empty) — Interactive mode, show status then ask what to do

## Step 1: Load sources.yml

Read `sources.yml` (at the project root) to get:
- All tracked repos and their paths
- All tracked files with their source mappings and last sync dates

If `$ARGUMENTS` contains a repo path not yet tracked, tell the user to run `/scan-repo <path>` first.

## Step 2: Run the diff script

Run the helper script to compare timestamps and detect changes:

```bash
bash "$(git rev-parse --show-toplevel)/scripts/sync-diff.sh" [repo-alias]
```

This outputs a list of files with their sync status (newer-local, newer-source, identical, missing).

## Step 3: For each tracked file, determine sync status

For files (not directories), compare using `diff`:
- **Identical**: no action needed
- **Source newer**: candidate for pull (source repo was updated)
- **Local newer**: candidate for push (SetupMyAi was updated)
- **Both changed**: conflict — needs manual resolution
- **Source missing**: file was deleted in source repo
- **Local missing**: file was deleted in SetupMyAi

For directories (skills), compare the SKILL.md file as a proxy.

## Step 4: Show preview

### For `status` or interactive mode:
```
SYNC STATUS for all tracked repos
──────────────────────────────────────────────────────

📂 my-project (my-project)
   Last scanned: 2026-04-08
   ✓ 15 files in sync
   ← 2 files newer in source (pull candidates)
   → 1 file newer locally (push candidate)
──────────────────────────────────────────────────────
```

### For `from <repo>`:
```
PREVIEW: Pull from [repo-name]
──────────────────────────────────────────────────────

WILL PULL (source newer):
  ⚡ create-mr.md          universal     [source: Apr 8 → local: Apr 5]
     Diff: 3 lines added, 1 removed (glab auth fix)
  📏 frontend-standards.md  react-frontend [source: Apr 7 → local: Apr 1]

CONFLICTS (both sides changed):
  🤖 bdd-test-strategist.md  bdd-testing  [both modified since last sync]
     → Will show diff for manual resolution

UNCHANGED: 12 files
──────────────────────────────────────────────────────
Proceed? [y/n/select specific files]
```

### For `to <repo>`:
```
PREVIEW: Push to [repo-name]
──────────────────────────────────────────────────────

WILL PUSH (local newer):
  ⚡ fix-ci.md              → .claude/commands/fix-ci.md
     Diff: 5 lines added (auto-detect build tool)
  
NEW (not in target repo yet):
  ⚡ smart-rebase.md        → .claude/commands/smart-rebase.md
  📏 worktree-safety.md     → .claude/rules/worktree-safety.md

⚠ NOTE: Files with {{PLACEHOLDER}} values will need manual configuration in the target repo.

UNCHANGED: 8 files
──────────────────────────────────────────────────────
Proceed? [y/n/select specific files]
```

## Step 5: Wait for user confirmation

Ask the user to confirm. They can:
- `y` — proceed with all changes
- `n` — cancel
- Select specific files by name
- For conflicts: show the full diff and ask which version to keep (source, local, or merge)

## Step 6: Execute sync

### For `from` (pull):
1. For each approved file, copy from source repo to SetupMyAi package location
2. If the file had been genericized (has `{{PLACEHOLDER}}`s), warn the user that pulling may overwrite genericized versions with project-specific ones — ask if they want to re-genericize
3. Update `last_synced` in sources.yml

### For `to` (push):
1. For each approved file, determine the correct target path in the source repo:
   - Look up `sources[].path` in sources.yml for the mapping
   - If the source repo uses `.cursor/` format, auto-convert `.md` rules to `.mdc`
   - If pushing to both `.claude/` and `.cursor/` dirs in the target, handle both
2. If the file has `{{PLACEHOLDER}}` values, warn the user they need to replace them
3. Update `last_synced` in sources.yml

### For conflicts:
1. Show the full diff between source and local versions
2. Ask user: keep source, keep local, or open both for manual merge
3. Apply chosen resolution

## Step 7: Update sources.yml

Update `last_synced` timestamps and `direction` for all synced files.

## Step 8: Summary

```
✅ Sync complete:
   ← Pulled 2 files from my-project
   → Pushed 1 file to my-project
   ⚠ 1 conflict resolved (kept local version of bdd-test-strategist.md)

📋 sources.yml updated
```
