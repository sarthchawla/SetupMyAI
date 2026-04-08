# Create BDD Tests

Implement BDD tests end-to-end: feature, steps, page objects, fixtures, and initial green run.

Use `$ARGUMENTS` as optional context (feature path, scenario names, ticket id).

## Steps

1. Ensure test-type decision exists (run `/bdd-test-strategy` if needed).
2. Create/update feature file(s) under the project's features directory.
3. Run BDD code generation (e.g., `pnpm bddgen`).
4. Implement step file(s) under the project's steps directory.
5. Implement/extend page objects under the project's pages directory.
6. Keep steps thin, page objects rich, selectors stable.
7. Wire/update fixtures if needed.
8. Run focused Playwright test and fix obvious issues.
9. When implementation fails due to data/state uncertainty, use `psql` to debug DB schema/data assumptions before changing test logic.

## Selector Priority

1. `getByRole`
2. `getByLabel` / `getByPlaceholder` / `getByText`
3. `getByTestId`
4. Semantic data attributes
5. CSS fallback only

## Output

- Files created/updated.
- Commands run.
- Current status (green / remaining failures).
- If not green, handoff to `/bdd-run-fix`.
