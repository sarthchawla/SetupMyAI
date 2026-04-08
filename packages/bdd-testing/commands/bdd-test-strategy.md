# BDD Test Strategy (Unit vs BDD)

Decide which requested cases should be unit/integration tests and which should be Playwright BDD acceptance tests.

Use `$ARGUMENTS` as optional scope text (feature name, ticket, flow).

## Steps

1. Ask for the target flow/cases if unclear.
2. Build a decision matrix:
   - Case
   - Layer span (single layer vs UI->BFF->backend)
   - Risk and business criticality
   - Recommended test type
   - Why
3. Apply rules:
   - **Unit/integration** for pure logic, transforms, reducers, utility behavior, component-local behavior.
   - **BDD** for real user journeys, role/flag gates, navigation/actions/modals, and submission flows.
4. Produce final split:
   - `Must be BDD`
   - `Should be unit/integration`
   - `Optional coverage`
5. Recommend next command(s):
   - `/bdd-plan`
   - `/bdd-mocks`
   - `/bdd-create`
   - `/bdd-run-fix`
   - or `/bdd-all-in-one`

## Output Format

```markdown
## Test Type Decision
| Case | Layer Span | Risk | Test Type | Why |
|---|---|---|---|---|

## Recommended Split
- Must be BDD: ...
- Should be unit/integration: ...
- Optional: ...

## Next Step
- Use /bdd-plan ...
```
