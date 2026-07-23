import { useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { useCreateMathCenterTerm, useMathCenterMe } from '@my239/shared'
import { Button, Card, PillTabs, Spinner, type PillTabOption } from '../../../design/ui'
import { useAuth } from '../../../auth/auth-context'
import { useCenterIdContext, useCenterTermContext } from '../center-id-context'
import { GroupsTab } from './groups-tab'
import { TeachersTab } from './teachers-tab'
import { StudentsTab } from './students-tab'
import { GoogleSheetsTab } from './google-sheets-tab'

type Tab = 'groups' | 'teachers' | 'students' | 'google-sheets'

const TABS: PillTabOption<Tab>[] = [
  { id: 'groups', label: 'Группы' },
  { id: 'teachers', label: 'Преподаватели' },
  { id: 'students', label: 'Ученики' },
  { id: 'google-sheets', label: 'Google Sheets' },
]

const TAB_IDS = TABS.map((t) => t.id)

// ManagePage is the head-teacher self-service panel for one center. Access is
// limited to a head teacher of this center or a global admin; everyone else
// sees "Нет доступа". The three URL-driven tabs manage groups, teachers, and
// students.
export function ManagePage() {
  const centerId = useCenterIdContext()
  const { term } = useCenterTermContext()
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
      <TermRolloverCard centerId={centerId} />
      {term !== null && !term.is_active ? (
        <Card className="px-5 py-4 text-sm text-muted">
          Архивный период доступен только для чтения. Выберите текущий период, чтобы менять группы и состав учеников.
        </Card>
      ) : null}
      <PillTabs
        value={tab}
        onChange={(t) => navigate('/mathcenter/' + year + '/manage/' + t)}
        options={TABS}
        ariaLabel="Раздел управления"
        className="self-start"
      />

      {tab === 'groups' && (term === null || term.is_active) ? (
        <GroupsTab centerId={centerId} />
      ) : tab === 'teachers' ? (
        <TeachersTab centerId={centerId} />
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
  const [kind, setKind] = useState<'academic' | 'camp'>('academic')
  const [grade, setGrade] = useState(5)
  const isCamp = kind === 'camp'

  return (
    <Card className="flex flex-wrap items-end gap-3 p-4">
      <div className="mr-auto">
        <div className="font-medium text-ink">Новый период</div>
        <p className="text-sm text-muted">
          Завершает «{term?.display_name ?? 'текущий период'}», копируя только названия групп.
        </p>
      </div>
      <label className="flex flex-col gap-1 text-xs text-muted">
        Вид
        <select value={kind} onChange={(event) => setKind(event.target.value as 'academic' | 'camp')} className="rounded-lg border border-line bg-surface px-2 py-1 text-sm text-ink">
          <option value="academic">Учебный год</option>
          <option value="camp">Лагерь</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">
        Класс
        <select value={grade} onChange={(event) => setGrade(Number(event.target.value))} className="rounded-lg border border-line bg-surface px-2 py-1 text-sm text-ink">
          {Array.from({ length: isCamp ? 6 : 7 }, (_, index) => index + 5).map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
      </label>
      <Button
        type="button"
        size="sm"
        disabled={create.isPending}
        onClick={() => create.mutate({ kind, grade })}
      >
        Открыть период
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
