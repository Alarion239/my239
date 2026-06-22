import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  APIErrorImpl,
  nextMathcenterDueAt,
  toDatetimeLocalValue,
  useCreateSeries,
  usePutSeriesTex,
  useUpdateSeries,
  useUploadSeriesPdf,
  type CreateSeriesBody,
  type Series,
} from '@my239/shared'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  Field,
  Input,
} from '../../design/ui'
import { cn } from '../../design/cn'
import { StatementPanel } from './statement-panel'
import { ProblemBuilder } from './problem-builder'
import {
  DEFAULT_PROBLEMS,
  seedProblems,
  type ProblemDraft,
} from './problem-builder-model'

// Maximum series PDF size accepted by the backend (1 MiB).
const MAX_PDF_BYTES = 1024 * 1024

export interface UploadSeriesDialogProps {
  centerId: number
  // When present the dialog edits an existing series; otherwise it creates one.
  series?: Series
  // Pre-filled series number for a fresh series (max existing + 1). Defaults 1.
  defaultNumber?: number
  // Custom trigger (defaults to a "Загрузить серию" button).
  trigger?: React.ReactNode
}

type Step = 'meta' | 'statement' | 'problems'

const STEP_HINT: Record<Step, string> = {
  meta: 'метаданные серии',
  statement: 'условие (TeX или PDF)',
  problems: 'задачи и подзадачи',
}

// metaSchema validates step 1 only (number/name/due_at). Problems are entered in
// step 3, so they are not part of this form.
const metaSchema = z.object({
  number: z
    .number({ message: 'Введите число' })
    .int('Целое число')
    .min(0, 'Минимум 0')
    .max(100000, 'Максимум 100000'),
  name: z.string().trim().min(1, 'Введите название').max(200, 'Максимум 200 символов'),
  due_at: z.string().trim().min(1, 'Укажите срок сдачи'),
})
type MetaValues = z.infer<typeof metaSchema>

// problemsToDrafts maps an existing series' problems into builder drafts,
// ordered by number and counting only REAL subparts (the single-part sentinel
// subproblem has an empty label and is not a subpart).
function problemsToDrafts(series: Series): ProblemDraft[] {
  return [...series.problems]
    .sort((a, b) => a.number - b.number)
    .map((p) => ({
      id: p.id,
      number: p.number,
      subproblem_count: p.subproblems.filter((s) => s.label !== '').length,
    }))
}

// draftsToBody serialises drafts into the wire problem list.
function draftsToBody(drafts: ProblemDraft[]): CreateSeriesBody['problems'] {
  return drafts.map((d) => ({
    id: d.id,
    number: d.number,
    subproblem_count: d.subproblem_count,
  }))
}

// UploadSeriesDialog is the teacher/admin create-and-edit flow as a 3-step
// wizard: (1) metadata, (2) statement upload, (3) problems — with the rendered
// statement shown beside the problem builder so problems can be marked off
// against it. The series is created up front (with no problems) so the statement
// can attach to it; problems are saved in step 3.
export function UploadSeriesDialog({
  centerId,
  series,
  defaultNumber,
  trigger,
}: UploadSeriesDialogProps) {
  const isEdit = !!series
  const [open, setOpen] = useState(false)
  // The series we're working on: the edited one, or the freshly created one.
  const [attachTo, setAttachTo] = useState<Series | null>(series ?? null)
  const [step, setStep] = useState<Step>('meta')

  function reset(nextOpen: boolean) {
    setOpen(nextOpen)
    if (!nextOpen) {
      setAttachTo(series ?? null)
      setStep('meta')
    }
  }

  const stepNo = step === 'meta' ? 1 : step === 'statement' ? 2 : 3

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        {trigger ?? <Button size="sm">Загрузить серию</Button>}
      </DialogTrigger>
      <DialogContent className={step === 'problems' ? 'max-w-4xl' : 'max-w-lg'}>
        <DialogTitle>{isEdit ? 'Редактировать серию' : 'Загрузить серию'}</DialogTitle>
        <DialogDescription>
          Шаг {stepNo} из 3 — {STEP_HINT[step]}.
        </DialogDescription>

        {step === 'meta' ? (
          <MetaStep
            centerId={centerId}
            series={attachTo ?? undefined}
            defaultNumber={defaultNumber ?? 1}
            onSaved={(saved) => {
              setAttachTo(saved)
              setStep('statement')
            }}
          />
        ) : attachTo && step === 'statement' ? (
          <StatementStep
            series={attachTo}
            onAttached={setAttachTo}
            onBack={() => setStep('meta')}
            onNext={() => setStep('problems')}
          />
        ) : attachTo ? (
          <ProblemsStep
            series={attachTo}
            onSaved={setAttachTo}
            onBack={() => setStep('statement')}
            onDone={() => reset(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function MetaStep({
  centerId,
  series,
  defaultNumber,
  onSaved,
}: {
  centerId: number
  series: Series | undefined
  defaultNumber: number
  onSaved: (saved: Series) => void
}) {
  const isEdit = !!series
  const create = useCreateSeries(centerId)
  const update = useUpdateSeries(series?.id ?? 0)
  const [formError, setFormError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<MetaValues>({
    resolver: zodResolver(metaSchema),
    defaultValues: isEdit
      ? {
          number: series.number,
          name: series.name,
          due_at: toDatetimeLocalValue(new Date(series.due_at)),
        }
      : {
          number: defaultNumber,
          name: '',
          // Sessions run Wed/Sat 16:00 Moscow time — pre-fill the next one.
          due_at: toDatetimeLocalValue(nextMathcenterDueAt(new Date())),
        },
  })

  const onSubmit = handleSubmit((values) => {
    setFormError(null)
    // datetime-local yields "YYYY-MM-DDTHH:mm" (local); the backend decodes
    // due_at as RFC3339, so convert before sending (else: 400).
    const dueDate = new Date(values.due_at)
    if (Number.isNaN(dueDate.getTime())) {
      setError('due_at', { message: 'Укажите корректный срок' })
      return
    }
    // Edit keeps the existing problems untouched (they're managed in step 3);
    // create starts with none — they're added in step 3 after the statement.
    const payload: CreateSeriesBody = {
      number: values.number,
      name: values.name,
      due_at: dueDate.toISOString(),
      problems: isEdit ? draftsToBody(problemsToDrafts(series)) : [],
    }
    const mutation = isEdit ? update : create
    return new Promise<void>((resolve) => {
      mutation.mutate(payload, {
        onSuccess: (saved) => {
          onSaved(saved)
          resolve()
        },
        onError: (e) => {
          if (e instanceof APIErrorImpl) {
            for (const [k, v] of Object.entries(e.fields ?? {})) {
              setError(k as keyof MetaValues, { message: v })
            }
            setFormError(e.message)
          } else {
            setFormError('Не удалось сохранить серию. Попробуйте ещё раз.')
          }
          resolve()
        },
      })
    })
  })

  return (
    <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-4" noValidate>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Номер серии" error={errors.number?.message}>
          {({ id, invalid }) => (
            <Input
              id={id}
              type="number"
              min={0}
              invalid={invalid}
              {...register('number', { valueAsNumber: true })}
            />
          )}
        </Field>
        <Field label="Срок сдачи" error={errors.due_at?.message}>
          {({ id, invalid }) => (
            <Input id={id} type="datetime-local" invalid={invalid} {...register('due_at')} />
          )}
        </Field>
      </div>

      <Field label="Название" error={errors.name?.message}>
        {({ id, invalid }) => <Input id={id} invalid={invalid} {...register('name')} />}
      </Field>

      {formError ? <p className="text-sm text-danger">{formError}</p> : null}

      <Button type="submit" disabled={isSubmitting} className="mt-1">
        {isSubmitting ? 'Сохранение…' : isEdit ? 'Сохранить и далее →' : 'Далее →'}
      </Button>
    </form>
  )
}

type AttachMode = 'tex' | 'pdf'

function StatementStep({
  series,
  onAttached,
  onBack,
  onNext,
}: {
  series: Series
  onAttached: (saved: Series) => void
  onBack: () => void
  onNext: () => void
}) {
  const [mode, setMode] = useState<AttachMode>(series.has_pdf && !series.has_tex ? 'pdf' : 'tex')
  const [tex, setTex] = useState('')
  const [error, setError] = useState<string | null>(null)
  const putTex = usePutSeriesTex(series.id)
  const uploadPdf = useUploadSeriesPdf(series.id)

  function submitTex() {
    setError(null)
    if (!tex.includes('\\begin{document}')) {
      setError('LaTeX должен содержать \\begin{document}.')
      return
    }
    putTex.mutate(tex, {
      onSuccess: (saved) => {
        onAttached(saved)
        onNext()
      },
      onError: (e) => {
        setError(e instanceof APIErrorImpl ? e.message : 'Не удалось сохранить условие.')
      },
    })
  }

  function onPdfChange(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null)
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > MAX_PDF_BYTES) {
      setError('Файл больше 1 МиБ.')
      e.target.value = ''
      return
    }
    uploadPdf.mutate(file, {
      onSuccess: (saved) => {
        onAttached(saved)
        onNext()
      },
      onError: (err) => {
        setError(err instanceof Error ? err.message : 'Не удалось загрузить PDF.')
      },
    })
  }

  const busy = putTex.isPending || uploadPdf.isPending
  const attached = series.has_tex || series.has_pdf

  return (
    <div className="mt-4 flex flex-col gap-4">
      <div className="inline-flex self-start rounded-full border border-line bg-surface-muted p-0.5">
        {(['tex', 'pdf'] as AttachMode[]).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            onClick={() => {
              setMode(m)
              setError(null)
            }}
            className={cn(
              'rounded-full px-3 py-1 text-sm font-medium transition-colors',
              mode === m ? 'bg-accent-soft text-accent-ink' : 'text-muted hover:text-ink',
            )}
          >
            {m === 'tex' ? 'LaTeX' : 'PDF'}
          </button>
        ))}
      </div>

      {mode === 'tex' ? (
        <div className="flex flex-col gap-2">
          <label htmlFor="series-tex" className="text-sm font-medium text-ink">
            Исходник LaTeX
          </label>
          <textarea
            id="series-tex"
            value={tex}
            onChange={(e) => setTex(e.target.value)}
            rows={8}
            placeholder={'\\documentclass{article}\n\\begin{document}\n...\n\\end{document}'}
            className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 font-mono text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          />
          <p className="text-xs text-faint">Должен содержать \begin{'{document}'}.</p>
          <Button type="button" onClick={submitTex} disabled={busy}>
            {putTex.isPending ? 'Сохранение…' : 'Сохранить условие и далее →'}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <label htmlFor="series-pdf" className="text-sm font-medium text-ink">
            PDF-файл (до 1 МиБ)
          </label>
          <input
            id="series-pdf"
            type="file"
            accept="application/pdf"
            disabled={busy}
            onChange={onPdfChange}
            className="text-sm text-muted file:mr-3 file:rounded-lg file:border file:border-line-strong file:bg-surface file:px-3 file:py-1.5 file:text-sm file:text-ink hover:file:bg-surface-muted"
          />
          {uploadPdf.isPending ? <p className="text-sm text-muted">Загрузка…</p> : null}
        </div>
      )}

      {error ? <p className="text-sm text-danger" role="alert">{error}</p> : null}

      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="ghost" onClick={onBack} disabled={busy}>
          ← Назад
        </Button>
        <Button type="button" variant="ghost" onClick={onNext} disabled={busy}>
          {attached ? 'К задачам →' : 'Пропустить →'}
        </Button>
      </div>
    </div>
  )
}

function ProblemsStep({
  series,
  onSaved,
  onBack,
  onDone,
}: {
  series: Series
  onSaved: (saved: Series) => void
  onBack: () => void
  onDone: () => void
}) {
  const update = useUpdateSeries(series.id)
  const [drafts, setDrafts] = useState<ProblemDraft[]>(() =>
    series.problems.length > 0 ? problemsToDrafts(series) : seedProblems(DEFAULT_PROBLEMS),
  )
  const [error, setError] = useState<string | null>(null)

  function save() {
    setError(null)
    const payload: CreateSeriesBody = {
      number: series.number,
      name: series.name,
      due_at: series.due_at,
      problems: draftsToBody(drafts),
    }
    update.mutate(payload, {
      onSuccess: (saved) => {
        onSaved(saved)
        onDone()
      },
      onError: (e) => {
        setError(e instanceof APIErrorImpl ? e.message : 'Не удалось сохранить задачи.')
      },
    })
  }

  return (
    <div className="mt-4 flex flex-col gap-4">
      <div className="flex flex-col gap-4 md:flex-row md:items-start">
        {/* Rendered statement to mark problems against. */}
        <div className="max-h-[55vh] overflow-auto rounded-lg border border-line p-3 md:w-1/2">
          <StatementPanel series={series} bare />
        </div>
        {/* The problem builder. */}
        <div className="md:w-1/2">
          <ProblemBuilder value={drafts} onChange={setDrafts} />
        </div>
      </div>

      {error ? <p className="text-sm text-danger" role="alert">{error}</p> : null}

      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="ghost" onClick={onBack} disabled={update.isPending}>
          ← Условие
        </Button>
        <Button type="button" onClick={save} disabled={update.isPending}>
          {update.isPending ? 'Сохранение…' : 'Сохранить и готово'}
        </Button>
      </div>
    </div>
  )
}
