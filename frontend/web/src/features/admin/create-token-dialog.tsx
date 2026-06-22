import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  APIErrorImpl,
  createTokenSchema,
  useCenterGroups,
  useCreateToken,
  useMathCenters,
  type CreateTokenValues,
  type InvitationToken,
  type TokenPreset,
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
  Select,
} from '../../design/ui'

// The role a token grants its registrant. 'none' mints a plain invite; the
// others map onto the backend tokenpreset.Preset grants.
type Grant = 'none' | 'admin' | 'teacher' | 'student'

// CreateTokenDialog opens a form to mint an invitation token. On success the raw
// token string is shown in a read-only, copyable field and the dialog stays open
// so the admin can copy it (it is only ever exposed here). The role section
// presets what the registrant becomes (admin / teacher / student), enforced
// server-side at registration.
export function CreateTokenDialog() {
  const [open, setOpen] = useState(false)
  const [created, setCreated] = useState<InvitationToken | null>(null)
  const [copied, setCopied] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // Role/preset selection lives outside react-hook-form: it's a small dependent
  // state machine (center → group) that's clearer as plain state.
  const [grant, setGrant] = useState<Grant>('none')
  const [teacherCenterId, setTeacherCenterId] = useState(0)
  const [isHeadTeacher, setIsHeadTeacher] = useState(false)
  const [studentCenterId, setStudentCenterId] = useState(0)
  const [studentGroupId, setStudentGroupId] = useState(0)
  const [presetError, setPresetError] = useState<string | null>(null)

  const createToken = useCreateToken()
  // Only fetch centers once the dialog is open (admin-gated endpoint).
  const centers = useMathCenters(open)
  const groups = useCenterGroups(grant === 'student' ? studentCenterId : 0)

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
    setGrant('none')
    setTeacherCenterId(0)
    setIsHeadTeacher(false)
    setStudentCenterId(0)
    setStudentGroupId(0)
    setPresetError(null)
  }

  // buildPreset returns the preset to send, or null when the selection is
  // incomplete (after setting presetError). 'none' → undefined (plain invite).
  function buildPreset(): { ok: true; preset?: TokenPreset } | { ok: false } {
    setPresetError(null)
    if (grant === 'none') return { ok: true, preset: undefined }
    if (grant === 'admin') return { ok: true, preset: { grants_admin: true } }
    if (grant === 'teacher') {
      if (!teacherCenterId) {
        setPresetError('Выберите матцентр')
        return { ok: false }
      }
      return {
        ok: true,
        preset: {
          mathcenter_teacher: {
            center_id: teacherCenterId,
            is_head_teacher: isHeadTeacher,
          },
        },
      }
    }
    if (!studentGroupId) {
      setPresetError('Выберите группу')
      return { ok: false }
    }
    return { ok: true, preset: { mathcenter_student: { group_id: studentGroupId } } }
  }

  const onSubmit = handleSubmit((values) => {
    setFormError(null)
    const built = buildPreset()
    if (!built.ok) return
    return new Promise<void>((resolve) => {
      createToken.mutate(
        { ...values, preset: built.preset },
        {
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
        },
      )
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

  const centerOptions = centers.data ?? []

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

            {/* Role preset: what the registrant becomes. The backend applies it
                atomically at registration and rejects dangling references. */}
            <Field label="Роль при регистрации">
              {({ id }) => (
                <Select
                  id={id}
                  value={grant}
                  onChange={(e) => {
                    setGrant(e.target.value as Grant)
                    setPresetError(null)
                  }}
                >
                  <option value="none">Без роли (обычный пользователь)</option>
                  <option value="admin">Администратор</option>
                  <option value="teacher">Преподаватель матцентра</option>
                  <option value="student">Студент матцентра</option>
                </Select>
              )}
            </Field>

            {grant === 'teacher' ? (
              <>
                <Field label="Матцентр">
                  {({ id, invalid }) => (
                    <Select
                      id={id}
                      invalid={invalid}
                      value={teacherCenterId || ''}
                      onChange={(e) => setTeacherCenterId(Number(e.target.value))}
                    >
                      <option value="">— выберите —</option>
                      {centerOptions.map((c) => (
                        <option key={c.id} value={c.id}>
                          Выпуск {c.graduation_year}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={isHeadTeacher}
                    onChange={(e) => setIsHeadTeacher(e.target.checked)}
                    className="h-4 w-4 rounded border-line-strong text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  />
                  Старший преподаватель (может управлять центром)
                </label>
              </>
            ) : null}

            {grant === 'student' ? (
              <>
                <Field label="Матцентр">
                  {({ id }) => (
                    <Select
                      id={id}
                      value={studentCenterId || ''}
                      onChange={(e) => {
                        setStudentCenterId(Number(e.target.value))
                        setStudentGroupId(0)
                      }}
                    >
                      <option value="">— выберите —</option>
                      {centerOptions.map((c) => (
                        <option key={c.id} value={c.id}>
                          Выпуск {c.graduation_year}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Группа">
                  {({ id, invalid }) => (
                    <Select
                      id={id}
                      invalid={invalid}
                      disabled={!studentCenterId || groups.isPending}
                      value={studentGroupId || ''}
                      onChange={(e) => setStudentGroupId(Number(e.target.value))}
                    >
                      <option value="">
                        {!studentCenterId
                          ? '— сначала выберите матцентр —'
                          : (groups.data?.length ?? 0) === 0
                            ? '— в центре нет групп —'
                            : '— выберите —'}
                      </option>
                      {(groups.data ?? []).map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </>
            ) : null}

            {presetError ? <p className="text-sm text-danger">{presetError}</p> : null}
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
