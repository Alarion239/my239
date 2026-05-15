import {useCallback, useEffect, useState} from 'react'
import {Pressable, StyleSheet, Text, View} from 'react-native'
import {APIErrorImpl} from '../../api'
import {
    createSeries,
    deleteSeries,
    downloadSeriesPDF,
    fetchSeriesPDFObjectURL,
    getSeries,
    listSeriesForCenter,
    publishSeries,
    type ProblemSpec,
    type Series,
    type SeriesPayload,
    updateSeries,
} from '../../api/series'
import {useAuth} from '../../auth'
import {formatDateTime} from '../../lib/format'
import {Button, colors, ErrorBanner, Field} from '../ui'

// SeriesPanel is the per-center series UI: list on the left, an inline editor
// or detail on the right. It deliberately keeps everything in one component
// so a teacher can flip between create / edit / view without losing their
// place in the list.

interface Props {
    centerID: number
    isTeacher: boolean
}

type Mode =
    | {kind: 'idle'}
    | {kind: 'view'; id: number}
    | {kind: 'edit'; id: number}
    | {kind: 'create'}

export function SeriesPanel({centerID, isTeacher}: Props) {
    const {authedFetch, authedFetchRaw} = useAuth()
    const [list, setList] = useState<Series[]>([])
    const [error, setError] = useState<string | null>(null)
    const [mode, setMode] = useState<Mode>({kind: 'idle'})
    const [active, setActive] = useState<Series | null>(null)

    const reloadList = useCallback(async () => {
        try {
            // Newest series at the top — matches the student-facing list
            // and matches how the teacher actually thinks about psets.
            const raw = await listSeriesForCenter(authedFetch, centerID)
            setList(raw.slice().sort((a, b) => b.number - a.number))
        } catch (e) {
            setError(e instanceof APIErrorImpl ? e.message : 'Не удалось загрузить серии')
        }
    }, [authedFetch, centerID])

    useEffect(() => {
        void reloadList()
    }, [reloadList])

    // When mode points at a specific series id, fetch it (so the detail view
    // can show problems even if the list response someday strips them).
    useEffect(() => {
        if (mode.kind === 'view' || mode.kind === 'edit') {
            const id = mode.id
            getSeries(authedFetch, id)
                .then((s) => setActive(s))
                .catch((e) => setError(e instanceof APIErrorImpl ? e.message : 'Не удалось загрузить серию'))
        } else {
            setActive(null)
        }
    }, [mode, authedFetch])

    return (
        <View style={s.wrap}>
            <View style={s.header}>
                <Text style={s.section}>Серии</Text>
                {isTeacher ? (
                    <Button title="+ Создать серию" onPress={() => setMode({kind: 'create'})}/>
                ) : null}
            </View>

            {error ? <ErrorBanner message={error}/> : null}

            {list.length === 0 ? (
                <Text style={s.muted}>Серий пока нет</Text>
            ) : (
                list.map((row) => (
                    <Pressable
                        key={row.id}
                        // Toggle: a second click on the currently-open series
                        // (whether being viewed or edited) collapses it back
                        // to the idle list. Clicking a different row swaps
                        // the open one.
                        onPress={() => setMode((prev) => {
                            if ((prev.kind === 'view' || prev.kind === 'edit') && prev.id === row.id) {
                                return {kind: 'idle'}
                            }
                            return {kind: 'view', id: row.id}
                        })}
                        style={({pressed}) => [
                            s.row,
                            ((mode.kind === 'view' || mode.kind === 'edit') && mode.id === row.id) && s.rowActive,
                            pressed && {opacity: 0.7},
                        ]}
                    >
                        <View style={{flex: 1}}>
                            <Text style={s.rowTitle}>{row.display_name}</Text>
                            <Text style={s.rowMeta}>
                                до {formatDateTime(row.due_at)} ·{' '}
                                {row.published ? 'опубликована' : 'черновик'}
                                {row.has_pdf ? ' · PDF загружен' : ''}
                            </Text>
                        </View>
                    </Pressable>
                ))
            )}

            {mode.kind === 'create' ? (
                <SeriesEditor
                    title="Новая серия"
                    initial={null}
                    onCancel={() => setMode({kind: 'idle'})}
                    onSubmit={async (payload) => {
                        const created = await createSeries(authedFetch, centerID, payload)
                        await reloadList()
                        setMode({kind: 'view', id: created.id})
                    }}
                />
            ) : null}

            {(mode.kind === 'view' || mode.kind === 'edit') && active ? (
                mode.kind === 'edit' ? (
                    <SeriesEditor
                        title={`Редактирование: ${active.display_name}`}
                        initial={active}
                        onCancel={() => setMode({kind: 'view', id: active.id})}
                        onSubmit={async (payload) => {
                            await updateSeries(authedFetch, active.id, payload)
                            await reloadList()
                            setMode({kind: 'view', id: active.id})
                        }}
                    />
                ) : (
                    <SeriesDetail
                        series={active}
                        isTeacher={isTeacher}
                        onEdit={() => setMode({kind: 'edit', id: active.id})}
                        onDelete={async () => {
                            if (!confirm(`Удалить серию «${active.display_name}»? Это удалит и PDF, если он был загружен.`)) return
                            try {
                                await deleteSeries(authedFetch, active.id)
                                setMode({kind: 'idle'})
                                await reloadList()
                            } catch (e) {
                                setError(e instanceof APIErrorImpl ? e.message : 'Не удалось удалить')
                            }
                        }}
                        onPublish={async (file) => {
                            try {
                                const updated = await publishSeries(authedFetch, active.id, file)
                                setActive(updated)
                                await reloadList()
                            } catch (e) {
                                setError(e instanceof APIErrorImpl ? e.message : 'Не удалось загрузить PDF')
                            }
                        }}
                        onDownload={async () => {
                            try {
                                await downloadSeriesPDF(authedFetchRaw, active)
                            } catch (e) {
                                setError(e instanceof APIErrorImpl ? e.message : 'Не удалось скачать PDF')
                            }
                        }}
                        onFetchPreview={() => fetchSeriesPDFObjectURL(authedFetchRaw, active.id)}
                        onPreviewError={(msg) => setError(msg)}
                    />
                )
            ) : null}
        </View>
    )
}

// SeriesEditor handles both create and edit. The problems list is editable
// inline; subproblem counts use a small +/− stepper because typing 0..26 in a
// text field is far more annoying than nudging a number.
//
// Exported so the consolidated teacher view (TeacherCenterView) can reuse it
// directly without re-implementing the form.
export function SeriesEditor(props: {
    title: string
    initial: Series | null
    onSubmit: (payload: SeriesPayload) => Promise<void>
    onCancel: () => void
}) {
    const {title, initial, onSubmit, onCancel} = props
    const [number, setNumber] = useState(initial ? String(initial.number) : '1')
    const [name, setName] = useState(initial?.name ?? '')
    const [dueAt, setDueAt] = useState(() => toDateTimeLocal(initial?.due_at))
    const [problems, setProblems] = useState<ProblemSpec[]>(() =>
        initial ? initial.problems.map((p) => ({number: p.number, subproblem_count: p.subproblems.length}))
            : [{number: 0, subproblem_count: 0}, {number: 1, subproblem_count: 0}],
    )
    const [error, setError] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)

    function setProblemAt(idx: number, patch: Partial<ProblemSpec>) {
        setProblems((rows) => rows.map((p, i) => (i === idx ? {...p, ...patch} : p)))
    }

    function addProblem() {
        setProblems((rows) => {
            const maxNum = rows.reduce((m, p) => Math.max(m, p.number), 0)
            return [...rows, {number: maxNum + 1, subproblem_count: 0}]
        })
    }

    function removeProblem(idx: number) {
        setProblems((rows) => rows.filter((_, i) => i !== idx))
    }

    async function submit() {
        setError(null)
        const n = parseInt(number, 10)
        if (Number.isNaN(n) || n < 0) {
            setError('Номер серии должен быть неотрицательным числом')
            return
        }
        if (!name.trim()) {
            setError('Название обязательно')
            return
        }
        const due = parseDateTimeLocal(dueAt)
        if (!due) {
            setError('Введите корректную дату/время сдачи')
            return
        }
        if (problems.length === 0) {
            setError('Добавьте хотя бы одну задачу')
            return
        }
        const seen = new Set<number>()
        for (const p of problems) {
            if (p.number < 0) {
                setError('Номер задачи должен быть >= 0')
                return
            }
            if (seen.has(p.number)) {
                setError('Номера задач должны быть уникальны')
                return
            }
            seen.add(p.number)
            if (p.subproblem_count < 0 || p.subproblem_count > 26) {
                setError('Количество подзадач — от 0 до 26')
                return
            }
        }
        setSaving(true)
        try {
            await onSubmit({number: n, name: name.trim(), due_at: due.toISOString(), problems})
        } catch (e) {
            setError(e instanceof APIErrorImpl ? e.message : 'Не удалось сохранить')
        } finally {
            setSaving(false)
        }
    }

    return (
        <View style={s.editor}>
            <Text style={s.subSection}>{title}</Text>
            {error ? <ErrorBanner message={error}/> : null}
            <View style={s.editorRow}>
                <View style={{width: 120}}>
                    <Field label="Номер" value={number} onChangeText={setNumber} placeholder="1"/>
                </View>
                <View style={{width: 16}}/>
                <View style={{flex: 1}}>
                    <Field label="Название" value={name} onChangeText={setName} placeholder="например, Алгебра"/>
                </View>
            </View>
            <Field label="Срок сдачи (ГГГГ-ММ-ДД ЧЧ:ММ)" value={dueAt} onChangeText={setDueAt} placeholder="2026-05-15 18:00"/>

            <Text style={s.subLabel}>Задачи</Text>
            {problems.map((p, idx) => (
                <View key={idx} style={s.problemRow}>
                    <View style={{width: 80}}>
                        <Field
                            label="№"
                            value={String(p.number)}
                            onChangeText={(v) => setProblemAt(idx, {number: parseInt(v, 10) || 0})}
                            placeholder="0"
                        />
                    </View>
                    <View style={{width: 12}}/>
                    <View style={s.stepper}>
                        <Text style={s.stepperLabel}>Подзадач: {p.subproblem_count}</Text>
                        <View style={{flexDirection: 'row', gap: 6} as any}>
                            <Button
                                title="−"
                                variant="secondary"
                                onPress={() => setProblemAt(idx, {subproblem_count: Math.max(0, p.subproblem_count - 1)})}
                            />
                            <Button
                                title="+"
                                variant="secondary"
                                onPress={() => setProblemAt(idx, {subproblem_count: Math.min(26, p.subproblem_count + 1)})}
                            />
                        </View>
                    </View>
                    <View style={{flex: 1}}/>
                    <Button title="Убрать" variant="danger" onPress={() => removeProblem(idx)}/>
                </View>
            ))}
            <View style={{marginTop: 8, marginBottom: 16, alignSelf: 'flex-start'} as any}>
                <Button title="+ Добавить задачу" variant="secondary" onPress={addProblem}/>
            </View>

            <View style={{flexDirection: 'row', gap: 8} as any}>
                <Button title={saving ? 'Сохраняем…' : 'Сохранить'} onPress={submit} disabled={saving}/>
                <Button title="Отмена" variant="secondary" onPress={onCancel}/>
            </View>
        </View>
    )
}

// SeriesDetail is the read-only view. Teachers see edit / delete / upload PDF;
// students see only the download / preview buttons (and only if a PDF exists).
// Exported for use by the consolidated teacher view.
export function SeriesDetail(props: {
    series: Series
    isTeacher: boolean
    onEdit: () => void
    onDelete: () => void
    onPublish: (file: File) => Promise<void>
    onDownload: () => Promise<void>
    onFetchPreview: () => Promise<string>
    onPreviewError: (msg: string) => void
}) {
    const {series, isTeacher, onEdit, onDelete, onPublish, onDownload, onFetchPreview, onPreviewError} = props
    const [uploading, setUploading] = useState(false)
    const [previewURL, setPreviewURL] = useState<string | null>(null)
    const [previewLoading, setPreviewLoading] = useState(false)

    // Object URLs hold the blob in memory until explicitly revoked. The
    // cleanup runs whenever the URL changes (toggle off, replaced, or unmount
    // during series switch) so we never leak a closed-but-unrevoked URL.
    useEffect(() => {
        return () => {
            if (previewURL) URL.revokeObjectURL(previewURL)
        }
    }, [previewURL])

    // A new upload invalidates any open preview — the bytes the user is
    // looking at are now stale.
    useEffect(() => {
        if (!series.has_pdf && previewURL) {
            URL.revokeObjectURL(previewURL)
            setPreviewURL(null)
        }
    }, [series.has_pdf, previewURL])

    function pickAndUpload() {
        // We bypass <input type=file> in JSX (RN-Web won't render it) and
        // create a transient one programmatically — same trick used by most
        // headless file pickers.
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = 'application/pdf'
        input.onchange = async () => {
            const file = input.files?.[0]
            if (!file) return
            setUploading(true)
            try {
                await onPublish(file)
                // Drop the now-stale preview so the next "Просмотреть" pulls fresh bytes.
                if (previewURL) {
                    URL.revokeObjectURL(previewURL)
                    setPreviewURL(null)
                }
            } finally {
                setUploading(false)
            }
        }
        input.click()
    }

    async function togglePreview() {
        if (previewURL) {
            URL.revokeObjectURL(previewURL)
            setPreviewURL(null)
            return
        }
        setPreviewLoading(true)
        try {
            const url = await onFetchPreview()
            setPreviewURL(url)
        } catch (e) {
            onPreviewError(e instanceof APIErrorImpl ? e.message : 'Не удалось открыть PDF')
        } finally {
            setPreviewLoading(false)
        }
    }

    function openInNewTab() {
        // Reuse an existing object URL when one is open; otherwise fetch a
        // fresh one specifically for the new tab. We do NOT revoke the URL
        // we hand to the new tab — revoking would invalidate it before the
        // new window loads. Same-document blob URLs auto-clean on unload.
        if (previewURL) {
            window.open(previewURL, '_blank', 'noopener,noreferrer')
            return
        }
        setPreviewLoading(true)
        onFetchPreview()
            .then((url) => {
                window.open(url, '_blank', 'noopener,noreferrer')
            })
            .catch((e) => onPreviewError(e instanceof APIErrorImpl ? e.message : 'Не удалось открыть PDF'))
            .finally(() => setPreviewLoading(false))
    }

    return (
        <View style={s.detail}>
            <Text style={s.subSection}>{series.display_name}</Text>
            <Text style={s.muted}>Срок сдачи: {formatDateTime(series.due_at)}</Text>
            <Text style={s.muted}>
                Статус: {series.published ? 'опубликована' : 'черновик'}
                {series.has_pdf ? ' · PDF загружен' : ' · PDF не загружен'}
            </Text>

            {/* The problems / subproblems list lives in the spreadsheet
                next to this panel — repeating it here was pure noise.
                Edit mode (SeriesEditor) is where the list becomes
                interactive again. */}

            <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16} as any}>
                {series.has_pdf ? (
                    <>
                        <Button
                            title={previewLoading ? 'Открываем…' : previewURL ? 'Скрыть PDF' : 'Просмотреть PDF'}
                            onPress={togglePreview}
                            disabled={previewLoading}
                        />
                        <Button title="В новой вкладке" variant="secondary" onPress={openInNewTab} disabled={previewLoading}/>
                        <Button title="Скачать PDF" variant="secondary" onPress={onDownload}/>
                    </>
                ) : null}
                {isTeacher ? (
                    <>
                        <Button
                            title={uploading ? 'Загрузка…' : series.has_pdf ? 'Заменить PDF' : 'Загрузить PDF'}
                            variant="secondary"
                            onPress={pickAndUpload}
                            disabled={uploading}
                        />
                        <Button title="Редактировать" variant="secondary" onPress={onEdit}/>
                        <Button title="Удалить серию" variant="danger" onPress={onDelete}/>
                    </>
                ) : null}
            </View>

            {previewURL ? <PDFPreview url={previewURL}/> : null}
        </View>
    )
}

// PDFPreview embeds the browser's native PDF viewer via <iframe>. We use a
// raw HTML iframe (not an RN-Web component) because RNW has no PDF primitive
// — same pattern as Autocomplete's createPortal trick. Height is fixed-but-
// generous so the viewer's own toolbar + first page fit without forcing the
// page to scroll; the viewer paginates internally.
function PDFPreview({url}: {url: string}) {
    return (
        <View style={s.preview}>
            <iframe
                src={url}
                title="Предпросмотр PDF"
                // eslint-disable-next-line react/forbid-dom-props
                style={{width: '100%', height: '100%', border: 'none', display: 'block'}}
            />
        </View>
    )
}

// toDateTimeLocal converts an ISO string to "YYYY-MM-DD HH:MM" in local time —
// matches what parseDateTimeLocal expects. Default falls back to "tomorrow at
// 18:00" so the create form starts with a reasonable due date.
export function toDateTimeLocal(iso?: string | null): string {
    const d = iso ? new Date(iso) : new Date(Date.now() + 24 * 60 * 60 * 1000)
    if (Number.isNaN(d.getTime())) return ''
    const pad = (n: number) => n.toString().padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// parseDateTimeLocal accepts the same shape we render in toDateTimeLocal,
// plus the ISO subset with 'T'. Returns null on anything else so the caller
// can show a validation error instead of silently sending NaN to the server.
export function parseDateTimeLocal(s: string): Date | null {
    const m = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/)
    if (!m) return null
    const [, y, mo, d, h, mi, se] = m
    const dt = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), se ? Number(se) : 0)
    return Number.isNaN(dt.getTime()) ? null : dt
}

const s = StyleSheet.create({
    wrap: {marginTop: 24},
    header: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12},
    section: {
        fontSize: 12,
        fontWeight: '700',
        color: colors.textMuted,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    subSection: {fontSize: 16, fontWeight: '600', color: colors.text, marginBottom: 8},
    subLabel: {
        marginTop: 12,
        marginBottom: 6,
        fontSize: 12,
        fontWeight: '700',
        color: colors.textMuted,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    row: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 8,
        marginBottom: 8,
        backgroundColor: '#fff',
    },
    rowActive: {borderColor: colors.primary, backgroundColor: '#eef2ff'},
    rowTitle: {fontSize: 15, fontWeight: '600', color: colors.text},
    rowMeta: {fontSize: 12, color: colors.textMuted, marginTop: 2},
    muted: {fontSize: 13, color: colors.textMuted, fontStyle: 'italic'},
    editor: {
        marginTop: 16,
        padding: 16,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 8,
        backgroundColor: '#fafbff',
    },
    editorRow: {flexDirection: 'row', alignItems: 'flex-start'},
    problemRow: {flexDirection: 'row', alignItems: 'flex-end', gap: 12, marginBottom: 6} as any,
    stepper: {alignItems: 'flex-start'},
    stepperLabel: {fontSize: 13, color: colors.text, marginBottom: 6},
    detail: {
        marginTop: 16,
        padding: 16,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 8,
        backgroundColor: '#fafbff',
    },
    problemView: {paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border},
    problemTitle: {fontSize: 14, fontWeight: '600', color: colors.text},
    preview: {
        marginTop: 16,
        height: 720,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 8,
        overflow: 'hidden',
        backgroundColor: '#fff',
    },
})
