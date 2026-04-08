# Create BDD Mocks

Design and implement mock data/config needed for deterministic BDD tests.

Use `$ARGUMENTS` as optional scope (feature + group id + target actions).

## Steps

1. Confirm target scenarios and required states.
2. Inspect current mock sources:
   - Feature flags configuration
   - Seed data files (CSV, JSON, SQL fixtures)
   - Mock repository filtering semantics
3. Align with production query behavior:
   - Ensure proper entity filtering is respected
   - Avoid mixed-entity status resolution bugs
4. Apply minimal mock updates needed for scenario determinism.
5. Reload mock DB data using the project's mock data setup scripts.
6. Before starting/reloading on required ports, check port occupancy.
   - If the needed port is occupied, ask the user before killing the process on that port.
7. Use `psql` to inspect schema and validate assumptions while mocking.
   - Example checks: `\dt`, `\d <table>`, and `information_schema.columns` queries.
8. Validate with quick checks (API response or DB/mock verification).

## Guardrails

- Prefer data-level determinism over route interception.
- Use route interception only when requirement is explicitly submission-only UI validation.
- Avoid changes that alter unrelated domains.

## Output

- Files updated and why.
- Verification commands run and key evidence.
- Regression-risk note and what was validated.
