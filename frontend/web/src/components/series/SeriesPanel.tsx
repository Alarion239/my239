import {useCallback, useEffect, useState} from 'react'
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
import {Button, ErrorBanner, Field} from '../ui'

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

const sectionClass = 'text-xs font-bold uppercase tracking-wide text-muted'
const subSectionClass = 'text-base font-semibold text-ink mb-2'
const subLabelClass = 'mt-3 mb-1.5 text-xs font-bold uppercase tracking-wide text-muted'
const mutedClass = 'text-[13px] italic text-muted'
const boxClass = 'mt-4 p-4 border border-card-border rounded-lg bg-[#fafbff]'

export function SeriesPanel({centerID, isTeacher}: Props) {
    const {authedFetch, authedFetchRaw} = useAuth()
    const [list, setList] = useState<Series[]>([])
    const [error, setError] = useState<string | null>(null)
    const [mode, setMode] = useState<Mode>({kind: 'idle'})
    const [active, setActive] = useState<Series | null>(null)

    const reloadList = useCallback(async () => {
        try {
            const raw = await listSeriesForCenter(authedFetch, centerID)
            setList(raw.slice().sort((a, b) => b.number - a.number))
        } catch (e) {
            setError(e instanceof APIErrorImpl ? e.message : 'Не удалось загрузить серии')
        }
    }, [authedFetch, centerID])

    useEffect(() => {
        void reloadList()
    }, [reloadList])

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
        <div className="mt-6">
            <div className="flex justify-between items-center mb-3">
                <p className={sectionClass}>Серии</p>
                {isTeacher ? (
                    <Button title="+ Создать серию" onPress={() => setMode({kind: 'create'})}/>
                ) : null}
            </div>

            {error ? <ErrorBanner message={error}/> : null}

            {list.length === 0 ? (
                <p className={mutedClass}>Серий пока нет</p>
            ) : (
                list.map((row) => {
                    const isActive = (mode.kind === 'view' || mode.kind === 'edit') && mode.id === row.id
                    return (
                        <button
                            type="button"
                            key={row.id}
                            onClick={() => setMode((prev) => {
                                if ((prev.kind === 'view' || prev.kind === 'edit') && prev.id === row.id) {
                                    return {kind: 'idle'}
                                }
                                return {kind: 'view', id: row.id}
                            })}
                            className={`w-full flex justify-between items-center py-2.5 px-3 border rounded-lg mb-2 text-left transition-colors ${
                                isActive
                                    ? 'border-primary bg-[#eef2ff]'
                                    : 'border-card-border bg-white hover:bg-page'
                            }`}
                        >
                            <div className="flex-1">
                                <p className="text-[15px] font-semibold text-ink">{row.display_name}</p>
                                <p className="text-xs text-muted mt-0.5">
                                    до {formatDateTime(row.due_at)} ·{' '}
                                    {row.published ? 'опубликована' : 'черновик'}
                                    {row.has_pdf ? ' · PDF загружен' : ''}
                                </p>
                            </div>
                        </button>
                    )
                })
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
        </div>
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
        <div className={boxClass}>
            <p className={subSectionClass}>{title}</p>
            {error ? <ErrorBanner message={error}/> : null}
            <div className="flex items-start gap-4">
                <div className="w-[120px]">
                    <Field label="Номер" value={number} onChangeText={setNumber} placeholder="1"/>
                </div>
                <div className="flex-1">
                    <Field label="Название" value={name} onChangeText={setName} placeholder="например, Алгебра"/>
                </div>
            </div>
            <Field
                label="Срок сдачи (ГГГГ-ММ-ДД ЧЧ:ММ)"
                value={dueAt}
                onChangeText={setDueAt}
                placeholder="2026-05-15 18:00"
            />

            <p className={subLabelClass}>Задачи</p>
            {problems.map((p, idx) => (
                <div key={idx} className="flex items-end gap-3 mb-1.5">
                    <div className="w-[80px]">
                        <Field
                            label="№"
                            value={String(p.number)}
                            onChangeText={(v) => setProblemAt(idx, {number: parseInt(v, 10) || 0})}
                            placeholder="0"
                        />
                    </div>
                    <div className="pb-3 flex flex-col items-start">
                        <p className="text-[13px] text-ink mb-1.5">Подзадач: {p.subproblem_count}</p>
                        <div className="flex gap-1.5">
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
                        </div>
                    </div>
                    <div className="flex-1"/>
                    <div className="pb-3">
                        <Button title="Убрать" variant="danger" onPress={() => removeProblem(idx)}/>
                    </div>
                </div>
            ))}
            <div className="mt-2 mb-4">
                <Button title="+ Добавить задачу" variant="secondary" onPress={addProblem}/>
            </div>

            <div className="flex gap-2">
                <Button title={saving ? 'Сохраняем…' : 'Сохранить'} onPress={submit} disabled={saving}/>
                <Button title="Отмена" variant="secondary" onPress={onCancel}/>
            </div>
        </div>
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

    // Object URLs hold the blob in memory until explicitly revoked.
    useEffect(() => {
        return () => {
            if (previewURL) URL.revokeObjectURL(previewURL)
        }
    }, [previewURL])

    // A new upload invalidates any open preview.
    useEffect(() => {
        if (!series.has_pdf && previewURL) {
            URL.revokeObjectURL(previewURL)
            setPreviewURL(null)
        }
    }, [series.has_pdf, previewURL])

    function pickAndUpload() {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = 'application/pdf'
        input.onchange = async () => {
            const file = input.files?.[0]
            if (!file) return
            setUploading(true)
            try {
                await onPublish(file)
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
        // fresh one specifically for the new tab. We do NOT revoke the URL we
        // hand to the new tab — revoking would invalidate it before the new
        // window loads. Same-document blob URLs auto-clean on unload.
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
        <div className={boxClass}>
            <p className={subSectionClass}>{series.display_name}</p>
            <p className={mutedClass}>Срок сдачи: {formatDateTime(series.due_at)}</p>
            <p className={mutedClass}>
                Статус: {series.published ? 'опубликована' : 'черновик'}
                {series.has_pdf ? ' · PDF загружен' : ' · PDF не загружен'}
            </p>

            <div className="flex flex-wrap gap-2 mt-4">
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
            </div>

            {previewURL ? <PDFPreview url={previewURL}/> : null}
        </div>
    )
}

// PDFPreview embeds the browser's native PDF viewer via <iframe>. Height is
// fixed-but-generous so the viewer's toolbar + first page fit without
// forcing the page to scroll; the viewer paginates internally.
function PDFPreview({url}: {url: string}) {
    return (
        <div className="mt-4 h-[720px] border border-card-border rounded-lg overflow-hidden bg-white">
            <iframe
                src={url}
                title="Предпросмотр PDF"
                className="w-full h-full block"
                style={{border: 'none'}}
            />
        </div>
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
