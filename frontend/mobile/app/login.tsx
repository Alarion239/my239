// Login screen — outside the (tabs) group so it can render without
// the bottom-tab chrome and without requiring auth. The root layout
// gate redirects unauthenticated users here and authenticated users
// away to /(tabs).

import {useState} from 'react'
import {KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View} from 'react-native'
import {APIErrorImpl} from '@my239/shared/api/http'
import {useAuth} from '@/lib/auth'

export default function LoginScreen() {
    const {login} = useAuth()
    const [username, setUsername] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)

    async function submit() {
        if (!username || !password) {
            setError('Введите логин и пароль.')
            return
        }
        setBusy(true)
        setError(null)
        try {
            await login(username, password)
            // Navigation happens automatically — the root AuthGate
            // moves us into (tabs) when `user` flips to non-null.
        } catch (e) {
            setError(e instanceof APIErrorImpl ? e.message : 'Не удалось войти')
        } finally {
            setBusy(false)
        }
    }

    return (
        <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={s.root}
        >
            <View style={s.card}>
                <Text style={s.title}>Вход</Text>
                <Text style={s.subtitle}>my239</Text>

                {error ? (
                    <View style={s.errorBanner}>
                        <Text style={s.errorBannerText}>{error}</Text>
                    </View>
                ) : null}

                <View style={s.field}>
                    <Text style={s.label}>Логин</Text>
                    <TextInput
                        value={username}
                        onChangeText={setUsername}
                        autoCapitalize="none"
                        autoCorrect={false}
                        placeholder="alice"
                        placeholderTextColor="#9ca3af"
                        style={s.input}
                    />
                </View>

                <View style={s.field}>
                    <Text style={s.label}>Пароль</Text>
                    <TextInput
                        value={password}
                        onChangeText={setPassword}
                        secureTextEntry
                        placeholder="••••••••"
                        placeholderTextColor="#9ca3af"
                        style={s.input}
                    />
                </View>

                <Pressable
                    onPress={submit}
                    disabled={busy}
                    style={({pressed}) => [
                        s.button,
                        pressed && !busy && {backgroundColor: '#1e40af'},
                        busy && {opacity: 0.6},
                    ]}
                >
                    <Text style={s.buttonText}>{busy ? 'Входим…' : 'Войти'}</Text>
                </Pressable>
            </View>
        </KeyboardAvoidingView>
    )
}

const s = StyleSheet.create({
    root: {flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f5f6f8', padding: 24},
    card: {
        width: '100%',
        maxWidth: 420,
        backgroundColor: '#ffffff',
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#e1e4ea',
        padding: 24,
        gap: 8,
    },
    title: {fontSize: 24, fontWeight: '700', color: '#1f2933'},
    subtitle: {fontSize: 14, color: '#6b7280', marginBottom: 12},
    field: {gap: 6},
    label: {fontSize: 13, fontWeight: '500', color: '#1f2933'},
    input: {
        borderWidth: 1,
        borderColor: '#e1e4ea',
        borderRadius: 8,
        paddingVertical: 11,
        paddingHorizontal: 12,
        fontSize: 16,
        color: '#1f2933',
        backgroundColor: '#fff',
    },
    button: {
        backgroundColor: '#2563eb',
        borderRadius: 8,
        paddingVertical: 12,
        alignItems: 'center',
        marginTop: 12,
    },
    buttonText: {color: '#fff', fontSize: 16, fontWeight: '600'},
    errorBanner: {
        backgroundColor: '#fef2f2',
        borderColor: '#fecaca',
        borderWidth: 1,
        borderRadius: 8,
        padding: 10,
    },
    errorBannerText: {color: '#dc2626', fontSize: 13},
})
