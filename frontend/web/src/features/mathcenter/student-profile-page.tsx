import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import {
  useCreateStudentNote,
  useDeleteStudentNote,
  useStudentNotes,
  useStudentProfile,
  useUpdateStudentNote,
} from '@my239/shared'
import { Card, Spinner } from '../../design/ui'
import { useAuth } from '../../auth/auth-context'
import { InternalNotesPanel } from './internal-notes-panel'
import { useCenterIdContext } from './center-id-context'

// StudentProfilePage is the teacher-facing student page: identity + group and
// the internal teacher-only note log. Reached from the «Кондуит» (a student's
// name links here). Students who guess the URL are blocked by the backend.
export function StudentProfilePage() {
  const params = useParams<{ year: string; studentUserId: string }>()
  const year = params.year ?? ''
  const centerId = useCenterIdContext()
  const studentUserId = Number(params.studentUserId)
  const { user } = useAuth()
  const currentUserId = user?.id ?? 0

  const profile = useStudentProfile(centerId, studentUserId)
  const notes = useStudentNotes(centerId, studentUserId)
  const create = useCreateStudentNote(centerId, studentUserId)
  const update = useUpdateStudentNote(centerId, studentUserId)
  const remove = useDeleteStudentNote(centerId, studentUserId)

  const conduitPath = '/mathcenter/' + year + '/conduit'

  return (
    <div className="animate-rise mx-auto flex w-full max-w-3xl flex-col gap-4">
      <Link
        to={conduitPath}
        className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-accent underline-offset-4 hover:underline"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Назад к кондуиту
      </Link>

      {profile.isPending ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : profile.isError || !profile.data ? (
        <Card className="px-6 py-16 text-center">
          <p className="text-muted">Нет доступа к этому ученику.</p>
        </Card>
      ) : (
        <>
          <Card className="p-5">
            <h1 className="font-display text-xl font-medium text-ink">
              {profile.data.display_name}
            </h1>
            <p className="mt-1 text-sm text-muted">
              Группа {profile.data.group_name} · выпуск {profile.data.graduation_year}
            </p>
          </Card>

          <InternalNotesPanel
            notes={notes.data}
            isLoading={notes.isPending}
            currentUserId={currentUserId}
            onCreate={(body) => create.mutateAsync(body)}
            onUpdate={(noteId, body) => update.mutateAsync({ noteId, body })}
            onDelete={(noteId) => remove.mutateAsync(noteId)}
            title="Заметки об ученике"
            hint="Видно только преподавателям. Ученик их не видит."
          />
        </>
      )}
    </div>
  )
}
