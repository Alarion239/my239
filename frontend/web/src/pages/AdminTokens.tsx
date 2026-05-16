import {useCallback, useEffect, useState} from 'react'
import {APIErrorImpl} from '../api'
import {useAuth} from '../auth'
import {Button, Card, ErrorBanner, Field, Heading, Subheading} from '../components/ui'

interface TokenView {
    id: number
    token: string
    description: string
    max_uses: number
    uses: number
    expires_at: string
    created_at: string
}

export default function AdminTokensPage() {
    const {authedFetch} = useAuth()
    const [tokens, setTokens] = useState<TokenView[] | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [revealed, setRevealed] = useState<number | null>(null)

    const [description, setDescription] = useState('')
    const [maxUses, setMaxUses] = useState('5')
    const [expiresHours, setExpiresHours] = useState('720')
    const [creating, setCreating] = useState(false)
    // copiedId flashes a "Copied!" label on the row whose token was just put on
    // the clipboard. Cleared after 2s so subsequent clicks re-trigger feedback.
    const [copiedId, setCopiedId] = useState<number | null>(null)

    async function copyToken(t: TokenView) {
        // Reveal the row so the user sees what landed in their clipboard, even
        // if the clipboard write fails on some unsupported browser.
        setRevealed(t.id)
        try {
            // navigator.clipboard requires a secure context (https or localhost) —
            // both apply here. The fallback handles older browsers where it's missing.
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(t.token)
            } else {
                legacyCopy(t.token)
            }
            setCopiedId(t.id)
            window.setTimeout(() => setCopiedId((id) => (id === t.id ? null : id)), 2000)
        } catch (e) {
            setError(e instanceof Error ? `Не удалось скопировать: ${e.message}` : 'Не удалось скопировать')
        }
    }

    const load = useCallback(async () => {
        try {
            const list = await authedFetch<TokenView[]>('/admin/tokens')
            setTokens(list)
        } catch (e) {
            setError(e instanceof APIErrorImpl ? e.message : 'Не удалось загрузить токены')
        }
    }, [authedFetch])

    useEffect(() => {
        void load()
    }, [load])

    async function createToken() {
        setError(null)
        setCreating(true)
        try {
            const m = parseInt(maxUses, 10)
            const h = parseInt(expiresHours, 10)
            if (!m || !h) throw new APIErrorImpl({status: 0, message: 'Заполните «Макс. использований» и «Срок действия»'})
            const created = await authedFetch<TokenView>('/admin/tokens', {
                body: {description, max_uses: m, expires_in_hours: h},
            })
            setRevealed(created.id)
            setDescription('')
            await load()
        } catch (e) {
            setError(e instanceof APIErrorImpl ? e.message : 'Не удалось создать токен')
        } finally {
            setCreating(false)
        }
    }

    async function revoke(t: TokenView) {
        setError(null)
        try {
            await authedFetch(`/admin/tokens/${t.id}`, {method: 'DELETE'})
            await load()
        } catch (e) {
            setError(e instanceof APIErrorImpl ? e.message : 'Не удалось отозвать')
        }
    }

    const statusLabels: Record<string, string> = {active: 'активен', expired: 'истёк', exhausted: 'исчерпан'}

    return (
        <div className="w-[760px] flex flex-col gap-6">
            <Card>
                <Heading>Создать пригласительный токен</Heading>
                <Subheading>
                    Поделитесь токеном с приглашаемым — после использования или истечения срока он становится невалидным.
                </Subheading>
                {error ? <ErrorBanner message={error}/> : null}
                <Field
                    label="Описание"
                    value={description}
                    onChangeText={setDescription}
                    placeholder="например, для Алисы"
                    autoCapitalize="sentences"
                />
                <div className="flex gap-4">
                    <div className="flex-1">
                        <Field label="Макс. использований" value={maxUses} onChangeText={setMaxUses} placeholder="1–N"/>
                    </div>
                    <div className="flex-1">
                        <Field
                            label="Срок действия (ч)"
                            value={expiresHours}
                            onChangeText={setExpiresHours}
                            placeholder="720 = 30 дней"
                        />
                    </div>
                </div>
                <Button title={creating ? 'Создаём…' : 'Создать токен'} onPress={createToken} disabled={creating}/>
            </Card>

            <Card>
                <Heading>Токены</Heading>
                <Subheading>{tokens ? `Всего: ${tokens.length}` : 'Загрузка…'}</Subheading>
                <div className="flex py-2 border-b border-card-border">
                    <div className="flex-[2] px-1 text-xs font-semibold uppercase text-muted">Описание</div>
                    <div className="flex-[2] px-1 text-xs font-semibold uppercase text-muted">Токен</div>
                    <div className="w-[70px] px-1 text-xs font-semibold uppercase text-muted">Исп.</div>
                    <div className="flex-[2] px-1 text-xs font-semibold uppercase text-muted">Срок</div>
                    <div className="w-[110px] px-1 text-xs font-semibold uppercase text-muted">Действие</div>
                </div>
                {tokens?.map((t) => {
                    const expired = new Date(t.expires_at).getTime() < Date.now()
                    const exhausted = t.uses >= t.max_uses
                    const status = expired ? 'expired' : exhausted ? 'exhausted' : 'active'
                    return (
                        <div key={t.id} className="flex items-center py-2.5 border-b border-card-border">
                            <div className="flex-[2] px-1 text-sm text-ink">
                                {t.description || <span className="text-muted">—</span>}
                            </div>
                            <button
                                type="button"
                                onClick={() => void copyToken(t)}
                                aria-label="Скопировать токен"
                                className="flex-[2] px-1 text-left hover:bg-page rounded"
                            >
                                <p className="text-[13px] font-mono text-ink truncate">
                                    {revealed === t.id ? t.token : maskToken(t.token)}
                                </p>
                                <p className="text-[10px] text-muted mt-0.5">
                                    {copiedId === t.id ? '✓ скопировано' : 'нажмите, чтобы скопировать'}
                                </p>
                            </button>
                            <div className="w-[70px] px-1 text-sm text-ink">{t.uses}/{t.max_uses}</div>
                            <div className="flex-[2] px-1">
                                <p className="text-[13px] text-ink">{new Date(t.expires_at).toLocaleString('ru-RU')}</p>
                                <p className={`text-[11px] font-semibold uppercase ${status === 'active' ? 'text-ok' : 'text-danger'}`}>
                                    {statusLabels[status]}
                                </p>
                            </div>
                            <div className="w-[110px] px-1">
                                <Button title="Отозвать" variant="danger" onPress={() => revoke(t)}
                                        disabled={status !== 'active'}/>
                            </div>
                        </div>
                    )
                })}
            </Card>
        </div>
    )
}

function maskToken(t: string): string {
    if (t.length <= 12) return '•'.repeat(t.length)
    return t.slice(0, 6) + '…' + t.slice(-4)
}

// legacyCopy is the fallback for browsers that don't expose
// navigator.clipboard (HTTP origins, older Safari). We create an off-screen
// textarea, select its content, and ask the document to execute "copy".
function legacyCopy(text: string) {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
}
