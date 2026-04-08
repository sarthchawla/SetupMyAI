# Scan & Import from a Repo

Scan a repo at `$ARGUMENTS` (path to repo root) for AI agent configs and import them into SetupMyAi packages.

## Step 1: Run the inventory script

Run the helper script to discover all AI config files:

```bash
bash "$(git rev-parse --show-toplevel)/scripts/scan-repo.sh" "$ARGUMENTS"
```

This outputs a structured list of every command, rule, agent, skill, hook, and script found in `.claude/` and `.cursor/` directories.

## Step 2: Load existing sources

Read `sources.yml` (at the project root) to understand what's already tracked.

## Step 3: Identify new vs existing items

Compare the scan results against sources.yml:
- **New items**: not tracked yet — candidates for import
- **Existing items**: already tracked — check if source version is newer (compare with `diff`)
- **Duplicates**: same content already exists under a different name — skip or note

For each new item, determine:
1. **Which package** it belongs to (universal, react-frontend, kotlin-backend, bdd-testing, vercel-nextjs, auth-security, database — or suggest a new package)
2. **Does it need genericization?** Look for hardcoded paths, project-specific IDs, board numbers, etc. If found, note what needs `{{PLACEHOLDER}}` treatment
3. **Is it a duplicate/variant?** Compare content against existing commands with similar names

## Step 4: Show preview

Present a clear table to the user:

```
PREVIEW: Scan results for [repo-name]
──────────────────────────────────────────────────────

NEW ITEMS (to import):
  Package: universal
    ⚡ deploy-staging.md          command   [needs genericization: hardcoded URL]
    📏 code-review-checklist.md   rule      [ready as-is]

  Package: react-frontend  
    🧠 nextjs-caching/            skill     [ready as-is]

EXISTING (source newer — update candidates):
    ⚡ create-mr.md               command   [source: Mar 15 → local: Mar 10]

SKIPPED (already tracked, up to date):
    ⚡ fix-ci.md                  command   [identical]

DUPLICATES DETECTED:
    ⚡ raise-mr.md ≈ create-mr.md  [85% similar — merge?]
──────────────────────────────────────────────────────
Total: X new, Y updates, Z skipped
```

## Step 5: Wait for user confirmation

Ask: "Proceed with import? You can also exclude items by name (e.g., 'skip deploy-staging') or reassign packages (e.g., 'move nextjs-caching to vercel-nextjs')."

## Step 6: Execute import

For each approved item:

1. **If needs genericization**: Read the source file, replace hardcoded values with `{{PLACEHOLDER}}` patterns, write to the target package directory
2. **If ready as-is**: Copy directly to the target package directory
3. **If updating existing**: Read both versions, show the diff, ask user which parts to keep, then write the merged version
4. **If it's a directory (skill)**: Copy the entire directory

Target paths follow the convention:
- commands → `packages/<pkg>/commands/<name>.md`
- rules → `packages/<pkg>/rules/<name>.md`
- agents → `packages/<pkg>/agents/<name>.md`
- skills → `packages/<pkg>/skills/<name>/` (whole directory)
- hooks → `packages/<pkg>/hooks/<name>`
- scripts → `packages/<pkg>/scripts/<name>`

## Step 7: Update sources.yml

Read the current sources.yml, then update it:

1. **Add the repo** to the `repos:` section if not already present
2. **Add entries** for each imported file to the `files:` section with:
   - `local`: relative path in SetupMyAi
   - `sources`: array with `{ repo: <alias>, path: <relative-path-in-source> }`
   - `package`: which package it was placed in
   - `type`: command/rule/agent/skill/hook/script
   - `last_synced`: today's date
   - `direction`: origin
   - `notes`: any genericization notes

Write the updated sources.yml back.

## Step 8: Update the package's apm.yml if needed

If new primitive types were added (e.g., first agent in a package that only had commands), update that package's `apm.yml` to include the new type in its `primitives:` section.

## Step 9: Summary

Show what was done:
```
✅ Imported 3 items from [repo-name]:
   + packages/universal/commands/deploy-staging.md (genericized)
   + packages/react-frontend/skills/nextjs-caching/
   ↻ packages/universal/commands/create-mr.md (updated from source)

📋 sources.yml updated (repo added, 3 entries tracked)
```
