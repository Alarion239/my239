import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useCreateMathCenterTerm, useMathCenterMe } from '@my239/shared'
import { Button, Card, PillTabs, Spinner, type PillTabOption } from '../../../design/ui'
import { useAuth } from '../../../auth/auth-context'
import { useCenterIdContext, useCenterTermContext } from '../center-id-context'
import { GroupsTab } from './groups-tab'
import { TeachersTab } from './teachers-tab'
import { RazborAccessTab, StudentsTab } from './students-tab'
import { GoogleSheetsTab } from './google-sheets-tab'
import { LatexPreambleTab } from './latex-preamble-tab'
import { nextMathCenterTerm, nextTermDisplayName, shouldShowTermRollover } from './term-rollover'

type Tab = 'groups' | 'teachers' | 'razbor-access' | 'students' | 'google-sheets' | 'latex'

const TABS: PillTabOption<Tab>[] = [
  { id: 'groups', label: 'Группы' },
  { id: 'teachers', label: 'Преподаватели' },
  { id: 'razbor-access', label: 'Доступ к разборам' },
  { id: 'students', label: 'Ученики' },
  { id: 'google-sheets', label: 'Google Sheets' },
  { id: 'latex', label: 'LaTeX' },
]

const TAB_IDS = TABS.map((t) => t.id)

// ManagePage is the head-teacher self-service panel for one center. Access is
// limited to a head teacher of this center or a global admin; everyone else
// sees "Нет доступа". The three URL-driven tabs manage groups, teachers, and
// students, and разбор access.
export function ManagePage() {
  const centerId = useCenterIdContext()
  const { term } = useCenterTermContext()
  const { year, tab: tabParam } = useParams<{ year: string; tab?: string }>()
  const { search } = useLocation()
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
    return <Navigate to={'/mathcenter/' + year + '/manage/groups' + search} replace />
  }

  return (
    <div className="animate-rise flex flex-col gap-5">
      <TermRolloverCard centerId={centerId} />
      {term !== null && !term.is_active ? (
        <Card className="px-5 py-4 text-sm text-muted">
          Архивный период доступен только для чтения. Выберите текущий период, чтобы менять группы и состав учеников.
        </Card>
      ) : null}
      <PillTabs
        value={tab}
        onChange={(t) => navigate('/mathcenter/' + year + '/manage/' + t + search)}
        options={TABS}
        ariaLabel="Раздел управления"
        className="self-start"
      />

      {tab === 'latex' ? (
        <LatexPreambleTab centerId={centerId} />
      ) : tab === 'groups' && (term === null || term.is_active) ? (
        <GroupsTab centerId={centerId} />
      ) : tab === 'teachers' ? (
        <TeachersTab centerId={centerId} />
      ) : tab === 'razbor-access' && (term === null || term.is_active) ? (
        <RazborAccessTab centerId={centerId} />
      ) : tab === 'google-sheets' ? (
        <GoogleSheetsTab centerId={centerId} activeTermId={term?.id ?? 0} />
      ) : term === null || term.is_active ? (
        <StudentsTab centerId={centerId} />
      ) : null}
    </div>
  )
}

function TermRolloverCard({ centerId }: { centerId: number }) {
  const { term } = useCenterTermContext()
  const create = useCreateMathCenterTerm(centerId)
  const nextTerm = nextMathCenterTerm(term)

  if (!term || !nextTerm || !shouldShowTermRollover(term)) return null

  const nextDisplayName = nextTermDisplayName(nextTerm)

  return (
    <Card className="flex flex-wrap items-end gap-3 p-4">
      <div className="mr-auto">
        <div className="font-medium text-ink">Открыть следующий период</div>
        <p className="text-sm text-muted">
          После «{term.display_name}» будет открыт «{nextDisplayName}» с теми же группами и учениками.
        </p>
      </div>
      <Button
        type="button"
        size="sm"
        disabled={create.isPending}
        onClick={() => create.mutate(nextTerm)}
      >
        Открыть «{nextDisplayName}»
      </Button>
    </Card>
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
