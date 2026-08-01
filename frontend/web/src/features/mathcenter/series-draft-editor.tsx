import { useDeferredValue, useEffect, useRef, useState } from 'react'
import { Pencil } from 'lucide-react'
import {
  APIErrorImpl,
  DEFAULT_LATEX_PREAMBLE,
  latexBodySource,
  normalizeLatexSource,
  useMathCenterLatexPreamble,
  usePublishSeries,
  usePutSeriesTex,
  useSeriesTex,
  useUpdateSeries,
  useUploadSeriesPdf,
  type CreateSeriesBody,
  type Series,
} from '@my239/shared'
import { Button, Textarea } from '../../design/ui'
import { cn } from '../../design/cn'
import { PdfViewer } from './pdf-viewer'
import { ProblemBuilder } from './problem-builder'
import type { ProblemDraft } from './problem-builder-model'
import { TexViewer } from './tex-viewer'
import { UploadSeriesDialog } from './upload-series-dialog'

const MAX_PDF_BYTES = 1024 * 1024
type StatementFormat = 'tex' | 'pdf'

function problemsToDrafts(series: Series): ProblemDraft[] {
  return [...series.problems]
    .sort((a, b) => a.number - b.number)
    .map((problem) => ({
      id: problem.id,
      number: problem.number,
      subproblem_count: problem.subproblems.filter((part) => part.label !== '').length,
    }))
}

function draftsToBody(drafts: ProblemDraft[]): CreateSeriesBody['problems'] {
  return drafts.map((draft) => ({
    id: draft.id,
    number: draft.number,
    subproblem_count: draft.subproblem_count,
  }))
}

export function SeriesDraftEditor({ centerId, series }: { centerId: number; series: Series }) {
  const [format, setFormat] = useState<StatementFormat>(
    series.has_pdf && !series.has_tex ? 'pdf' : 'tex',
  )
  const [tex, setTex] = useState('')
  const [problems, setProblems] = useState<ProblemDraft[]>(() => problemsToDrafts(series))
  const [materialError, setMaterialError] = useState<string | null>(null)
  const [problemError, setProblemError] = useState<string | null>(null)
  const [publishError, setPublishError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const texQuery = useSeriesTex(series.id, series.has_tex)
  const preambleQuery = useMathCenterLatexPreamble(centerId)
  const putTex = usePutSeriesTex(series.id)
  const uploadPdf = useUploadSeriesPdf(series.id)
  const update = useUpdateSeries(series.id)
  const publish = usePublishSeries(series.id)
  const previewSource = useDeferredValue(tex)
  const preamble = preambleQuery.data?.preamble ?? DEFAULT_LATEX_PREAMBLE
  const preview = previewSource.trim() ? normalizeLatexSource(previewSource, preamble) : ''
  const canPublish = (series.has_tex || series.has_pdf) && series.problems.length > 0
  const materialsBusy = putTex.isPending || uploadPdf.isPending

  useEffect(() => {
    if (texQuery.data?.tex) setTex(latexBodySource(texQuery.data.tex))
  }, [texQuery.data?.tex])

  useEffect(() => {
    setProblems(problemsToDrafts(series))
  }, [series])

  const runMaterial = (work: () => Promise<unknown>) => {
    setMaterialError(null)
    void work().catch((error: unknown) => {
      setMaterialError(
        error instanceof APIErrorImpl ? error.message : 'Не удалось сохранить условие.',
      )
    })
  }

  const saveProblems = () => {
    setProblemError(null)
    update.mutate(
      {
        number: series.number,
        name: series.name,
        due_at: series.due_at,
        problems: draftsToBody(problems),
      },
      {
        onError: (error) => setProblemError(
          error instanceof APIErrorImpl ? error.message : 'Не удалось сохранить задачи.',
        ),
      },
    )
  }

  const onPdfSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (file.size > MAX_PDF_BYTES) {
      setMaterialError('Файл больше 1 МиБ.')
      return
    }
    runMaterial(() => uploadPdf.mutateAsync(file))
  }

  return (
    <div className="animate-rise flex flex-col gap-7">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-5">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-faint">
            Черновик · серия {series.number}
          </p>
          <div className="mt-1 flex items-center gap-2">
            <h1 className="truncate font-display text-2xl font-medium text-ink">{series.name}</h1>
            <UploadSeriesDialog
              key={'draft-meta-' + series.id}
              centerId={centerId}
              series={series}
              trigger={
                <button
                  type="button"
                  aria-label="Редактировать серию"
                  title="Редактировать серию"
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                >
                  <Pencil className="h-4 w-4" aria-hidden />
                </button>
              }
            />
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Button
            size="sm"
            disabled={!canPublish || publish.isPending}
            title={canPublish ? 'Опубликовать серию' : 'Добавьте условие и хотя бы одну задачу'}
            onClick={() => {
              setPublishError(null)
              publish.mutate(undefined, {
                onError: (error) => setPublishError(
                  error instanceof APIErrorImpl ? error.message : 'Не удалось опубликовать серию.',
                ),
              })
            }}
          >
            {publish.isPending ? 'Публикуем…' : 'Опубликовать'}
          </Button>
          {!canPublish ? (
            <span className="text-right text-xs text-faint">Нужны условие и задача</span>
          ) : null}
        </div>
      </header>
      {publishError ? <p className="-mt-4 text-sm text-danger" role="alert">{publishError}</p> : null}

      <section className="flex flex-col gap-3" aria-labelledby="series-statement-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-faint">Условие</p>
            <h2 id="series-statement-heading" className="mt-1 font-display text-xl font-medium text-ink">
              Материал серии
            </h2>
          </div>
          <FormatTabs value={format} onChange={setFormat} />
        </div>
        {materialError ? <p className="text-sm text-danger" role="alert">{materialError}</p> : null}

        {format === 'tex' ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="flex min-w-0 flex-col gap-2">
              <label htmlFor="series-draft-tex" className="text-sm font-medium text-ink">Исходник</label>
              <Textarea
                id="series-draft-tex"
                value={tex}
                onChange={(event) => setTex(event.target.value)}
                className="min-h-[28rem] flex-1 font-mono text-xs leading-6"
                placeholder="Введите условие и формулы без преамбулы…"
              />
              <Button
                size="sm"
                variant="secondary"
                className="self-start"
                disabled={materialsBusy || tex.trim() === ''}
                onClick={() => runMaterial(() => putTex.mutateAsync(normalizeLatexSource(tex, preamble)))}
              >
                {putTex.isPending ? 'Сохраняем…' : 'Сохранить LaTeX'}
              </Button>
            </section>
            <section className="flex min-w-0 flex-col gap-2">
              <p className="text-sm font-medium text-ink">Предпросмотр</p>
              <div className="min-h-[28rem] overflow-auto rounded-lg border border-line bg-surface p-5">
                {preview ? <TexViewer tex={preview} /> : <p className="text-sm text-muted">Предпросмотр появится здесь.</p>}
              </div>
            </section>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {series.has_pdf ? (
              <PdfViewer
                path={'/mathcenter/series/' + series.id + '/pdf'}
                title={series.display_name + ' (PDF)'}
                fileName={'series-' + series.number + '.pdf'}
              />
            ) : (
              <div className="rounded-xl border border-dashed border-line-strong px-4 py-10 text-center text-sm text-muted">
                PDF ещё не загружен
              </div>
            )}
            <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={onPdfSelected} />
            <Button
              size="sm"
              variant="secondary"
              className="self-start"
              disabled={materialsBusy}
              onClick={() => fileRef.current?.click()}
            >
              {uploadPdf.isPending ? 'Загружаем…' : series.has_pdf ? 'Заменить PDF' : 'Загрузить PDF'}
            </Button>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3 border-t border-line pt-6" aria-labelledby="series-problems-heading">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-faint">Структура</p>
            <h2 id="series-problems-heading" className="mt-1 font-display text-xl font-medium text-ink">Задачи</h2>
          </div>
          <Button size="sm" disabled={update.isPending} onClick={saveProblems}>
            {update.isPending ? 'Сохраняем…' : 'Сохранить задачи'}
          </Button>
        </div>
        {problemError ? <p className="text-sm text-danger" role="alert">{problemError}</p> : null}
        <ProblemBuilder value={problems} onChange={setProblems} disabled={update.isPending} />
      </section>
    </div>
  )
}

function FormatTabs({
  value,
  onChange,
}: {
  value: StatementFormat
  onChange: (next: StatementFormat) => void
}) {
  return (
    <div className="inline-flex rounded-full border border-line bg-surface-muted p-0.5" role="group" aria-label="Формат условия">
      {(['tex', 'pdf'] as const).map((format) => (
        <button
          key={format}
          type="button"
          aria-pressed={value === format}
          onClick={() => onChange(format)}
          className={cn(
            'rounded-full px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
            value === format ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink',
          )}
        >
          {format === 'tex' ? 'LaTeX' : 'PDF'}
        </button>
      ))}
    </div>
  )
}
