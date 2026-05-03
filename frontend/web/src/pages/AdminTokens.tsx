import {useCallback, useEffect, useState} from 'react'
import {Pressable, StyleSheet, Text, View} from 'react-native'
import {APIErrorImpl} from '../api'
import {useAuth} from '../auth'
import {Button, Card, colors, ErrorBanner, Field, Heading, Subheading} from '../components/ui'

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
        <View style={{width: 760, gap: 24} as any}>
            <Card>
                <Heading>Создать пригласительный токен</Heading>
                <Subheading>Поделитесь токеном с приглашаемым — после использования или истечения срока он становится
                    невалидным.</Subheading>
                {error ? <ErrorBanner message={error}/> : null}
                <Field label="Описание" value={description} onChangeText={setDescription}
                       placeholder="например, для Алисы" autoCapitalize="sentences"/>
                <View style={s.inline}>
                    <View style={{flex: 1}}>
                        <Field label="Макс. использований" value={maxUses} onChangeText={setMaxUses} placeholder="1–N"/>
                    </View>
                    <View style={{width: 16}}/>
                    <View style={{flex: 1}}>
                        <Field label="Срок действия (ч)" value={expiresHours} onChangeText={setExpiresHours}
                               placeholder="720 = 30 дней"/>
                    </View>
                </View>
                <Button title={creating ? 'Создаём…' : 'Создать токен'} onPress={createToken} disabled={creating}/>
            </Card>

            <Card>
                <Heading>Токены</Heading>
                <Subheading>{tokens ? `Всего: ${tokens.length}` : 'Загрузка…'}</Subheading>
                <View style={s.headerRow}>
                    <Text style={[s.cell, s.cellDesc, s.h]}>Описание</Text>
                    <Text style={[s.cell, s.cellToken, s.h]}>Токен</Text>
                    <Text style={[s.cell, s.cellUses, s.h]}>Исп.</Text>
                    <Text style={[s.cell, s.cellExpiry, s.h]}>Срок</Text>
                    <Text style={[s.cell, s.cellAction, s.h]}>Действие</Text>
                </View>
                {tokens?.map((t) => {
                    const expired = new Date(t.expires_at).getTime() < Date.now()
                    const exhausted = t.uses >= t.max_uses
                    const status = expired ? 'expired' : exhausted ? 'exhausted' : 'active'
                    return (
                        <View key={t.id} style={s.row}>
                            <Text style={[s.cell, s.cellDesc]}>{t.description ||
                                <Text style={{color: colors.textMuted}}>—</Text>}</Text>
                            <Pressable
                                onPress={() => void copyToken(t)}
                                style={[s.cell, s.cellToken]}
                                accessibilityLabel="Скопировать токен"
                            >
                                <Text style={s.tokenText} numberOfLines={1}>
                                    {revealed === t.id ? t.token : maskToken(t.token)}
                                </Text>
                                <Text style={s.tokenHint}>
                                    {copiedId === t.id ? '✓ скопировано' : 'нажмите, чтобы скопировать'}
                                </Text>
                            </Pressable>
                            <Text style={[s.cell, s.cellUses]}>{t.uses}/{t.max_uses}</Text>
                            <View style={[s.cell, s.cellExpiry]}>
                                <Text style={s.expiryText}>{new Date(t.expires_at).toLocaleString('ru-RU')}</Text>
                                <Text
                                    style={[s.statusText, status === 'active' ? {color: colors.ok} : {color: colors.danger}]}>{statusLabels[status]}</Text>
                            </View>
                            <View style={[s.cell, s.cellAction]}>
                                <Button title="Отозвать" variant="danger" onPress={() => revoke(t)}
                                        disabled={status !== 'active'}/>
                            </View>
                        </View>
                    )
                })}
            </Card>
        </View>
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

const s = StyleSheet.create({
    inline: {flexDirection: 'row'},
    headerRow: {
        flexDirection: 'row',
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    cell: {fontSize: 14, color: colors.text, paddingHorizontal: 4},
    h: {fontWeight: '600', color: colors.textMuted, fontSize: 12, textTransform: 'uppercase'},
    cellDesc: {flex: 2},
    cellToken: {flex: 2},
    cellUses: {width: 70},
    cellExpiry: {flex: 2},
    cellAction: {width: 110},
    tokenText: {fontFamily: 'monospace', fontSize: 13, color: colors.text},
    tokenHint: {fontSize: 10, color: colors.textMuted, marginTop: 2},
    expiryText: {fontSize: 13, color: colors.text},
    statusText: {fontSize: 11, fontWeight: '600', textTransform: 'uppercase'},
})
