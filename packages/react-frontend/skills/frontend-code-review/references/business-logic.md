# Rule Catalog -- Business Logic

## Store usage in isolated components

IsUrgent: True

### Description

Components that are rendered in contexts without a parent store provider (e.g., templates, modals, or isolated views) must not directly depend on application-level stores. This can result in blank screens or runtime errors when the store provider is absent.

### Suggested Fix

Use framework-provided hooks (e.g., `useNodes` from reactflow) instead of application-specific store hooks. Ensure components can render independently of global state providers.
