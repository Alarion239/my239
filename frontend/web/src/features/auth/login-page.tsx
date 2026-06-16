import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link, useNavigate } from 'react-router-dom'
import { APIErrorImpl, loginSchema, useLogin, type LoginValues } from '@my239/shared'
import { Button, Field, Input } from '../../design/ui'
import { AuthLayout } from './auth-layout'

export function LoginPage() {
  const navigate = useNavigate()
  const login = useLogin()
  const [formError, setFormError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: '', password: '' },
  })

  const onSubmit = handleSubmit((values) => {
    setFormError(null)
    return new Promise<void>((resolve) => {
      login.mutate(values, {
        onSuccess: () => {
          navigate('/', { replace: true })
          resolve()
        },
        onError: (e) => {
          if (e instanceof APIErrorImpl) {
            for (const [k, v] of Object.entries(e.fields ?? {})) {
              setError(k as keyof LoginValues, { message: v })
            }
            setFormError(
              e.status === 401 ? 'Неверное имя пользователя или пароль' : e.message,
            )
          } else {
            setFormError('Не удалось войти. Попробуйте ещё раз.')
          }
          resolve()
        },
      })
    })
  })

  return (
    <AuthLayout
      subtitle="Войдите, чтобы продолжить"
      footer={
        <>
          Есть приглашение?{' '}
          <Link to="/register" className="font-medium text-accent hover:underline">
            Зарегистрироваться
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Field label="Имя пользователя" error={errors.username?.message}>
          {({ id, invalid }) => (
            <Input
              id={id}
              invalid={invalid}
              autoComplete="username"
              autoFocus
              {...register('username')}
            />
          )}
        </Field>
        <Field label="Пароль" error={errors.password?.message}>
          {({ id, invalid }) => (
            <Input
              id={id}
              type="password"
              invalid={invalid}
              autoComplete="current-password"
              {...register('password')}
            />
          )}
        </Field>

        {formError ? <p className="text-sm text-danger">{formError}</p> : null}

        <Button type="submit" disabled={isSubmitting} className="mt-1 w-full">
          {isSubmitting ? 'Вход…' : 'Войти'}
        </Button>
      </form>
    </AuthLayout>
  )
}
