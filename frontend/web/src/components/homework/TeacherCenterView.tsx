// TeacherCenterView is the unified teacher hub for a single math
// center: the all-series spreadsheet on the right (or below, on
// phones) and a side panel showing the selected series's detail /
// editor on the left (or top). Clicking a series header in the
// spreadsheet swaps the side panel to view that series; the "+"
// column header opens the create form; "Редактировать" on the detail
// flips to the editor; saving any form refreshes both the spreadsheet
// and the side panel in place.

import {useCallback, useEffect, useRef, useState} from 'react'
import {APIErrorImpl} from '../../api'
import {
    createSeries,
    deleteSeries,
    downloadSeriesPDF,
    fetchSeriesPDFObjectURL,
    getSeries,
    publishSeries,
    type Series,
    type SeriesPayload,
    updateSeries,
} from '../../api/series'
import {useAuth} from '../../auth'
import {SeriesDetail, SeriesEditor} from '../series/SeriesPanel'
import {Card, ErrorBanner, Heading, Subheading} from '../ui'
import {TeacherGrid, type TeacherGridHandle} from './TeacherGrid'

// Mode is what the side panel is currently showing.
//   - 'idle'  : nothing selected, "выберите серию" placeholder
//   - 'view'  : read-only detail for a series
//   - 'edit'  : the SeriesEditor pre-filled with a series's current data
//   - 'create': the SeriesEditor with empty defaults; saves create a row
type Mode =
    | {kind: 'idle'}
    | {kind: 'view'; seriesID: number}
    | {kind: 'edit'; seriesID: number}
    | {kind: 'create'}

const tightCardClass = '!py-3.5 !px-[18px]'

export function TeacherCenterView({centerID, gradeLabel, graduationYear}: {
    centerID: number
    gradeLabel: string
    graduationYear: number
}) {
    const {authedFetch, authedFetchRaw} = useAuth()

    const [mode, setMode] = useState<Mode>({kind: 'idle'})
    // `active` is the loaded series for view/edit modes. Kept separate
    // from `mode` so the side panel can render immediately when mode
    // changes while the fetch is still in flight.
    const [active, setActive] = useState<Series | null>(null)
    const [error, setError] = useState<string | null>(null)
    const gridRef = useRef<TeacherGridHandle | null>(null)

    useEffect(() => {
        if (mode.kind !== 'view' && mode.kind !== 'edit') {
            setActive(null)
            return
        }
        const id = mode.seriesID
        let cancelled = false
        getSeries(authedFetch, id)
            .then(s => {
                if (!cancelled) setActive(s)
            })
            .catch(e => {
                if (!cancelled) setError(e instanceof APIErrorImpl ? e.message : 'Не удалось загрузить серию')
            })
        return () => {
            cancelled = true
        }
    }, [mode, authedFetch])

    const refreshGrid = useCallback(async () => {
        try {
            await gridRef.current?.reload()
        } catch {
            /* grid surfaces its own error */
        }
    }, [])

    const selectedSeriesID = mode.kind === 'view' || mode.kind === 'edit' ? mode.seriesID : null

    async function handleCreateSubmit(payload: SeriesPayload) {
        const s = await createSeries(authedFetch, centerID, payload)
        setMode({kind: 'view', seriesID: s.id})
        await refreshGrid()
    }

    async function handleEditSubmit(seriesID: number, payload: SeriesPayload) {
        const s = await updateSeries(authedFetch, seriesID, payload)
        setActive(s)
        setMode({kind: 'view', seriesID: s.id})
        await refreshGrid()
    }

    async function handleDelete(seriesID: number) {
        if (!confirm('Удалить серию? Это удалит и PDF, если он был загружен.')) return
        try {
            await deleteSeries(authedFetch, seriesID)
            setMode({kind: 'idle'})
            await refreshGrid()
        } catch (e) {
            setError(e instanceof APIErrorImpl ? e.message : 'Не удалось удалить')
        }
    }

    async function handlePublish(seriesID: number, file: File) {
        try {
            const updated = await publishSeries(authedFetch, seriesID, file)
            setActive(updated)
            await refreshGrid()
        } catch (e) {
            setError(e instanceof APIErrorImpl ? e.message : 'Не удалось загрузить PDF')
        }
    }

    async function handleDownload(series: Series) {
        try {
            await downloadSeriesPDF(authedFetchRaw, series)
        } catch (e) {
            setError(e instanceof APIErrorImpl ? e.message : 'Не удалось скачать PDF')
        }
    }

    function handleFetchPreview(seriesID: number) {
        return fetchSeriesPDFObjectURL(authedFetchRaw, seriesID)
    }

    function renderSidePanel() {
        if (error) {
            return (
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
            )
        }
        if (mode.kind === 'idle') {
            return (
                <Card className={tightCardClass}>
                    <Heading>Серии</Heading>
                    <Subheading>
                        Нажмите на заголовок серии в таблице справа, чтобы открыть её здесь.
                        Кнопка «+» в конце строки серий создаст новую.
                    </Subheading>
                </Card>
            )
        }
        if (mode.kind === 'create') {
            return (
                <Card className={tightCardClass}>
                    <SeriesEditor
                        title="Новая серия"
                        initial={null}
                        onSubmit={handleCreateSubmit}
                        onCancel={() => setMode({kind: 'idle'})}
                    />
                </Card>
            )
        }
        if (!active || active.id !== mode.seriesID) {
            return <Card className={tightCardClass}><Subheading>Загрузка серии…</Subheading></Card>
        }
        if (mode.kind === 'edit') {
            return (
                <Card className={tightCardClass}>
                    <SeriesEditor
                        title={`Редактирование: ${active.display_name}`}
                        initial={active}
                        onSubmit={p => handleEditSubmit(active.id, p)}
                        onCancel={() => setMode({kind: 'view', seriesID: active.id})}
                    />
                </Card>
            )
        }
        return (
            <Card className={tightCardClass}>
                <SeriesDetail
                    series={active}
                    isTeacher
                    onEdit={() => setMode({kind: 'edit', seriesID: active.id})}
                    onDelete={() => handleDelete(active.id)}
                    onPublish={file => handlePublish(active.id, file)}
                    onDownload={() => handleDownload(active)}
                    onFetchPreview={() => handleFetchPreview(active.id)}
                    onPreviewError={msg => setError(msg)}
                />
            </Card>
        )
    }

    // ~38/62 split: the spreadsheet usually wants more room because of
    // the many subproblem columns; the side panel needs enough width
    // for the SeriesEditor's form fields. Tailwind's `lg:` breakpoint
    // (1024px) is the boundary between stacked and side-by-side.
    return (
        <div className="flex flex-col gap-3">
            <Card className={tightCardClass}>
                <Heading>{gradeLabel} — выпуск {graduationYear}</Heading>
                <Subheading>Преподаватель — таблица слева, серия открывается в боковой панели.</Subheading>
            </Card>
            <div className="flex flex-col lg:flex-row gap-4 items-start">
                <div className="w-full lg:basis-0 lg:grow-[38] lg:min-w-[320px]">
                    {renderSidePanel()}
                </div>
                <div className="w-full lg:basis-0 lg:grow-[62] lg:min-w-[320px]">
                    <TeacherGrid
                        ref={gridRef}
                        centerID={centerID}
                        selectedSeriesID={selectedSeriesID}
                        onSelectSeries={id => setMode({kind: 'view', seriesID: id})}
                        onCreateSeries={() => setMode({kind: 'create'})}
                    />
                </div>
            </div>
        </div>
    )
}
