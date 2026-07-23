import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  coffinOpen,
  initialsOf,
  useCenterGrid,
  useOfflineAccept,
  useOfflineUndo,
  type CenterGridColumn,
  type CenterGridResponse,
  type CenterGridSeries,
} from '@my239/shared'
import { Card, Input, Spinner } from '../../design/ui'
import { cn } from '../../design/cn'
import { ThreadCommentCell } from './cell-comment'
import { OfflineCellDialog, type OfflineCellTarget } from './offline-cell-dialog'
import {
  GraderInitialsInput,
  emptyGrader,
  type CreditedGrader,
} from './grader-initials-input'
import { useSeriesContext } from './use-series-context'
import { useCenterIdContext } from './center-id-context'
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
  const ctx = useSeriesContext(centerId)

  if (!Number.isFinite(centerId) || centerId <= 0) {
    return <NoAccess />
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
      <Conduit centerId={centerId} />
    </div>
  )
}

function Conduit({ centerId }: { centerId: number }) {
  const { data, isPending, isError } = useCenterGrid(centerId)
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
  return <ConduitTable centerId={centerId} data={data} />
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

function ConduitTable({
  centerId,
  data,
}: {
  centerId: number
  data: CenterGridResponse
}) {
  const { year } = useParams<{ year: string }>()
  const [query, setQuery] = useState('')

  // Offline-grading interaction state. A grader picks an active student (their
  // row lights up) and enters their initials once; tapping un-accepted cells in
  // that row marks them solved. Any cell can open the detail dialog (undo /
  // comment / thread link).
  const [activeStudentId, setActiveStudentId] = useState<number | null>(null)
  const [grader, setGrader] = useState<CreditedGrader>(emptyGrader)
  const [dialog, setDialog] = useState<OfflineCellTarget | null>(null)
  const [pendingKey, setPendingKey] = useState<string | null>(null)
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
      if (e.key === 'Enter' && !dialogOpenRef.current) {
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

  // Filtered groups for rendering: students whose name matches the query, with
  // empty groups dropped.
  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return data.groups
    return data.groups
      .map((g) => ({
        ...g,
        students: g.students.filter((s) => s.name.toLowerCase().includes(q)),
      }))
      .filter((g) => g.students.length > 0)
  }, [data.groups, query])

  const shown = useMemo(
    () => filteredGroups.reduce((n, g) => n + g.students.length, 0),
    [filteredGroups],
  )

  const activeStudent = useMemo(
    () => students.find((s) => s.user_id === activeStudentId) ?? null,
    [students, activeStudentId],
  )

  const accepted = (studentId: number, subId: number): boolean =>
    data.cells[studentId + ':' + subId]?.current_status === 'accepted'

  const cellInitials = (studentId: number, subId: number): string => {
    const cell = data.cells[studentId + ':' + subId]
    if (!cell || cell.current_status !== 'accepted') return ''
    const g = cell.last_grader_user_id
    if (g != null && data.graders[String(g)]) return data.graders[String(g)]
    if (cell.last_grader_name) return initialsOf(cell.last_grader_name)
    return '✓'
  }

  const rowTotal = (studentId: number): number =>
    cols.reduce((n, c) => n + (accepted(studentId, c.col.subproblem_id) ? 1 : 0), 0)
  const colTotal = (subId: number): number =>
    students.reduce((n, st) => n + (accepted(st.user_id, subId) ? 1 : 0), 0)
  const grandTotal = students.reduce((n, st) => n + rowTotal(st.user_id), 0)

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
      acceptedInitials: cellInitials(studentId, sub) || undefined,
      threadHref:
        cell && cell.thread_id > 0
          ? '/mathcenter/' + (year ?? '') + '/series/' + fc.seriesId + '/thread/' + cell.thread_id
          : undefined,
    })
  }

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

  // The grid IS the page: it fills the full-bleed region. When a student is
  // active, an initials bar sits above the single scroll surface.
  return (
    <div className="flex h-full flex-col">
      {activeStudent ? (
        <div className="flex flex-wrap items-end gap-3 border-b border-amber-300/70 bg-amber-50/70 px-4 py-2.5 dark:bg-amber-500/10">
          <div className="flex flex-col">
            <span className="text-xs text-faint">Отмечаю решённые у</span>
            <span className="font-medium text-ink">{activeStudent.name}</span>
          </div>
          <div className="min-w-48 flex-1">
            <GraderInitialsInput
              centerId={centerId}
              value={grader}
              onChange={handleGraderChange}
              inputRef={graderInputRef}
              focusToken={graderFocusToken}
              autoFocus
            />
          </div>
          <button
            type="button"
            onClick={() => selectStudent(null)}
            className="h-9 rounded-lg border border-line px-3 text-sm text-muted hover:bg-surface-muted hover:text-ink"
          >
            Готово
          </button>
        </div>
      ) : null}

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
                Решено
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
                  return (
                    <tr
                      key={st.user_id}
                      className={cn(
                        'hover:bg-surface-muted/40',
                        isActiveRow && 'bg-amber-50/60 dark:bg-amber-500/10',
                      )}
                    >
                      <td className={nameCell}>
                        {/* The name opens the student's profile (identity +
                            teacher notes about them). Marking mode is entered by
                            touching one of the student's cells, not the name. */}
                        <Link
                          to={'../students/' + st.user_id}
                          className={cn(
                            'inline-flex items-center gap-1.5 underline-offset-2 hover:underline',
                            isActiveRow && 'font-semibold text-ink',
                          )}
                        >
                          <span>{st.name}</span>
                          {st.has_student_comment ? (
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
                        // A cell marked this session shows green + the CURRENT
                        // initials immediately, so correcting the bar updates the
                        // letters live (the persisted credit is reconciled on
                        // «Готово»).
                        const marked =
                          isActiveRow && markedSubs.has(col.subproblem_id)
                        const acc = accepted(st.user_id, col.subproblem_id) || marked
                        const open = col.is_coffin && coffinOpen(col.coffin_released_at)
                        const cell = data.cells[st.user_id + ':' + col.subproblem_id]
                        const threadId = cell?.thread_id ?? 0
                        const hasComment = !!cell?.has_internal_comment && threadId > 0
                        const key = st.user_id + ':' + col.subproblem_id
                        const pending = pendingKey === key
                        const shownInitials = marked
                          ? initialsOf(grader.name)
                          : cellInitials(st.user_id, col.subproblem_id)
                        // Tapping a cell acts on THAT cell. If the student
                        // wasn't active yet, the same tap also enters marking
                        // mode for them (committing the previous student) — the
                        // tap isn't spent just selecting the row. Within a row:
                        // a square you marked this session toggles off (undo a
                        // misclick); a pre-existing accept opens the detail
                        // dialog; an empty cell fast-marks with the current
                        // initials. If none is available yet, the same tap
                        // activates the row and focuses the initials field.
                        const onClick = () => {
                          const sid = st.user_id
                          if (!isActiveRow) {
                            if (accepted(sid, col.subproblem_id)) {
                              selectStudent(sid)
                              openCellDialog(sid, st.name, fc)
                              return
                            }

                            // An empty cell starts the active marking mode. If
                            // a grader was entered recently, reuse it for the
                            // first mark; either way, put the cursor in the
                            // top field so a new grader can start typing.
                            const remembered = recentGrader()
                            selectStudent(sid)
                            focusGraderInput()
                            if (remembered.name.trim()) markCell(sid, col, remembered)
                            return
                          }

                          if (marked) {
                            unmarkCell(sid, col)
                          } else if (accepted(sid, col.subproblem_id)) {
                            openCellDialog(sid, st.name, fc)
                          } else if (grader.name.trim()) {
                            markCell(sid, col)
                          } else {
                            focusGraderInput()
                          }
                        }
                        const cellAria = marked
                          ? 'Снять отметку'
                          : acc
                            ? 'Открыть проверку'
                            : 'Отметить решённым'
                        return (
                          <ThreadCommentCell
                            key={col.subproblem_id}
                            threadId={threadId}
                            hasComment={hasComment}
                            className={cn(
                              'border-b border-line p-0 text-center',
                              vert(firstInSeries),
                              acc
                                ? 'bg-status-accepted-soft font-medium text-status-accepted'
                                : cn(coffinCellClasses(col.is_coffin, open), 'text-faint'),
                            )}
                          >
                            <button
                              type="button"
                              onClick={onClick}
                              disabled={pending}
                              aria-label={cellAria}
                              className={cn(
                                'flex h-full w-full items-center justify-center px-1.5 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                                !acc && isActiveRow && 'text-status-accepted hover:bg-status-accepted-soft',
                                !acc && !isActiveRow && 'hover:bg-surface-muted',
                              )}
                            >
                              {pending
                                ? '…'
                                : acc
                                  ? shownInitials
                                  : isActiveRow
                                    ? '＋'
                                    : ''}
                            </button>
                          </ThreadCommentCell>
                        )
                      })}
                      <td className="sticky right-0 z-10 border-b border-l border-r border-line bg-surface px-3 py-1.5 text-center font-medium text-ink">
                        {rowTotal(st.user_id)}
                      </td>
                    </tr>
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
                  {colTotal(col.subproblem_id)}
                </td>
              ))}
              <td className="sticky bottom-0 right-0 z-30 border-b border-l border-r border-t border-line bg-surface-muted px-3 py-1.5 text-center font-medium text-ink">
                {grandTotal}
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

function NoAccess() {
  return (
    <Card className="px-6 py-16 text-center">
      <p className="text-muted">Нет доступа к кондуиту этого матцентра.</p>
    </Card>
  )
}
