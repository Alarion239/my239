import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ApiClient, ApiClientProvider, type TokenStore } from '@my239/shared'
import { SubmissionForm, type FinalizeArgs } from './submission-form'

const noopStore: TokenStore = {
  getRefreshToken: async () => null,
  setRefreshToken: async () => {},
  clear: async () => {},
}

function renderForm(props: Partial<Parameters<typeof SubmissionForm>[0]> = {}) {
  const onFinalize = vi.fn(async (_args: FinalizeArgs) => {})
  const client = new ApiClient({ baseURL: '/api/v1', tokenStore: noopStore })
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={client}>
        <SubmissionForm
          presignKind="student"
          presignId={42}
          submitLabel="Отправить решение"
          onFinalize={onFinalize}
          {...props}
        />
      </ApiClientProvider>
    </QueryClientProvider>,
  )
  return { onFinalize }
}

function makeFiles(n: number): File[] {
  return Array.from(
    { length: n },
    (_, i) => new File(['x'], `p${i}.jpg`, { type: 'image/jpeg' }),
  )
}

describe('SubmissionForm — grade validation', () => {
  it('requires a verdict before a grade can be submitted', async () => {
    const user = userEvent.setup()
    const { onFinalize } = renderForm({
      showVerdict: true,
      bodyRequired: true,
      submitLabel: 'Сохранить оценку',
    })

    await user.click(screen.getByRole('button', { name: 'Сохранить оценку' }))

    expect(await screen.findByText('Выберите вердикт.')).toBeInTheDocument()
    expect(onFinalize).not.toHaveBeenCalled()
  })

  it('requires a comment for a grade once a verdict is chosen', async () => {
    const user = userEvent.setup()
    const { onFinalize } = renderForm({
      showVerdict: true,
      bodyRequired: true,
      submitLabel: 'Сохранить оценку',
    })

    await user.click(screen.getByRole('button', { name: 'Принять' }))
    await user.click(screen.getByRole('button', { name: 'Сохранить оценку' }))

    expect(await screen.findByText('Комментарий обязателен.')).toBeInTheDocument()
    expect(onFinalize).not.toHaveBeenCalled()
  })
})

describe('SubmissionForm — photo cap', () => {
  it('keeps at most 10 photos', async () => {
    renderForm()
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement
    fireEvent.change(input, { target: { files: makeFiles(11) } })

    expect(
      await screen.findByRole('button', { name: /Прикрепить фото \(10\/10\)/ }),
    ).toBeDisabled()
    // Exactly 10 remove buttons → 10 files kept, the 11th dropped.
    expect(screen.getAllByRole('button', { name: /^Убрать / })).toHaveLength(10)
  })
})

describe('SubmissionForm — finalize payload', () => {
  it('submits a trimmed body and no object keys when no photos are attached', async () => {
    const user = userEvent.setup()
    const { onFinalize } = renderForm()

    await user.type(screen.getByLabelText('Комментарий'), '  готово  ')
    await user.click(screen.getByRole('button', { name: 'Отправить решение' }))

    await waitFor(() => expect(onFinalize).toHaveBeenCalledTimes(1))
    const args = onFinalize.mock.calls[0][0]
    expect(args.body).toBe('готово')
    expect(args.object_keys).toEqual([])
    expect(args.event_uuid).toMatch(/^[0-9a-f]{32}$/)
    expect(args.verdict).toBeUndefined()
  })
})
