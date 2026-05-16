// SubmitForm is the photo + text input panel used by:
//   • student submit (kind='student' submit)
//   • student appeal (kind='student' appeal — same form, different endpoint)
//   • teacher grade (kind='grader' with verdict accepted/rejected)
//
// The presigned-PUT handshake is encapsulated in api/homework.uploadPhotos
// so this component just glues file picking → upload → finalize together.

import {useState} from 'react'
import {APIErrorImpl} from '../../api'
import {type Verdict, uploadPhotos} from '../../api/homework'
import {useAuth} from '../../auth'
import {Button, ErrorBanner} from '../ui'

export type SubmitFormPurpose = 'submit' | 'appeal' | 'grade'

interface SubmitFormProps {
    purpose: SubmitFormPurpose
    // Where to mint upload URLs and which finalize endpoint to call.
    // For student submit/appeal we pass subproblemID (kind='student');
    // for grade we pass threadID (kind='grader').
    presignKind: 'student' | 'grader'
    presignID: number
    // Called when files + body are ready. Returns when the finalize call
    // resolves so we can clear the form and bubble the new state up.
    onSubmit(args: {event_uuid: string; body: string; object_keys: string[]; verdict?: Verdict}): Promise<void>
    submitLabel: string
    bodyRequired?: boolean
    bodyPlaceholder?: string
    showVerdictControls?: boolean
}

export function SubmitForm(props: SubmitFormProps) {
    const {authedFetch} = useAuth()
    const [body, setBody] = useState('')
    const [files, setFiles] = useState<File[]>([])
    const [verdict, setVerdict] = useState<Verdict | ''>('')
    const [error, setError] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)

    function pickFiles() {
        // The native <input type=file> is the simplest cross-browser
        // way to open the OS file dialog. We programmatically create
        // one rather than rendering it in JSX so the visible
        // "Прикрепить фото" button can stay a normal styled <button>.
        const input = document.createElement('input')
        input.type = 'file'
        input.multiple = true
        input.accept = 'image/jpeg,image/png,image/heic,image/webp'
        input.onchange = () => {
            const list = Array.from(input.files ?? [])
            setFiles(prev => [...prev, ...list].slice(0, 10))
        }
        input.click()
    }

    async function handleSubmit() {
        setError(null)
        if (props.bodyRequired && body.trim() === '') {
            setError('Комментарий обязателен.')
            return
        }
        if (props.showVerdictControls && verdict === '') {
            setError('Выберите вердикт.')
            return
        }
        setBusy(true)
        try {
            const {event_uuid, object_keys} = await uploadPhotos(
                authedFetch, props.presignKind, props.presignID, files,
            )
            await props.onSubmit({
                event_uuid,
                body: body.trim(),
                object_keys,
                verdict: props.showVerdictControls ? (verdict as Verdict) : undefined,
            })
            setBody('')
            setFiles([])
            setVerdict('')
        } catch (e) {
            setError(e instanceof APIErrorImpl ? e.message : 'Не удалось отправить')
        } finally {
            setBusy(false)
        }
    }

    return (
        <div className="flex flex-col gap-3">
            {error ? <ErrorBanner message={error}/> : null}
            {props.showVerdictControls ? (
                <div className="flex gap-2">
                    <VerdictButton
                        label="Принять"
                        active={verdict === 'accepted'}
                        accent="ok"
                        onClick={() => setVerdict('accepted')}
                    />
                    <VerdictButton
                        label="Отклонить"
                        active={verdict === 'rejected'}
                        accent="danger"
                        onClick={() => setVerdict('rejected')}
                    />
                </div>
            ) : null}
            <textarea
                value={body}
                onChange={e => setBody(e.target.value)}
                placeholder={props.bodyPlaceholder ?? 'Комментарий…'}
                className="min-h-[100px] w-full rounded-lg border border-card-border bg-white p-3 text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/30 resize-y"
            />
            <div className="flex items-center gap-3">
                <Button
                    title={`Прикрепить фото (${files.length}/10)`}
                    onPress={pickFiles}
                    variant="secondary"
                />
                {files.length > 0 ? (
                    <button
                        type="button"
                        onClick={() => setFiles([])}
                        className="text-[13px] font-medium text-danger hover:underline"
                    >
                        Очистить
                    </button>
                ) : null}
            </div>
            {files.length > 0 ? (
                <div className="flex flex-col gap-1">
                    {files.map((f, i) => (
                        <span key={`${f.name}-${i}`} className="text-xs text-muted">{f.name}</span>
                    ))}
                </div>
            ) : null}
            <Button
                title={busy ? 'Отправляем…' : props.submitLabel}
                onPress={handleSubmit}
                disabled={busy}
            />
        </div>
    )
}

function VerdictButton({label, active, accent, onClick}: {
    label: string
    active: boolean
    accent: 'ok' | 'danger'
    onClick: () => void
}) {
    const activeClasses = accent === 'ok'
        ? 'bg-ok border-ok text-white'
        : 'bg-danger border-danger text-white'
    return (
        <button
            type="button"
            onClick={onClick}
            className={`rounded-md border border-card-border px-3.5 py-2 text-sm font-semibold transition-colors ${
                active ? activeClasses : 'text-ink hover:bg-page'
            }`}
        >
            {label}
        </button>
    )
}
