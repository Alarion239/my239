import {
  Fragment,
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
  coffinOpen,
  initialsOf,
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
import { Card, Input, Spinner } from '../../design/ui'
import { cn } from '../../design/cn'
import { usePhoneViewport } from '../../use-phone-viewport'
import { ThreadCommentCell } from './cell-comment'
import { OfflineCellDialog, type OfflineCellTarget } from './offline-cell-dialog'
import {
  GraderInitialsInput,
  emptyGrader,
  type CreditedGrader,
} from './grader-initials-input'
import { useSeriesContext } from './use-series-context'
import { useCenterIdContext, useCenterTermContext } from './center-id-context'
import {
  coffinCellClasses,
  coffinColumnClasses,
  cornerHeaderCell,
  gridScrollerWithHeight,
  gridTable,
  groupLabel,
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
  const { data, isPending, isError } = useCenterGrid(centerId, termId)
  if (isPending) return <CenteredSpinner />
  if (isError || !data) {
    return <p className="py-10 text-sm text-danger">Не удалось загрузить кондуит.</p>
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
  return <ConduitTable centerId={centerId} termId={termId} data={data} />
}

// flatCol is a column with the bookkeeping the table needs: which series it
// belongs to and whether it's the first of that series (for the thick divider).
interface FlatCol {
  col: CenterGridColumn
  seriesId: number
  firstInSeries: boolean
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

type ConduitCellAction = (
  student: CenterGridStudentEntry,
  column: FlatCol,
) => void

interface ConduitStudentRowProps {
  student: CenterGridStudentEntry
  cols: FlatCol[]
  cells: Record<string, CenterGridCell>
  graders: Record<string, string>
  search: string
  active: boolean
  markedSubs: Map<number, string>
  pendingSubproblemId: number | null
  currentGraderInitials: string
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
  cols,
  cells,
  graders,
  search,
  active,
  markedSubs,
  pendingSubproblemId,
  currentGraderInitials,
  solvedTotal,
  onCellAction,
}: ConduitStudentRowProps) {
  return (
    <tr
      className={cn(
        'hover:bg-surface-muted/40',
        active && 'bg-amber-50/60 dark:bg-amber-500/10',
      )}
    >
      <td className={nameCell}>
        {/* Names stay profile/comment links; grading starts from a task cell. */}
        <Link
          to={'../students/' + student.user_id + search}
          className={cn(
            'inline-flex items-center gap-1.5 underline-offset-2 hover:underline',
            active && 'font-semibold text-ink',
          )}
        >
          <span>{student.name}</span>
          {student.has_student_comment ? (
            <span
              title="Есть заметки об ученике"
              aria-label="Есть заметки об ученике"
              className="inline-block h-2 w-2 shrink-0 rounded-full bg-amber-500"
            />
          ) : null}
        </Link>
      </td>
      {cols.map((fc) => {
        const { col, firstInSeries } = fc
        const key = student.user_id + ':' + col.subproblem_id
        const cell = cells[key]
        const marked = active && markedSubs.has(col.subproblem_id)
        const accepted = cell?.current_status === 'accepted' || marked
        const coffinIsOpen =
          col.is_coffin && coffinOpen(col.coffin_released_at)
        const threadId = cell?.thread_id ?? 0
        const hasComment = !!cell?.has_internal_comment && threadId > 0
        const pending = pendingSubproblemId === col.subproblem_id
        const shownInitials = marked
          ? currentGraderInitials
          : persistedCellInitials(cell, graders)
        const cellAria = marked
          ? 'Снять отметку'
          : accepted
            ? 'Открыть проверку'
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
            aria-disabled={pending || undefined}
            onClick={pending ? undefined : activate}
            onKeyDown={pending ? undefined : onKeyDown}
            className={cn(
              'h-9 min-w-9 cursor-pointer select-none border-b border-line px-1.5 text-center align-middle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40',
              vert(firstInSeries),
              accepted
                ? 'bg-status-accepted-soft font-medium text-status-accepted'
                : cn(
                    coffinCellClasses(col.is_coffin, coffinIsOpen),
                    active
                      ? 'text-status-accepted hover:bg-status-accepted-soft'
                      : 'text-faint hover:bg-surface-muted',
                  ),
            )}
          >
            {pending
              ? '…'
              : accepted
                ? shownInitials
                : active
                  ? '＋'
                  : ''}
          </ThreadCommentCell>
        )
      })}
      <td className="sticky right-0 z-10 border-b border-l border-r border-line bg-surface px-3 py-1.5 text-center font-medium text-ink">
        {solvedTotal}
      </td>
    </tr>
  )
}, sameConduitStudentRowProps)

function sameConduitStudentRowProps(
  previous: ConduitStudentRowProps,
  next: ConduitStudentRowProps,
): boolean {
  if (
    previous.student !== next.student ||
    previous.cols !== next.cols ||
    previous.graders !== next.graders ||
    previous.search !== next.search ||
    previous.active !== next.active ||
    previous.markedSubs !== next.markedSubs ||
    previous.pendingSubproblemId !== next.pendingSubproblemId ||
    previous.currentGraderInitials !== next.currentGraderInitials ||
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
  const [solvedSort, setSolvedSort] = useState<'none' | 'desc' | 'asc'>('none')

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

  const solvedSummary = useMemo(() => {
    const rowTotals = new Map<number, number>()
    const columnTotals = new Map<number, number>()
    let grandTotal = 0
    for (const student of students) {
      let rowTotal = 0
      for (const { col } of cols) {
        if (
          data.cells[student.user_id + ':' + col.subproblem_id]
            ?.current_status !== 'accepted'
        ) {
          continue
        }
        rowTotal++
        grandTotal++
        columnTotals.set(
          col.subproblem_id,
          (columnTotals.get(col.subproblem_id) ?? 0) + 1,
        )
      }
      rowTotals.set(student.user_id, rowTotal)
    }
    return { rowTotals, columnTotals, grandTotal }
  }, [students, cols, data.cells])
  const solvedTotals = solvedSummary.rowTotals

  // Filtered groups for rendering: students whose name matches the query, with
  // empty groups dropped.
  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const groups = !q ? data.groups : data.groups
      .map((g) => ({
        ...g,
        students: g.students.filter((s) => s.name.toLowerCase().includes(q)),
      }))
      .filter((g) => g.students.length > 0)
    if (solvedSort === 'none') return groups
    return groups.map((g) => ({
      ...g,
      students: [...g.students].sort((a, b) => {
        const difference = (solvedTotals.get(a.user_id) ?? 0) - (solvedTotals.get(b.user_id) ?? 0)
        return solvedSort === 'desc' ? -difference : difference
      }),
    }))
  }, [data.groups, query, solvedSort, solvedTotals])

  const shown = useMemo(
    () => filteredGroups.reduce((n, g) => n + g.students.length, 0),
    [filteredGroups],
  )

  const activeStudent = useMemo(
    () => students.find((s) => s.user_id === activeStudentId) ?? null,
    [students, activeStudentId],
  )

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
    fc: FlatCol,
  ) {
    const sub = fc.col.subproblem_id
    const cell = data.cells[studentId + ':' + sub]
    setDialog({
      studentUserId: studentId,
      studentName,
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
        openCellDialog(sid, student.name, fc)
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
      openCellDialog(sid, student.name, fc)
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
  const scrollerRef = useRef<HTMLDivElement>(null)
  const currentThRef = useRef<HTMLTableCellElement | null>(null)
  const currentId = useMemo(() => currentSeriesId(data.series), [data.series])
  useEffect(() => {
    const scroller = scrollerRef.current
    const el = currentThRef.current
    if (!scroller || !el) return
    const elRect = el.getBoundingClientRect()
    const scRect = scroller.getBoundingClientRect()
    // Bring the series just to the right of the sticky student column (~12rem).
    scroller.scrollLeft += elRect.left - scRect.left - 200
  }, [currentId])

  const toolbar = (
    <div className="flex min-w-0 items-center justify-end gap-2">
      <button
        type="button"
        title="Импортировать отмеченные решения из связанных Google Sheets"
        disabled={termId <= 0 || syncGoogleSheets.isPending}
        onClick={() => syncGoogleSheets.mutate(termId)}
        className="h-8 shrink-0 rounded-lg border border-line px-2.5 text-xs text-muted hover:bg-surface-muted hover:text-ink disabled:opacity-50"
      >
        {syncGoogleSheets.isPending ? 'Импорт…' : 'Sheets'}
      </button>
      <span className="hidden whitespace-nowrap text-xs text-faint xl:inline">Ваши инициалы</span>
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
      <div
        className={cn(
          'min-w-0 overflow-hidden whitespace-nowrap transition-[max-width,opacity,transform] duration-300 ease-out motion-reduce:transition-none',
          activeStudent
            ? 'max-w-48 translate-x-0 opacity-100'
            : 'pointer-events-none max-w-0 translate-x-2 opacity-0',
        )}
        aria-hidden={!activeStudent}
      >
        <span className="block max-w-48 truncate text-xs text-muted">{activeStudent?.name}</span>
      </div>
      <button
        type="button"
        onClick={() => selectStudent(null)}
        disabled={!activeStudent}
        className={cn(
          'h-8 shrink-0 overflow-hidden rounded-lg border border-line px-2.5 text-xs text-muted transition-[max-width,opacity,transform] duration-300 ease-out motion-reduce:transition-none hover:bg-surface-muted hover:text-ink disabled:pointer-events-none',
          activeStudent
            ? 'max-w-24 translate-x-0 opacity-100'
            : 'pointer-events-none max-w-0 border-0 px-0 opacity-0',
        )}
      >
        Готово
      </button>
    </div>
  )

  return (
    <div className="flex h-full flex-col">
      {toolbarSlot ? createPortal(toolbar, toolbarSlot) : null}

      <div ref={scrollerRef} className={gridScrollerWithHeight('min-h-0 flex-1')}>
        <table className={gridTable}>
          <thead>
            {/* Series band — one header spanning each series' columns. */}
            <tr>
              {/* Corner cell — holds the student search filter. */}
              <th rowSpan={2} className={cornerHeaderCell}>
                <div className="flex flex-col gap-1">
                  <Input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Ученик…"
                    className="h-8 w-full min-w-40"
                    aria-label="Поиск ученика"
                  />
                  <span className="text-[0.65rem] font-normal text-faint">
                    {shown} из {students.length}
                  </span>
                </div>
              </th>
              {data.series.map((s) => (
                <th
                  key={s.series_id}
                  ref={s.series_id === currentId ? currentThRef : undefined}
                  colSpan={s.columns.length}
                  className={cn(
                    'sticky top-0 z-20 h-9 whitespace-nowrap border-b border-t border-line bg-surface-muted px-3 text-center font-medium text-ink',
                    vert(true),
                  )}
                  title={s.display_name}
                >
                  Серия {s.number}
                </th>
              ))}
              <th
                rowSpan={2}
                className="sticky right-0 top-0 z-40 border-b border-l border-r border-t border-line bg-surface-muted px-3 py-2 text-center font-medium text-ink"
              >
                <button
                  type="button"
                  onClick={() => setSolvedSort((current) => current === 'desc' ? 'asc' : 'desc')}
                  className="whitespace-nowrap hover:underline"
                  title="Сортировать учеников каждой группы по числу решённых задач"
                  aria-label="Сортировать учеников каждой группы по числу решённых задач"
                >
                  Решено{solvedSort === 'desc' ? ' ↓' : solvedSort === 'asc' ? ' ↑' : ''}
                </button>
              </th>
            </tr>
            {/* Per-subproblem column labels. Coffins are tinted — amber while
                open for submission, gray once разобрана (solved). */}
            <tr>
              {cols.map(({ col, firstInSeries }) => {
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
                      'sticky top-9 z-20 min-w-9 border-b border-line px-1.5 py-1 text-center text-xs font-medium',
                      vert(firstInSeries),
                      coffinColumnClasses(col.is_coffin, open),
                    )}
                  >
                    {col.column_label}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {filteredGroups.map((g) => (
              <Fragment key={g.group_id}>
                <tr className="bg-surface-muted/60">
                  <td colSpan={cols.length + 2} className="border-b border-line p-0">
                    <div className={groupLabel}>{g.name}</div>
                  </td>
                </tr>
                {g.students.map((st) => {
                  const isActiveRow = activeStudentId === st.user_id
                  const pendingPrefix = st.user_id + ':'
                  const pendingSubproblemId =
                    pendingKey?.startsWith(pendingPrefix)
                      ? Number(pendingKey.slice(pendingPrefix.length))
                      : null
                  return (
                    <ConduitStudentRow
                      key={st.user_id}
                      student={st}
                      cols={cols}
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
                      solvedTotal={solvedTotals.get(st.user_id) ?? 0}
                      onCellAction={onCellAction}
                    />
                  )
                })}
              </Fragment>
            ))}
            {/* Column totals: people who solved each problem — pinned to the
                bottom so it's always on screen. Always over ALL students. */}
            <tr>
              <td className="sticky bottom-0 left-0 z-30 border-b border-l border-r border-t border-line bg-surface-muted px-3 py-1.5 font-medium text-ink">
                Решили
              </td>
              {cols.map(({ col, firstInSeries }) => (
                <td
                  key={col.subproblem_id}
                  className={cn(
                    'sticky bottom-0 z-20 border-b border-t border-line bg-surface-muted px-1.5 py-1.5 text-center font-medium text-ink',
                    vert(firstInSeries),
                  )}
                >
                  {solvedSummary.columnTotals.get(col.subproblem_id) ?? 0}
                </td>
              ))}
              <td className="sticky bottom-0 right-0 z-30 border-b border-l border-r border-t border-line bg-surface-muted px-3 py-1.5 text-center font-medium text-ink">
                {solvedSummary.grandTotal}
              </td>
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
