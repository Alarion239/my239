import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { useMathCenterMe } from '@my239/shared'
import { Card, PillTabs, Spinner, type PillTabOption } from '../../../design/ui'
import { useAuth } from '../../../auth/auth-context'
import { useCenterIdContext } from '../center-id-context'
import { GroupsTab } from './groups-tab'
import { TeachersTab } from './teachers-tab'
import { StudentsTab } from './students-tab'

type Tab = 'groups' | 'teachers' | 'students'

const TABS: PillTabOption<Tab>[] = [
  { id: 'groups', label: 'Группы' },
  { id: 'teachers', label: 'Преподаватели' },
  { id: 'students', label: 'Ученики' },
]

const TAB_IDS = TABS.map((t) => t.id)

// ManagePage is the head-teacher self-service panel for one center. Access is
// limited to a head teacher of this center or a global admin; everyone else
// sees "Нет доступа". The three URL-driven tabs manage groups, teachers, and
// students.
export function ManagePage() {
  const centerId = useCenterIdContext()
  const { year, tab: tabParam } = useParams<{ year: string; tab?: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const me = useMathCenterMe()

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

  const tab = (TAB_IDS as string[]).includes(tabParam ?? '')
    ? (tabParam as Tab)
    : null
  if (!tab) {
    return <Navigate to={'/mathcenter/' + year + '/manage/groups'} replace />
  }

  return (
    <div className="animate-rise flex flex-col gap-5">
      <PillTabs
        value={tab}
        onChange={(t) => navigate('/mathcenter/' + year + '/manage/' + t)}
        options={TABS}
        ariaLabel="Раздел управления"
        className="self-start"
      />

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
