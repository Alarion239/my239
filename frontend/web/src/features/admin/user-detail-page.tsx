import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import {
  APIErrorImpl,
  fullName,
  initials,
  useAdminUser,
  useCenterGroups,
  useEnrollStudent,
  useEnrollTeacher,
  useMathCenters,
  useRemoveStudent,
  useRemoveTeacher,
  useSetTeacherHead,
  useSetUserAdmin,
  useUserEnrollments,
  type StudentEnrollment,
  type TeacherEnrollment,
  type User,
} from '@my239/shared'
import { useAuth } from '../../auth/auth-context'
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Select,
  Spinner,
} from '../../design/ui'
import { ConfirmButton } from './_shared'

function apiMessage(e: unknown, fallback: string): string {
  return e instanceof APIErrorImpl ? e.message : fallback
}

export function UserDetailPage() {
  const { userId: userIdParam } = useParams<{ userId: string }>()
  const userId = Number(userIdParam)
  const { data: user, isPending, isError } = useAdminUser(userId)

  if (!Number.isFinite(userId) || userId <= 0) {
    return <NotFound />
  }
  if (isPending) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    )
  }
  if (isError || !user) {
    return <NotFound />
  }

  return (
    <div className="animate-rise flex flex-col gap-8">
      <BackLink />
      <ProfileHeader user={user} />
      <TeachingSection userId={userId} />
      <StudentSection userId={userId} />
    </div>
  )
}

function BackLink() {
  return (
    <Link
      to="/admin/users"
      className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-accent underline-offset-4 hover:underline"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden />
      К пользователям
    </Link>
  )
}

function NotFound() {
  return (
    <div className="animate-rise flex flex-col gap-6">
      <BackLink />
      <Card className="px-6 py-16 text-center">
        <p className="text-muted">Пользователь не найден.</p>
      </Card>
    </div>
  )
}

function ProfileHeader({ user }: { user: User }) {
  const { user: current } = useAuth()
  const setAdmin = useSetUserAdmin()
  const [error, setError] = useState<string | null>(null)
  const isSelf = current?.id === user.id

  function toggleAdmin() {
    setError(null)
    setAdmin.mutate(
      { userId: user.id, isAdmin: !user.is_admin },
      { onError: (e) => setError(apiMessage(e, 'Не удалось изменить роль.')) },
    )
  }

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-4 pt-6">
        <Avatar initials={initials(user)} className="h-14 w-14 text-lg" />
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl font-medium text-ink">
            {fullName(user)}
          </h1>
          <p className="text-sm text-muted">@{user.username}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {user.is_admin ? <Badge variant="accent">Админ</Badge> : null}
            {user.is_math_center ? <Badge variant="neutral">Матцентр</Badge> : null}
            {!user.is_admin && !user.is_math_center ? (
              <Badge variant="neutral">Участник</Badge>
            ) : null}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Button
            variant="secondary"
            size="sm"
            disabled={isSelf || setAdmin.isPending}
            title={isSelf ? 'Нельзя изменить собственную роль' : undefined}
            onClick={toggleAdmin}
          >
            {user.is_admin ? 'Снять админа' : 'Сделать админом'}
          </Button>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
        </div>
      </CardContent>
    </Card>
  )
}

// --- Teaching ----------------------------------------------------------------

function TeachingSection({ userId }: { userId: number }) {
  const { data, isPending, isError } = useUserEnrollments(userId)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Преподаёт</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {isPending ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : isError || !data ? (
          <p className="text-sm text-danger">Не удалось загрузить роли.</p>
        ) : (
          <>
            {data.teaching.length === 0 ? (
              <p className="text-sm text-muted">Не преподаёт ни в одном матцентре.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {data.teaching.map((t) => (
                  <TeacherRow key={t.teacher_id} userId={userId} enrollment={t} />
                ))}
              </ul>
            )}
            <AddTeacher userId={userId} taught={data.teaching} />
          </>
        )}
      </CardContent>
    </Card>
  )
}

function TeacherRow({
  userId,
  enrollment,
}: {
  userId: number
  enrollment: TeacherEnrollment
}) {
  const setHead = useSetTeacherHead()
  const remove = useRemoveTeacher()
  const [error, setError] = useState<string | null>(null)

  function toggleHead() {
    setError(null)
    setHead.mutate(
      {
        teacherId: enrollment.teacher_id,
        userId,
        isHeadTeacher: !enrollment.is_head_teacher,
      },
      { onError: (e) => setError(apiMessage(e, 'Не удалось изменить роль.')) },
    )
  }

  function removeTeacher() {
    setError(null)
    remove.mutate(
      { teacherId: enrollment.teacher_id, userId },
      { onError: (e) => setError(apiMessage(e, 'Не удалось снять преподавателя.')) },
    )
  }

  return (
    <li className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-paper px-3 py-2">
      <span className="font-medium text-ink">
        Матцентр {enrollment.graduation_year}
      </span>
      {enrollment.is_head_teacher ? <Badge variant="accent">Старший</Badge> : null}
      <div className="ml-auto flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          disabled={setHead.isPending}
          onClick={toggleHead}
        >
          {enrollment.is_head_teacher ? 'Снять старшего' : 'Сделать старшим'}
        </Button>
        <ConfirmButton
          variant="ghost"
          size="sm"
          disabled={remove.isPending}
          onConfirm={removeTeacher}
        >
          Снять
        </ConfirmButton>
      </div>
      {error ? <p className="w-full text-sm text-danger">{error}</p> : null}
    </li>
  )
}

function AddTeacher({
  userId,
  taught,
}: {
  userId: number
  taught: TeacherEnrollment[]
}) {
  const { data: centers } = useMathCenters()
  const enroll = useEnrollTeacher()
  const [centerId, setCenterId] = useState('')
  const [error, setError] = useState<string | null>(null)

  const taughtIds = new Set(taught.map((t) => t.center_id))
  const options = (centers ?? []).filter((c) => !taughtIds.has(c.id))

  function add() {
    const id = Number(centerId)
    if (!id) return
    setError(null)
    enroll.mutate(
      { centerId: id, userId, isHeadTeacher: false },
      {
        onSuccess: () => setCenterId(''),
        onError: (e) => setError(apiMessage(e, 'Не удалось добавить преподавателя.')),
      },
    )
  }

  if (options.length === 0) {
    return null
  }

  return (
    <div className="flex flex-col gap-1.5 border-t border-line pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label="Матцентр"
          value={centerId}
          onChange={(e) => setCenterId(e.target.value)}
          className="h-9 max-w-xs"
        >
          <option value="">Выберите матцентр…</option>
          {options.map((c) => (
            <option key={c.id} value={c.id}>
              Матцентр {c.graduation_year}
            </option>
          ))}
        </Select>
        <Button
          variant="secondary"
          size="sm"
          disabled={!centerId || enroll.isPending}
          onClick={add}
        >
          Добавить преподавателем
        </Button>
      </div>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </div>
  )
}

// --- Student -----------------------------------------------------------------

function StudentSection({ userId }: { userId: number }) {
  const { data, isPending, isError } = useUserEnrollments(userId)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Учится</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {isPending ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : isError || !data ? (
          <p className="text-sm text-danger">Не удалось загрузить роли.</p>
        ) : data.student ? (
          <StudentRow userId={userId} enrollment={data.student} />
        ) : (
          <AddStudent userId={userId} />
        )}
      </CardContent>
    </Card>
  )
}

function StudentRow({
  userId,
  enrollment,
}: {
  userId: number
  enrollment: StudentEnrollment
}) {
  const remove = useRemoveStudent()
  const [error, setError] = useState<string | null>(null)

  function removeStudent() {
    setError(null)
    remove.mutate(
      { studentId: enrollment.student_id, userId },
      { onError: (e) => setError(apiMessage(e, 'Не удалось снять ученика.')) },
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-paper px-3 py-2">
        <span className="font-medium text-ink">
          Матцентр {enrollment.graduation_year} · {enrollment.group_name}
        </span>
        <ConfirmButton
          variant="ghost"
          size="sm"
          className="ml-auto"
          disabled={remove.isPending}
          onConfirm={removeStudent}
        >
          Снять
        </ConfirmButton>
      </div>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </div>
  )
}

function AddStudent({ userId }: { userId: number }) {
  const { data: centers } = useMathCenters()
  const [centerId, setCenterId] = useState('')
  const numericCenter = Number(centerId)
  const { data: groups } = useCenterGroups(numericCenter || 0)
  const [groupId, setGroupId] = useState('')
  const enroll = useEnrollStudent()
  const [error, setError] = useState<string | null>(null)

  function add() {
    const id = Number(groupId)
    if (!id) return
    setError(null)
    enroll.mutate(
      { groupId: id, userId },
      {
        onSuccess: () => {
          setCenterId('')
          setGroupId('')
        },
        onError: (e) => setError(apiMessage(e, 'Не удалось добавить ученика.')),
      },
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted">Не состоит ни в одной группе.</p>
      <p className="text-xs text-faint">Ученик может быть только в одном матцентре.</p>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label="Матцентр"
          value={centerId}
          onChange={(e) => {
            setCenterId(e.target.value)
            setGroupId('')
          }}
          className="h-9 max-w-xs"
        >
          <option value="">Выберите матцентр…</option>
          {(centers ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              Матцентр {c.graduation_year}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Группа"
          value={groupId}
          onChange={(e) => setGroupId(e.target.value)}
          className="h-9 max-w-xs"
          disabled={!centerId}
        >
          <option value="">Выберите группу…</option>
          {(groups ?? []).map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </Select>
        <Button
          variant="secondary"
          size="sm"
          disabled={!groupId || enroll.isPending}
          onClick={add}
        >
          Добавить учеником
        </Button>
      </div>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </div>
  )
}
