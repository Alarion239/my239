import { useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Skull, X } from 'lucide-react'
import {
  useMarkCoffin,
  usePublishSubproblemSolutionsBatch,
  usePutSubproblemSolutionTexBatch,
  useSetSubproblemSolutionLinkBatch,
  useSubproblemSolutionTex,
  useUnmarkCoffin,
  useUploadSubproblemSolutionPdfBatch,
  type SeriesProblemStat,
  type SeriesProblemStats,
  type Subproblem,
  type Series,
} from '@my239/shared'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../design/ui'
import { cn } from '../../design/cn'
import { SolutionWorkbench, type SolutionWorkbenchMode } from './solution-editor'

// hasRazbor reports whether a subproblem already carries an official разбор.
function hasRazbor(meta: Subproblem | undefined): boolean {
  return !!(meta && (meta.has_solution_tex || meta.has_solution_pdf || meta.solution_link))
}

function isPublished(meta: Subproblem | undefined): boolean {
  return !!meta?.solution_published_at
}

function sharesRazbor(
  first: Subproblem | undefined,
  second: Subproblem | undefined,
): boolean {
  if (!first || !second) return false
  return first.solution_group_id != null
    ? first.solution_group_id === second.solution_group_id
    : first.id === second.id
}

function solutionIds(id: number, metaById: Map<number, Subproblem>): number[] {
  const selected = metaById.get(id)
  if (!selected) return [id]
  if (selected.solution_group_id == null) return [id]
  return [...metaById.entries()]
    .filter(([, meta]) => meta.solution_group_id === selected.solution_group_id)
    .map(([subproblemId]) => subproblemId)
}

// Each segment maps a stat field to its status colour token + Russian label.
interface Segment {
  key: keyof Pick<
    SeriesProblemStat,
    'accepted' | 'submitted' | 'rejected' | 'appealed' | 'unsolved'
  >
  label: string
  bar: string
}

const SEGMENTS: Segment[] = [
  { key: 'accepted', label: 'Принято', bar: 'bg-status-accepted' },
  { key: 'submitted', label: 'Проверяется', bar: 'bg-status-checking' },
  { key: 'rejected', label: 'Отклонено', bar: 'bg-status-rejected' },
  { key: 'appealed', label: 'Апелляция', bar: 'bg-status-appeal' },
  { key: 'unsolved', label: 'Не решено', bar: 'bg-status-unsolved' },
]

// subStatLabel composes the user-facing name of a stat line: the problem name
// plus the subproblem letter when there is one (5а, 5б); single-subproblem
// problems carry an empty label and read as just "Задача 5".
function subStatLabel(stat: SeriesProblemStat): string {
  return stat.subproblem_label
    ? stat.problem_display + ' (' + stat.subproblem_label + ')'
    : stat.problem_display
}

export interface TeacherProblemStatsProps {
  stats: SeriesProblemStats
  series: Series
  centerId: number
  toolbarSlot?: HTMLElement | null
}

// TeacherProblemStats renders the per-subproblem aggregate across all students.
// The counts live directly inside one thick status rail; hovering a segment
// names its status, avoiding a separate legend and duplicated student total.
// Each subproblem (the atomic unit) also carries its own coffin toggle and
// «Разбор» authoring, so teachers manage 5а, 5б, 6 independently straight from
// the stats they just read.
export function TeacherProblemStats({
  stats,
  series,
  centerId,
  toolbarSlot,
}: TeacherProblemStatsProps) {
  const mark = useMarkCoffin(centerId)
  const unmark = useUnmarkCoffin(centerId)
  const busy = mark.isPending || unmark.isPending

  // Per-subproblem разбор/coffin metadata, keyed by subproblem id.
  const metaById = new Map<number, Subproblem>()
  for (const p of series.problems) {
    for (const sub of p.subproblems) metaById.set(sub.id, sub)
  }

  // Pressing a problem does one of two things, depending on its state:
  //  - has a разбор  → preview it in the left panel (master-detail).
  //  - no разбор yet → select it for a shared batch разбор.
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [panel, setPanel] = useState<{
    mode: SolutionWorkbenchMode
    representativeId: number
    subproblemIds: number[]
  } | null>(null)
  const originId = useRef<number | null>(null)

  const press = (id: number) => {
    // An edit target is frozen until the workbench closes. This prevents a
    // second row click from silently retargeting a dirty/shared draft.
    if (panel?.mode === 'edit') return
    originId.current = id
    const pressed = metaById.get(id)
    if (hasRazbor(pressed)) {
      setPanel((cur) =>
        cur?.mode === 'view' && sharesRazbor(metaById.get(cur.representativeId), pressed)
          ? null
          : { mode: 'view', representativeId: id, subproblemIds: solutionIds(id, metaById) },
      )
    } else {
      setSelected((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
    }
  }

  if (stats.problems.length === 0) {
    return <p className="py-6 text-sm text-muted">В этой серии пока нет задач.</p>
  }

  const selectedIds = stats.problems
    .map((p) => p.subproblem_id)
    .filter((id) => selected.has(id))
  const previewSub = panel != null ? metaById.get(panel.representativeId) : undefined
  // A shared разбор is one selectable unit: pressing any covered problem
  // previews that source and lights up every sibling in the same group.
  const previewIds = new Set(panel?.subproblemIds ?? [])
  const batchAction =
    selectedIds.length > 0 ? (
      <BatchRazborBar
        subproblemIds={selectedIds}
        onOpen={() => {
          originId.current = selectedIds[0]
          setPanel({ mode: 'edit', representativeId: selectedIds[0], subproblemIds: selectedIds })
        }}
        onClear={() => { setSelected(new Set()); setPanel(null) }}
      />
    ) : null

  return (
    // Side-by-side master-detail on ≥md; on phones the разбор preview stacks
    // above the list (no cramped horizontal split).
    <div className="flex flex-col gap-4 md:flex-row md:items-start md:gap-0">
      {/* разбор of the pressed problem. Desktop: a sliding left pane. Mobile: a
          full-width block shown above the list, hidden when nothing is open. */}
      <div
        className={cn(
          'overflow-hidden md:shrink-0 md:transition-all md:duration-300 md:ease-out',
          previewSub ? 'md:w-1/2 md:opacity-100' : 'hidden md:block md:w-0 md:opacity-0',
        )}
      >
        <div className="md:pr-4">
          {previewSub && panel ? (
            <RazborPreview
              centerId={centerId}
              sub={previewSub}
              subproblemIds={panel.subproblemIds}
              mode={panel.mode}
              onModeChange={(mode) => setPanel({ ...panel, mode })}
              onClose={() => {
                setPanel(null)
                setSelected(new Set())
                const id = originId.current
                if (id != null) requestAnimationFrame(() => document.getElementById('subproblem-row-' + id)?.focus())
              }}
            />
          ) : null}
        </div>
      </div>

      {/* The statistics list + batch разбор bar. */}
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        {toolbarSlot && batchAction
          ? createPortal(batchAction, toolbarSlot)
          : batchAction}
        {stats.problems.map((p) => (
          <ProblemStatRow
            key={p.subproblem_id}
            stat={p}
            meta={metaById.get(p.subproblem_id)}
            busy={busy}
            active={
              hasRazbor(metaById.get(p.subproblem_id))
                ? previewIds.has(p.subproblem_id)
                : selected.has(p.subproblem_id)
            }
            onPress={() => press(p.subproblem_id)}
            onMark={() => mark.mutate(p.subproblem_id)}
            onUnmark={() => unmark.mutate(p.subproblem_id)}
          />
        ))}
      </div>
    </div>
  )
}

// RazborPreview is the left-hand shared view/edit workbench. The same panel is
// used for a saved razbor and for a fresh multi-problem draft.
function RazborPreview({
  centerId,
  sub,
  subproblemIds,
  mode,
  onModeChange,
  onClose,
}: {
  centerId: number
  sub: Subproblem
  subproblemIds: number[]
  mode: SolutionWorkbenchMode
  onModeChange: (mode: SolutionWorkbenchMode) => void
  onClose: () => void
}) {
  const texQuery = useSubproblemSolutionTex(sub.id, sub.has_solution_tex || mode === 'edit')
  const putTex = usePutSubproblemSolutionTexBatch(centerId)
  const uploadPdf = useUploadSubproblemSolutionPdfBatch(centerId)
  const setLink = useSetSubproblemSolutionLinkBatch(centerId)
  const publish = usePublishSubproblemSolutionsBatch(centerId)
  return (
    <SolutionWorkbench
      title={subproblemIds.length > 1 ? 'Общий разбор · ' + sub.display : sub.display}
      targetDescription={subproblemIds.length > 1 ? 'Задачи: ' + subproblemIds.length : undefined}
      mode={mode}
      hasTex={sub.has_solution_tex}
      hasPdf={sub.has_solution_pdf}
      link={sub.solution_link}
      publishedAt={sub.solution_published_at}
      centerId={centerId}
      pdfPath={'/mathcenter/subproblems/' + sub.id + '/solution/pdf'}
      initialTex={texQuery.data?.tex}
      texQuery={texQuery}
      onModeChange={onModeChange}
      onPutTex={(tex) => putTex.mutateAsync({ subproblemIds, tex })}
      onUploadPdf={(file) => uploadPdf.mutateAsync({ subproblemIds, file })}
      onSetLink={(link) => setLink.mutateAsync({ subproblemIds, link })}
      onPublish={() => publish.mutateAsync(subproblemIds)}
      onClose={onClose}
    />
  )
}

// BatchRazborBar lets a teacher attach ONE разбор (TeX/PDF/link) to all the
// subproblems they've ticked — so a shared solution covers several problems.
function taskGenitive(count: number): 'задачи' | 'задач' {
  const lastTwo = count % 100
  return count % 10 === 1 && lastTwo !== 11 ? 'задачи' : 'задач'
}

function BatchRazborBar({
  subproblemIds,
  onOpen,
  onClear,
}: {
  subproblemIds: number[]
  onOpen: () => void
  onClear: () => void
}) {
  if (subproblemIds.length === 0) return null

  return (
    <div className="relative ml-1 inline-flex items-center">
      <button
        type="button"
        onClick={onOpen}
        className="whitespace-nowrap rounded-xl border border-line bg-surface px-3 py-2 pr-10 text-sm font-medium text-ink transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        Прикрепить разбор {subproblemIds.length}{' '}
        {taskGenitive(subproblemIds.length)}
      </button>
      <button
        type="button"
        onClick={onClear}
        aria-label="Снять выбор задач"
        title="Снять выбор задач"
        className="absolute right-1 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  )
}

function ProblemStatRow({
  stat,
  meta,
  busy,
  active,
  onPress,
  onMark,
  onUnmark,
}: {
  stat: SeriesProblemStat
  meta: Subproblem | undefined
  busy: boolean
  active: boolean
  onPress: () => void
  onMark: () => void
  onUnmark: () => void
}) {
  const total =
    stat.accepted + stat.submitted + stat.rejected + stat.appealed + stat.unsolved
  const isCoffin = meta?.is_coffin ?? false
  const hasSolution = hasRazbor(meta)
  const published = isPublished(meta)
  const distributionLabel = SEGMENTS.map(
    (seg) => seg.label + ' — ' + stat[seg.key],
  ).join('; ')

  // Pressing the row previews its разбор (solved) or selects it for a shared
  // разбор (unsolved). The right-hand controls stop propagation so they don't
  // also trigger the press.
  return (
    <div
      id={'subproblem-row-' + stat.subproblem_id}
      role="button"
      tabIndex={0}
      aria-pressed={active}
      onClick={onPress}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onPress()
        }
      }}
      className={cn(
        'cursor-pointer rounded-xl border border-line px-3 py-2.5 transition-colors',
        'hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        published
          ? 'bg-status-accepted-soft'
          : hasSolution
            ? 'bg-surface-muted'
            : 'bg-surface',
        active ? 'ring-2 ring-accent/50' : '',
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="w-28 shrink-0 truncate font-medium text-ink sm:w-32">
          {subStatLabel(stat)}
        </span>

        <div
          className="flex h-8 min-w-0 flex-1 rounded-lg bg-surface-muted"
          role="img"
          aria-label={
            'Распределение статусов по задаче ' +
            subStatLabel(stat) +
            ': ' +
            distributionLabel
          }
        >
          {SEGMENTS.map((seg) => {
            const value = stat[seg.key]
            if (value === 0 || total === 0) return null
            const percentage = (value / total) * 100
            return (
              <span
                key={seg.key}
                className={cn(
                  'group relative flex h-full min-w-0 items-center justify-center first:rounded-l-lg last:rounded-r-lg',
                  seg.bar,
                )}
                style={{ width: percentage + '%' }}
                aria-hidden
              >
                {percentage >= 5 ? (
                  <span className="truncate px-1 text-sm font-medium tabular-nums text-surface">
                    {value}
                  </span>
                ) : null}
                <span
                  role="tooltip"
                  className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg border border-line bg-ink px-2 py-1 text-xs font-medium text-paper opacity-0 shadow-lg transition-opacity group-hover:opacity-100"
                >
                  {seg.label} — {value}
                </span>
              </span>
            )
          })}
        </div>

        <div
          className="flex shrink-0 items-center gap-2"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          role="presentation"
        >
          {hasSolution ? (
            <span className={cn('hidden text-xs font-medium sm:inline', published ? 'text-status-accepted' : 'text-muted')}>
              {published ? 'Разбор ✓' : 'Черновик'}
            </span>
          ) : null}
          {/* Keep the existing coffin status control visible even after the
              razbor is published; publication changes the razbor background,
              not the coffin's own status affordance. */}
          <CoffinBadge
            problemDisplay={subStatLabel(stat)}
            isCoffin={isCoffin}
            busy={busy}
            onMark={onMark}
            onUnmark={onUnmark}
          />
        </div>
      </div>
    </div>
  )
}

// CoffinBadge is the per-subproblem гроб toggle: a big, square icon button that
// opens a small confirmation menu (marking re-opens the subproblem for
// submission after the deadline until its разбор is released).
function CoffinBadge({
  problemDisplay,
  isCoffin,
  busy,
  onMark,
  onUnmark,
}: {
  problemDisplay: string
  isCoffin: boolean
  busy: boolean
  onMark: () => void
  onUnmark: () => void
}) {
  const hintId = useId()
  const hint = isCoffin
    ? 'Гроб открыт до публикации разбора'
    : 'Открыть сдачу после дедлайна до публикации разбора'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={busy}
          aria-label={isCoffin ? 'Гроб: снять пометку' : 'Отметить гробом'}
          aria-describedby={hintId}
          className={cn(
            'group relative inline-flex h-10 w-10 items-center justify-center rounded-xl border transition-colors disabled:opacity-55',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
            isCoffin
              ? 'border-status-checking bg-status-checking-soft text-status-checking'
              : 'border-line-strong bg-surface text-muted hover:border-status-checking hover:text-status-checking',
          )}
        >
          <Skull className="h-5 w-5" aria-hidden />
          <span
            id={hintId}
            role="tooltip"
            className="pointer-events-none absolute bottom-full right-0 z-30 mb-2 w-max max-w-56 rounded-md border border-line bg-ink px-2 py-1 text-left text-[11px] font-normal leading-snug text-paper opacity-0 shadow-md transition-opacity duration-150 delay-0 group-hover:opacity-100 group-hover:delay-[700ms] group-focus-visible:opacity-100 group-focus-visible:delay-0 group-data-[state=open]:hidden"
          >
            {hint}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        collisionPadding={8}
        className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] min-w-0 max-w-56 overflow-y-auto"
      >
        <DropdownMenuLabel className="break-words">{problemDisplay}</DropdownMenuLabel>
        {isCoffin ? (
          <>
            <p className="px-2.5 pb-1 text-xs text-muted">
              Подзадача открыта для сдачи как гроб.
            </p>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={onUnmark}>
              <Skull className="h-4 w-4" aria-hidden />
              Снять пометку гроба
            </DropdownMenuItem>
          </>
        ) : (
          <>
            <p className="px-2.5 pb-1 text-xs text-muted">
              Гроб останется открытым для сдачи после дедлайна, пока вы не
              опубликуете разбор.
            </p>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onMark}>
              <Skull className="h-4 w-4" aria-hidden />
              Отметить гробом
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
