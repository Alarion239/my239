import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation, useParams } from 'react-router-dom'
import {
  claimIsLive,
  coffinOpen,
  displayStatusMeta,
  exerciseComplete,
  initialsOf,
  solvedForCredit,
  useCenterGrid,
  useOfflineAccept,
  useOfflineUndo,
  useSyncGoogleSheets,
  type CenterGridCell,
  type CenterGridColumn,
  type CenterGridResponse,
  type CenterGridSeries,
  type CenterGridStudentEntry,
} from '@my239/shared'
import { Button, Card, Input, Spinner } from '../../design/ui'
import { cn } from '../../design/cn'
import { usePhoneViewport } from '../../use-phone-viewport'
import { ThreadCommentCell } from './cell-comment'
import { OfflineCellDialog, type OfflineCellTarget } from './offline-cell-dialog'
import {
  GraderInitialsInput,
  emptyGrader,
  type CreditedGrader,
} from './grader-initials-input'
import { statusPillClasses } from './status-style'
import { useSeriesContext } from './use-series-context'
import { useCenterIdContext, useCenterTermContext } from './center-id-context'
import { StudentNameLabel, studentNameColorStyle } from './student-name-color'
import {
  coffinCellClasses,
  coffinColumnClasses,
  cornerHeaderCell,
  exerciseCellClasses,
  exerciseColumnClasses,
  gridScrollerWithHeight,
  gridTable,
  nameCell,
  vert,
} from './grid-style'

const RECENT_GRADER_WINDOW_MS = 15_000

export function ConduitPage() {
  const centerId = useCenterIdContext()
  const { termId } = useCenterTermContext()
  const ctx = useSeriesContext(centerId)
  const isPhone = usePhoneViewport()

  if (!Number.isFinite(centerId) || centerId <= 0) {
    return <NoAccess />
  }
  if (isPhone) {
    return <NoAccess message="Кондуит доступен только на компьютере." />
  }
  if (ctx.isLoading) {
    return <CenteredSpinner />
  }
  // The «Кондуит» is a teacher tool; students don't see it.
  if (!ctx.hasAccess || ctx.isStudentView) {
    return <NoAccess />
  }

  // Fills the full-bleed content region; the grid below is the single scroll
  // surface (see AppShell's full-bleed branch).
  return (
    <div className="h-full">
      <Conduit centerId={centerId} termId={termId} />
    </div>
  )
}

function Conduit({ centerId, termId }: { centerId: number; termId: number }) {
  const { data, isPending, isError, refetch } = useCenterGrid(centerId, termId)
  if (isPending && !data) return <CenteredSpinner />
  if (!data) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-sm text-danger">
        <p>Не удалось загрузить кондуит.</p>
        <Button type="button" variant="secondary" onClick={() => void refetch()}>
          Повторить
        </Button>
      </div>
    )
  }
  const hasRows = data.groups.some((g) => g.students.length > 0)
  const hasCols = data.series.some((s) => s.columns.length > 0)
  if (!hasRows || !hasCols) {
    return (
      <Card className="px-6 py-16 text-center">
        <p className="text-muted">Пока нет данных: нужны ученики и серии задач.</p>
      </Card>
    )
  }
  return (
    <>
      {isError && (
        <div className="flex items-center justify-center gap-3 py-2 text-sm text-danger">
          <span>Не удалось обновить кондуит.</span>
          <Button type="button" variant="secondary" onClick={() => void refetch()}>
            Повторить
          </Button>
        </div>
      )}
      <ConduitTable centerId={centerId} termId={termId} data={data} />
    </>
  )
}

// flatCol is a column with the bookkeeping the table needs: which series it
// belongs to and whether it's the first of that series (for the thick divider).
interface FlatCol {
  col: CenterGridColumn
  seriesId: number
  firstInSeries: boolean
}

type SolvedSort = 'none' | 'desc' | 'asc'

const studentNameCollator = new Intl.Collator('ru', {
  sensitivity: 'base',
})

function compareStudentNames(
  left: CenterGridStudentEntry,
  right: CenterGridStudentEntry,
): number {
  return studentNameCollator.compare(left.name, right.name)
}

function compareStudentsBySolved(
  left: CenterGridStudentEntry,
  right: CenterGridStudentEntry,
  sort: Exclude<SolvedSort, 'none'>,
  solvedTotals: Map<number, number>,
): number {
  const difference =
    (solvedTotals.get(left.user_id) ?? 0) -
    (solvedTotals.get(right.user_id) ?? 0)
  if (difference !== 0) return sort === 'desc' ? -difference : difference
  return compareStudentNames(left, right)
}

// currentSeriesId picks the series to centre on: the soonest deadline at/after
// now, else the latest one.
function currentSeriesId(series: CenterGridSeries[]): number | null {
  const now = Date.now()
  let best: number | null = null
  let bestDue = Infinity
  let last: number | null = null
  let lastDue = -Infinity
  for (const s of series) {
    const due = Date.parse(s.due_at)
    if (Number.isNaN(due)) continue
    if (due >= now && due < bestDue) {
      bestDue = due
      best = s.series_id
    }
    if (due > lastDue) {
      lastDue = due
      last = s.series_id
    }
  }
  return best ?? last
}

const EMPTY_MARKED_SUBPROBLEMS = new Map<number, string>()
const CONDUIT_ROW_HEIGHT = 36
const CONDUIT_ROW_OVERSCAN = 8
const CONDUIT_INITIAL_ROWS = 30
const CONDUIT_COLUMN_WIDTH = 36
const CONDUIT_COLUMN_OVERSCAN = 8
const CONDUIT_INITIAL_COLUMNS = 60
const CONDUIT_STUDENT_COLUMN_WIDTH = 176
const CONDUIT_SOLVED_COLUMN_WIDTH = 72
const EMPTY_CREDIT_GATES = new Map<number, boolean>()

function acceptedCell(
  cells: Record<string, CenterGridCell>,
  studentID: number,
  subproblemID: number,
  marks: Map<number, string>,
): boolean {
  return (
    marks.has(subproblemID) ||
    cells[studentID + ':' + subproblemID]?.current_status === 'accepted'
  )
}

type ConduitCellAction = (
  student: CenterGridStudentEntry,
  column: FlatCol,
) => void

type ConduitVirtualRow = {
  key: string
  student: CenterGridStudentEntry
}

interface ConduitStudentRowProps {
  student: CenterGridStudentEntry
  studentColumnWidth: number
  cols: FlatCol[]
  leadingColumns: number
  trailingColumns: number
  cells: Record<string, CenterGridCell>
  graders: Record<string, string>
  search: string
  active: boolean
  markedSubs: Map<number, string>
  pendingSubproblemId: number | null
  currentGraderInitials: string
  creditGates: Map<number, boolean>
  solvedTotal: number
  onCellAction: ConduitCellAction
}

function persistedCellInitials(
  cell: CenterGridCell | undefined,
  graders: Record<string, string>,
): string {
  if (!cell || cell.current_status !== 'accepted') return ''
  const graderID = cell.last_grader_user_id
  if (graderID != null && graders[String(graderID)]) {
    return graders[String(graderID)]
  }
  if (cell.last_grader_name) return initialsOf(cell.last_grader_name)
  return '✓'
}

// One center can have 50k+ cells. Keeping each student's row memoized means a
// sort only moves existing <tr> nodes and a cell click only rebuilds the row
// whose active/pending state changed.
const ConduitStudentRow = memo(function ConduitStudentRow({
  student,
  studentColumnWidth,
  cols,
  leadingColumns,
  trailingColumns,
  cells,
  graders,
  search,
  active,
  markedSubs,
  pendingSubproblemId,
  currentGraderInitials,
  creditGates,
  solvedTotal,
  onCellAction,
}: ConduitStudentRowProps) {
  return (
    <tr
      className={cn(
        'h-9 hover:bg-surface-subtle/40',
        active && 'bg-private-soft',
      )}
    >
      <td
        className={nameCell}
        style={studentNameColorStyle(student.background_hex)}
        data-student-name-cell
      >
        {/* Names stay profile/comment links; grading starts from a task cell. */}
        <Link
          to={'../students/' + student.user_id + (search ? search + '&origin=conduit' : '?origin=conduit')}
          className={cn(
            'inline-flex items-center gap-1.5 underline-offset-2 hover:underline',
            active && 'font-semibold text-text',
          )}
        >
          <StudentNameLabel name={student.name} backgroundHex={student.background_hex} className="px-0 py-0" />
          {student.has_student_comment ? (
            <span
              title="Есть заметки об ученике"
              aria-label="Есть заметки об ученике"
              className="inline-block h-2 w-2 shrink-0 rounded-full bg-signature"
            />
          ) : null}
        </Link>
      </td>
      <td
        className="sticky z-20 border-b border-l border-r border-border bg-surface px-3 py-1.5 text-center font-medium text-text"
        style={{ left: studentColumnWidth }}
        data-conduit-solved
      >
        {solvedTotal}
      </td>
      {leadingColumns > 0 ? (
        <td
          aria-hidden="true"
          colSpan={leadingColumns}
          className="h-9 border-b border-border p-0"
          data-conduit-column-spacer="left"
        />
      ) : null}
      {cols.map((fc) => {
        const { col, firstInSeries } = fc
        const key = student.user_id + ':' + col.subproblem_id
        const cell = cells[key]
        const marked = active && markedSubs.has(col.subproblem_id)
        const accepted = cell?.current_status === 'accepted' || marked
        const pendingStatus =
          !marked &&
          cell &&
          (cell.current_status === 'submitted' ||
            cell.current_status === 'appealed')
            ? displayStatusMeta(cell.current_status, claimIsLive(cell))
            : null
        const coffinIsOpen =
          col.is_coffin && coffinOpen(col.coffin_released_at)
        const threadId = cell?.thread_id ?? 0
        const hasComment = !!cell?.has_internal_comment && threadId > 0
        const pending = pendingSubproblemId === col.subproblem_id
        const exercise = col.problem_number === 0
        const inactive = !exercise && !(creditGates.get(fc.seriesId) ?? true)
        const shownInitials = marked
          ? currentGraderInitials
          : persistedCellInitials(cell, graders)
        const cellAria = marked
          ? 'Снять отметку'
          : accepted
            ? 'Открыть проверку'
            : pendingStatus
              ? pendingStatus.label + '. Отметить решённым'
              : 'Отметить решённым'
        const activate = () => onCellAction(student, fc)
        const onKeyDown = (event: ReactKeyboardEvent<HTMLTableCellElement>) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          activate()
        }
        return (
          <ThreadCommentCell
            key={col.subproblem_id}
            threadId={threadId}
            hasComment={hasComment}
            data-conduit-cell
            tabIndex={pending ? -1 : 0}
            aria-label={cellAria}
            title={pendingStatus?.label}
            aria-disabled={pending || undefined}
            onClick={pending ? undefined : activate}
            onKeyDown={pending ? undefined : onKeyDown}
            className={cn(
              'h-9 min-w-9 cursor-pointer select-none border-b border-border px-1.5 text-center align-middle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus',
              vert(firstInSeries),
              exercise
                ? exerciseCellClasses(true)
                : accepted && !inactive
                  ? 'bg-status-accepted-soft font-medium text-status-accepted'
                  : accepted
                    ? 'bg-surface-subtle font-medium text-muted opacity-70'
                    : pendingStatus
                      ? cn(
                          'font-medium',
                          statusPillClasses(pendingStatus.tone),
                          inactive && 'opacity-60 grayscale',
                        )
                      : cn(
                          coffinCellClasses(col.is_coffin, coffinIsOpen),
                          inactive
                            ? 'bg-surface-subtle/70 text-text-subtle hover:bg-surface-subtle'
                            : active
                              ? 'text-status-accepted hover:bg-status-accepted-soft'
                              : 'text-text-subtle hover:bg-surface-subtle',
                        ),
            )}
          >
            {pending
              ? '…'
              : accepted
                ? shownInitials
                : pendingStatus
                  ? pendingStatus.glyph
                  : active
                    ? '＋'
                    : ''}
          </ThreadCommentCell>
        )
      })}
      {trailingColumns > 0 ? (
        <td
          aria-hidden="true"
          colSpan={trailingColumns}
          className="h-9 border-b border-border p-0"
          data-conduit-column-spacer="right"
        />
      ) : null}
    </tr>
  )
}, sameConduitStudentRowProps)

function sameConduitStudentRowProps(
  previous: ConduitStudentRowProps,
  next: ConduitStudentRowProps,
): boolean {
  if (
    previous.student !== next.student ||
    previous.studentColumnWidth !== next.studentColumnWidth ||
    previous.cols !== next.cols ||
    previous.leadingColumns !== next.leadingColumns ||
    previous.trailingColumns !== next.trailingColumns ||
    previous.graders !== next.graders ||
    previous.search !== next.search ||
    previous.active !== next.active ||
    previous.markedSubs !== next.markedSubs ||
    previous.pendingSubproblemId !== next.pendingSubproblemId ||
    previous.currentGraderInitials !== next.currentGraderInitials ||
    previous.creditGates !== next.creditGates ||
    previous.solvedTotal !== next.solvedTotal ||
    previous.onCellAction !== next.onCellAction
  ) {
    return false
  }
  if (previous.cells === next.cells) return true
  for (const { col } of next.cols) {
    const key = next.student.user_id + ':' + col.subproblem_id
    if (previous.cells[key] !== next.cells[key]) return false
  }
  return true
}

export function ConduitTable({
  centerId,
  termId,
  data,
}: {
  centerId: number
  termId: number
  data: CenterGridResponse
}) {
  const { year } = useParams<{ year: string }>()
  const { search } = useLocation()
  const [query, setQuery] = useState('')
  const [solvedSort, setSolvedSort] = useState<SolvedSort>('none')
  const [centerWideRanking, setCenterWideRanking] = useState(false)
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(
    () =>
      data.groups.find((group) => group.students.length > 0)?.group_id ?? null,
  )

  // Offline-grading interaction state. A grader picks an active student (their
  // row lights up) and enters their initials once; tapping un-accepted cells in
  // that row marks them solved. Any cell can open the detail dialog (undo /
  // comment / thread link).
  const [activeStudentId, setActiveStudentId] = useState<number | null>(null)
  const [grader, setGrader] = useState<CreditedGrader>(emptyGrader)
  const [dialog, setDialog] = useState<OfflineCellTarget | null>(null)
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [toolbarSlot, setToolbarSlot] = useState<HTMLElement | null>(null)
  const [graderFocusToken, setGraderFocusToken] = useState(0)
  const graderInputRef = useRef<HTMLInputElement>(null)
  const lastGraderRef = useRef<{
    grader: CreditedGrader
    enteredAt: number
  } | null>(null)
  // Subproblems marked during the current active-student session → the grader
  // key they were credited with at mark time. Lets cells show the *current*
  // initials live (override below) and re-credit only the cells that drift when
  // the grader corrects their initials before «Готово».
  const [markedSubs, setMarkedSubs] = useState<Map<number, string>>(new Map())
  const accept = useOfflineAccept()
  const undo = useOfflineUndo()
  const syncGoogleSheets = useSyncGoogleSheets(centerId)

  useEffect(() => {
    setToolbarSlot(document.getElementById('conduit-toolbar-slot'))
  }, [])

  const recentGrader = (): CreditedGrader => {
    const saved = lastGraderRef.current
    if (!saved) return emptyGrader
    if (Date.now() - saved.enteredAt > RECENT_GRADER_WINDOW_MS) {
      lastGraderRef.current = null
      return emptyGrader
    }
    return { ...saved.grader }
  }

  function handleGraderChange(next: CreditedGrader) {
    setGrader(next)
    if (next.name.trim()) {
      lastGraderRef.current = {
        grader: { ...next },
        enteredAt: Date.now(),
      }
    }
  }

  function focusGraderInput() {
    setGraderFocusToken((token) => token + 1)
    graderInputRef.current?.focus()
  }

  // graderKey identifies a credited grader so we can tell whether a marked cell
  // still matches the current initials; graderFields builds the accept payload.
  const graderKey = (g: CreditedGrader): string =>
    g.userId != null ? 'u' + g.userId : 'n' + g.name.trim().toLowerCase()
  const graderFields = (g: CreditedGrader) =>
    g.userId != null ? { grader_user_id: g.userId } : { grader_name: g.name.trim() }

  // commitMarks re-credits any cell marked under an earlier initials value once
  // the grader settles on a final one — only the drifted cells, so the common
  // "type once, mark many" path issues no extra writes.
  function commitMarks(studentId: number | null) {
    if (studentId == null || !grader.name.trim()) return
    const finalKey = graderKey(grader)
    markedSubs.forEach((markKey, sub) => {
      if (markKey !== finalKey) {
        accept.mutate({ student_user_id: studentId, subproblem_id: sub, ...graderFields(grader) })
      }
    })
  }

  // selectStudent switches the active row, committing the previous student's
  // marks first; passing null is «Готово».
  function selectStudent(id: number | null) {
    if (activeStudentId != null && id !== activeStudentId) commitMarks(activeStudentId)
    setActiveStudentId(id)
    setMarkedSubs(new Map())
    setGrader(id == null ? emptyGrader : recentGrader())
  }

  // unmarkCell reverses a mark made this session (e.g. the grader hit the wrong
  // square) — undoes the offline accept and drops it from the session set.
  function unmarkCell(studentId: number, col: CenterGridColumn) {
    const sub = col.subproblem_id
    setPendingKey(studentId + ':' + sub)
    undo.mutate(
      { student_user_id: studentId, subproblem_id: sub },
      {
        onSettled: () => setPendingKey(null),
        onSuccess: () =>
          setMarkedSubs((prev) => {
            const next = new Map(prev)
            next.delete(sub)
            return next
          }),
      },
    )
  }

  // Enter commits «Готово» from anywhere in the active session (the initials
  // field, a just-marked cell, …), not just while the initials input is focused.
  // Refs keep the listener stable while always seeing the latest handlers.
  const selectStudentRef = useRef(selectStudent)
  selectStudentRef.current = selectStudent
  const dialogOpenRef = useRef(dialog)
  dialogOpenRef.current = dialog
  useEffect(() => {
    if (activeStudentId == null) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'Enter' || e.key === 'Escape') && !dialogOpenRef.current) {
        e.preventDefault()
        selectStudentRef.current(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeStudentId])

  const cols: FlatCol[] = useMemo(() => {
    const out: FlatCol[] = []
    for (const s of data.series) {
      s.columns.forEach((col, i) =>
        out.push({ col, seriesId: s.series_id, firstInSeries: i === 0 }),
      )
    }
    return out
  }, [data.series])

  // All students — totals are always computed over the full cohort; the search
  // only hides rows, it never changes the Решили/Решено/итого numbers.
  const students = useMemo(
    () => data.groups.flatMap((g) => g.students),
    [data.groups],
  )
  const availableGroups = useMemo(
    () => data.groups.filter((group) => group.students.length > 0),
    [data.groups],
  )

  useEffect(() => {
    if (
      selectedGroupId != null &&
      availableGroups.some((group) => group.group_id === selectedGroupId)
    ) {
      return
    }
    setSelectedGroupId(availableGroups[0]?.group_id ?? null)
  }, [availableGroups, selectedGroupId])

  const creditGatesByStudent = useMemo(() => {
    const gates = new Map<number, Map<number, boolean>>()
    for (const student of students) {
      const marks = student.user_id === activeStudentId ? markedSubs : EMPTY_MARKED_SUBPROBLEMS
      const perSeries = new Map<number, boolean>()
      for (const series of data.series) {
        const exerciseItems = series.columns
          .filter((col) => col.problem_number === 0)
          .map((col) => ({
            problem_number: 0,
            current_status: acceptedCell(data.cells, student.user_id, col.subproblem_id, marks)
              ? ('accepted' as const)
              : ('ungraded' as const),
          }))
        perSeries.set(series.series_id, exerciseComplete(exerciseItems))
      }
      gates.set(student.user_id, perSeries)
    }
    return gates
  }, [students, data.series, data.cells, activeStudentId, markedSubs])

  const solvedSummary = useMemo(() => {
    const rowTotals = new Map<number, number>()
    const columnTotals = new Map<number, number>()
    let grandTotal = 0
    for (const student of students) {
      let rowTotal = 0
      const marks = student.user_id === activeStudentId ? markedSubs : EMPTY_MARKED_SUBPROBLEMS
      const gates = creditGatesByStudent.get(student.user_id) ?? EMPTY_CREDIT_GATES
      for (const { col, seriesId } of cols) {
        const accepted = acceptedCell(data.cells, student.user_id, col.subproblem_id, marks)
        const counted =
          col.problem_number === 0
            ? accepted
            : solvedForCredit(
                col.problem_number,
                accepted ? 'accepted' : 'ungraded',
                gates.get(seriesId) ?? true,
              )
        if (!counted) continue
        if (col.problem_number !== 0) {
          rowTotal++
          grandTotal++
        }
        columnTotals.set(col.subproblem_id, (columnTotals.get(col.subproblem_id) ?? 0) + 1)
      }
      rowTotals.set(student.user_id, rowTotal)
    }
    return { rowTotals, columnTotals, grandTotal }
  }, [students, cols, data.cells, activeStudentId, markedSubs, creditGatesByStudent])
  const solvedTotals = solvedSummary.rowTotals

  // Search only controls which students are rendered. Sorting is layered on
  // afterwards so the third «Решено» click can restore a true alphabetical
  // view instead of relying on whichever order happened to arrive from the API.
  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase()
    return data.groups
      .map((group) => ({
        ...group,
        students: q
          ? group.students.filter((student) =>
              student.name.toLowerCase().includes(q),
            )
          : group.students,
      }))
      .filter((g) => g.students.length > 0)
  }, [data.groups, query])

  const globalRanking = solvedSort !== 'none' && centerWideRanking

  const displayedStudents = useMemo(() => {
    const visible = globalRanking
      ? filteredGroups.flatMap((group) => group.students)
      : (filteredGroups.find((group) => group.group_id === selectedGroupId)
          ?.students ?? [])
    return [...visible].sort((left, right) =>
      solvedSort === 'none'
        ? compareStudentNames(left, right)
        : compareStudentsBySolved(left, right, solvedSort, solvedTotals),
    )
  }, [filteredGroups, globalRanking, selectedGroupId, solvedSort, solvedTotals])

  const selectedGroupSize =
    availableGroups.find((group) => group.group_id === selectedGroupId)?.students
      .length ?? 0
  const shown = displayedStudents.length
  const shownFrom = globalRanking ? students.length : selectedGroupSize

  const virtualRows = useMemo<ConduitVirtualRow[]>(() => {
    return displayedStudents.map((student) => ({
      key: 'student:' + student.user_id,
      student,
    }))
  }, [displayedStudents])
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [rowWindow, setRowWindow] = useState({
    start: 0,
    end: CONDUIT_INITIAL_ROWS,
  })
  const [columnWindow, setColumnWindow] = useState({
    start: 0,
    end: CONDUIT_INITIAL_COLUMNS,
  })
  const [studentColumnWidth, setStudentColumnWidth] = useState(
    CONDUIT_STUDENT_COLUMN_WIDTH,
  )
  const [solvedColumnWidth, setSolvedColumnWidth] = useState(
    CONDUIT_SOLVED_COLUMN_WIDTH,
  )

  // A synced center can exceed 50k task cells. Keep only the rows around the
  // viewport mounted; fixed-height spacer rows preserve the full scrollbar and
  // sticky header/total geometry. Sorting now replaces a few visible rows
  // instead of asking the browser to move every 400-cell row in the table.
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return

    let animationFrame = 0
    const measure = () => {
      animationFrame = 0
      const firstVisible = Math.floor(
        scroller.scrollTop / CONDUIT_ROW_HEIGHT,
      )
      const visibleCount = Math.ceil(
        scroller.clientHeight / CONDUIT_ROW_HEIGHT,
      )
      const start = Math.max(0, firstVisible - CONDUIT_ROW_OVERSCAN)
      const end = Math.min(
        virtualRows.length,
        firstVisible + visibleCount + CONDUIT_ROW_OVERSCAN,
      )
      setRowWindow((current) =>
        current.start === start && current.end === end
          ? current
          : { start, end },
      )

      const firstVisibleColumn = Math.floor(
        Math.max(
          0,
          scroller.scrollLeft - studentColumnWidth - solvedColumnWidth,
        ) / CONDUIT_COLUMN_WIDTH,
      )
      const visibleColumnCount = Math.ceil(
        scroller.clientWidth / CONDUIT_COLUMN_WIDTH,
      )
      const columnStart = Math.max(
        0,
        firstVisibleColumn - CONDUIT_COLUMN_OVERSCAN,
      )
      const columnEnd = Math.min(
        cols.length,
        firstVisibleColumn +
          visibleColumnCount +
          CONDUIT_COLUMN_OVERSCAN,
      )
      setColumnWindow((current) =>
        current.start === columnStart && current.end === columnEnd
          ? current
          : { start: columnStart, end: columnEnd },
      )
    }
    const scheduleMeasure = () => {
      if (animationFrame === 0) {
        animationFrame = window.requestAnimationFrame(measure)
      }
    }

    measure()
    scroller.addEventListener('scroll', scheduleMeasure, { passive: true })
    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(scheduleMeasure)
    resizeObserver?.observe(scroller)
    return () => {
      scroller.removeEventListener('scroll', scheduleMeasure)
      resizeObserver?.disconnect()
      if (animationFrame !== 0) window.cancelAnimationFrame(animationFrame)
    }
  }, [studentColumnWidth, solvedColumnWidth, virtualRows.length, cols.length])

  const visibleRows = virtualRows.slice(rowWindow.start, rowWindow.end)
  const visibleCols = useMemo(
    () => cols.slice(columnWindow.start, columnWindow.end),
    [cols, columnWindow.start, columnWindow.end],
  )
  const trailingColumns = Math.max(0, cols.length - columnWindow.end)
  const topSpacerHeight = rowWindow.start * CONDUIT_ROW_HEIGHT
  const bottomSpacerHeight =
    Math.max(0, virtualRows.length - rowWindow.end) * CONDUIT_ROW_HEIGHT

  // markCell fast-paths an offline accept using the initials bar's grader and
  // remembers which grader credited it (for later re-crediting on a correction).
  function markCell(
    studentId: number,
    col: CenterGridColumn,
    creditedGrader: CreditedGrader = grader,
  ) {
    const key = studentId + ':' + col.subproblem_id
    const gk = graderKey(creditedGrader)
    setPendingKey(key)
    accept.mutate(
      {
        student_user_id: studentId,
        subproblem_id: col.subproblem_id,
        ...graderFields(creditedGrader),
      },
      {
        onSettled: () => setPendingKey(null),
        onSuccess: () =>
          setMarkedSubs((prev) => new Map(prev).set(col.subproblem_id, gk)),
      },
    )
  }

  function openCellDialog(
    studentId: number,
    studentName: string,
    backgroundHex: string | null | undefined,
    fc: FlatCol,
  ) {
    const sub = fc.col.subproblem_id
    const cell = data.cells[studentId + ':' + sub]
    setDialog({
      studentUserId: studentId,
      studentName,
      backgroundHex,
      subproblemId: sub,
      columnLabel: fc.col.column_label,
      threadId: cell?.thread_id ?? 0,
      status: cell?.current_status ?? 'ungraded',
      lastGraderName: cell?.last_grader_name,
      acceptedInitials:
        persistedCellInitials(cell, data.graders) || undefined,
      threadHref:
        cell && cell.thread_id > 0
          ? '/mathcenter/' + (year ?? '') + '/series/' + fc.seriesId + '/thread/' + cell.thread_id + search
          : undefined,
    })
  }

  // Student rows retain this stable callback across sorting/dialog/toolbar
  // state changes. The ref delegates to the newest interaction state so a
  // memoized row never acts with stale initials or active-student data.
  const cellActionRef = useRef<ConduitCellAction>(() => {})
  cellActionRef.current = (student, fc) => {
    const sid = student.user_id
    const { col } = fc
    const marked =
      activeStudentId === sid && markedSubs.has(col.subproblem_id)
    const isAccepted =
      data.cells[sid + ':' + col.subproblem_id]?.current_status === 'accepted'

    if (activeStudentId !== sid) {
      if (isAccepted) {
        openCellDialog(sid, student.name, student.background_hex, fc)
        return
      }
      const remembered = recentGrader()
      selectStudent(sid)
      focusGraderInput()
      if (remembered.name.trim()) markCell(sid, col, remembered)
      return
    }
    if (marked) {
      unmarkCell(sid, col)
      focusGraderInput()
    } else if (isAccepted) {
      openCellDialog(sid, student.name, student.background_hex, fc)
    } else if (grader.name.trim()) {
      markCell(sid, col)
      focusGraderInput()
    } else {
      focusGraderInput()
    }
  }
  const onCellAction = useCallback<ConduitCellAction>(
    (student, column) => cellActionRef.current(student, column),
    [],
  )

  // Centre the current series on open.
  const nameHeaderRef = useRef<HTMLTableCellElement | null>(null)
  const solvedHeaderRef = useRef<HTMLTableCellElement | null>(null)
  const currentThRef = useRef<HTMLTableCellElement | null>(null)
  useEffect(() => {
    const nameHeader = nameHeaderRef.current
    const solvedHeader = solvedHeaderRef.current
    if (!nameHeader || !solvedHeader) return
    const measure = () => {
      const nameWidth = nameHeader.getBoundingClientRect().width
      const solvedWidth = solvedHeader.getBoundingClientRect().width
      if (nameWidth > 0) setStudentColumnWidth(nameWidth)
      if (solvedWidth > 0) setSolvedColumnWidth(solvedWidth)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(nameHeader)
    observer.observe(solvedHeader)
    return () => observer.disconnect()
  }, [])
  const currentId = useMemo(() => currentSeriesId(data.series), [data.series])
  useEffect(() => {
    const scroller = scrollerRef.current
    const el = currentThRef.current
    if (!scroller || !el) return
    const elRect = el.getBoundingClientRect()
    const scRect = scroller.getBoundingClientRect()
    // Bring the series just to the right of the frozen student + solved rail.
    scroller.scrollLeft +=
      elRect.left - scRect.left - studentColumnWidth - solvedColumnWidth
  }, [currentId, studentColumnWidth, solvedColumnWidth])

  const toolbar = (
    <div className="flex min-w-0 items-center justify-end gap-2">
      <button
        type="button"
        title="Импортировать отмеченные решения из связанных Google Sheets"
        disabled={termId <= 0 || syncGoogleSheets.isPending}
        onClick={() => syncGoogleSheets.mutate(termId)}
        className="h-8 shrink-0 rounded-lg border border-border px-2.5 text-xs text-muted hover:bg-surface-subtle hover:text-text disabled:opacity-50"
      >
        {syncGoogleSheets.isPending ? 'Импорт…' : 'Sheets'}
      </button>
      <div className="min-w-0 w-56 sm:w-64">
        <GraderInitialsInput
          centerId={centerId}
          value={grader}
          onChange={handleGraderChange}
          inputRef={graderInputRef}
          focusToken={graderFocusToken}
          onEscape={() => selectStudent(null)}
          showCreditHint={false}
        />
      </div>
    </div>
  )

  function showGroup(groupId: number) {
    if (activeStudentId != null) selectStudent(null)
    setSelectedGroupId(groupId)
    setCenterWideRanking(false)
    if (scrollerRef.current) scrollerRef.current.scrollTop = 0
  }

  function showCenterWideRanking() {
    setCenterWideRanking(true)
    if (scrollerRef.current) scrollerRef.current.scrollTop = 0
  }

  function cycleSolvedSort() {
    if (solvedSort === 'none') {
      setSolvedSort('desc')
      return
    }
    if (solvedSort === 'desc') {
      setSolvedSort('asc')
      return
    }
    setSolvedSort('none')
    setCenterWideRanking(false)
  }

  return (
    <div className="flex h-full flex-col">
      {toolbarSlot ? createPortal(toolbar, toolbarSlot) : null}

      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-surface px-3 py-2">
        <span className="shrink-0 text-xs font-medium text-text-subtle">Группа</span>
        <div
          role="group"
          aria-label="Выбор группы"
          className="flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {availableGroups.map((group) => {
            const selected = !globalRanking && group.group_id === selectedGroupId
            return (
              <button
                key={group.group_id}
                type="button"
                aria-label={'Группа ' + group.name}
                aria-pressed={selected}
                onClick={() => showGroup(group.group_id)}
                className={cn(
                  'inline-flex h-8 shrink-0 items-center gap-2 rounded-md border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
                  selected
                    ? 'border-selected-border bg-action text-on-action shadow-sm'
                    : 'border-transparent text-muted hover:border-border hover:bg-surface-subtle hover:text-text',
                )}
              >
                <span>{group.name}</span>
                <span
                  className={cn(
                    'text-[0.65rem] font-normal tabular-nums',
                    selected ? 'text-on-action/75' : 'text-text-subtle',
                  )}
                >
                  {group.students.length}
                </span>
              </button>
            )
          })}
          {solvedSort !== 'none' ? (
            <>
              <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-border" />
              <button
                type="button"
                aria-pressed={globalRanking}
                onClick={showCenterWideRanking}
                className={cn(
                  'h-8 shrink-0 rounded-md border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
                  globalRanking
                    ? 'border-selected-border bg-action text-on-action shadow-sm'
                    : 'border-border text-muted hover:bg-surface-subtle hover:text-text',
                )}
              >
                Общий рейтинг
              </button>
            </>
          ) : null}
        </div>
      </div>

      <div ref={scrollerRef} className={gridScrollerWithHeight('min-h-0 flex-1')}>
        <table className={gridTable}>
          <thead>
            {/* Series band — one header spanning each series' columns. */}
            <tr>
              {/* Corner cell — holds the student search filter. */}
              <th
                ref={nameHeaderRef}
                rowSpan={2}
                className={cornerHeaderCell}
                data-conduit-student-header
              >
                <div className="flex flex-col gap-1">
                  <Input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Ученик…"
                    className="h-8 w-full min-w-40"
                    aria-label="Поиск ученика"
                  />
                  <span className="text-[0.65rem] font-normal text-text-subtle">
                    {shown} из {shownFrom}
                  </span>
                </div>
              </th>
              <th
                ref={solvedHeaderRef}
                rowSpan={2}
                className="sticky top-0 z-40 border-b border-l border-r border-t border-border bg-surface-subtle px-2 py-1 text-center font-medium text-text"
                style={{ left: studentColumnWidth }}
                data-conduit-solved-header
              >
                <div className="flex min-h-14 flex-col items-center justify-center">
                  <button
                    type="button"
                    onClick={cycleSolvedSort}
                    className="whitespace-nowrap rounded-sm underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                    title={
                      solvedSort === 'none'
                        ? 'Сортировать по убыванию числа решённых задач'
                        : solvedSort === 'desc'
                          ? 'Сортировать по возрастанию числа решённых задач'
                          : 'Вернуть алфавитный порядок'
                    }
                    aria-label="Сортировать учеников по числу решённых задач"
                  >
                    Решено
                    {solvedSort === 'desc'
                      ? ' ↓'
                      : solvedSort === 'asc'
                        ? ' ↑'
                        : ''}
                  </button>
                </div>
              </th>
              {data.series.map((s) => (
                <th
                  key={s.series_id}
                  ref={s.series_id === currentId ? currentThRef : undefined}
                  colSpan={s.columns.length}
                  className={cn(
                    'sticky top-0 z-20 h-9 whitespace-nowrap border-b border-t border-border bg-surface-subtle px-3 text-center font-medium text-text',
                    vert(true),
                  )}
                  title={s.display_name + ' — открыть условие'}
                >
                  <Link
                    to={
                      '/mathcenter/' +
                      (year ?? '') +
                      '/series/' +
                      s.series_id +
                      '/statement' +
                      search
                    }
                    aria-label={'Серия ' + s.number + ' — открыть условие'}
                    className="rounded-sm underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                  >
                    Серия {s.number}
                  </Link>
                </th>
              ))}
            </tr>
            {/* Per-subproblem column labels. Open coffins use the warning scale
                so the problem itself is visible before reading cell status. */}
            <tr>
              {cols.map(({ col, seriesId, firstInSeries }) => {
                const open = col.is_coffin && coffinOpen(col.coffin_released_at)
                return (
                  <th
                    key={col.subproblem_id}
                    title={
                      col.is_coffin
                        ? open
                          ? 'Гроб — открыт'
                          : 'Гроб — разобран'
                        : undefined
                    }
                    className={cn(
                      'sticky top-9 z-20 min-w-9 border-b border-border px-1.5 py-1 text-center text-xs font-medium',
                      vert(firstInSeries),
                      col.problem_number === 0
                        ? exerciseColumnClasses(true)
                        : coffinColumnClasses(col.is_coffin, open),
                    )}
                  >
                    <Link
                      to={
                        '/mathcenter/' +
                        (year ?? '') +
                        '/series/' +
                        seriesId +
                        '/razbor' +
                        search
                      }
                      aria-label={
                        (col.problem_number === 0 ? 'Упражнение ' : 'Задача ') +
                        col.column_label +
                        ' — открыть разбор'
                      }
                      className="inline-flex min-h-6 min-w-6 items-center justify-center rounded-sm underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                    >
                      {col.column_label}
                    </Link>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {topSpacerHeight > 0 ? (
              <tr aria-hidden="true" data-conduit-virtual-spacer="top">
                <td
                  colSpan={cols.length + 2}
                  className="border-0 p-0"
                  style={{ height: topSpacerHeight }}
                />
              </tr>
            ) : null}
            {visibleRows.map((row) => {
              const st = row.student
              const isActiveRow = activeStudentId === st.user_id
              const pendingPrefix = st.user_id + ':'
              const pendingSubproblemId =
                pendingKey?.startsWith(pendingPrefix)
                  ? Number(pendingKey.slice(pendingPrefix.length))
                  : null
              return (
                <ConduitStudentRow
                  key={row.key}
                  student={st}
                  studentColumnWidth={studentColumnWidth}
                  cols={visibleCols}
                  leadingColumns={columnWindow.start}
                  trailingColumns={trailingColumns}
                  cells={data.cells}
                  graders={data.graders}
                  search={search}
                  active={isActiveRow}
                  markedSubs={
                    isActiveRow
                      ? markedSubs
                      : EMPTY_MARKED_SUBPROBLEMS
                  }
                  pendingSubproblemId={pendingSubproblemId}
                  currentGraderInitials={
                    isActiveRow ? initialsOf(grader.name) : ''
                  }
                  creditGates={
                    creditGatesByStudent.get(st.user_id) ?? EMPTY_CREDIT_GATES
                  }
                  solvedTotal={solvedTotals.get(st.user_id) ?? 0}
                  onCellAction={onCellAction}
                />
              )
            })}
            {bottomSpacerHeight > 0 ? (
              <tr aria-hidden="true" data-conduit-virtual-spacer="bottom">
                <td
                  colSpan={cols.length + 2}
                  className="border-0 p-0"
                  style={{ height: bottomSpacerHeight }}
                />
              </tr>
            ) : null}
            {/* Column totals: people who solved each problem — pinned to the
                bottom so it's always on screen. Always over ALL students. */}
            <tr>
              <td className="sticky bottom-0 left-0 z-30 border-b border-l border-r border-t border-border bg-surface-subtle px-3 py-1.5 font-medium text-text">
                Решили
              </td>
              <td
                className="sticky bottom-0 z-30 border-b border-l border-r border-t border-border bg-surface-subtle px-3 py-1.5 text-center font-medium text-text"
                style={{ left: studentColumnWidth }}
                data-conduit-solved-total
              >
                {solvedSummary.grandTotal}
              </td>
              {cols.map(({ col, firstInSeries }) => (
                <td
                  key={col.subproblem_id}
                  className={cn(
                    'sticky bottom-0 z-20 border-b border-t border-border bg-surface-subtle px-1.5 py-1.5 text-center font-medium text-text',
                    vert(firstInSeries),
                  )}
                >
                  {solvedSummary.columnTotals.get(col.subproblem_id) ?? 0}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {dialog ? (
        <OfflineCellDialog
          open={dialog != null}
          onOpenChange={(o) => !o && setDialog(null)}
          centerId={centerId}
          mode="conduit"
          target={dialog}
        />
      ) : null}
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

function NoAccess({ message = 'Нет доступа к кондуиту этого матцентра.' }: { message?: string }) {
  return (
    <Card className="px-6 py-16 text-center">
      <p className="text-muted">{message}</p>
    </Card>
  )
}
