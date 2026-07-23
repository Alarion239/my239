import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  APIErrorImpl,
  registerSchema,
  useInviteContext,
  useRegister,
  type RegisterValues,
} from '@my239/shared'
import { Button, Field, Input } from '../../design/ui'
import { AuthLayout } from './auth-layout'

export function RegisterPage() {
  const navigate = useNavigate()
  const registerMutation = useRegister()
  const [formError, setFormError] = useState<string | null>(null)

  // An invite link (/register?token=…) prefills and locks the token field and
  // shows what the invitee is about to join.
  const [params] = useSearchParams()
  const urlToken = params.get('token') ?? ''
  const fromLink = urlToken.length > 0

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      username: '',
      password: '',
      invitation_token: urlToken,
      first_name: '',
      middle_name: '',
      last_name: '',
    },
  })

  // Usernames are lowercase-only (the backend lowercases on store). Mirror that
  // in the field so the user sees and submits the normalised value.
  const usernameField = register('username')

  const onSubmit = handleSubmit((values) => {
    setFormError(null)
    // Normalise an empty optional middle name to undefined for the backend.
    const payload: RegisterValues = {
      ...values,
      middle_name: values.middle_name?.trim() ? values.middle_name.trim() : undefined,
    }
    return new Promise<void>((resolve) => {
      registerMutation.mutate(payload, {
        onSuccess: () => {
          navigate('/', { replace: true })
          resolve()
        },
        onError: (e) => {
          if (e instanceof APIErrorImpl) {
            for (const [k, v] of Object.entries(e.fields ?? {})) {
              setError(k as keyof RegisterValues, { message: v })
            }
            setFormError(e.message)
          } else {
            setFormError('Не удалось зарегистрироваться. Попробуйте ещё раз.')
          }
          resolve()
        },
      })
    })
  })

  return (
    <AuthLayout
      subtitle="Регистрация по приглашению"
      footer={
        <>
          Уже есть аккаунт?{' '}
          <Link to="/login" className="font-medium text-accent hover:underline">
            Войти
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {fromLink ? <InviteBanner token={urlToken} /> : null}
        <Field label="Код приглашения" error={errors.invitation_token?.message}>
          {({ id, invalid }) => (
            <Input
              id={id}
              invalid={invalid}
              autoFocus={!fromLink}
              readOnly={fromLink}
              {...register('invitation_token')}
            />
          )}
        </Field>

        <Field label="Имя" error={errors.first_name?.message}>
          {({ id, invalid }) => (
            <Input id={id} invalid={invalid} autoComplete="given-name" {...register('first_name')} />
          )}
        </Field>

        <Field label="Отчество (необязательно)" error={errors.middle_name?.message}>
          {({ id, invalid }) => (
            <Input id={id} invalid={invalid} autoComplete="additional-name" {...register('middle_name')} />
          )}
        </Field>

        <Field label="Фамилия" error={errors.last_name?.message}>
          {({ id, invalid }) => (
            <Input id={id} invalid={invalid} autoComplete="family-name" {...register('last_name')} />
          )}
        </Field>

        <Field label="Имя пользователя" error={errors.username?.message}>
          {({ id, invalid }) => (
            <Input
              id={id}
              invalid={invalid}
              autoComplete="username"
              {...usernameField}
              onChange={(e) => {
                e.target.value = e.target.value.toLowerCase()
                return usernameField.onChange(e)
              }}
            />
          )}
        </Field>

        <Field label="Пароль" error={errors.password?.message}>
          {({ id, invalid }) => (
            <Input
              id={id}
              type="password"
              invalid={invalid}
              autoComplete="new-password"
              {...register('password')}
            />
          )}
        </Field>

        {formError ? <p className="text-sm text-danger">{formError}</p> : null}

        <Button type="submit" disabled={isSubmitting} className="mt-1 w-full">
          {isSubmitting ? 'Создание…' : 'Создать аккаунт'}
        </Button>
      </form>
    </AuthLayout>
  )
}

// InviteBanner describes what an invite link grants, so the registrant knows
// which center/role/group they are joining before they submit.
function InviteBanner({ token }: { token: string }) {
  const { data, isPending, isError } = useInviteContext(token)

  if (isPending) return null
  if (isError || !data || !data.valid) {
    return (
      <p className="rounded-lg bg-surface-muted px-3 py-2 text-sm text-muted">
        Приглашение недействительно или истекло. Проверьте ссылку.
      </p>
    )
  }

  const roleLabel =
    data.role === 'teacher'
      ? 'преподавателем'
      : data.role === 'student'
        ? 'учеником'
        : null

  return (
    <div className="rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-sm text-ink">
      {data.center_name && roleLabel ? (
        <p>
          Вы вступаете в <span className="font-medium">«{data.center_name}»</span>{' '}
          {roleLabel}
          {data.group_name ? (
            <>
              {' '}
              в группу <span className="font-medium">{data.group_name}</span>
            </>
          ) : null}
          .
        </p>
      ) : (
        <p>Приглашение принято — заполните данные ниже.</p>
      )}
    </div>
  )
}
