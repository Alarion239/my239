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
            setError(e instanceof Error ? `Copy failed: ${e.message}` : 'Copy failed')
        }
    }

    const load = useCallback(async () => {
        try {
            const list = await authedFetch<TokenView[]>('/admin/tokens')
            setTokens(list)
        } catch (e) {
            setError(e instanceof APIErrorImpl ? e.message : 'Failed to load tokens')
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
            if (!m || !h) throw new APIErrorImpl({status: 0, message: 'max_uses and expires_in_hours are required'})
            const created = await authedFetch<TokenView>('/admin/tokens', {
                body: {description, max_uses: m, expires_in_hours: h},
            })
            setRevealed(created.id)
            setDescription('')
            await load()
        } catch (e) {
            setError(e instanceof APIErrorImpl ? e.message : 'Create failed')
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
            setError(e instanceof APIErrorImpl ? e.message : 'Revoke failed')
        }
    }

    return (
        <View style={{width: 760, gap: 24} as any}>
            <Card>
                <Heading>Create invitation token</Heading>
                <Subheading>Share the resulting token with a single person — it expires after use or after the
                    timeout.</Subheading>
                {error ? <ErrorBanner message={error}/> : null}
                <Field label="Description" value={description} onChangeText={setDescription}
                       placeholder="e.g. for Alice (PM)" autoCapitalize="sentences"/>
                <View style={s.inline}>
                    <View style={{flex: 1}}>
                        <Field label="Max uses" value={maxUses} onChangeText={setMaxUses} placeholder="1–N"/>
                    </View>
                    <View style={{width: 16}}/>
                    <View style={{flex: 1}}>
                        <Field label="Expires (hours)" value={expiresHours} onChangeText={setExpiresHours}
                               placeholder="720 = 30d"/>
                    </View>
                </View>
                <Button title={creating ? 'Creating…' : 'Create token'} onPress={createToken} disabled={creating}/>
            </Card>

            <Card>
                <Heading>Tokens</Heading>
                <Subheading>{tokens ? `${tokens.length} total` : 'Loading…'}</Subheading>
                <View style={s.headerRow}>
                    <Text style={[s.cell, s.cellDesc, s.h]}>Description</Text>
                    <Text style={[s.cell, s.cellToken, s.h]}>Token</Text>
                    <Text style={[s.cell, s.cellUses, s.h]}>Uses</Text>
                    <Text style={[s.cell, s.cellExpiry, s.h]}>Expires</Text>
                    <Text style={[s.cell, s.cellAction, s.h]}>Action</Text>
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
                                // title hint shows on hover in browsers; a small affordance
                                // for users who don't immediately realize the cell is clickable
                                accessibilityLabel="Copy token to clipboard"
                            >
                                <Text style={s.tokenText} numberOfLines={1}>
                                    {revealed === t.id ? t.token : maskToken(t.token)}
                                </Text>
                                <Text style={s.tokenHint}>
                                    {copiedId === t.id ? '✓ copied' : 'click to copy'}
                                </Text>
                            </Pressable>
                            <Text style={[s.cell, s.cellUses]}>{t.uses}/{t.max_uses}</Text>
                            <View style={[s.cell, s.cellExpiry]}>
                                <Text style={s.expiryText}>{new Date(t.expires_at).toLocaleString()}</Text>
                                <Text
                                    style={[s.statusText, status === 'active' ? {color: colors.ok} : {color: colors.danger}]}>{status}</Text>
                            </View>
                            <View style={[s.cell, s.cellAction]}>
                                <Button title="Revoke" variant="danger" onPress={() => revoke(t)}
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
