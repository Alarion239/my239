import { useState } from 'react'
import { useSeriesTex, type Series } from '@my239/shared'
import { Card, CardContent, Spinner } from '../../design/ui'
import { cn } from '../../design/cn'
import { TexViewer } from './tex-viewer'
import { PdfViewer } from './pdf-viewer'

type View = 'tex' | 'pdf'

export interface StatementPanelProps {
  series: Series
  className?: string
  // bare drops the Card chrome so the statement spans full width inside a tab;
  // the disclosure in thread-page keeps the card (default).
  bare?: boolean
}

// StatementPanel renders a series' problem statement: TeX when available (crisp
// KaTeX math), PDF otherwise, with a format toggle when both exist. The
// "Условие" label lives on the tab/disclosure that hosts this, so it is not
// repeated here.
export function StatementPanel({ series, className, bare }: StatementPanelProps) {
  const { has_tex, has_pdf } = series
  // TeX is the default surface when present.
  const [view, setView] = useState<View>(has_tex ? 'tex' : 'pdf')
  const both = has_tex && has_pdf
  const active: View = both ? view : has_tex ? 'tex' : 'pdf'

  const body = (
    <div className="flex flex-col gap-3">
      {both ? (
        <div className="flex justify-end">
          <ViewToggle value={view} onChange={setView} />
        </div>
      ) : null}
      {!has_tex && !has_pdf ? (
        <EmptyStatement />
      ) : active === 'tex' ? (
        <TexStatement series={series} />
      ) : (
        <PdfViewer path={'/mathcenter/series/' + series.id + '/pdf'} title="Условие (PDF)" />
      )}
    </div>
  )

  if (bare) {
    return <div className={className}>{body}</div>
  }
  return (
    <Card className={className}>
      <CardContent>{body}</CardContent>
    </Card>
  )
}

// TexStatement loads the LaTeX source on demand, then renders it.
function TexStatement({ series }: { series: Series }) {
  const { data, isLoading, isError, error } = useSeriesTex(series.id, series.has_tex)

  if (isLoading) {
    return (
      <div className="flex min-h-32 items-center justify-center" role="status" aria-label="Загрузка условия">
        <Spinner />
      </div>
    )
  }
  if (isError || !data) {
    return (
      <p className="text-sm text-danger" role="alert">
        {error instanceof Error ? error.message : 'Не удалось загрузить условие'}
      </p>
    )
  }
  return <TexViewer tex={data.tex} />
}

function EmptyStatement() {
  return (
    <p className="py-8 text-center text-sm text-faint">
      Условие ещё не опубликовано
    </p>
  )
}

// ViewToggle is a two-pill segmented control for TeX vs PDF.
function ViewToggle({ value, onChange }: { value: View; onChange: (v: View) => void }) {
  return (
    <div className="inline-flex rounded-full border border-line bg-surface-muted p-0.5" role="group" aria-label="Формат условия">
      <Pill active={value === 'tex'} onClick={() => onChange('tex')}>
        TeX
      </Pill>
      <Pill active={value === 'pdf'} onClick={() => onChange('pdf')}>
        PDF
      </Pill>
    </div>
  )
}

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'rounded-full px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        active ? 'bg-accent-soft text-accent-ink' : 'text-muted hover:text-ink',
      )}
    >
      {children}
    </button>
  )
}
