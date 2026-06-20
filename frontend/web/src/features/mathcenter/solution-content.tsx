import { useState, type ReactNode } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import { Spinner } from '../../design/ui'
import { cn } from '../../design/cn'
import { TexViewer } from './tex-viewer'
import { PdfViewer } from './pdf-viewer'

type Fmt = 'tex' | 'pdf' | 'link'

const FMT_LABEL: Record<Fmt, string> = { tex: 'TeX', pdf: 'PDF', link: 'Видео' }

export interface SolutionContentProps {
  hasTex: boolean
  hasPdf: boolean
  link?: string | null
  // The authed PDF blob endpoint (e.g. /mathcenter/series/7/solution/pdf).
  pdfPath: string
  // The TeX query result (the parent owns the hook call so it can gate fetching
  // on visibility). Only read when TeX is the active format.
  texQuery: UseQueryResult<{ tex: string }>
  emptyText?: string
}

// SolutionContent renders a «Разбор» as TeX / PDF / external (video) link, with
// a format toggle when more than one is available. Reused for the series-level
// разбор and each coffin's разбор.
export function SolutionContent({
  hasTex,
  hasPdf,
  link,
  pdfPath,
  texQuery,
  emptyText = 'Разбор ещё не опубликован',
}: SolutionContentProps) {
  const formats: Fmt[] = []
  if (hasTex) formats.push('tex')
  if (hasPdf) formats.push('pdf')
  if (link) formats.push('link')

  const [fmt, setFmt] = useState<Fmt>(formats[0] ?? 'tex')
  const active: Fmt = formats.includes(fmt) ? fmt : (formats[0] ?? 'tex')

  if (formats.length === 0) {
    return <p className="py-8 text-center text-sm text-faint">{emptyText}</p>
  }

  return (
    <div className="flex flex-col gap-3">
      {formats.length > 1 ? (
        <FormatToggle formats={formats} value={active} onChange={setFmt} />
      ) : null}
      {active === 'tex' ? (
        <TexContent texQuery={texQuery} />
      ) : active === 'pdf' ? (
        <PdfViewer path={pdfPath} title="Разбор (PDF)" />
      ) : (
        <LinkViewer link={link as string} />
      )}
    </div>
  )
}

// TexContent renders the разбор LaTeX from the parent-owned query.
function TexContent({
  texQuery,
}: {
  texQuery: UseQueryResult<{ tex: string }>
}) {
  const { data, isLoading, isError, error } = texQuery
  if (isLoading) {
    return (
      <div className="flex min-h-32 items-center justify-center" role="status" aria-label="Загрузка разбора">
        <Spinner />
      </div>
    )
  }
  if (isError || !data) {
    return (
      <p className="text-sm text-danger" role="alert">
        {error instanceof Error ? error.message : 'Не удалось загрузить разбор'}
      </p>
    )
  }
  return <TexViewer tex={data.tex} />
}

// youtubeEmbed converts a YouTube watch/share URL into its /embed/ form.
function youtubeEmbed(url: string): string | null {
  const m =
    url.match(/[?&]v=([\w-]{11})/) ||
    url.match(/youtu\.be\/([\w-]{11})/) ||
    url.match(/youtube\.com\/embed\/([\w-]{11})/)
  return m ? 'https://www.youtube.com/embed/' + m[1] : null
}

// LinkViewer embeds a recognised video (YouTube) or shows an external link.
function LinkViewer({ link }: { link: string }) {
  const embed = youtubeEmbed(link)
  if (embed) {
    return (
      <iframe
        src={embed}
        title="Видео-разбор"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        className="aspect-video w-full rounded-lg border border-line bg-surface"
      />
    )
  }
  return (
    <a
      href={link}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 self-start rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-muted"
    >
      <ExternalLink className="h-4 w-4" aria-hidden />
      Открыть разбор
    </a>
  )
}

function FormatToggle({
  formats,
  value,
  onChange,
}: {
  formats: Fmt[]
  value: Fmt
  onChange: (f: Fmt) => void
}) {
  return (
    <div className="inline-flex self-start rounded-full border border-line bg-surface-muted p-0.5" role="group" aria-label="Формат разбора">
      {formats.map((f) => (
        <Pill key={f} active={value === f} onClick={() => onChange(f)}>
          {FMT_LABEL[f]}
        </Pill>
      ))}
    </div>
  )
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
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
