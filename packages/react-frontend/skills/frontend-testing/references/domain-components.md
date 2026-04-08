# Domain-Specific Component Testing

This guide covers testing patterns for domain-specific components common in frontend applications.

## Configuration Components

Configuration components handle forms, validation, and data persistence.

### Key Test Areas

1. **Form Validation**
1. **Save/Reset**
1. **Required vs Optional Fields**
1. **Configuration Persistence**
1. **Error Feedback**

### Example: Configuration Form

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ConfigForm from './config-form'

vi.mock('@/service/api', () => ({
  updateConfig: vi.fn(),
  getConfig: vi.fn(),
}))

import * as apiService from '@/service/api'
const mockedService = vi.mocked(apiService)

describe('ConfigForm', () => {
  const defaultConfig = {
    name: 'My App',
    description: '',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockedService.getConfig.mockResolvedValue(defaultConfig)
  })

  describe('Form Validation', () => {
    it('should require name field', async () => {
      const user = userEvent.setup()
      
      render(<ConfigForm id="app-1" />)
      
      await waitFor(() => {
        expect(screen.getByLabelText(/name/i)).toHaveValue('My App')
      })
      
      await user.clear(screen.getByLabelText(/name/i))
      await user.click(screen.getByRole('button', { name: /save/i }))
      
      expect(screen.getByText(/name is required/i)).toBeInTheDocument()
      expect(mockedService.updateConfig).not.toHaveBeenCalled()
    })
  })

  describe('Save/Reset Functionality', () => {
    it('should save configuration', async () => {
      const user = userEvent.setup()
      mockedService.updateConfig.mockResolvedValue({ success: true })
      
      render(<ConfigForm id="app-1" />)
      
      await waitFor(() => {
        expect(screen.getByLabelText(/name/i)).toHaveValue('My App')
      })
      
      await user.clear(screen.getByLabelText(/name/i))
      await user.type(screen.getByLabelText(/name/i), 'Updated App')
      await user.click(screen.getByRole('button', { name: /save/i }))
      
      await waitFor(() => {
        expect(mockedService.updateConfig).toHaveBeenCalledWith(
          'app-1',
          expect.objectContaining({ name: 'Updated App' })
        )
      })
    })

    it('should reset to default values', async () => {
      const user = userEvent.setup()
      
      render(<ConfigForm id="app-1" />)
      
      await waitFor(() => {
        expect(screen.getByLabelText(/name/i)).toHaveValue('My App')
      })
      
      await user.clear(screen.getByLabelText(/name/i))
      await user.type(screen.getByLabelText(/name/i), 'Changed Name')
      await user.click(screen.getByRole('button', { name: /reset/i }))
      
      expect(screen.getByLabelText(/name/i)).toHaveValue('My App')
    })
  })

  describe('Error Handling', () => {
    it('should show error on save failure', async () => {
      const user = userEvent.setup()
      mockedService.updateConfig.mockRejectedValue(new Error('Server error'))
      
      render(<ConfigForm id="app-1" />)
      
      await waitFor(() => {
        expect(screen.getByLabelText(/name/i)).toHaveValue('My App')
      })
      
      await user.click(screen.getByRole('button', { name: /save/i }))
      
      await waitFor(() => {
        expect(screen.getByText(/failed to save/i)).toBeInTheDocument()
      })
    })
  })
})
```

## File Upload Components

### Key Test Areas

1. **File Upload**
1. **File Type Validation**
1. **Progress Indication**
1. **Error Handling**

### Example: File Uploader

```typescript
describe('FileUploader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('File Upload', () => {
    it('should accept valid file types', async () => {
      const user = userEvent.setup()
      const onUpload = vi.fn()
      mockedService.uploadFile.mockResolvedValue({ id: 'file-1' })
      
      render(<FileUploader onUpload={onUpload} />)
      
      const file = new File(['content'], 'test.pdf', { type: 'application/pdf' })
      const input = screen.getByLabelText(/upload/i)
      
      await user.upload(input, file)
      
      await waitFor(() => {
        expect(mockedService.uploadFile).toHaveBeenCalledWith(
          expect.any(FormData)
        )
      })
    })

    it('should reject invalid file types', async () => {
      const user = userEvent.setup()
      
      render(<FileUploader />)
      
      const file = new File(['content'], 'test.exe', { type: 'application/x-msdownload' })
      const input = screen.getByLabelText(/upload/i)
      
      await user.upload(input, file)
      
      expect(screen.getByText(/unsupported file type/i)).toBeInTheDocument()
    })
  })

  describe('Error Handling', () => {
    it('should handle upload failure', async () => {
      const user = userEvent.setup()
      mockedService.uploadFile.mockRejectedValue(new Error('Upload failed'))
      
      render(<FileUploader />)
      
      const file = new File(['content'], 'test.pdf', { type: 'application/pdf' })
      await user.upload(screen.getByLabelText(/upload/i), file)
      
      await waitFor(() => {
        expect(screen.getByText(/upload failed/i)).toBeInTheDocument()
      })
    })
  })
})
```

## List with Pagination Components

### Key Test Areas

1. **Data Loading**
1. **Pagination Navigation**
1. **Search & Filtering**

### Example: Paginated List

```typescript
describe('PaginatedList', () => {
  describe('Pagination', () => {
    it('should load first page on mount', async () => {
      mockedService.getItems.mockResolvedValue({
        data: [{ id: '1', name: 'Item 1' }],
        total: 50,
        page: 1,
        pageSize: 10,
      })
      
      render(<PaginatedList />)
      
      await waitFor(() => {
        expect(screen.getByText('Item 1')).toBeInTheDocument()
      })
      
      expect(mockedService.getItems).toHaveBeenCalledWith({ page: 1 })
    })

    it('should navigate to next page', async () => {
      const user = userEvent.setup()
      mockedService.getItems.mockResolvedValue({
        data: [{ id: '1', name: 'Item 1' }],
        total: 50,
        page: 1,
        pageSize: 10,
      })
      
      render(<PaginatedList />)
      
      await waitFor(() => {
        expect(screen.getByText('Item 1')).toBeInTheDocument()
      })
      
      mockedService.getItems.mockResolvedValue({
        data: [{ id: '11', name: 'Item 11' }],
        total: 50,
        page: 2,
        pageSize: 10,
      })
      
      await user.click(screen.getByRole('button', { name: /next/i }))
      
      await waitFor(() => {
        expect(screen.getByText('Item 11')).toBeInTheDocument()
      })
    })
  })
})
```
