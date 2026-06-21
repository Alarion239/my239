import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useMathCenterMe } from '@my239/shared'
import { Card, Spinner } from '../../../design/ui'
import { cn } from '../../../design/cn'
import { useAuth } from '../../../auth/auth-context'
import { GroupsTab } from './groups-tab'
import { TeachersTab } from './teachers-tab'
import { StudentsTab } from './students-tab'

type Tab = 'groups' | 'teachers' | 'students'

const TABS: { id: Tab; label: string }[] = [
  { id: 'groups', label: 'Группы' },
  { id: 'teachers', label: 'Преподаватели' },
  { id: 'students', label: 'Ученики' },
]

// ManagePage is the head-teacher self-service panel for one center. Access is
// limited to a head teacher of this center or a global admin; everyone else
// sees "Нет доступа". The three tabs manage groups, teachers, and students.
export function ManagePage() {
  const { centerId: param } = useParams<{ centerId: string }>()
  const centerId = Number(param)
  const { user } = useAuth()
  const me = useMathCenterMe()
  const [tab, setTab] = useState<Tab>('groups')

  if (!Number.isFinite(centerId) || centerId <= 0) {
    return <NoAccess />
  }
  if (me.isPending) {
    return <CenteredSpinner />
  }

  const isAdmin = user?.is_admin ?? false
  const isHead = (me.data?.teacher?.centers ?? []).some(
    (c) => c.id === centerId && c.is_head_teacher,
  )
  if (!isAdmin && !isHead) {
    return <NoAccess />
  }

  return (
    <div className="animate-rise flex flex-col gap-5">
      <div className="flex flex-wrap gap-1 rounded-xl bg-surface-muted p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              'rounded-lg px-4 py-1.5 text-sm font-medium transition-colors',
              tab === t.id
                ? 'bg-surface text-ink shadow-sm'
                : 'text-muted hover:text-ink',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'groups' ? (
        <GroupsTab centerId={centerId} />
      ) : tab === 'teachers' ? (
        <TeachersTab centerId={centerId} />
      ) : (
        <StudentsTab centerId={centerId} />
      )}
    </div>
  )
}

function CenteredSpinner() {
  return (
    <div className="flex justify-center py-16">
      <Spinner />
    </div>
  )
}

function NoAccess() {
  return (
    <Card className="animate-rise px-6 py-16 text-center">
      <p className="text-muted">Нет доступа к управлению этим матцентром.</p>
    </Card>
  )
}
