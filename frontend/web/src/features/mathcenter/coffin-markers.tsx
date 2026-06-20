import {
  useCenterCoffins,
  useMarkCoffin,
  useUnmarkCoffin,
  type Series,
} from '@my239/shared'
import { Check, Skull } from 'lucide-react'
import { cn } from '../../design/cn'

// CoffinMarkers lets a teacher flag/unflag each problem as a coffin (гроб) from
// the series stats view — the place they look after the deadline once they see
// which problems were barely solved. Marking re-opens the problem for
// submission until its разбор is released.
export function CoffinMarkers({ series }: { series: Series }) {
  const centerId = series.math_center_id
  const { data: coffins } = useCenterCoffins(centerId)
  const mark = useMarkCoffin(centerId)
  const unmark = useUnmarkCoffin(centerId)
  const busy = mark.isPending || unmark.isPending

  const coffinProblemIds = new Set((coffins ?? []).map((c) => c.problem_id))

  if (series.problems.length === 0) return null

  return (
    <div className="border-t border-line pt-4">
      <p className="mb-2 text-sm font-medium text-ink">Гробы</p>
      <p className="mb-3 text-xs text-muted">
        Отметьте сложные задачи гробом — они останутся открытыми для сдачи после
        дедлайна, пока вы не опубликуете разбор.
      </p>
      <div className="flex flex-wrap gap-2">
        {series.problems.map((p) => {
          const isCoffin = coffinProblemIds.has(p.id)
          return (
            <button
              key={p.id}
              type="button"
              disabled={busy}
              onClick={() =>
                isCoffin ? unmark.mutate(p.id) : mark.mutate(p.id)
              }
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium transition-colors disabled:opacity-55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                isCoffin
                  ? 'border-status-checking bg-status-checking-soft text-status-checking'
                  : 'border-line-strong bg-surface text-muted hover:text-ink',
              )}
              title={isCoffin ? 'Снять пометку гроба' : 'Отметить гробом'}
            >
              {isCoffin ? (
                <Check className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <Skull className="h-3.5 w-3.5" aria-hidden />
              )}
              {p.display_name}
            </button>
          )
        })}
      </div>
    </div>
  )
}
