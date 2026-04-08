# SetupMyAi Architecture Plan

## Goal
Portable, shareable AI agent configuration packages that work across Claude Code, Cursor, and Codex. Eliminates repetitive setup across repos and enables selective team installation.

## Approach: Hybrid (APM + Thin CLI)

### Why Hybrid?
- **APM** handles standard primitives (commands, rules, agents, skills) with version pinning and audit
- **Thin CLI** handles gaps: settings.json merging, md-to-mdc conversion, MCP config injection, interactive picker
- As APM matures, the CLI shrinks — future-proof

## Package Structure

```
SetupMyAi/
├── apm.yml                    # Root manifest
├── package.json               # CLI package (@setupmyai/cli)
├── packages/
│   ├── universal/             # Tier 1 - Any repo
│   │   ├── commands/          # create-mr, fix-ci, worktree, etc. (12)
│   │   ├── rules/             # worktree-safety, testing-locator-order (2)
│   │   ├── hooks/             # hooks-config.json
│   │   ├── scripts/           # statusline, loops, notify (5)
│   │   └── apm.yml
│   ├── react-frontend/        # Tier 2a - React/TS projects
│   │   ├── rules/             # frontend-standards, react-frontend (2)
│   │   ├── skills/            # 7 skills incl. vercel-react-best-practices
│   │   └── apm.yml
│   ├── kotlin-backend/        # Tier 2b - Kotlin/Ktor projects
│   │   ├── rules/             # kotlin-backend (md + mdc)
│   │   └── apm.yml
│   ├── bdd-testing/           # Tier 2c - Playwright BDD
│   │   ├── commands/          # 6 bdd-* commands
│   │   ├── agents/            # 3 BDD agents
│   │   ├── skills/            # bdd-test-workflow
│   │   ├── rules/             # feature-test-bdd, page-objects
│   │   └── apm.yml
│   ├── vercel-nextjs/         # Tier 2d - Vercel deployment
│   │   ├── commands/          # fix-vercel-deployment, vercel-logs
│   │   └── apm.yml
│   ├── auth-security/         # Tier 2e - Auth best practices
│   │   ├── skills/            # 4 auth/security skills
│   │   └── apm.yml
│   └── database/              # Tier 2f - PostgreSQL
│       ├── skills/            # postgresql-table-design, DB migrations
│       └── apm.yml
└── cli/
    └── bin/index.js           # CLI entry point
    └── lib/
        ├── installer.js       # File placement logic
        ├── converter.js       # md <-> mdc conversion
        ├── merger.js          # settings.json + mcp.json merging
        └── packages.js        # Package registry

## Consumer Usage

```bash
# Via APM
apm install @setupmyai/universal @setupmyai/react-frontend

# Via CLI (interactive)
setupmyai init

# Via CLI (direct)
setupmyai install universal react-frontend bdd-testing
```

## Deduplication Strategy
- Commands existing in multiple repos: merged into single best version with auto-detection
- Hardcoded IDs/paths: replaced with {{PLACEHOLDER}} or auto-detected from git/project config
- Claude .md rules: auto-converted to Cursor .mdc format during install
- Agents/skills duplicated across .claude/ and .cursor/: single source, installed to both
