import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Likbez } from '@my239/shared'
import { CenterIdContext, CenterTermContext } from './center-id-context'
import { LikbezPage } from './likbez-page'

const mocks = vi.hoisted(() => ({
  list: [] as Likbez[],
  detail: null as Likbez | null,
  unpublish: { isPending: false, mutateAsync: vi.fn() },
  publish: { isPending: false, mutateAsync: vi.fn() },
  update: { isPending: false, mutateAsync: vi.fn(), mutate: vi.fn() },
  remove: { isPending: false, mutate: vi.fn() },
  putTex: { isPending: false, mutateAsync: vi.fn() },
  setVideo: { isPending: false, mutateAsync: vi.fn() },
  uploadPdf: { isPending: false, mutateAsync: vi.fn() },
}))

vi.mock('./use-series-context', () => ({
  useSeriesContext: () => ({ isLoading: false, isError: false, hasAccess: true, isStudentView: false }),
}))

vi.mock('@my239/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@my239/shared')>()
  return {
    ...actual,
    useLikbezList: () => ({ data: mocks.list, isPending: false, isError: false }),
    useLikbez: () => ({ data: mocks.detail, isPending: false, isError: !mocks.detail }),
    useLikbezTex: () => ({ data: undefined, isPending: false, isError: false }),
    useMathCenterTerms: () => ({ data: [{ id: 1, kind: 'academic', grade: 9, display_name: '9 класс', is_active: true }], isPending: false }),
    useMathCenterLatexPreamble: () => ({ data: { preamble: '\\documentclass{article}' }, isPending: false }),
    useCreateLikbez: () => ({ isPending: false, mutate: vi.fn() }),
    useDeleteLikbez: () => mocks.remove,
    usePublishLikbez: () => mocks.publish,
    useUnpublishLikbez: () => mocks.unpublish,
    useUpdateLikbez: () => mocks.update,
    usePutLikbezTex: () => mocks.putTex,
    useSetLikbezVideo: () => mocks.setVideo,
    useUploadLikbezPdf: () => mocks.uploadPdf,
  }
})

const published: Likbez = {
  id: 11,
  math_center_id: 7,
  term_id: 1,
  term_display_name: '9 класс',
  number: 1,
  title: 'Проценты',
  held_on: '2026-08-01',
  description: 'Краткое описание',
  published: true,
  has_pdf: false,
  has_tex: false,
  video_url: null,
}

const draft: Likbez = { ...published, id: 12, title: 'Черновик', published: false, video_url: 'https://youtu.be/dQw4w9WgXcQ' }

function renderPage(entry = '/mathcenter/2032/likbez') {
  return render(
    <CenterIdContext.Provider value={7}>
      <CenterTermContext.Provider value={{ termId: 1, term: null }}>
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route path="/mathcenter/:year/likbez" element={<LikbezPage />} />
            <Route path="/mathcenter/:year/likbez/:likbezId" element={<LikbezPage />} />
          </Routes>
        </MemoryRouter>
      </CenterTermContext.Provider>
    </CenterIdContext.Provider>,
  )
}

beforeEach(() => {
  mocks.list = [published]
  mocks.detail = published
  mocks.unpublish.mutateAsync.mockReset().mockResolvedValue(published)
  mocks.publish.mutateAsync.mockReset().mockResolvedValue({ ...draft, published: true })
  mocks.update.mutateAsync.mockReset().mockResolvedValue(draft)
  mocks.update.mutate.mockReset()
  mocks.remove.mutate.mockReset()
  mocks.putTex.mutateAsync.mockReset().mockResolvedValue(draft)
  mocks.setVideo.mutateAsync.mockReset().mockResolvedValue(draft)
  mocks.uploadPdf.mutateAsync.mockReset().mockResolvedValue(draft)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Likbez controls', () => {
  it('uses one Edit action and unpublishes a published card before opening it', async () => {
    const user = userEvent.setup()
    renderPage()

    expect(await screen.findByRole('button', { name: 'Редактировать' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Опубликовать/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Материалы/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Редактировать' }))
    await waitFor(() => expect(mocks.unpublish.mutateAsync).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('button', { name: /Материалы/ })).not.toBeInTheDocument()
  })

  it('keeps the published card in place when unpublishing fails', async () => {
    mocks.unpublish.mutateAsync.mockRejectedValueOnce(new Error('service unavailable'))
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Редактировать' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось открыть черновик.')
    expect(screen.getByText('Проценты')).toBeInTheDocument()
  })

  it('opens an existing draft directly and publishes after saving its details', async () => {
    mocks.list = [draft]
    mocks.detail = draft
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Редактировать' }))
    const publishButton = await screen.findByRole('button', { name: 'Опубликовать' })
    expect(mocks.unpublish.mutateAsync).not.toHaveBeenCalled()
    expect(screen.getByRole('tablist', { name: 'Формат ликбеза' })).toBeInTheDocument()
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['LaTeX', 'PDF', 'Видео'])
    expect(document.querySelector('.material-tex-grid')).toBeInTheDocument()
    expect(screen.getByLabelText('Дата')).toHaveAttribute('type', 'date')
    expect(screen.getByText('Суббота')).toBeInTheDocument()
    expect(screen.queryByText(/Материал 0[123]/)).not.toBeInTheDocument()
    expect(screen.queryByText('Добавьте PDF-версию лекции')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Сохранить сведения' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Сохранить LaTeX' })).not.toBeInTheDocument()

    await user.clear(screen.getByLabelText('Название'))
    await user.type(screen.getByLabelText('Название'), 'Обновлённый черновик')
    await user.click(screen.getByRole('tab', { name: 'Видео' }))
    const videoInput = screen.getByLabelText('Ссылка на видео')
    await user.clear(videoInput)
    await user.type(videoInput, 'https://youtu.be/abc12345678')
    await user.click(publishButton)

    await waitFor(() => expect(mocks.update.mutateAsync).toHaveBeenCalled())
    await waitFor(() => expect(mocks.setVideo.mutateAsync).toHaveBeenCalledWith('https://youtu.be/abc12345678'))
    await waitFor(() => expect(mocks.publish.mutateAsync).toHaveBeenCalledTimes(1))
    expect(mocks.update.mutateAsync.mock.invocationCallOrder[0]).toBeLessThan(mocks.publish.mutateAsync.mock.invocationCallOrder[0])
    expect(mocks.setVideo.mutateAsync.mock.invocationCallOrder[0]).toBeLessThan(mocks.publish.mutateAsync.mock.invocationCallOrder[0])
  })

  it('does not publish when saving draft details fails', async () => {
    mocks.list = [draft]
    mocks.detail = draft
    mocks.update.mutateAsync.mockRejectedValue(new Error('save failed'))
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Редактировать' }))
    await user.clear(screen.getByLabelText('Название'))
    await user.type(screen.getByLabelText('Название'), 'Сломанный черновик')
    await user.click(await screen.findByRole('button', { name: 'Опубликовать' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось опубликовать ликбез')
    expect(mocks.publish.mutateAsync).not.toHaveBeenCalled()
  })

  it('blocks publication when the video link cannot be saved', async () => {
    mocks.list = [draft]
    mocks.detail = draft
    mocks.setVideo.mutateAsync.mockRejectedValue(new Error('invalid video link'))
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Редактировать' }))
    await user.click(screen.getByRole('tab', { name: 'Видео' }))
    await user.clear(screen.getByLabelText('Ссылка на видео'))
    await user.type(screen.getByLabelText('Ссылка на видео'), 'not-a-url')
    await user.click(await screen.findByRole('button', { name: 'Опубликовать' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('invalid video link')
    expect(mocks.publish.mutateAsync).not.toHaveBeenCalled()
  })

  it('keeps deletion in the draft danger zone', async () => {
    mocks.list = [draft]
    mocks.detail = draft
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = userEvent.setup()
    renderPage('/mathcenter/2032/likbez/12')

    await user.click(await screen.findByRole('button', { name: 'Удалить ликбез' }))
    expect(mocks.remove.mutate).toHaveBeenCalledWith(12, expect.any(Object))
  })
})
