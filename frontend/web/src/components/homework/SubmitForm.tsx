// SubmitForm is the photo + text input panel used by:
//   • student submit (kind='student' submit)
//   • student appeal (kind='student' appeal — same form, different endpoint)
//   • teacher grade (kind='grader' with verdict accepted/rejected)
//
// The presigned-PUT handshake is encapsulated in api/homework.uploadPhotos
// so this component just glues file picking → upload → finalize together.

import {useState} from 'react'
import {Pressable, StyleSheet, Text, TextInput, View} from 'react-native'
import {APIErrorImpl} from '../../api'
import {Verdict, uploadPhotos} from '../../api/homework'
import {useAuth} from '../../auth'
import {Button, colors, ErrorBanner} from '../ui'

export type SubmitFormPurpose = 'submit' | 'appeal' | 'grade'

interface SubmitFormProps {
    purpose: SubmitFormPurpose
    // Where to mint upload URLs and which finalize endpoint to call. For
    // student submit/appeal we pass subproblemID (kind='student'); for
    // grade we pass threadID (kind='grader').
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
        // The native <input type=file> is the only reliable cross-browser
        // way to open the OS file dialog; React Native Web doesn't expose
        // an equivalent component.
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
            // 1. Mint URLs + upload (uploadPhotos handles the no-photos case
            //    by minting a UUID without a server roundtrip).
            const {event_uuid, object_keys} = await uploadPhotos(
                authedFetch, props.presignKind, props.presignID, files,
            )
            // 2. Hand off to the caller, who runs the finalize endpoint.
            await props.onSubmit({
                event_uuid,
                body: body.trim(),
                object_keys,
                verdict: props.showVerdictControls ? (verdict as Verdict) : undefined,
            })
            // Reset the form on success so the next attempt starts clean.
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
        <View style={s.root}>
            {error ? <ErrorBanner message={error}/> : null}
            {props.showVerdictControls ? (
                <View style={s.verdictRow}>
                    <VerdictButton
                        label="Принять"
                        active={verdict === 'accepted'}
                        accent="#15803d"
                        onPress={() => setVerdict('accepted')}
                    />
                    <VerdictButton
                        label="Отклонить"
                        active={verdict === 'rejected'}
                        accent="#dc2626"
                        onPress={() => setVerdict('rejected')}
                    />
                </View>
            ) : null}
            <TextInput
                style={s.textarea}
                placeholder={props.bodyPlaceholder ?? 'Комментарий…'}
                placeholderTextColor={colors.textMuted}
                multiline
                value={body}
                onChangeText={setBody}
            />
            <View style={s.fileBar}>
                <Button title={`Прикрепить фото (${files.length}/10)`} onPress={pickFiles} variant="secondary"/>
                {files.length > 0 ? (
                    <Pressable onPress={() => setFiles([])}>
                        <Text style={s.clearLink}>Очистить</Text>
                    </Pressable>
                ) : null}
            </View>
            {files.length > 0 ? (
                <View style={s.fileList}>
                    {files.map((f, i) => (
                        <Text key={`${f.name}-${i}`} style={s.fileItem}>{f.name}</Text>
                    ))}
                </View>
            ) : null}
            <Button
                title={busy ? 'Отправляем…' : props.submitLabel}
                onPress={handleSubmit}
                disabled={busy}
            />
        </View>
    )
}

function VerdictButton({label, active, accent, onPress}: {label: string; active: boolean; accent: string; onPress: () => void}) {
    return (
        <Pressable
            onPress={onPress}
            style={({pressed}) => [
                s.verdictBtn,
                active && {backgroundColor: accent, borderColor: accent},
                pressed && {opacity: 0.85},
            ]}
        >
            <Text style={[s.verdictText, active && {color: '#fff'}]}>{label}</Text>
        </Pressable>
    )
}

const s = StyleSheet.create({
    root: {gap: 12} as any,
    textarea: {
        minHeight: 100,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 8,
        padding: 12,
        fontSize: 14,
        color: colors.text,
        backgroundColor: '#fff',
        textAlignVertical: 'top',
    },
    fileBar: {flexDirection: 'row', alignItems: 'center', gap: 12} as any,
    clearLink: {fontSize: 13, color: colors.danger, fontWeight: '500'},
    fileList: {gap: 4} as any,
    fileItem: {fontSize: 12, color: colors.textMuted},
    verdictRow: {flexDirection: 'row', gap: 8} as any,
    verdictBtn: {
        paddingVertical: 8,
        paddingHorizontal: 14,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: colors.border,
    },
    verdictText: {fontSize: 14, fontWeight: '600', color: colors.text},
})
