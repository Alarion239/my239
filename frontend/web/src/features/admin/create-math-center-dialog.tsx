import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  APIErrorImpl,
  createMathCenterSchema,
  useCreateMathCenter,
  type CreateMathCenterValues,
} from '@my239/shared'
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  Field,
  Input,
  Select,
} from '../../design/ui'

const termOptions = Array.from({ length: 7 }, (_, index) => index + 5).flatMap(
  (grade) => [
    { kind: 'academic' as const, grade },
    ...(grade < 11 ? [{ kind: 'camp' as const, grade }] : []),
  ],
)

function termLabel(
  kind: CreateMathCenterValues['term_kind'],
  grade: number,
  graduationYear: number,
) {
  const endingYear = graduationYear - (11 - grade)
  const calendar =
    Number.isInteger(endingYear) && endingYear >= 1900 && endingYear <= 2100
      ? kind === 'camp'
        ? `лето ${endingYear}`
        : `${endingYear - 1}–${endingYear}`
      : null
  const name = kind === 'camp' ? `${grade} класс · Лагерь` : `${grade} класс`
  return calendar ? `${name} · ${calendar}` : name
}

// CreateMathCenterDialog mints a cohort and its explicitly selected first term.
export function CreateMathCenterDialog() {
  const [open, setOpen] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const createCenter = useCreateMathCenter()

  const {
    register,
    handleSubmit,
    reset,
    setError,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CreateMathCenterValues>({
    resolver: zodResolver(createMathCenterSchema),
    defaultValues: {
      graduation_year: new Date().getFullYear(),
      term_kind: 'academic',
      term_grade: 11,
    },
  })
  const graduationYear = watch('graduation_year')
  const termKind = watch('term_kind')
  const termGrade = watch('term_grade')

  const onSubmit = handleSubmit((values) => {
    setFormError(null)
    return new Promise<void>((resolve) => {
      createCenter.mutate(values, {
        onSuccess: () => {
          reset()
          setOpen(false)
          resolve()
        },
        onError: (e) => {
          if (e instanceof APIErrorImpl) {
            for (const [k, v] of Object.entries(e.fields ?? {})) {
              setError(k as keyof CreateMathCenterValues, { message: v })
            }
            setFormError(e.message)
          } else {
            setFormError('Не удалось создать матцентр. Попробуйте ещё раз.')
          }
          resolve()
        },
      })
    })
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) {
          reset()
          setFormError(null)
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">Создать матцентр</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Создать матцентр</DialogTitle>
        <DialogDescription>
          Укажите год выпуска и период, с которого начинается работа этой когорты.
          Можно выбрать период в прошлом.
        </DialogDescription>

        <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-4" noValidate>
          <Field label="Год выпуска" error={errors.graduation_year?.message}>
            {({ id, invalid }) => (
              <Input
                id={id}
                type="number"
                invalid={invalid}
                autoFocus
                {...register('graduation_year', { valueAsNumber: true })}
              />
            )}
          </Field>

          <Field
            label="Учебный период"
            error={errors.term_kind?.message ?? errors.term_grade?.message}
          >
            {({ id, invalid }) => (
              <>
                <Select
                  id={id}
                  invalid={invalid}
                  value={`${termKind}:${termGrade}`}
                  onChange={(event) => {
                    const [kind, grade] = event.target.value.split(':')
                    setValue(
                      'term_kind',
                      kind as CreateMathCenterValues['term_kind'],
                      { shouldValidate: true },
                    )
                    setValue('term_grade', Number(grade), {
                      shouldValidate: true,
                    })
                  }}
                >
                  {termOptions.map((term) => (
                    <option
                      key={`${term.kind}:${term.grade}`}
                      value={`${term.kind}:${term.grade}`}
                    >
                      {termLabel(term.kind, term.grade, graduationYear)}
                    </option>
                  ))}
                </Select>
                <input type="hidden" {...register('term_kind')} />
                <input
                  type="hidden"
                  {...register('term_grade', { valueAsNumber: true })}
                />
              </>
            )}
          </Field>

          {formError ? <p className="text-sm text-danger">{formError}</p> : null}

          <div className="mt-1 flex items-center gap-2">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Создание…' : 'Создать'}
            </Button>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                Отмена
              </Button>
            </DialogClose>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
