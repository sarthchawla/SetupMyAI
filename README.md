# SetupMyAi

Portable AI agent configuration packages. Install once, use everywhere.

Stop copy-pasting `.claude/commands/`, `.cursor/rules/`, and agent configs across repos. **SetupMyAi** packages your AI setup into modular, versioned, selectively installable packages that work with **Claude Code**, **Cursor**, **Codex**, **OpenCode**, and **Gemini**.

https://github.com/user-attachments/assets/eb0838d1-8f75-4e3a-aa86-988c8551fbd1

## Packages

| Package | Tier | What's Inside |
|---------|------|---------------|
| `@setupmyai/universal` | 1 - Any repo | MR/PR commands, CI fixes, worktree management, statusline, hooks, loops |
| `@setupmyai/react-frontend` | 2 - Stack | React/TS rules, 7 frontend skills (testing, code review, perf, design) |
| `@setupmyai/kotlin-backend` | 2 - Stack | Kotlin/Ktor coding standards and patterns |
| `@setupmyai/bdd-testing` | 2 - Stack | Playwright BDD workflow — 6 commands, 3 agents, skills, rules |
| `@setupmyai/vercel-nextjs` | 2 - Stack | Vercel deployment debugging and log commands |
| `@setupmyai/auth-security` | 2 - Stack | Auth best practices (Better Auth, 2FA, email/password security) |
| `@setupmyai/database` | 2 - Stack | PostgreSQL table design and migration skills |

## Quick Start

### Install the CLI globally (recommended)

```bash
npm install -g @setupmyai/cli
# or
pnpm add -g @setupmyai/cli
```

Then run from any project:

```bash
setupmyai init                               # Interactive picker
setupmyai install universal react-frontend   # Install specific packages
setupmyai list                               # Show available & installed
setupmyai sync                               # Pull latest versions
setupmyai convert                            # Convert .md rules to .mdc and vice versa
```

### One-off run (no install)

```bash
pnpm dlx @setupmyai/cli init
# or
npx @setupmyai/cli init
```

### Interactive picker

`setupmyai init` launches an interactive picker:

```
? Select tools to target: (claude, cursor, codex, opencode, gemini, or all)
? Install level: (project or user)
? Select packages to install:
  [x] universal        — MR/PR commands, CI fixes, worktree, statusline, hooks
  [x] react-frontend   — React/TS rules, frontend skills
  [ ] kotlin-backend   — Kotlin/Ktor coding standards
  [x] bdd-testing      — BDD workflow with Playwright
  [ ] vercel-nextjs    — Vercel deployment commands
  [ ] auth-security    — Auth & security best practices
  [ ] database         — PostgreSQL & migration skills
```

### Targeting specific tools and levels

```bash
setupmyai install universal --tool claude            # Claude Code only
setupmyai install universal --tool cursor,codex      # Multiple tools
setupmyai install universal --level user             # Install to ~/ (user level)
setupmyai install universal --level project          # Install to cwd (default)
```

### Via APM (alternative)

```bash
apm marketplace add SarthakChawla/SetupMyAi
apm install @setupmyai/universal @setupmyai/react-frontend
```

## How It Works

```
SetupMyAi packages  -->  APM resolves & places files  -->  Thin CLI handles the rest
                                                            - settings.json merge
                                                            - .md <-> .mdc conversion
                                                            - MCP config injection
                                                            - Script installation
```

Files are placed into:
- `.claude/commands/`, `.claude/rules/`, `.claude/agents/`, `.claude/skills/` (Claude Code)
- `.cursor/commands/`, `.cursor/rules/`, `.cursor/agents/`, `.cursor/skills/` (Cursor)
- `~/.claude/scripts/` (user-level scripts like statusline)

## Supported Tools

- **Claude Code** — Full support (commands, rules, agents, skills, hooks, scripts)
- **Cursor** — Full support (commands, rules with .mdc format, agents, skills)
- **Codex** — Commands and instructions
- **OpenCode** — Commands and instructions
- **Gemini** — Commands and instructions

Pick one or more with `--tool claude,cursor,codex,opencode,gemini` or use `--tool all` (default).

## Adding Your Own Org Package

Want to add organization-specific workflows (Jira, on-call, analytics, MCP configs)? Create a new Tier 3 package:

```bash
mkdir -p packages/my-org-workflows/{commands,agents,rules,skills,mcp}
# Add your org-specific commands, agents, rules, etc.
# Create packages/my-org-workflows/apm.yml
# Add to root apm.yml packages list
```

## Contributing

1. Add/modify files in the relevant `packages/<name>/` directory
2. Update the package's `apm.yml` if adding new primitive types
3. Test with `setupmyai install <package> --dry-run`
4. Submit a pull request

### Adding a New Package

```bash
mkdir -p packages/my-package/{commands,rules,skills}
# Add your files
# Create packages/my-package/apm.yml
# Add to root apm.yml packages list
```

## License

MIT
