import { Link, useLocation, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import {
  useCreateStudentNote,
  useDeleteStudentNote,
  useStudentNotes,
  useStudentProfile,
  useUpdateStudentNameColor,
  useUpdateStudentNote,
} from '@my239/shared'
import { Card, Spinner } from '../../design/ui'
import { useAuth } from '../../auth/auth-context'
import { InternalNotesPanel } from './internal-notes-panel'
import { useCenterIdContext } from './center-id-context'
import { StudentNameColorSelector, StudentNameLabel } from './student-name-color'

// StudentProfilePage is the teacher-facing student page: identity + group and
// the internal teacher-only note log. Reached from the «Кондуит» (a student's
// name links here). Students who guess the URL are blocked by the backend.
export function StudentProfilePage() {
  const params = useParams<{ year: string; studentUserId: string }>()
  const { search } = useLocation()
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
  const color = useUpdateStudentNameColor(centerId, studentUserId)

  const profileSearch = new URLSearchParams(search)
  const origin = profileSearch.get('origin') === 'students' ? 'students' : 'conduit'
  profileSearch.delete('origin')
  const backSearch = profileSearch.toString()
  const backPath = origin === 'students'
    ? '/mathcenter/' + year + '/manage/students'
    : '/mathcenter/' + year + '/conduit'
  const backLabel = origin === 'students' ? 'Назад к ученикам' : 'Назад к кондуиту'

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <Link
        to={backPath + (backSearch ? '?' + backSearch : '')}
        className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-link underline-offset-4 hover:underline"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {backLabel}
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
            <h1 className="font-display text-xl font-medium text-text">
              <StudentNameLabel name={profile.data.display_name} backgroundHex={profile.data.background_hex} />
            </h1>
            <p className="mt-1 text-sm text-muted">
              Группа {profile.data.group_name} · выпуск {profile.data.graduation_year}
            </p>
            <div className="mt-4 border-t border-border pt-4">
              <StudentNameColorSelector
                value={profile.data.background_hex}
                onChange={(value) => color.mutate(value)}
                disabled={color.isPending}
                error={color.error?.message}
              />
            </div>
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
