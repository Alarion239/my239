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
} from '../../design/ui'

// CreateMathCenterDialog mints a math center for a graduation year.
export function CreateMathCenterDialog() {
  const [open, setOpen] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const createCenter = useCreateMathCenter()

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CreateMathCenterValues>({
    resolver: zodResolver(createMathCenterSchema),
    defaultValues: { graduation_year: new Date().getFullYear() },
  })

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
        <DialogDescription>Когорта учеников, сгруппированная по году выпуска.</DialogDescription>

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
