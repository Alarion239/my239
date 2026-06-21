import { useState } from 'react'
import { useFieldArray, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Plus, Trash2 } from 'lucide-react'
import {
  APIErrorImpl,
  createSeriesSchema,
  useCreateSeries,
  usePutSeriesTex,
  useUpdateSeries,
  useUploadSeriesPdf,
  type CreateSeriesValues,
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

// Maximum series PDF size accepted by the backend (1 MiB).
const MAX_PDF_BYTES = 1024 * 1024

export interface UploadSeriesDialogProps {
  centerId: number
  // When present the dialog edits an existing series; otherwise it creates one.
  series?: Series
  // Custom trigger (defaults to a "Загрузить серию" button).
  trigger?: React.ReactNode
}

// toLocalInput converts an ISO timestamp into the value a datetime-local input
// expects (YYYY-MM-DDTHH:mm in local time). Empty/invalid -> ''.
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    d.getFullYear() +
    '-' +
    pad(d.getMonth() + 1) +
    '-' +
    pad(d.getDate()) +
    'T' +
    pad(d.getHours()) +
    ':' +
    pad(d.getMinutes())
  )
}

function defaultsFor(series: Series | undefined): CreateSeriesValues {
  if (!series) {
    return { number: 1, name: '', due_at: '', problems: [{ number: 1, subproblem_count: 1 }] }
  }
  return {
    number: series.number,
    name: series.name,
    due_at: toLocalInput(series.due_at),
    problems:
      series.problems.length > 0
        ? series.problems.map((p) => ({
            number: p.number,
            // Count only REAL subparts: a single-part problem carries one
            // sentinel subproblem (label="") that means "0 declared subparts".
            subproblem_count: p.subproblems.filter((s) => s.label !== '').length,
          }))
        : [{ number: 1, subproblem_count: 1 }],
  }
}

// UploadSeriesDialog is the teacher/admin create-and-edit flow: step 1 captures
// the metadata + problem list, step 2 attaches the statement (TeX or PDF). The
// series must exist before it can be attached to, so create transitions into the
// attach step on its own series, while edit starts already attached.
export function UploadSeriesDialog({ centerId, series, trigger }: UploadSeriesDialogProps) {
  const isEdit = !!series
  const [open, setOpen] = useState(false)
  // The series we're attaching to: the edited one, or the freshly created one.
  const [attachTo, setAttachTo] = useState<Series | null>(series ?? null)
  const [step, setStep] = useState<'details' | 'attach'>(isEdit ? 'attach' : 'details')

  function reset(nextOpen: boolean) {
    setOpen(nextOpen)
    if (!nextOpen) {
      setAttachTo(series ?? null)
      setStep(isEdit ? 'attach' : 'details')
    }
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        {trigger ?? <Button size="sm">Загрузить серию</Button>}
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogTitle>{isEdit ? 'Редактировать серию' : 'Загрузить серию'}</DialogTitle>
        <DialogDescription>
          {step === 'details'
            ? 'Шаг 1 из 2 — метаданные и список задач.'
            : 'Шаг 2 из 2 — условие (TeX или PDF). Можно закрыть и вернуться позже.'}
        </DialogDescription>

        {step === 'details' ? (
          <DetailsStep
            centerId={centerId}
            series={series}
            onSaved={(saved) => {
              setAttachTo(saved)
              setStep('attach')
            }}
          />
        ) : attachTo ? (
          <AttachStep series={attachTo} onDone={() => reset(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function DetailsStep({
  centerId,
  series,
  onSaved,
}: {
  centerId: number
  series: Series | undefined
  onSaved: (saved: Series) => void
}) {
  const isEdit = !!series
  const create = useCreateSeries(centerId)
  const update = useUpdateSeries(series?.id ?? 0)
  const [formError, setFormError] = useState<string | null>(null)

  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CreateSeriesValues>({
    resolver: zodResolver(createSeriesSchema),
    defaultValues: defaultsFor(series),
  })
  const { fields, append, remove } = useFieldArray({ control, name: 'problems' })

  const onSubmit = handleSubmit((values) => {
    setFormError(null)
    // The datetime-local input yields local "YYYY-MM-DDTHH:mm"; the backend
    // decodes due_at as RFC3339, so convert before sending (else: 400).
    const dueDate = new Date(values.due_at)
    if (Number.isNaN(dueDate.getTime())) {
      setError('due_at', { message: 'Укажите корректный срок' })
      return
    }
    const payload = { ...values, due_at: dueDate.toISOString() }
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
              setError(k as keyof CreateSeriesValues, { message: v })
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

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-ink">Задачи</span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => append({ number: fields.length + 1, subproblem_count: 1 })}
          >
            <Plus className="h-4 w-4" aria-hidden /> Добавить
          </Button>
        </div>

        {fields.map((field, i) => (
          <div key={field.id} className="flex items-start gap-2">
            <div className="flex-1">
              <Input
                type="number"
                min={0}
                aria-label={'Номер задачи ' + (i + 1)}
                invalid={!!errors.problems?.[i]?.number}
                {...register(`problems.${i}.number`, { valueAsNumber: true })}
              />
              {errors.problems?.[i]?.number ? (
                <p className="mt-1 text-xs text-danger">{errors.problems[i]?.number?.message}</p>
              ) : null}
            </div>
            <div className="flex-1">
              <Input
                type="number"
                min={0}
                max={10}
                aria-label={'Число подзадач ' + (i + 1)}
                invalid={!!errors.problems?.[i]?.subproblem_count}
                {...register(`problems.${i}.subproblem_count`, { valueAsNumber: true })}
              />
              {errors.problems?.[i]?.subproblem_count ? (
                <p className="mt-1 text-xs text-danger">
                  {errors.problems[i]?.subproblem_count?.message}
                </p>
              ) : null}
            </div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={'Удалить задачу ' + (i + 1)}
              onClick={() => remove(i)}
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        ))}
        {errors.problems?.message ? (
          <p className="text-sm text-danger">{errors.problems.message}</p>
        ) : null}
        {errors.problems?.root?.message ? (
          <p className="text-sm text-danger">{errors.problems.root.message}</p>
        ) : null}
      </div>

      {formError ? <p className="text-sm text-danger">{formError}</p> : null}

      <Button type="submit" disabled={isSubmitting} className="mt-1">
        {isSubmitting ? 'Сохранение…' : isEdit ? 'Сохранить и продолжить' : 'Создать и продолжить'}
      </Button>
    </form>
  )
}

type AttachMode = 'tex' | 'pdf'

function AttachStep({ series, onDone }: { series: Series; onDone: () => void }) {
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
      onSuccess: () => onDone(),
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
      onSuccess: () => onDone(),
      onError: (err) => {
        setError(err instanceof Error ? err.message : 'Не удалось загрузить PDF.')
      },
    })
  }

  const busy = putTex.isPending || uploadPdf.isPending

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
            {putTex.isPending ? 'Сохранение…' : 'Сохранить условие'}
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

      <Button type="button" variant="ghost" onClick={onDone} disabled={busy}>
        Готово
      </Button>
    </div>
  )
}
