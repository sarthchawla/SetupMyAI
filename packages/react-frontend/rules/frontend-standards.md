# Frontend Coding Standards

## General Guidelines

- **Functional Components Only**: Do not use class components.
- **Arrow Functions**: Prefer arrow functions over the `function` keyword for components and helpers.
- **Folder Structure**: Organize code into:
  - `components/`: Reusable UI components.
  - `utils/`: Helper functions and business logic independent of React state.
  - `hooks/`: Custom React hooks for stateful logic.
  - `models/`: Data models and interfaces.
  - `types/`: Shared type definitions.
- **Unit Testing**: All new features and critical logic must have unit tests.

## Folder Structure Guidelines

Organize feature folders using a recursive structure. Each folder can contain its own `components/`, `utils/`, `hooks/`, and `types/` subfolders to scope files to where they are used.

**Example:**
```
FeaturePage/
  FeaturePage.tsx                     # Main page component
  FeaturePage.test.tsx                # Test co-located with source
  components/                         # Components used by this page
    ComponentA.tsx
    ComponentA.test.tsx
    hooks/                            # Hooks scoped to components/
      useComponentHook.ts
    types/                            # Types scoped to components/
      componentTypes.ts
    utils/                            # Utils scoped to components/
      componentUtils.ts
    modals/                           # Sub-feature: group of related modals
      CreateModal.tsx
      EditModal.tsx
      components/                     # Private components, only used by modals/
        SharedFormFields.tsx
        formSchema.ts
  utils/                              # Utils for the page level
    columns.tsx
  constants/                          # Constants and enums
    featureConstants.ts
  models/                             # Data models and interfaces
    FeatureModel.ts
```

**Naming Conventions:**
- **Folders**: lowercase (`components/`, `utils/`, `modals/`)
- **Component files**: PascalCase (`CreateModal.tsx`, `BulkUploadGroup.tsx`)
- **Utility files**: camelCase (`filterRuleUtils.ts`, `bulkUploadUtils.ts`)
- **Type/schema files**: camelCase (`bulkUploadTypes.ts`, `filterRuleSchema.ts`)
- **Model files**: PascalCase, matching the exported interface (`RuleRow.ts`, `RuleTemplate.ts`)
- **Constants files**: camelCase (`filterRuleConstants.ts`)
- **Hook files**: camelCase with `use` prefix (`useBulkUploadGroup.ts`)
- **Test files**: Same name as source + `.test.ts(x)`, co-located in same folder
- **File extension**: Use `.tsx` if the file contains JSX (e.g., `columns.tsx` for render helpers), otherwise `.ts`

**Key Principles:**
- Co-locate tests with their source files
- Scope `components/`, `utils/`, `hooks/`, `types/` to the folder that uses them
- Use nested `components/` folders to keep sub-feature internals private
- Group related files in subfolders rather than flat structures

## Testing

- **Run Tests**: Use `pnpm test:run` to run tests once without watching (CI mode).
- **Watch Mode**: `pnpm test` runs in watch mode by default.
- **Coverage**: Maintain good test coverage for critical paths.

## Component Best Practices

- **Component File Focus**: A component file should only contain what constitutes a component: props interface, hooks/effects, and JSX. Extract all other logic (data transformation, validation, business rules) to separate utility files or custom hooks.
- **Logic Separation**: Keep logic out of display components.
  - If a component has more than **20 lines of logic**, extract it into a custom hook or utility function.
- **Pure Functions**: Aim for functions that return results rather than relying solely on side effects.

## Code Style & Quality

- **No Magic Strings**: Use `enum` or constant objects instead of hardcoded strings.
- **Utils**: Helper functions currently in component files should be moved to `src/utils` or the component's local `utils` folder if strictly local.
- **No Use-Case-Specific Defaults in Utils**: Utility functions should not have default parameter values tied to a specific use case. Supply these values from the call site instead. This keeps utils generic and reusable.
- **Local Mutability**: It is acceptable to use mutable data structures within a single function for clarity and performance. No need to use `reduce` consistently. Just ensure the mutable value is not returned or exposed outside the function. Local mutability is the preferred option, no need for FP-purism.
- **Avoid Higher-Order Functions**: Prefer simpler, direct solutions over functions that return functions. Reserve higher-order patterns for library code; when used, provide a simple pre-configured accessor for export. Passing functions as parameters (callbacks) is fine.
- **Avoid Linter Suppressions**: Do not add `eslint-disable` comments, especially for `any` or `unknown` types. Prefer explicit typing to resolve type errors properly.
- **Success with Errors Pattern**: API responses can return `success: true` with partial failures (e.g., bulk operations where some items succeeded). Use `success: false` only when the entire operation fails. Check `!response.success` for failure handling, not `response.errors != null`.
- **Early Returns**: Prefer early error returns over nested `if-else` blocks. This reduces indentation and improves readability.
- **No Dead Code**: Remove unused code immediately. There is no such thing as "harmless" dead code. If code has no usage, it must be removed unless it is explicitly exported/exposed or has a comment explaining why it should be retained. No MR should introduce dead code.
- **No Re-export Files**: Do not create files that only re-export from other modules (barrel files / index.ts patterns). Import directly from the source file instead. This improves code traceability and avoids circular dependency issues.
- **Discriminated Unions**: Use discriminated unions with `switch` for most cases - it's idiomatic TypeScript and gives you great type safety. Use `ts-pattern` only if you need complex matching logic.

## Recurring Review Feedback

These patterns have been flagged repeatedly in code reviews. Pay special attention to avoid them:

### Function Style
- **Always use arrow functions** for component definitions, utility functions, and callbacks. The `function` keyword should only be used when `this` binding is explicitly required (rare in React).
  ```typescript
  // Good
  const processData = (items: Item[]) => { ... };
  export const MyComponent = () => { ... };

  // Bad
  function processData(items: Item[]) { ... }
  export function MyComponent() { ... }
  ```

### Type Safety
- **Use enums or const objects instead of string literals** for values that represent a fixed set of options.
  ```typescript
  // Good
  enum ModificationKind { Keep = 'keep', Change = 'change', Error = 'error' }

  // Bad
  type ModificationKind = 'keep' | 'change' | 'error';
  ```

### Function Design
- **Functions should return results**, not just perform side effects. This makes code testable and composable.
  ```typescript
  // Good - returns result
  const validateData = (data: Data): ValidationResult => { ... };

  // Bad - only side effects
  const validateData = (data: Data, errors: string[]) => { errors.push(...); };
  ```

### File Organization
- **Parsing/transformation logic belongs in `utils/`**, not directly in component files or alongside components.
- **Type definitions and interfaces belong in `types/`** when shared, or can be co-located if only used by one file.
- **Business logic classes should be refactored to functional approaches** - avoid class-based patterns like builders unless there's a compelling reason.

### Common Components
- **Don't modify shared components for feature-specific logic**. Instead, pass the logic as a callback prop.
  ```typescript
  // Good - pass logic as prop
  <ExpandableChipList getChipColor={(item) => isWarning(item) ? 'warning' : 'default'} />

  // Bad - hardcode feature logic in shared component
  // Inside ExpandableChipList.tsx: if (specificCondition?.has(item)) ...
  ```

### Logic Separation
- **Keep display components thin**. If a component has more than ~20 lines of logic (not JSX), extract to:
  - A custom hook (if it involves React state/effects)
  - A utility function (if it's pure data transformation)
- **Hooks are for stateful logic**, utils are for pure transformations.
