# Run and Fix BDD Tests

Run targeted BDD tests and iterate until green with root-cause fixes.

Use `$ARGUMENTS` as optional grep pattern or feature path.

## Steps

1. Run focused tests first:
   - `pnpm playwright test --grep "<pattern>"`
2. For each failure:
   - Classify root cause (selector, timing, data, feature flag, mock contract, backend validation)
   - Fix at the correct layer (not just symptom masking)
   - For data/state issues during run-fix, use `psql` to inspect schema and records before changing assertions or selectors
3. Re-run targeted tests after each meaningful fix.
4. When target is green, run nearby related tests to detect regressions.
5. Summarize final status and residual risks.

## Failure Triage Heuristics

- **Wrong entity/status** -> verify backend/mock filtering semantics.
- **Wrong entity/status or unexpected data state** -> query with `psql` first, then fix mock/config/test logic.
- **Element not found** -> inspect rendered role/text/testid and virtualized-table scrolling.
- **Intermittent timing** -> stabilize waits on business-ready state, not sleep-heavy retries.
- **Mutation conflicts** -> isolate data or reduce state coupling in assertions.

## Output

- Failure -> root cause mapping.
- Fixes applied.
- Test runs and final green evidence.
