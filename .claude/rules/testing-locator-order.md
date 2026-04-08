---
paths: '**/*.{test,spec}.{ts,tsx,js,jsx}, **/tests/**/*.ts, **/tests/**/*.js'
---
# Locator / Query Priority (Unit Tests + Playwright)

Use **user-centric, accessibility-aligned locators first**, and only fall back to implementation details when necessary.

## Why this order

- **More resilient tests**: Role/label-based locators survive refactors better than CSS selectors
- **Better accessibility**: If a `getByRole` / `getByLabel` query is hard, it often indicates missing semantic HTML
- **Lower flakiness**: Avoids brittle selectors (`nth()`, deep DOM paths) that change with layout
- **Clearer intent**: The locator reads like the user's mental model ("click the Save button")
- **Matches Playwright's model**: Playwright locators auto-wait and retry

## Order of preference

Use the **first** option that is both **unique** and **expressive**.

### 1) Role + accessible name (best default)

- **RTL**: `screen.getByRole('button', { name: /save/i })`
- **Playwright**: `page.getByRole('button', { name: 'Save' })`

### 2) Label-based (forms)

- **RTL**: `screen.getByLabelText(/email/i)`
- **Playwright**: `page.getByLabel('Email')`

### 3) Placeholder (only when part of UX contract)

- **RTL**: `screen.getByPlaceholderText(/search/i)`
- **Playwright**: `page.getByPlaceholder('Search')`

### 4) Visible text content (use sparingly)

- **RTL**: `screen.getByText(/something happened/i)`
- **Playwright**: `page.getByText('Something happened')`

Good when asserting **user-visible copy is the requirement**. Avoid using text as a handle when copy changes frequently.

### 5) Alt text / title (images & icon buttons)

- **RTL**: `screen.getByAltText(/hotel/i)`, `screen.getByTitle(/help/i)`
- **Playwright**: `page.getByAltText('Hotel')`, `page.getByTitle('Help')`

### 6) `data-testid` (explicit testing hook)

- **RTL**: `screen.getByTestId('partner-suspension-banner')`
- **Playwright**: `page.getByTestId('partner-suspension-banner')`

Best fallback when semantics aren't available or uniqueness is hard. Prefer adding accessibility first.

### 7) CSS selectors / XPath / DOM traversal (last resort)

- **RTL**: `container.querySelector(...)`
- **Playwright**: `page.locator('css=...')` / `page.locator('xpath=...')`

Most brittle and flaky. Avoid.

## Scoping & uniqueness rules

- Prefer **scoping** before downgrading the locator:
  - **RTL**: `within(section).getByRole(...)` to keep queries small and targeted
  - **Playwright**: chain locators and use filtering (e.g. `page.getByRole(...).filter(...)`)
- Never rely on `.nth()` / index selection unless the UI requirement is explicitly "the Nth item"
- If multiple elements match, **make the locator more specific** before switching to `data-testid`

## Examples

```tsx
// RTL: scope to dialog, then query inside it
const dialog = screen.getByRole('dialog', { name: /create item/i });
await user.click(within(dialog).getByRole('button', { name: /save/i }));
```

```ts
// Playwright: scope to dialog, then query inside it
const dialog = page.getByRole('dialog', { name: /create item/i });
await dialog.getByRole('button', { name: 'Save' }).click();
```
