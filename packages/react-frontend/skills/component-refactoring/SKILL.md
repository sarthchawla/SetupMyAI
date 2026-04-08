---
name: component-refactoring
description: Refactor high-complexity React components. Use when complexity analysis shows complexity > 50 or lineCount > 300, when the user asks for code splitting, hook extraction, or complexity reduction; avoid for simple/well-structured components, third-party wrappers, or when the user explicitly wants testing without refactoring.
---

# Component Refactoring Skill

Refactor high-complexity React components with the patterns and workflow below.

> **Complexity Threshold**: Components with complexity > 50 should be refactored before testing.

## Quick Reference

### Complexity Score Interpretation

| Score | Level | Action |
|-------|-------|--------|
| 0-25 | Simple | Ready for testing |
| 26-50 | Medium | Consider minor refactoring |
| 51-75 | Complex | **Refactor before testing** |
| 76-100 | Very Complex | **Must refactor** |

## Core Refactoring Patterns

### Pattern 1: Extract Custom Hooks

**When**: Component has complex state management, multiple `useState`/`useEffect`, or business logic mixed with UI.

**Convention**: Place hooks in a `hooks/` subdirectory or alongside the component as `use-<feature>.ts`.

```typescript
// Before: Complex state logic in component
const Configuration: FC = () => {
  const [modelConfig, setModelConfig] = useState<ModelConfig>(...)
  const [datasetConfigs, setDatasetConfigs] = useState<DatasetConfigs>(...)
  const [completionParams, setCompletionParams] = useState<FormValue>({})
  
  // 50+ lines of state management logic...
  
  return <div>...</div>
}

// After: Extract to custom hook
// hooks/use-model-config.ts
export const useModelConfig = (appId: string) => {
  const [modelConfig, setModelConfig] = useState<ModelConfig>(...)
  const [completionParams, setCompletionParams] = useState<FormValue>({})
  
  // Related state management logic here
  
  return { modelConfig, setModelConfig, completionParams, setCompletionParams }
}

// Component becomes cleaner
const Configuration: FC = () => {
  const { modelConfig, setModelConfig } = useModelConfig(appId)
  return <div>...</div>
}
```

### Pattern 2: Extract Sub-Components

**When**: Single component has multiple UI sections, conditional rendering blocks, or repeated patterns.

**Convention**: Place sub-components in subdirectories or as separate files in the same directory.

```typescript
// Before: Monolithic JSX with multiple sections
const AppInfo = () => {
  return (
    <div>
      {/* 100 lines of header UI */}
      {/* 100 lines of operations UI */}
      {/* 100 lines of modals */}
    </div>
  )
}

// After: Split into focused components
// app-info/
//   index.tsx           (orchestration only)
//   app-header.tsx      (header UI)
//   app-operations.tsx  (operations UI)
//   app-modals.tsx      (modal management)

const AppInfo = () => {
  const { showModal, setShowModal } = useAppInfoModals()
  
  return (
    <div>
      <AppHeader appDetail={appDetail} />
      <AppOperations onAction={handleAction} />
      <AppModals show={showModal} onClose={() => setShowModal(null)} />
    </div>
  )
}
```

### Pattern 3: Simplify Conditional Logic

**When**: Deep nesting (> 3 levels), complex ternaries, or multiple `if/else` chains.

```typescript
// Before: Deeply nested conditionals
const Template = useMemo(() => {
  if (mode === 'chat') {
    switch (locale) {
      case 'zh': return <TemplateChatZh />
      case 'ja': return <TemplateChatJa />
      default: return <TemplateChatEn />
    }
  }
  // More conditions...
}, [mode, locale])

// After: Use lookup tables + early returns
const TEMPLATE_MAP = {
  chat: { zh: TemplateChatZh, ja: TemplateChatJa, default: TemplateChatEn },
  advanced: { zh: TemplateAdvancedZh, default: TemplateAdvancedEn },
}

const Template = useMemo(() => {
  const modeTemplates = TEMPLATE_MAP[mode]
  if (!modeTemplates) return null
  
  const TemplateComponent = modeTemplates[locale] || modeTemplates.default
  return <TemplateComponent />
}, [mode, locale])
```

### Pattern 4: Extract API/Data Logic

**When**: Component directly handles API calls, data transformation, or complex async operations.

```typescript
// Before: API logic in component
const ServiceCard = () => {
  const [config, setConfig] = useState({})
  
  useEffect(() => {
    if (appId) {
      (async () => {
        const res = await fetchDetail({ url: '/apps', id: appId })
        setConfig(res?.config || {})
      })()
    }
  }, [appId])
}

// After: Extract to data hook
// use-app-config.ts
import { useQuery } from '@tanstack/react-query'

export const useAppConfig = (appId: string) => {
  return useQuery({
    enabled: !!appId,
    queryKey: ['appConfig', appId],
    queryFn: () => get(`/apps/${appId}`),
    select: data => data?.config || {},
  })
}

// Component becomes cleaner
const ServiceCard = () => {
  const { data: config, isLoading } = useAppConfig(appId)
  // UI only
}
```

### Pattern 5: Extract Modal/Dialog Management

**When**: Component manages multiple modals with complex open/close states.

```typescript
// Before: Multiple modal states in component
const AppInfo = () => {
  const [showEditModal, setShowEditModal] = useState(false)
  const [showDuplicateModal, setShowDuplicateModal] = useState(false)
  const [showConfirmDelete, setShowConfirmDelete] = useState(false)
  // 5+ more modal states...
}

// After: Extract to modal management hook
type ModalType = 'edit' | 'duplicate' | 'delete' | null

const useAppInfoModals = () => {
  const [activeModal, setActiveModal] = useState<ModalType>(null)
  
  const openModal = useCallback((type: ModalType) => setActiveModal(type), [])
  const closeModal = useCallback(() => setActiveModal(null), [])
  
  return {
    activeModal,
    openModal,
    closeModal,
    isOpen: (type: ModalType) => activeModal === type,
  }
}
```

### Pattern 6: Extract Form Logic

**When**: Complex form validation, submission handling, or field transformation.

```typescript
// Use form library infrastructure
import { useForm } from 'react-hook-form'

const ConfigForm = () => {
  const form = useForm({
    defaultValues: { name: '', description: '' },
  })
  
  return <form onSubmit={form.handleSubmit(onSubmit)}>...</form>
}
```

## Refactoring Workflow

### Step 1: Analyze

Identify:
- Total complexity score
- Max function complexity
- Line count
- Features detected (state, effects, API, etc.)

### Step 2: Plan

Create a refactoring plan based on detected features:

| Detected Feature | Refactoring Action |
|------------------|-------------------|
| Complex state + effects | Extract custom hook |
| API calls | Extract data/service hook |
| Many event handlers | Extract event handlers |
| 300+ lines | Split into sub-components |
| High complexity | Simplify conditional logic |

### Step 3: Execute Incrementally

1. **Extract one piece at a time**
2. **Run lint, type-check, and tests after each extraction**
3. **Verify functionality before next step**

```
For each extraction:
  1. Extract code
  2. Run: pnpm lint:fix
  3. Run: pnpm type-check
  4. Run: pnpm test
  5. PASS? -> Next extraction
     FAIL? -> Fix before continuing
```

### Step 4: Verify

After refactoring, target metrics:
- complexity < 50
- lineCount < 300
- maxComplexity < 30

## Common Mistakes to Avoid

### Over-Engineering

```typescript
// Too many tiny hooks
const useButtonText = () => useState('Click')
const useButtonDisabled = () => useState(false)

// Cohesive hook with related state
const useButtonState = () => {
  const [text, setText] = useState('Click')
  const [disabled, setDisabled] = useState(false)
  return { text, setText, disabled, setDisabled }
}
```

### Breaking Existing Patterns

- Follow existing directory structures
- Maintain naming conventions
- Preserve export patterns for compatibility

### Premature Abstraction

- Only extract when there's clear complexity benefit
- Don't create abstractions for single-use code
- Keep refactored code in the same domain area

## References

See `references/` for detailed guides:
- `complexity-patterns.md` - Complexity analysis patterns
- `component-splitting.md` - Component splitting strategies
- `hook-extraction.md` - Hook extraction techniques

### Related Skills

- `frontend-testing` - For testing refactored components
