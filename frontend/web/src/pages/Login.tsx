import {useState} from 'react'
import {StyleSheet, Text, View} from 'react-native'
import {Link, useNavigate} from 'react-router-dom'
import {APIErrorImpl} from '../api'
import {useAuth} from '../auth'
import {Button, Card, colors, ErrorBanner, Field, Heading, Subheading} from '../components/ui'

export default function LoginPage() {
    const {login} = useAuth()
    const navigate = useNavigate()
    const [username, setUsername] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [submitting, setSubmitting] = useState(false)

    async function onSubmit() {
        setError(null)
        setSubmitting(true)
        try {
            await login(username, password)
            navigate('/profile')
        } catch (e) {
            setError(e instanceof APIErrorImpl ? e.message : 'Login failed')
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <View style={s.wrap}>
            <Card style={{width: 380}}>
                <Heading>Sign in</Heading>
                <Subheading>Welcome back to my239</Subheading>
                {error ? <ErrorBanner message={error}/> : null}
                <Field label="Username" value={username} onChangeText={setUsername} placeholder="alice"/>
                <Field label="Password" value={password} onChangeText={setPassword} placeholder="••••••••"
                       secureTextEntry/>
                <Button title={submitting ? 'Signing in…' : 'Sign in'} onPress={onSubmit} disabled={submitting}/>
                <View style={{height: 16}}/>
                <Text style={s.foot}>
                    No account?{' '}
                    <Link to="/register" style={{color: colors.primary} as any}>Register</Link>
                </Text>
            </Card>
        </View>
    )
}

const s = StyleSheet.create({
    wrap: {
        flex: 1,
        minHeight: '100vh' as any,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        backgroundColor: colors.bg,
    },
    foot: {color: colors.textMuted, fontSize: 13, textAlign: 'center'},
})
