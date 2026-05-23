// SeriesContentPanel renders the series content in the student
// homework view. Picks the right renderer: TeX > PDF > "not uploaded".
//
// The TeX renderer is lazy-loaded, so series that only have a PDF skip
// the LaTeX.js bundle download entirely.
//
// Layout mirrors PDFPanel: sticky on desktop, fixed-height in flow on
// mobile, so the problem list stays beside it on laptop and above it on
// phone.

import {useEffect, useState, type ReactNode} from 'react'
import {fetchSeriesPDFObjectURL, getSeriesTex, type Series} from '../../api/series'
import {useAuth} from '../../auth'
import {TexViewer} from '../series/TexViewer'

interface Props {
    series: Series
    // sticky=true → parent is the laptop side-by-side layout; the panel
    // position-sticks to viewport top. sticky=false → mobile stacked
    // mode, fixed-height-in-flow.
    sticky: boolean
}

export function SeriesContentPanel({series, sticky}: Props) {
    const outerClass = sticky
        ? 'sticky top-4 flex flex-col min-h-[480px] h-[calc(100vh-120px)]'
        : 'flex flex-col min-h-[320px] h-[min(70vh,540px)]'

    if (series.has_tex) {
        return (
            <div className={outerClass}>
                <TexPanel seriesID={series.id}/>
            </div>
        )
    }
    if (series.has_pdf) {
        return (
            <div className={outerClass}>
                <PDFPanelInner seriesID={series.id}/>
            </div>
        )
    }
    return (
        <div className={outerClass}>
            <Placeholder>Серия пока не опубликована.</Placeholder>
        </div>
    )
}

function TexPanel({seriesID}: {seriesID: number}) {
    const {authedFetch} = useAuth()
    const [tex, setTex] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        let cancelled = false
        setError(null)
        setTex(null)
        getSeriesTex(authedFetch, seriesID)
            .then(t => {
                if (!cancelled) setTex(t)
            })
            .catch(e => {
                if (!cancelled) setError(e instanceof Error ? e.message : 'Не удалось загрузить TeX')
            })
        return () => {
            cancelled = true
        }
    }, [seriesID, authedFetch])

    if (error) return <Placeholder tone="danger">{error}</Placeholder>
    if (tex === null) return <Placeholder>Загружаем TeX…</Placeholder>
    // The outer wrapper from the caller (sticky vs flow) already sets
    // the height; we just claim the available space and scroll inside.
    return (
        <div className="flex-1 overflow-auto rounded-lg border border-card-border bg-white px-4">
            <TexViewer tex={tex}/>
        </div>
    )
}

function PDFPanelInner({seriesID}: {seriesID: number}) {
    const {authedFetchRaw} = useAuth()
    const [url, setUrl] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        let cancelled = false
        let owned: string | null = null
        setError(null)
        setUrl(null)
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
        }
    }, [seriesID, authedFetchRaw])

    if (error) return <Placeholder tone="danger">{error}</Placeholder>
    if (!url) return <Placeholder>Загрузка PDF…</Placeholder>
    return (
        <iframe
            src={url}
            title="Серия — PDF"
            className="flex-1 w-full border border-card-border rounded-lg bg-white block"
        />
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
