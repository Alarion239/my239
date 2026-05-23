// AdminSeriesTex is the temporary home of the series-LaTeX editor while
// we work out the proper "series control" page (which will live behind
// finer-grained teacher rights). Admin-only for now.
//
// Two-pane layout: monospace editor on the left, live LaTeX preview on
// the right. Saves with explicit click rather than autosave so a teacher
// half-way through a `\section` doesn't keep round-tripping to the
// backend.

import {useCallback, useEffect, useMemo, useState} from 'react'
import {useNavigate, useParams} from 'react-router-dom'
import {APIErrorImpl} from '../api'
import {
    deleteSeriesTex,
    getSeries,
    getSeriesTex,
    setSeriesTex,
    type Series,
} from '../api/series'
import {useAuth} from '../auth'
import {Button, Card, ErrorBanner, Heading, Subheading} from '../components/ui'
import {TexViewer} from '../components/series/TexViewer'

const STARTER = `\\documentclass[12pt]{article}
\\usepackage[T2A]{fontenc}
\\usepackage[utf8]{inputenc}
\\usepackage[russian]{babel}
\\usepackage{amsmath,amssymb}

\\begin{document}

\\section*{Серия 1. Алгебра}

Найдите все значения $x$, для которых $x^2 - 5x + 6 = 0$.

\\end{document}
`

export default function AdminSeriesTexPage() {
    const {seriesID: rawID} = useParams<{seriesID: string}>()
    const seriesID = rawID ? Number.parseInt(rawID, 10) : NaN
    const {authedFetch} = useAuth()
    const navigate = useNavigate()

    const [series, setSeries] = useState<Series | null>(null)
    const [source, setSource] = useState<string>('')
    // previewSource is what TexViewer renders. We bump it on Save (and
    // on a debounced "stop typing" trigger below) rather than on every
    // keystroke, because LaTeX.js parse + iframe srcdoc rewrite is too
    // expensive to run on each character.
    const [previewSource, setPreviewSource] = useState<string>('')
    const [error, setError] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)
    const [info, setInfo] = useState<string | null>(null)

    // Debounced live preview: 600ms of idle keystrokes triggers a
    // re-render. Save (button) bypasses the debounce and renders
    // immediately for confirmation.
    useEffect(() => {
        if (source === previewSource) return
        const t = window.setTimeout(() => setPreviewSource(source), 600)
        return () => window.clearTimeout(t)
    }, [source, previewSource])

    const load = useCallback(async () => {
        if (Number.isNaN(seriesID)) {
            setError('Некорректный идентификатор серии')
            return
        }
        try {
            const s = await getSeries(authedFetch, seriesID)
            setSeries(s)
            if (s.has_tex) {
                const tex = await getSeriesTex(authedFetch, seriesID)
                setSource(tex)
                setPreviewSource(tex)
            } else {
                setSource(STARTER)
                setPreviewSource(STARTER)
            }
        } catch (e) {
            setError(e instanceof APIErrorImpl ? e.message : 'Не удалось загрузить серию')
        }
    }, [authedFetch, seriesID])

    useEffect(() => {
        void load()
    }, [load])

    async function save() {
        setError(null)
        setInfo(null)
        setSaving(true)
        try {
            const updated = await setSeriesTex(authedFetch, seriesID, source)
            setSeries(updated)
            setPreviewSource(source)
            setInfo('Сохранено')
        } catch (e) {
            setError(e instanceof APIErrorImpl ? e.message : 'Не удалось сохранить')
        } finally {
            setSaving(false)
        }
    }

    async function removeTex() {
        if (!confirm('Удалить TeX-источник этой серии? PDF, если он был, остаётся.')) return
        setError(null)
        try {
            const updated = await deleteSeriesTex(authedFetch, seriesID)
            setSeries(updated)
            setSource('')
            setPreviewSource('')
            setInfo('TeX удалён')
        } catch (e) {
            setError(e instanceof APIErrorImpl ? e.message : 'Не удалось удалить')
        }
    }

    const sizeKb = useMemo(() => (new Blob([source]).size / 1024).toFixed(1), [source])

    if (Number.isNaN(seriesID)) {
        return <Card className="w-[720px]"><ErrorBanner message="Некорректный идентификатор серии"/></Card>
    }

    return (
        <div className="w-full max-w-[1600px] flex flex-col gap-3">
            <Card className="!py-3.5 !px-[18px]">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div>
                        <Heading>{series ? `Редактор TeX: ${series.display_name}` : 'Загрузка…'}</Heading>
                        <Subheading>
                            Введите полный документ (с преамбулой и {'\\begin{document}'}).
                            Сохранение публикует серию, если она была черновиком.
                        </Subheading>
                    </div>
                    <div className="flex gap-2 items-center">
                        <span className="text-[12px] text-muted">{sizeKb} KiB</span>
                        <Button title="К матцентру" variant="secondary" onPress={() => navigate('/mathcenter')}/>
                        {series?.has_tex ? (
                            <Button title="Удалить TeX" variant="danger" onPress={removeTex}/>
                        ) : null}
                        <Button title={saving ? 'Сохраняем…' : 'Сохранить'} onPress={save} disabled={saving}/>
                    </div>
                </div>
                {error ? <ErrorBanner message={error}/> : null}
                {info ? <p className="text-[13px] text-ok">{info}</p> : null}
            </Card>

            <div className="flex flex-col lg:flex-row gap-3 items-start">
                <div className="w-full lg:basis-0 lg:grow lg:min-w-[320px]">
                    <Card className="!py-3 !px-3">
                        <textarea
                            value={source}
                            onChange={e => setSource(e.target.value)}
                            spellCheck={false}
                            className="w-full h-[720px] font-mono text-[13px] leading-snug p-3 rounded-lg border border-card-border bg-white text-ink focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
                            placeholder="\documentclass{article}…"
                        />
                    </Card>
                </div>
                <div className="w-full lg:basis-0 lg:grow lg:min-w-[320px]">
                    <Card className="!py-3 !px-3">
                        {previewSource ? (
                            <TexViewer tex={previewSource} className="h-[720px] overflow-auto pr-1"/>
                        ) : (
                            <p className="text-[13px] italic text-muted">Введите TeX слева, чтобы увидеть предпросмотр.</p>
                        )}
                    </Card>
                </div>
            </div>
        </div>
    )
}
