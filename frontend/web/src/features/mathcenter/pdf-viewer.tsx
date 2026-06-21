import { useEffect, useState } from 'react'
import { Spinner } from '../../design/ui'
import { apiClient } from '../../lib/api'

export interface PdfViewerProps {
  // The authed blob endpoint to fetch (e.g. /mathcenter/series/7/pdf or a
  // /solution/pdf variant).
  path: string
  title?: string
  className?: string
}

// PdfViewer fetches a PDF as an authed blob from `path`, shows it in an iframe,
// and revokes the object URL on change/unmount. Loading + error states included.
export function PdfViewer({ path, title = 'PDF', className }: PdfViewerProps) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null

    setUrl(null)
    setError(null)

    apiClient
      .requestBlob(path)
      .then((blob) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Не удалось загрузить PDF')
      })

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [path])

  if (error) {
    return (
      <div
        className="flex h-[min(70vh,640px)] w-full items-center justify-center rounded-lg border border-line bg-surface-muted text-sm text-muted"
        role="alert"
      >
        {error}
      </div>
    )
  }

  if (!url) {
    return (
      <div
        className="flex h-[min(70vh,640px)] w-full items-center justify-center rounded-lg border border-line bg-surface-muted"
        role="status"
        aria-label="Загрузка PDF"
      >
        <Spinner />
      </div>
    )
  }

  return (
    <iframe
      src={url}
      title={title}
      className={'h-[min(70vh,640px)] w-full rounded-lg border border-line bg-surface ' + (className ?? '')}
    />
  )
}
