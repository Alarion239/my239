import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  APIErrorImpl,
  createTokenSchema,
  useCreateToken,
  type CreateTokenValues,
  type InvitationToken,
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

// CreateTokenDialog opens a form to mint an invitation token. On success the raw
// token string is shown in a read-only, copyable field and the dialog stays open
// so the admin can copy it (it is only ever exposed here).
export function CreateTokenDialog() {
  const [open, setOpen] = useState(false)
  const [created, setCreated] = useState<InvitationToken | null>(null)
  const [copied, setCopied] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const createToken = useCreateToken()

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CreateTokenValues>({
    resolver: zodResolver(createTokenSchema),
    defaultValues: { description: '', max_uses: 1, expires_in_hours: 168 },
  })

  function resetAll() {
    reset()
    setCreated(null)
    setCopied(false)
    setFormError(null)
  }

  const onSubmit = handleSubmit((values) => {
    setFormError(null)
    return new Promise<void>((resolve) => {
      createToken.mutate(values, {
        onSuccess: (token) => {
          setCreated(token)
          resolve()
        },
        onError: (e) => {
          if (e instanceof APIErrorImpl) {
            for (const [k, v] of Object.entries(e.fields ?? {})) {
              setError(k as keyof CreateTokenValues, { message: v })
            }
            setFormError(e.message)
          } else {
            setFormError('Не удалось создать приглашение. Попробуйте ещё раз.')
          }
          resolve()
        },
      })
    })
  })

  async function copyToken() {
    if (!created) return
    try {
      await navigator.clipboard.writeText(created.token)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) resetAll()
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">Создать приглашение</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Создать приглашение</DialogTitle>
        <DialogDescription>
          Одноразовая или многоразовая ссылка-приглашение для регистрации.
        </DialogDescription>

        {created ? (
          <div className="mt-4 flex flex-col gap-3">
            <Field label="Токен приглашения">
              {({ id }) => (
                <Input id={id} readOnly value={created.token} onFocus={(e) => e.target.select()} />
              )}
            </Field>
            <div className="flex items-center gap-2">
              <Button type="button" variant="secondary" onClick={copyToken}>
                {copied ? 'Скопировано' : 'Скопировать'}
              </Button>
              <Button type="button" variant="ghost" onClick={resetAll}>
                Создать ещё
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-4" noValidate>
            <Field label="Описание" error={errors.description?.message}>
              {({ id, invalid }) => (
                <Input id={id} invalid={invalid} autoFocus {...register('description')} />
              )}
            </Field>
            <Field label="Макс. использований" error={errors.max_uses?.message}>
              {({ id, invalid }) => (
                <Input
                  id={id}
                  type="number"
                  min={1}
                  invalid={invalid}
                  {...register('max_uses', { valueAsNumber: true })}
                />
              )}
            </Field>
            <Field label="Срок действия (часы)" error={errors.expires_in_hours?.message}>
              {({ id, invalid }) => (
                <Input
                  id={id}
                  type="number"
                  min={1}
                  invalid={invalid}
                  {...register('expires_in_hours', { valueAsNumber: true })}
                />
              )}
            </Field>

            {formError ? <p className="text-sm text-danger">{formError}</p> : null}

            <Button type="submit" disabled={isSubmitting} className="mt-1">
              {isSubmitting ? 'Создание…' : 'Создать'}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
