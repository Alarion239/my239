// PDFPanel is the shared "embed the series PDF" surface for the student
// homework view. On a laptop the parent uses it as the left column of a
// responsive split (with sticky positioning so the PDF stays visible
// while the student scrolls through problem cards). On a phone the
// parent stacks it above the problem list.
//
// Uses fetchSeriesPDFObjectURL so the bearer-authed GET is converted
// into a blob: URL that <iframe> can render. We own the URL and revoke
// it on unmount or seriesID change to avoid leaking object URLs across
// pages.

import {useEffect, useState, type ReactNode} from 'react'
import {fetchSeriesPDFObjectURL} from '../../api/series'
import {useAuth} from '../../auth'

interface PDFPanelProps {
    seriesID: number
    hasPDF: boolean
    // When true, the panel position-sticks to the viewport top so it
    // remains visible while the student scrolls the problem list
    // (desktop). When false, it lays out in normal flow with a fixed
    // height — used on mobile where the PDF stacks above the problems.
    sticky: boolean
}

export function PDFPanel({seriesID, hasPDF, sticky}: PDFPanelProps) {
    const {authedFetchRaw} = useAuth()
    const [url, setUrl] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (!hasPDF) {
            setUrl(null)
            return
        }
        let cancelled = false
        let owned: string | null = null
        setError(null)
        fetchSeriesPDFObjectURL(authedFetchRaw, seriesID)
            .then(u => {
                if (cancelled) {
                    URL.revokeObjectURL(u)
                    return
                }
                owned = u
                setUrl(u)
            })
            .catch(e => {
                if (!cancelled) setError(e instanceof Error ? e.message : 'Не удалось загрузить PDF')
            })
        return () => {
            cancelled = true
            if (owned) URL.revokeObjectURL(owned)
            setUrl(null)
        }
    }, [seriesID, hasPDF, authedFetchRaw])

    // Sticky needs an explicit height so the iframe has something to
    // fill; we use the viewport minus the nav bar so the PDF takes the
    // full visible height. Flow mode caps at 70vh / 540px so the
    // problem cards don't get pushed off the screen on phones.
    const outerClass = sticky
        ? 'sticky top-4 flex flex-col min-h-[480px] h-[calc(100vh-120px)]'
        : 'flex flex-col min-h-[320px] h-[min(70vh,540px)]'

    if (!hasPDF) {
        return (
            <div className={outerClass}>
                <Placeholder>PDF ещё не загружен.</Placeholder>
            </div>
        )
    }
    if (error) {
        return (
            <div className={outerClass}>
                <Placeholder tone="danger">{error}</Placeholder>
            </div>
        )
    }
    if (!url) {
        return (
            <div className={outerClass}>
                <Placeholder>Загрузка PDF…</Placeholder>
            </div>
        )
    }
    return (
        <div className={outerClass}>
            <iframe
                src={url}
                title="Серия — PDF"
                className="flex-1 w-full border border-card-border rounded-lg bg-white block"
            />
        </div>
    )
}

function Placeholder({children, tone}: {children: ReactNode; tone?: 'danger'}) {
    return (
        <div className="flex-1 flex items-center justify-center rounded-lg border border-dashed border-card-border bg-page p-6">
            <p className={`text-sm text-center ${tone === 'danger' ? 'text-danger' : 'text-muted'}`}>
                {children}
            </p>
        </div>
    )
}
