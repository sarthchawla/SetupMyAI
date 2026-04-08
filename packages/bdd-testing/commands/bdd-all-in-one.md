# BDD All-In-One

Execute the full BDD workflow:

1) decide unit vs BDD, 2) plan scenarios, 3) prepare mocks, 4) create tests, 5) run and fix to green.

Use `$ARGUMENTS` to pass ticket/feature/flow context.

## Execution Plan

1. Run **strategy phase** (equivalent to `/bdd-test-strategy`).
2. Run **planning phase** (equivalent to `/bdd-plan`).
3. Run **mock phase** (equivalent to `/bdd-mocks`).
   - Reload mock data using the project's mock data setup scripts.
   - If a required port is occupied, ask user before killing the process on that port.
   - Use `psql` to inspect schema while designing/verifying mock changes.
4. Run **implementation phase** (equivalent to `/bdd-create`).
   - Allow `psql` debugging for implementation-time data/state issues.
5. Run **stabilization phase** (equivalent to `/bdd-run-fix`).
   - Use `psql` during failure triage when backend/data behavior is unclear.

## Subagent Usage

Use subagents where independent work can run in parallel:

- flow tracing subagent for UI/backend discovery
- mock design subagent for deterministic state setup
- execution subagent for run/fix loops

## Required Final Output

- Unit vs BDD decision table.
- Scenario plan and implemented files.
- Mock changes and rationale.
- Test commands run and final pass/fail status.
- Remaining gaps or follow-up items.
