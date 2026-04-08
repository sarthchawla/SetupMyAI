# Plan BDD Tests

Plan BDD scenarios by tracing UI, BFF, and backend behavior before implementation.

Use `$ARGUMENTS` as optional context (ticket, page path, endpoint, flow summary).

## Steps

1. Clarify minimal inputs:
   - Entry page/route
   - Main user actions
   - Expected outcomes
   - Feature flags and group/role
2. Reverse engineer the flow:
   - UI component(s) and stable selectors
   - Query/mutation endpoint(s)
   - Backend route/service and key validation branches
3. Determine deterministic mock data needs:
   - Existing mock records to reuse
   - Missing records to add
   - Mock DB handling plan (use project-specific reload scripts)
   - Port handling plan:
     - If required port is occupied, ask user before killing the process.
   - Schema verification plan using `psql` (`\dt`, `\d <table>`, `information_schema`).
4. Draft BDD scenarios:
   - One core intention per scenario
   - Stable assertions (title, modal, toast, known row/action)
   - Parallel-safe and independent
5. Decide implementation breakdown:
   - Single feature file vs multiple feature files
   - Page object additions
   - Step file organization

## Output

- Mermaid flow (`User -> Page -> API -> Controller -> Service`).
- Scenario list with Given/When/Then summary.
- Mock data plan.
- Implementation file plan.
- Recommended follow-up command: `/bdd-mocks` or `/bdd-create`.
