import { FunctionSquare } from 'lucide-react'
import { PlaceholderPage } from '../placeholder-page'

// Stand-in until the Math Center module ships (series, grading grids, threads,
// LaTeX rendering). The route exists now so the shell and nav work end to end.
export function MathCenterPage() {
  return (
    <PlaceholderPage
      title="Матцентр"
      description="Серии задач, проверка работ и прогресс появятся здесь в ближайшем обновлении."
      icon={FunctionSquare}
    />
  )
}
