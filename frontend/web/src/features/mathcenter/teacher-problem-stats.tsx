import { useId, useState } from 'react'
import { createPortal } from 'react-dom'
import { Skull, X } from 'lucide-react'
import {
  coffinOpen,
  formatDateTime,
  useMarkCoffin,
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
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../design/ui'
import { cn } from '../../design/cn'
import { SolutionContent } from './solution-content'
import { SolutionEditor } from './solution-editor'

// hasRazbor reports whether a subproblem already carries an official разбор.
function hasRazbor(meta: Subproblem | undefined): boolean {
  return !!(meta && (meta.has_solution_tex || meta.has_solution_pdf || meta.solution_link))
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
  const [previewId, setPreviewId] = useState<number | null>(null)

  const press = (id: number) => {
    if (hasRazbor(metaById.get(id))) {
      setPreviewId((cur) => (cur === id ? null : id))
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
  const previewSub =
    previewId != null && hasRazbor(metaById.get(previewId))
      ? metaById.get(previewId)
      : undefined
  const batchAction =
    selectedIds.length > 0 ? (
      <BatchRazborBar
        centerId={centerId}
        subproblemIds={selectedIds}
        onClear={() => setSelected(new Set())}
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
          {previewSub ? (
            <RazborPreview
              centerId={centerId}
              sub={previewSub}
              onClose={() => setPreviewId(null)}
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
                ? previewId === p.subproblem_id
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

// RazborPreview shows the official разбор of a solved problem on the left, with
// a «Редактировать» action (edit it in place) and a close button.
function RazborPreview({
  centerId,
  sub,
  onClose,
}: {
  centerId: number
  sub: Subproblem
  onClose: () => void
}) {
  const texQuery = useSubproblemSolutionTex(sub.id, sub.has_solution_tex)
  const putTex = usePutSubproblemSolutionTexBatch(centerId)
  const uploadPdf = useUploadSubproblemSolutionPdfBatch(centerId)
  const setLink = useSetSubproblemSolutionLinkBatch(centerId)
  const ids = [sub.id]
  return (
    <div className="animate-rise rounded-xl border border-accent/40 bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-lg font-medium text-ink">
          {sub.display}
        </h3>
        <div className="flex items-center gap-2">
          <SolutionEditor
            title={'Редактировать разбор · ' + sub.display}
            hasTex={sub.has_solution_tex}
            hasPdf={sub.has_solution_pdf}
            link={sub.solution_link}
            initialTex={texQuery.data?.tex}
            onPutTex={(tex) => putTex.mutateAsync({ subproblemIds: ids, tex })}
            onUploadPdf={(file) => uploadPdf.mutateAsync({ subproblemIds: ids, file })}
            onSetLink={(link) => setLink.mutateAsync({ subproblemIds: ids, link })}
            closeOnSave
            trigger={
              <Button type="button" size="sm" variant="secondary">
                Редактировать
              </Button>
            }
          />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Скрыть разбор"
            onClick={onClose}
          >
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </div>
      <SolutionContent
        hasTex={sub.has_solution_tex}
        hasPdf={sub.has_solution_pdf}
        link={sub.solution_link}
        pdfPath={'/mathcenter/subproblems/' + sub.id + '/solution/pdf'}
        texQuery={texQuery}
      />
    </div>
  )
}

// BatchRazborBar lets a teacher attach ONE разбор (TeX/PDF/link) to all the
// subproblems they've ticked — so a shared solution covers several problems.
function taskGenitive(count: number): 'задачи' | 'задач' {
  const lastTwo = count % 100
  return count % 10 === 1 && lastTwo !== 11 ? 'задачи' : 'задач'
}

function BatchRazborBar({
  centerId,
  subproblemIds,
  onClear,
}: {
  centerId: number
  subproblemIds: number[]
  onClear: () => void
}) {
  const putTex = usePutSubproblemSolutionTexBatch(centerId)
  const uploadPdf = useUploadSubproblemSolutionPdfBatch(centerId)
  const setLink = useSetSubproblemSolutionLinkBatch(centerId)

  if (subproblemIds.length === 0) return null

  return (
    <div className="inline-flex items-center rounded-full border border-line bg-surface-muted p-0.5">
      <SolutionEditor
        title={'Общий разбор для выбранных (' + subproblemIds.length + ')'}
        hasTex={false}
        hasPdf={false}
        link={null}
        onPutTex={(tex) => putTex.mutateAsync({ subproblemIds, tex })}
        onUploadPdf={(file) => uploadPdf.mutateAsync({ subproblemIds, file })}
        onSetLink={(link) => setLink.mutateAsync({ subproblemIds, link })}
        closeOnSave
        onSaved={onClear}
        trigger={
          <button
            type="button"
            className="whitespace-nowrap rounded-full bg-accent-soft px-3 py-1 text-sm font-medium text-accent-ink transition-colors hover:bg-accent/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            Прикрепить разбор {subproblemIds.length}{' '}
            {taskGenitive(subproblemIds.length)}
          </button>
        }
      />
      <button
        type="button"
        onClick={onClear}
        aria-label="Снять выбор задач"
        title="Снять выбор задач"
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
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
  const open = isCoffin && coffinOpen(meta?.released_at)
  const hasSolution = hasRazbor(meta)
  const distributionLabel = SEGMENTS.map(
    (seg) => seg.label + ' — ' + stat[seg.key],
  ).join('; ')

  // Pressing the row previews its разбор (solved) or selects it for a shared
  // разбор (unsolved). The right-hand controls stop propagation so they don't
  // also trigger the press.
  return (
    <div
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
        'cursor-pointer rounded-xl border bg-surface px-3 py-2.5 transition-colors',
        'hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        // A green frame marks a subproblem that already has a разбор, and stays
        // visible while it's being previewed (the accent ring layers on top).
        hasSolution
          ? 'border-status-accepted'
          : isCoffin
            ? 'border-status-checking'
            : active
              ? 'border-accent'
              : 'border-line',
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
            <span className="hidden text-xs font-medium text-status-accepted sm:inline">
              Разбор ✓
            </span>
          ) : null}
          {/* Coffin marking is for problems WITHOUT a разбор yet. */}
          {!hasSolution ? (
            <CoffinBadge
              problemDisplay={subStatLabel(stat)}
              isCoffin={isCoffin}
              busy={busy}
              onMark={onMark}
              onUnmark={onUnmark}
            />
          ) : null}
        </div>
      </div>

      {isCoffin ? (
        <p className="mt-2 text-xs text-status-checking">
          {open
            ? 'Гроб — открыта для сдачи после дедлайна'
            : 'Разбор опубликован · ' + formatDateTime(meta?.released_at ?? null)}
        </p>
      ) : null}
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
