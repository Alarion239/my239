// TeacherCenterView is the teacher hub for a single math center: the
// all-series spreadsheet on the right and the selected series's
// rendered content on the left. The side panel is purely a viewer —
// series control (create/edit/delete) will live on a separate
// admin-gated page.
//
// Content rendering preference: TeX > PDF > "no content" message. The
// TeX renderer is lazy-loaded, so series that only have a PDF skip the
// LaTeX.js download entirely.
//
// On mount we auto-select the earliest series whose due date is still
// in the future, so the teacher lands on the pset they're most likely
// about to grade without an extra click.

import {useCallback, useEffect, useRef, useState} from 'react'
import {Link} from 'react-router-dom'
import {APIErrorImpl} from '../../api'
import {
    fetchSeriesPDFObjectURL,
    getSeriesTex,
    listSeriesForCenter,
    type Series,
} from '../../api/series'
import {useAuth} from '../../auth'
import {formatDateTime} from '../../lib/format'
import {Card, ErrorBanner, Subheading} from '../ui'
import {TeacherGrid, type TeacherGridHandle} from './TeacherGrid'
import {TexViewer} from '../series/TexViewer'

const tightCardClass = '!py-3.5 !px-[18px]'

export function TeacherCenterView({centerID}: {centerID: number}) {
    const {user, authedFetch, authedFetchRaw} = useAuth()

    const [seriesList, setSeriesList] = useState<Series[] | null>(null)
    const [selectedID, setSelectedID] = useState<number | null>(null)
    const [error, setError] = useState<string | null>(null)
    const gridRef = useRef<TeacherGridHandle | null>(null)
    const [userPicked, setUserPicked] = useState(false)

    const loadSeries = useCallback(async () => {
        try {
            const list = await listSeriesForCenter(authedFetch, centerID)
            setSeriesList(list)
        } catch (e) {
            setError(e instanceof APIErrorImpl ? e.message : 'Не удалось загрузить серии')
        }
    }, [authedFetch, centerID])

    useEffect(() => {
        void loadSeries()
    }, [loadSeries])

    // Auto-select: earliest published series with due_at still in the future.
    useEffect(() => {
        if (userPicked || selectedID !== null || !seriesList) return
        const now = Date.now()
        const upcoming = seriesList
            .filter(s => s.published && s.due_at && new Date(s.due_at).getTime() > now)
            .sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime())
        if (upcoming.length > 0) setSelectedID(upcoming[0].id)
    }, [seriesList, selectedID, userPicked])

    const selectedSeries = seriesList?.find(s => s.id === selectedID) ?? null

    return (
        <div className="flex flex-col lg:flex-row gap-4 items-start">
            <div className="w-full lg:basis-0 lg:grow-[38] lg:min-w-[320px]">
                {error ? (
                    <Card className={tightCardClass}>
                        <ErrorBanner message={error}/>
                        <button
                            type="button"
                            onClick={() => setError(null)}
                            className="self-start mt-2 text-[13px] text-primary hover:underline"
                        >
                            Скрыть
                        </button>
                    </Card>
                ) : (
                    <SidePanel
                        series={selectedSeries}
                        seriesList={seriesList}
                        authedFetch={authedFetch}
                        authedFetchRaw={authedFetchRaw}
                        isAdmin={!!user?.is_admin}
                        onError={setError}
                    />
                )}
            </div>
            <div className="w-full lg:basis-0 lg:grow-[62] lg:min-w-[320px]">
                <TeacherGrid
                    ref={gridRef}
                    centerID={centerID}
                    selectedSeriesID={selectedID}
                    onSelectSeries={id => {
                        setUserPicked(true)
                        setSelectedID(id)
                    }}
                />
            </div>
        </div>
    )
}

function SidePanel({series, seriesList, authedFetch, authedFetchRaw, isAdmin, onError}: {
    series: Series | null
    seriesList: Series[] | null
    authedFetch: ReturnType<typeof useAuth>['authedFetch']
    authedFetchRaw: ReturnType<typeof useAuth>['authedFetchRaw']
    isAdmin: boolean
    onError: (msg: string) => void
}) {
    if (!seriesList) {
        return <Card className={tightCardClass}><Subheading>Загрузка серий…</Subheading></Card>
    }
    if (!series) {
        return (
            <Card className={tightCardClass}>
                <Subheading>
                    Нажмите на заголовок серии в таблице справа, чтобы открыть её здесь.
                </Subheading>
            </Card>
        )
    }
    return (
        <Card className={tightCardClass}>
            <div className="flex items-start justify-between gap-3 mb-1">
                <h3 className="text-base font-semibold text-ink">{series.display_name}</h3>
                {isAdmin ? (
                    <Link
                        to={`/admin/series/${series.id}/tex`}
                        className="text-[12px] font-medium text-primary hover:underline shrink-0 mt-1"
                        title="Редактировать TeX"
                    >
                        ✎ TeX
                    </Link>
                ) : null}
            </div>
            <p className="text-[13px] text-muted mb-3">Срок: {formatDateTime(series.due_at)}</p>
            <SeriesContent
                series={series}
                authedFetch={authedFetch}
                authedFetchRaw={authedFetchRaw}
                onError={onError}
            />
        </Card>
    )
}

// SeriesContent picks the right renderer: TeX > PDF > nothing.
function SeriesContent({series, authedFetch, authedFetchRaw, onError}: {
    series: Series
    authedFetch: ReturnType<typeof useAuth>['authedFetch']
    authedFetchRaw: ReturnType<typeof useAuth>['authedFetchRaw']
    onError: (msg: string) => void
}) {
    if (series.has_tex) {
        return <TexSourceLoader seriesID={series.id} authedFetch={authedFetch} onError={onError}/>
    }
    if (series.has_pdf) {
        return <PDFViewer seriesID={series.id} authedFetchRaw={authedFetchRaw} onError={onError}/>
    }
    return <p className="text-[13px] italic text-muted">Для этой серии не загружены ни TeX, ни PDF.</p>
}

// TexSourceLoader fetches the raw .tex (small text payload, no presigned
// dance) and hands it to the lazy-loaded TexViewer.
function TexSourceLoader({seriesID, authedFetch, onError}: {
    seriesID: number
    authedFetch: ReturnType<typeof useAuth>['authedFetch']
    onError: (msg: string) => void
}) {
    const [tex, setTex] = useState<string | null>(null)

    useEffect(() => {
        let cancelled = false
        setTex(null)
        getSeriesTex(authedFetch, seriesID)
            .then(t => {
                if (!cancelled) setTex(t)
            })
            .catch(e => {
                if (!cancelled) onError(e instanceof APIErrorImpl ? e.message : 'Не удалось загрузить TeX')
            })
        return () => {
            cancelled = true
        }
    }, [seriesID, authedFetch, onError])

    if (tex === null) {
        return <p className="text-[13px] italic text-muted">Загружаем TeX…</p>
    }
    // Cap the side-panel render to a viewport-bound scroll area so a
    // very long pset doesn't push the spreadsheet off the page.
    return <TexViewer tex={tex} className="max-h-[720px] overflow-auto pr-1"/>
}

// PDFViewer fetches a fresh blob URL whenever the series changes and
// shows it inline in an <iframe>. Blob URLs are revoked on cleanup so
// switching between series doesn't leak memory.
function PDFViewer({seriesID, authedFetchRaw, onError}: {
    seriesID: number
    authedFetchRaw: ReturnType<typeof useAuth>['authedFetchRaw']
    onError: (msg: string) => void
}) {
    const [url, setUrl] = useState<string | null>(null)

    useEffect(() => {
        let cancelled = false
        let acquired: string | null = null
        setUrl(null)
        fetchSeriesPDFObjectURL(authedFetchRaw, seriesID)
            .then(u => {
                if (cancelled) {
                    URL.revokeObjectURL(u)
                    return
                }
                acquired = u
                setUrl(u)
            })
            .catch(e => {
                if (!cancelled) onError(e instanceof APIErrorImpl ? e.message : 'Не удалось открыть PDF')
            })
        return () => {
            cancelled = true
            if (acquired) URL.revokeObjectURL(acquired)
        }
    }, [seriesID, authedFetchRaw, onError])

    if (!url) {
        return <p className="text-[13px] italic text-muted">Открываем PDF…</p>
    }
    return (
        <div className="h-[720px] border border-card-border rounded-lg overflow-hidden bg-white">
            <iframe
                src={url}
                title="PDF серии"
                className="w-full h-full block"
                style={{border: 'none'}}
            />
        </div>
    )
}
