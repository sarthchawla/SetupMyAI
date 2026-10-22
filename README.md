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
| `@setupmyai/pstack` | 2 - Optional | 56 pstack engineering skills, playbooks, and principles (MIT, pinned upstream) |
| `@setupmyai/database` | 2 - Stack | PostgreSQL table design and migration skills |

## Quick Start

### Install the CLI globally (recommended)

```bash
npm install -g @setupmyai/cli
# or
pnpm add -g @setupmyai/cli
```

Then run `setupmyai init` from any project to select packages, tools and install level.

### One-off run (no global install)

```bash
pnpm dlx @setupmyai/cli init
# or
npx @setupmyai/cli init
```

### Via APM (alternative)

```bash
apm marketplace add SarthakChawla/SetupMyAi
apm install @setupmyai/universal @setupmyai/react-frontend
```

This launches an interactive picker:
```
? Select packages to install:
  [x] universal        — MR/PR commands, CI fixes, worktree, statusline, hooks
  [x] react-frontend   — React/TS rules, frontend skills
  [ ] kotlin-backend   — Kotlin/Ktor coding standards
  [x] bdd-testing      — BDD workflow with Playwright
  [ ] vercel-nextjs    — Vercel deployment commands
  [ ] auth-security    — Auth & security best practices
  [ ] database         — PostgreSQL & migration skills
```

### Via CLI (direct)

```bash
setupmyai install universal react-frontend bdd-testing
setupmyai install --tool claude universal    # Claude Code only
setupmyai install --tool cursor universal    # Cursor only
setupmyai install --tool cursor,codex universal # Multiple tools
setupmyai install --level user universal     # User-level install
setupmyai install --level project universal  # Current project (default)
setupmyai list                               # Show available packages
setupmyai list --installed --level all       # Summarize managed installs
setupmyai status --level all                 # Show drift and unmanaged files
setupmyai update --dry-run --level all       # Preview managed updates
setupmyai update --level all                 # Apply safe managed updates
setupmyai update --check --level all         # Check without writing; exits 1 on drift
setupmyai update --package universal         # Update one installed package
setupmyai sync --level all                   # Backwards-compatible update alias
setupmyai convert                            # Convert .md rules to .mdc and vice versa
```

Installed files are tracked in `.setupmyai/installed.yml` at project level or
`~/.setupmyai/installed.yml` at user level. `update` preserves locally modified
managed files unless `--force` is supplied; unmanaged files are reported but
never overwritten. `setupmyai status` also reports whether a newer CLI release
is available, and a normal update can prompt before running the global CLI
self-update. `update --check` remains read-only and never prompts or self-updates.

### pstack (optional)

```bash
setupmyai install pstack --tool codex       # Project: .agents/skills/
setupmyai install pstack --tool claude      # Project: .claude/skills/
setupmyai install pstack --tool cursor      # Project: .cursor/skills/
# Add --level user to install for your user instead of the project.
```

This bundles [backnotprop/pstack](https://github.com/backnotprop/pstack) at a pinned revision, including all skill support files and MIT notices. Installation copies files; invoke `poteto-help` for guidance, `setup-pstack` to configure models, or `poteto-mode` to start a task. Most upstream skills require explicit invocation; installation does not enable a mode or write model settings. `setupmyai sync` updates only manifest-backed managed installs; unmanaged installations are reported without being overwritten. Use `install <packages...>` to choose bundles. Optional runtime tools and reproducible vendoring are documented in [the bundle README](packages/pstack/README.md).

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
- `.codex/commands/`, `.codex/rules/`, `.codex/agents/`, `.agents/skills/`, `.codex/plugins/` (Codex)
- `.claude/scripts/` or `~/.claude/scripts/` (project- or user-level scripts)

## Supported Tools

- **Claude Code** — Full support (commands, rules, agents, skills, hooks, scripts)
- **Cursor** — Full support (commands, rules with .mdc format, agents, skills)
- **Codex** — Commands, instructions, skills, and plugins (via APM compatibility)

- **Codex** — Skills in `.agents/skills/`; commands and instructions via APM compatibility

- **OpenCode** — Commands, rules, agents, and skills in `.opencode/`
- **Gemini** — Commands, rules, agents, and skills in `.gemini/`

Select one or more tools with `--tool claude,cursor,codex,opencode,gemini`, or use `--tool all` (default).

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
