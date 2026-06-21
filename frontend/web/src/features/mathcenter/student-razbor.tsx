import { useState } from 'react'
import { Skull } from 'lucide-react'
import {
  submissionClosedFor,
  useSubproblemSolutionTex,
  type Series,
  type Subproblem,
} from '@my239/shared'
import { Card, CardContent } from '../../design/ui'
import { cn } from '../../design/cn'
import { SolutionContent } from './solution-content'

interface Chip {
  sub: Subproblem
  token: string
}

// razborReleased reports whether a subproblem's разбор is visible to a student:
// it must exist AND be released — at the series deadline for a normal problem,
// or once a coffin is released. (The content endpoints enforce the same gate.)
function razborReleased(sub: Subproblem, dueAt: string): boolean {
  const has = sub.has_solution_tex || sub.has_solution_pdf || !!sub.solution_link
  if (!has) return false
  return submissionClosedFor({
    is_coffin: sub.is_coffin,
    coffin_released_at: sub.released_at,
    series_due_at: dueAt,
  })
}

// StudentRazbor is the read-only «Разбор» view: a row of subproblem chips at the
// top (released ones are pressable; coffins carry a skull), and on click the
// solution renders below while every problem the same разбор covers lights up.
export function StudentRazbor({ series }: { series: Series }) {
  const chips: Chip[] = []
  for (const p of series.problems) {
    for (const sub of p.subproblems) {
      chips.push({ sub, token: String(p.number) + (sub.label ?? '') })
    }
  }

  const [selectedId, setSelectedId] = useState<number | null>(null)
  const selected = chips.find((c) => c.sub.id === selectedId)?.sub

  // The set lit up = subproblems sharing the selected разбор's group (or just
  // the selected one when it has no group).
  const litIds = new Set<number>()
  if (selected) {
    if (selected.solution_group_id != null) {
      for (const c of chips) {
        if (c.sub.solution_group_id === selected.solution_group_id) {
          litIds.add(c.sub.id)
        }
      }
    } else {
      litIds.add(selected.id)
    }
  }

  const anyAvailable = chips.some((c) => razborReleased(c.sub, series.due_at))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {chips.map(({ sub, token }) => {
          const released = razborReleased(sub, series.due_at)
          const lit = litIds.has(sub.id)
          return (
            <button
              key={sub.id}
              type="button"
              disabled={!released}
              onClick={() =>
                setSelectedId((cur) => (cur === sub.id ? null : sub.id))
              }
              title={released ? sub.display : sub.display + ' — разбор ещё не вышел'}
              className={cn(
                'inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-sm font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                lit
                  ? 'border-accent bg-accent-soft text-accent-ink ring-2 ring-accent/40'
                  : released
                    ? 'cursor-pointer border-line-strong text-ink hover:border-accent hover:text-accent'
                    : 'cursor-not-allowed border-line text-faint',
              )}
            >
              {sub.is_coffin ? <Skull className="h-3.5 w-3.5" aria-hidden /> : null}
              {token}
            </button>
          )
        })}
      </div>

      {!anyAvailable ? (
        <p className="py-6 text-sm text-muted">
          Разборы появятся после срока серии.
        </p>
      ) : !selected ? (
        <p className="py-2 text-sm text-muted">
          Выберите задачу выше, чтобы посмотреть её разбор.
        </p>
      ) : (
        <RazborBody
          sub={selected}
          coveredTokens={chips
            .filter((c) => litIds.has(c.sub.id))
            .map((c) => c.token)}
        />
      )}
    </div>
  )
}

function RazborBody({
  sub,
  coveredTokens,
}: {
  sub: Subproblem
  coveredTokens: string[]
}) {
  const texQuery = useSubproblemSolutionTex(sub.id, sub.has_solution_tex)
  return (
    <Card>
      <CardContent>
        <p className="mb-3 text-sm text-muted">
          Разбор · {coveredTokens.length > 1 ? 'задачи ' : 'задача '}
          <span className="font-medium text-ink">{coveredTokens.join(', ')}</span>
        </p>
        <SolutionContent
          hasTex={sub.has_solution_tex}
          hasPdf={sub.has_solution_pdf}
          link={sub.solution_link}
          pdfPath={'/mathcenter/subproblems/' + sub.id + '/solution/pdf'}
          texQuery={texQuery}
        />
      </CardContent>
    </Card>
  )
}
