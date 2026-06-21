import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  coffinOpen,
  displayStatusMeta,
  formatDateTime,
  useCenterCoffins,
  usePutSubproblemSolutionTex,
  useReleaseCoffin,
  useSetSubproblemSolutionLink,
  useSubproblemSolutionTex,
  useUnmarkCoffin,
  useUploadSubproblemSolutionPdf,
  type Coffin,
} from '@my239/shared'
import { Button, Card, Spinner, StatusTile } from '../../design/ui'
import { cn } from '../../design/cn'
import { useSeriesContext } from './use-series-context'
import { SolutionContent } from './solution-content'
import { SolutionEditor } from './solution-editor'

export function CoffinsPage() {
  const { centerId: centerIdParam } = useParams<{ centerId: string }>()
  const centerId = Number(centerIdParam)
  const ctx = useSeriesContext(centerId)

  if (!Number.isFinite(centerId) || centerId <= 0 || (!ctx.isLoading && !ctx.hasAccess)) {
    return (
      <Card className="animate-rise px-6 py-16 text-center">
        <p className="text-muted">Нет доступа к этому матцентру.</p>
      </Card>
    )
  }
  if (ctx.isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="animate-rise flex flex-col gap-6">
      <CoffinList centerId={centerId} isManager={!ctx.isStudentView} />
    </div>
  )
}

function CoffinList({ centerId, isManager }: { centerId: number; isManager: boolean }) {
  const { data, isPending, isError } = useCenterCoffins(centerId)

  if (isPending) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    )
  }
  if (isError || !data) {
    return <p className="py-6 text-sm text-danger">Не удалось загрузить гробы.</p>
  }
  if (data.length === 0) {
    return (
      <Card className="px-6 py-16 text-center">
        <p className="text-muted">Гробов пока нет.</p>
        {isManager ? (
          <p className="mt-2 text-sm text-muted">
            Отметить подзадачу гробом можно в разделе «Разбор» серии.
          </p>
        ) : null}
      </Card>
    )
  }

  // Group by series, preserving the (series desc) order from the API.
  const groups: { key: number; label: string; coffins: Coffin[] }[] = []
  for (const c of data) {
    let g = groups.find((x) => x.key === c.series_id)
    if (!g) {
      g = { key: c.series_id, label: 'Серия ' + c.series_number + ' · ' + c.series_name, coffins: [] }
      groups.push(g)
    }
    g.coffins.push(c)
  }

  return (
    <div className="flex flex-col gap-6">
      {groups.map((g) => (
        <section key={g.key} className="flex flex-col gap-3">
          <h2 className="font-display text-lg font-medium text-ink">{g.label}</h2>
          {g.coffins.map((c) => (
            <CoffinCard key={c.subproblem_id} centerId={centerId} coffin={c} isManager={isManager} />
          ))}
        </section>
      ))}
    </div>
  )
}

function CoffinCard({
  centerId,
  coffin,
  isManager,
}: {
  centerId: number
  coffin: Coffin
  isManager: boolean
}) {
  const open = coffinOpen(coffin.released_at)
  const hasSolution = coffin.has_solution_tex || coffin.has_solution_pdf || !!coffin.solution_link
  // Students see разбор once released; teachers always (to verify).
  const canSeeSolution = (isManager || !open) && hasSolution
  const [showSolution, setShowSolution] = useState(false)
  const texQuery = useSubproblemSolutionTex(
    coffin.subproblem_id,
    coffin.has_solution_tex && showSolution,
  )

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium text-ink">{coffin.display}</div>
          <div className="mt-0.5">
            {open ? (
              <span className="rounded-full bg-status-checking-soft px-2.5 py-0.5 text-xs font-medium text-status-checking">
                Открыт для сдачи
              </span>
            ) : (
              <span className="rounded-full bg-surface-muted px-2.5 py-0.5 text-xs font-medium text-muted">
                Закрыт · разбор {formatDateTime(coffin.released_at)}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canSeeSolution ? (
            <Button type="button" size="sm" variant="secondary" onClick={() => setShowSolution((v) => !v)}>
              Разбор
            </Button>
          ) : null}
          {isManager ? <ManagerControls centerId={centerId} coffin={coffin} open={open} /> : null}
        </div>
      </div>

      {/* Student status tile + submit shortcut for this coffin subproblem. */}
      {!isManager ? (
        <div className="mt-3">
          <SubTile centerId={centerId} coffin={coffin} open={open} />
        </div>
      ) : null}

      {showSolution && canSeeSolution ? (
        <div className="mt-4 border-t border-line pt-4">
          <SolutionContent
            hasTex={coffin.has_solution_tex}
            hasPdf={coffin.has_solution_pdf}
            link={coffin.solution_link}
            pdfPath={'/mathcenter/subproblems/' + coffin.subproblem_id + '/solution/pdf'}
            texQuery={texQuery}
          />
        </div>
      ) : null}
    </Card>
  )
}

function SubTile({
  centerId,
  coffin,
  open,
}: {
  centerId: number
  coffin: Coffin
  open: boolean
}) {
  const status = coffin.current_status ?? 'ungraded'
  const beingGraded = coffin.being_graded ?? false
  const threadId = coffin.thread_id ?? 0
  const meta = displayStatusMeta(status, beingGraded)
  const base = '/mathcenter/' + centerId + '/series/' + coffin.series_id
  // Link to the existing thread, else (only while open) to the submit form.
  const to =
    threadId > 0
      ? base + '/thread/' + threadId
      : open
        ? base + '/submit/' + coffin.subproblem_id
        : null
  const tile = <StatusTile status={status} beingGraded={beingGraded} label={meta.label} />
  return to ? (
    <Link
      to={to}
      title={meta.label}
      className="inline-flex rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      {tile}
    </Link>
  ) : (
    <span title={meta.label}>{tile}</span>
  )
}

function ManagerControls({
  centerId,
  coffin,
  open,
}: {
  centerId: number
  coffin: Coffin
  open: boolean
}) {
  const release = useReleaseCoffin(centerId)
  const unmark = useUnmarkCoffin(centerId)
  const putTex = usePutSubproblemSolutionTex(coffin.subproblem_id, centerId)
  const uploadPdf = useUploadSubproblemSolutionPdf(coffin.subproblem_id, centerId)
  const setLink = useSetSubproblemSolutionLink(coffin.subproblem_id, centerId)

  return (
    <>
      <SolutionEditor
        title={'Разбор · ' + coffin.display}
        hasTex={coffin.has_solution_tex}
        hasPdf={coffin.has_solution_pdf}
        link={coffin.solution_link}
        onPutTex={(tex) => putTex.mutateAsync(tex)}
        onUploadPdf={(file) => uploadPdf.mutateAsync(file)}
        onSetLink={(link) => setLink.mutateAsync(link)}
        trigger={
          <Button type="button" size="sm" variant="secondary">
            Загрузить разбор
          </Button>
        }
      />
      {open ? (
        <Button
          type="button"
          size="sm"
          onClick={() => release.mutate(coffin.subproblem_id)}
          disabled={release.isPending}
          title="Закрыть сдачу и опубликовать разбор"
        >
          {release.isPending ? 'Освобождаем…' : 'Освободить'}
        </Button>
      ) : null}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => unmark.mutate(coffin.subproblem_id)}
        disabled={unmark.isPending}
        className={cn('text-muted')}
        title="Снять пометку гроба"
      >
        Снять
      </Button>
    </>
  )
}
