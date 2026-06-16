import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link, useNavigate } from 'react-router-dom'
import {
  APIErrorImpl,
  registerSchema,
  useRegister,
  type RegisterValues,
} from '@my239/shared'
import { Button, Field, Input } from '../../design/ui'
import { AuthLayout } from './auth-layout'

export function RegisterPage() {
  const navigate = useNavigate()
  const registerMutation = useRegister()
  const [formError, setFormError] = useState<string | null>(null)

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
      invitation_token: '',
      first_name: '',
      middle_name: '',
      last_name: '',
    },
  })

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
        <Field label="Код приглашения" error={errors.invitation_token?.message}>
          {({ id, invalid }) => (
            <Input id={id} invalid={invalid} autoFocus {...register('invitation_token')} />
          )}
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Имя" error={errors.first_name?.message}>
            {({ id, invalid }) => (
              <Input id={id} invalid={invalid} autoComplete="given-name" {...register('first_name')} />
            )}
          </Field>
          <Field label="Фамилия" error={errors.last_name?.message}>
            {({ id, invalid }) => (
              <Input id={id} invalid={invalid} autoComplete="family-name" {...register('last_name')} />
            )}
          </Field>
        </div>

        <Field label="Отчество (необязательно)" error={errors.middle_name?.message}>
          {({ id, invalid }) => (
            <Input id={id} invalid={invalid} autoComplete="additional-name" {...register('middle_name')} />
          )}
        </Field>

        <Field label="Имя пользователя" error={errors.username?.message}>
          {({ id, invalid }) => (
            <Input id={id} invalid={invalid} autoComplete="username" {...register('username')} />
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
