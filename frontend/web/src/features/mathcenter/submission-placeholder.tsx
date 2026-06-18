import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Hammer } from 'lucide-react'
import { Card } from '../../design/ui'

// SubmissionPlaceholder is the stand-in for the per-subproblem submission flow,
// which a later workflow fills in. It reads the route params so the link back to
// the series works, and so the URL is exercised end to end now.
export function SubmissionPlaceholder() {
  const { seriesId } = useParams<{ seriesId: string; subproblemId: string }>()

  return (
    <div className="animate-rise flex justify-center py-10">
      <Card className="flex max-w-sm flex-col items-center gap-3 px-6 py-12 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-accent-ink">
          <Hammer className="h-6 w-6" aria-hidden />
        </div>
        <h1 className="font-display text-xl font-medium text-ink">
          Сдача задачи — в разработке
        </h1>
        <p className="text-sm text-muted">
          Здесь появится форма отправки решения и переписка с проверяющим.
        </p>
        <Link
          to="/mathcenter"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-accent underline-offset-4 hover:underline"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          {seriesId ? 'Назад к серии' : 'Назад к сериям'}
        </Link>
      </Card>
    </div>
  )
}
