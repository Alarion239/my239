import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  APIErrorImpl,
  nextMathcenterDueAtForTerm,
  toDatetimeLocalValue,
  useCreateSeries,
  useUpdateSeries,
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

export interface UploadSeriesDialogProps {
  centerId: number
  termId?: number
  series?: Series
  defaultNumber?: number
  previousDueAt?: string | null
  termKind?: 'academic' | 'camp' | 'legacy'
  trigger?: React.ReactNode
}

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

function existingProblems(series: Series): CreateSeriesBody['problems'] {
  return [...series.problems]
    .sort((a, b) => a.number - b.number)
    .map((problem) => ({
      id: problem.id,
      number: problem.number,
      subproblem_count: problem.subproblems.filter((part) => part.label !== '').length,
    }))
}

// Creation only asks for stable metadata. The new series opens immediately as
// a private draft where statement and problem cards can be built iteratively.
export function UploadSeriesDialog({
  centerId,
  termId = 0,
  series,
  defaultNumber = 1,
  previousDueAt,
  termKind = 'academic',
  trigger,
}: UploadSeriesDialogProps) {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const { year = '' } = useParams<{ year: string }>()
  const isEdit = !!series

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? <Button size="sm">Создать серию</Button>}
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogTitle>{isEdit ? 'Редактировать серию' : 'Создать серию'}</DialogTitle>
        <DialogDescription>
          {isEdit
            ? 'Измените номер, название или срок сдачи.'
            : 'Серия сохранится как черновик. Условие и задачи добавляются на следующем экране.'}
        </DialogDescription>
        <MetaForm
          centerId={centerId}
          termId={termId}
          series={series}
          defaultNumber={defaultNumber}
          previousDueAt={previousDueAt}
          termKind={termKind}
          onSaved={(saved) => {
            setOpen(false)
            if (!isEdit) {
              const savedTermId = saved.term_id || termId
              navigate(
                '/mathcenter/' + year + '/series/' + saved.id + '/statement?term_id=' + savedTermId,
              )
            }
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

function MetaForm({
  centerId,
  termId,
  series,
  defaultNumber,
  previousDueAt,
  termKind,
  onSaved,
}: {
  centerId: number
  termId: number
  series?: Series
  defaultNumber: number
  previousDueAt?: string | null
  termKind: 'academic' | 'camp' | 'legacy'
  onSaved: (saved: Series) => void
}) {
  const create = useCreateSeries(centerId, termId)
  const update = useUpdateSeries(series?.id ?? 0)
  const [formError, setFormError] = useState<string | null>(null)
  const isEdit = !!series
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
          due_at: toDatetimeLocalValue(
            nextMathcenterDueAtForTerm(
              termKind,
              previousDueAt ? new Date(previousDueAt) : null,
            ),
          ),
        },
  })

  const onSubmit = handleSubmit((values) => {
    setFormError(null)
    const dueDate = new Date(values.due_at)
    if (Number.isNaN(dueDate.getTime())) {
      setError('due_at', { message: 'Укажите корректный срок' })
      return
    }
    const body: CreateSeriesBody = {
      number: values.number,
      name: values.name,
      due_at: dueDate.toISOString(),
      problems: series ? existingProblems(series) : [],
    }
    const mutation = series ? update : create
    return new Promise<void>((resolve) => {
      mutation.mutate(body, {
        onSuccess: (saved) => {
          onSaved(saved)
          resolve()
        },
        onError: (error) => {
          if (error instanceof APIErrorImpl) {
            for (const [key, message] of Object.entries(error.fields ?? {})) {
              setError(key as keyof MetaValues, { message })
            }
            setFormError(error.message)
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
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
      {formError ? <p className="text-sm text-danger" role="alert">{formError}</p> : null}
      <div className="flex justify-end">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Сохранение…' : isEdit ? 'Сохранить' : 'Создать черновик'}
        </Button>
      </div>
    </form>
  )
}
