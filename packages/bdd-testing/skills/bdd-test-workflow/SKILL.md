---
name: bdd-test-workflow
description: This skill should be used when the user asks to "create bdd tests", "add playwright-bdd scenarios", "mock data for acceptance tests", "fix flaky bdd tests", "write feature and step files", or asks whether cases should be unit tests vs bdd tests.
version: 0.1.0
---

# BDD Test Workflow

## Goal

Plan and implement reliable Playwright BDD acceptance tests from UI and backend analysis, while explicitly separating cases that should stay unit/integration tests.

## Decide Unit vs BDD First

Use this rule set before implementation:

- Select **unit/integration tests** for pure logic, mappers, reducers, hook data transforms, validation branches, and component-level behavior that does not require a full user journey.
- Select **BDD tests** for business flows crossing multiple layers: page interactions, permissions/flags, modal flows, tabular actions, and request submission from UI through BFF.
- For mixed requests, split scope:
  - unit/integration for high combinatorial logic and edge matrices;
  - BDD for a small number of critical user journeys.

Use a decision table in output:

| Case | Layer Span | Risk | Test Type | Reason |
|---|---|---|---|---|
| <case> | <single/multi> | <low/med/high> | <unit/bdd> | <why> |

## Workflow

1. Trace UI -> API -> backend service path.
2. Identify feature flags, user/group requirements, and deterministic records.
3. Draft feature scenarios focused on user-visible outcomes.
4. Plan mocking strategy (seed data alignment first, route mocking only when justified).
   - Reload mock DB using the project's mock data setup scripts.
   - If required ports are occupied, ask user before killing the process on that port.
   - Use `psql` to inspect table schema during mock design/verification (`\dt`, `\d <table>`, `information_schema` queries).
5. Implement feature files, steps, page objects, and fixtures.
6. Use `psql` during implementation when schema/data assumptions are unclear.
7. Run BDD code generation, execute focused tests, fix failures, repeat to green.
8. Use `psql` during run/fix loops for backend/data-state debugging before changing assertions/selectors.
9. Confirm parallel-safety and scenario independence.

## Implementation Standards

- Keep steps thin; move interaction complexity to page objects.
- Use stable locators in priority order: role -> label/text -> testid -> data attrs -> css.
- Favor assertions on modal/toast/title/visible action states over brittle DOM shape.
- Mirror production filtering semantics in mock repositories to avoid wrong-entity status resolution.
- Verify schema assumptions with `psql` before and after mock-data updates.

## Validation Checklist

- Unit-vs-BDD decisions documented.
- Feature path and step path mirror each other.
- BDD code generation clean.
- Target scenarios pass repeatedly.
- Related BDD/UI tests checked for regression when mock behavior changes.
