---
paths: '*.step.ts'
---
# UI Testing Environment Overview
## Key Components & Mocking
- **API Interaction**: UI interacts with APIs exclusively through a BFF.
- **Database Mocking**:
- **SQL**: Mocked via a repository layer.
- **PostgreSQL**: Mocked using a database layer source with a test container.
- **Playwright Configuration**: Refer to the Playwright configuration file for
setup details.
- **User Group Determination**: Based on login token.
- **BDD Rule**: Only one `Given-When-Then` per test; use `And` for additional
steps.
## Test Types and Creation
- **Test Types**:
- `acceptance-test` (used for all new tests).
- **Test Creation Workflow**:
1. Follow a BDD approach using `playwright-bdd`.
2. Update feature files and run BDD code generation (e.g., `pnpm bddgen`) to generate step functions.
3. Update or create step files, then rerun code generation to verify changes (empty response confirms steps are in place).
4. Implement step logic.
5. Once all steps are implemented, run `pnpm playwright test` to execute tests and verify results.
## Technical Details
- **Feature Flags**:
- States: Enabled, Disabled, Development (overwritable via FeatureFlagOptions
in Playwright).
- State retrieved from database values or configuration.
- **Login Token Overrides**:
- Use project-specific header values to bypass normal authentication for testing.
## Data Relationships
- **Adding New Groups**: Update the appropriate seed data files.
- **Adjusting Feature States**: Update the feature flags configuration.
## Updating Database Data
- **Seed Data Updates**:
- For SQL: Restart the BFF.
- For PostgreSQL: Use the appropriate reload command to reload mock database data.
