# Fix Vercel Deployment

Diagnose and fix Vercel deployment issues by fetching runtime logs, build errors, and deployment status.

## Prerequisites

- Vercel CLI installed globally (`pnpm add -g vercel`)
- Authenticated (`vercel whoami` should show your username)
- Project linked (run `vercel link` in project root if not)

## Steps

### 1. List recent deployments

```bash
vercel ls 2>&1 | head -15
```

### 2. Inspect the latest deployment

```bash
vercel inspect <deployment-url>
```

Check for: build size, function regions, status.

### 3. Fetch error logs

Use `--no-follow` to get historical logs (without it, `vercel logs` streams live and hangs).

```bash
# Errors from the last 24 hours (all branches)
vercel logs --level error --since 24h --no-follow --json --limit 50 --no-branch

# 500-series status codes (use comma-separated integers, NOT wildcards like 5xx)
vercel logs --status-code 500,502,503,504 --since 24h --no-follow --json --limit 50 --no-branch

# Filter by environment
vercel logs --environment production --level error --since 1h --no-follow --json --no-branch

# Expand full log messages
vercel logs --level error --since 1h --no-follow --expand --no-branch
```

**Important CLI quirks:**
- `--no-follow` is required for non-streaming output — without it, the command streams forever
- `--no-branch` disables git branch auto-detection (use when you want logs across all branches)
- `--status-code` only accepts comma-separated integers (e.g., `500,502`), NOT patterns like `5xx`
- `--json` outputs JSON Lines format — useful for piping to `jq`
- `--limit` is `-n`, not `--limit` in some versions — check `vercel logs --help`

### 4. Analyze errors

Common Vercel deployment issues:

| Error | Root Cause | Fix |
|-------|-----------|-----|
| Prisma Query Engine not found for `rhel-openssl-3.0.x` | Missing `binaryTargets` in schema.prisma | Add `binaryTargets = ["native", "rhel-openssl-3.0.x"]` to generator block |
| `INVALID_ORIGIN` on auth endpoints | CORS/trustedOrigins don't include the deployment URL | Use `VERCEL_URL` env var to build dynamic origins |
| 504 Gateway Timeout | Function exceeds `maxDuration` | Increase in `vercel.json` functions config |
| `Environment variable not found` | Missing env var in Vercel project settings | Add via Vercel Dashboard or `vercel env add` |
| ESM/CJS module errors | Import compatibility in serverless | Use dynamic imports in `api/index.ts` handler |

### 5. Propose and apply fixes

- Trace each error to the source file and line
- Make the fix
- Verify with `pnpm --filter api build`
- Commit and push to trigger redeployment

## Quick Diagnosis Command

Run this one-liner to get a summary of recent errors:

```bash
vercel logs --level error --since 24h --no-follow --json --limit 20 --no-branch 2>&1 | jq -r '[.requestPath, .responseStatusCode, (.message | split("\n")[0])] | @tsv' | sort | uniq -c | sort -rn
```
