---
paths: '**/*'
---
# Page Objects Organization - No Index/Barrel Exports

## Rule

Do NOT create `index.ts` or barrel export files in page object folders. This keeps the code structure explicit and makes imports clear and direct.

## Where This Applies

- Page object directories (class-based page objects - Playwright POM pattern)
- Functional component directories
- Any folder organizing page objects, components, or similar modules

## Why Class-Based Page Objects in Acceptance Tests?

**Acceptance tests use classes for Page Object Model (POM), not React components:**

1. **Playwright standard** - Official Playwright docs and community use class-based POM
2. **State encapsulation** - Classes naturally encapsulate the `page` instance and locators
3. **Inheritance/Composition** - Easy to extend functionality (e.g., `EditPage extends CreatePage`)
4. **Not React** - Page objects are abstractions over Playwright APIs, not UI components
5. **No rendering lifecycle** - Functional components with hooks (useState, useEffect) only work in React's rendering model

**Functional components with hooks are React-specific and don't apply to Playwright page objects.**

```typescript
// BAD - page objects don't render
export const SomePage = () => {
  const [page, setPage] = useState<Page>(); // useState doesn't work outside React
  useEffect(() => { /* no lifecycle */ }, []);
  // ...
};

// GOOD - class-based POM pattern
export class SomePage {
  readonly page: Page;
  
  constructor(page: Page) {
    this.page = page;
  }
  
  async clickButton() {
    await this.page.getByRole('button').click();
  }
}
```

## Correct Pattern

### Acceptance Tests (Class-Based Page Objects)

```typescript
// Good - Direct import from specific file
import { ListPage } from '../pages/Feature/ListPage';
import { CreatePage } from '../pages/Feature/CreatePage';
import { EditPage } from '../pages/Feature/EditPage';
```

### UI (Functional Components)

```typescript
// Good - Direct import from specific file
import { Button } from '../components/Button/Button';
import { Modal } from '../components/Modal/Modal';
import { useUserContext } from '../hooks/useUserContext';
```

## Incorrect Pattern

```typescript
// Don't do this - No barrel exports
import { ListPage, CreatePage } from '../pages/Feature';
import { Button, Modal } from '../components';
import { useUserContext } from '../hooks';
```

## Benefits

1. **Explicit dependencies** - Easy to see exactly which modules depend on which files
2. **Easier refactoring** - No need to maintain index files when moving or renaming
3. **Better IDE support** - Direct imports work better with go-to-definition and refactoring tools
4. **Clearer intent** - No hidden exports that aren't obvious from the folder structure

## Folder Organization Pattern

### Acceptance Tests

```
pages/
├── Feature/
│   ├── FeatureListPage.ts       # List view & actions (class-based)
│   ├── CreateFeaturePage.ts     # Creation wizard (class)
│   └── EditFeaturePage.ts       # Edit flow (class)
├── LoginPage.ts
├── Navigation.ts
└── DashboardPage.ts
```

### UI - Functional Components

```
components/
├── Button/
│   ├── Button.tsx                # Functional component
│   ├── Button.test.tsx
│   └── Button.module.css
├── Modal/
│   ├── Modal.tsx                 # Functional component
│   ├── Modal.test.tsx
│   └── Modal.module.css

hooks/
├── useUserContext.ts             # Custom hook
├── useAuth.ts                    # Custom hook
└── useFetch.ts                   # Custom hook
```

## Component/Page Object Patterns

### Acceptance Tests - Class-Based Page Objects (Direct Usage)

```typescript
// Good - Direct usage of specific page objects in step definitions
import { Given, When, Then } from '../../../fixtures/AppFixtures';

When('I open the {string} action modal', 
  async ({ listPage }, action: string) => {
    await listPage.openActionModal(itemId);
  }
);

When('I enter a name', 
  async ({ createPage }) => {
    await createPage.enterName('Test Item');
  }
);

When('I edit the item', 
  async ({ editPage }, itemId: string) => {
    await editPage.openEditForId(itemId);
  }
);
```

**Don't create wrapper/facade classes** - Use the specific page object you need:

```typescript
// Bad - Unnecessary wrapper that just delegates
export class FeaturePage {
  private readonly listPage: FeatureListPage;
  private readonly createPage: CreateFeaturePage;
  
  constructor(page: Page) {
    this.listPage = new FeatureListPage(page);
    this.createPage = new CreateFeaturePage(page);
  }
  
  async openActionModal(id: string) {
    return this.listPage.openActionModal(id); // Just delegates!
  }
}
```

### UI - Functional Components with Custom Hooks

```typescript
// Good - Functional component with hooks
export const UserProfile: React.FC<UserProfileProps> = ({ userId }) => {
  const user = useUserContext();
  const { data, loading } = useFetch(`/users/${userId}`);
  
  return (
    <div>
      {/* Component JSX */}
    </div>
  );
};
```
