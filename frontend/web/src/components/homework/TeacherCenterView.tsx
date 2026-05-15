// TeacherCenterView is the unified teacher hub for a single math center:
// the all-series spreadsheet on the right (or below, on phones) and a
// side panel showing the selected series's detail / editor on the left
// (or top). Clicking a series header in the spreadsheet swaps the side
// panel to view that series; the "+" column header opens the create
// form; "Редактировать" on the detail flips to the editor; saving any
// form refreshes both the spreadsheet and the side panel in place.
//
// Replaces what used to live in two separate pages (Матцентр's
// SeriesPanel + Домашка's TeacherGrid) — teachers now do everything
// from one screen.

import {useCallback, useEffect, useRef, useState} from 'react'
import {Pressable, StyleSheet, Text, useWindowDimensions, View} from 'react-native'
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
import {Card, colors, ErrorBanner, Heading, Subheading} from '../ui'
import {TeacherGrid, type TeacherGridHandle} from './TeacherGrid'

const RESPONSIVE_BREAKPOINT = 1000

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

export function TeacherCenterView({centerID, gradeLabel, graduationYear}: {
    centerID: number;
    gradeLabel: string;
    graduationYear: number;
}) {
    const {authedFetch, authedFetchRaw} = useAuth()
    const {width} = useWindowDimensions()
    const wide = width >= RESPONSIVE_BREAKPOINT

    const [mode, setMode] = useState<Mode>({kind: 'idle'})
    // active is the loaded series for view/edit modes. Kept as a
    // separate state from mode so the side panel can render
    // immediately when mode changes while the fetch is in flight.
    const [active, setActive] = useState<Series | null>(null)
    const [error, setError] = useState<string | null>(null)
    const gridRef = useRef<TeacherGridHandle | null>(null)

    // Whenever the mode points at a specific series id, re-fetch the
    // detail. (Re-fetching on every transition is fine — a series row
    // is tiny and the response includes the full problems list.)
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

    // refreshGrid is called after any save/delete so the spreadsheet
    // mirrors the new state without a hard reload.
    const refreshGrid = useCallback(async () => {
        try {
            await gridRef.current?.reload()
        } catch {
            /* the grid's own error path surfaces this */
        }
    }, [])

    const selectedSeriesID = mode.kind === 'view' || mode.kind === 'edit' ? mode.seriesID : null

    // Action handlers wired into SeriesDetail / SeriesEditor —————————

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

    // Side panel content driven by mode ——————————————————————————————

    function renderSidePanel() {
        if (error) {
            return (
                <Card style={s.tightCard}>
                    <ErrorBanner message={error}/>
                    <Pressable onPress={() => setError(null)} style={{alignSelf: 'flex-start', marginTop: 8}}>
                        <Text style={{color: colors.primary, fontSize: 13}}>Скрыть</Text>
                    </Pressable>
                </Card>
            )
        }
        if (mode.kind === 'idle') {
            return (
                <Card style={s.tightCard}>
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
                <Card style={s.tightCard}>
                    <SeriesEditor
                        title="Новая серия"
                        initial={null}
                        onSubmit={handleCreateSubmit}
                        onCancel={() => setMode({kind: 'idle'})}
                    />
                </Card>
            )
        }
        if (!active || active.id !== (mode.kind === 'view' ? mode.seriesID : mode.seriesID)) {
            return <Card style={s.tightCard}><Subheading>Загрузка серии…</Subheading></Card>
        }
        if (mode.kind === 'edit') {
            return (
                <Card style={s.tightCard}>
                    <SeriesEditor
                        title={`Редактирование: ${active.display_name}`}
                        initial={active}
                        onSubmit={p => handleEditSubmit(active.id, p)}
                        onCancel={() => setMode({kind: 'view', seriesID: active.id})}
                    />
                </Card>
            )
        }
        // mode.kind === 'view'
        return (
            <Card style={s.tightCard}>
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

    return (
        <View style={{gap: 12} as any}>
            <Card style={s.tightCard}>
                <Heading>{gradeLabel} — выпуск {graduationYear}</Heading>
                <Subheading>Преподаватель — таблица слева, серия открывается в боковой панели.</Subheading>
            </Card>
            <View style={[s.split, wide ? s.splitRow : s.splitCol]}>
                <View style={wide ? s.sideSlotWide : s.sideSlotNarrow}>
                    {renderSidePanel()}
                </View>
                <View style={wide ? s.gridSlotWide : s.gridSlotNarrow}>
                    <TeacherGrid
                        ref={gridRef}
                        centerID={centerID}
                        selectedSeriesID={selectedSeriesID}
                        onSelectSeries={id => setMode({kind: 'view', seriesID: id})}
                        onCreateSeries={() => setMode({kind: 'create'})}
                    />
                </View>
            </View>
        </View>
    )
}

const s = StyleSheet.create({
    tightCard: {paddingVertical: 14, paddingHorizontal: 18},
    split: {gap: 16} as any,
    splitRow: {flexDirection: 'row', alignItems: 'flex-start'},
    splitCol: {flexDirection: 'column'},
    // ~38/62 split: the spreadsheet usually wants more room because of
    // the many subproblem columns; the side panel needs enough width
    // for the SeriesEditor's form fields.
    sideSlotWide: {flexBasis: 0, flexGrow: 38, minWidth: 320},
    sideSlotNarrow: {width: '100%'},
    gridSlotWide: {flexBasis: 0, flexGrow: 62, minWidth: 320},
    gridSlotNarrow: {width: '100%'},
})
