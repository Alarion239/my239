import {useState} from 'react'
import {StyleSheet, Text, View} from 'react-native'
import {Link, useNavigate} from 'react-router-dom'
import {APIErrorImpl} from '../api'
import {useAuth} from '../auth'
import {Button, Card, colors, ErrorBanner, Field, Heading, Subheading} from '../components/ui'

export default function RegisterPage() {
    const {register} = useAuth()
    const navigate = useNavigate()
    const [username, setUsername] = useState('')
    const [password, setPassword] = useState('')
    const [invitation, setInvitation] = useState('')
    const [firstName, setFirstName] = useState('')
    const [lastName, setLastName] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [fields, setFields] = useState<Record<string, string>>({})
    const [submitting, setSubmitting] = useState(false)

    async function onSubmit() {
        setError(null)
        setFields({})
        setSubmitting(true)
        try {
            await register({
                username,
                password,
                invitation_token: invitation,
                first_name: firstName,
                last_name: lastName,
            })
            navigate('/profile')
        } catch (e) {
            if (e instanceof APIErrorImpl) {
                setError(e.message)
                setFields(e.fields ?? {})
            } else {
                setError('Registration failed')
            }
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <View style={s.wrap}>
            <Card style={{width: 420}}>
                <Heading>Create account</Heading>
                <Subheading>You'll need an invitation token from an admin</Subheading>
                {error ? <ErrorBanner message={error}/> : null}
                <Field
                    label="Invitation token"
                    value={invitation}
                    onChangeText={setInvitation}
                    placeholder="paste your token"
                    error={fields.InvitationToken}
                />
                <Field label="Username" value={username} onChangeText={setUsername}
                       placeholder="alphanumeric, 3–50 chars" error={fields.Username}/>
                <Field label="Password" value={password} onChangeText={setPassword} placeholder="min 8 characters"
                       secureTextEntry error={fields.Password}/>
                <Field label="First name" value={firstName} onChangeText={setFirstName} autoCapitalize="sentences"
                       error={fields.FirstName}/>
                <Field label="Last name" value={lastName} onChangeText={setLastName} autoCapitalize="sentences"
                       error={fields.LastName}/>
                <Button title={submitting ? 'Creating account…' : 'Create account'} onPress={onSubmit}
                        disabled={submitting}/>
                <View style={{height: 16}}/>
                <Text style={s.foot}>
                    Already registered?{' '}
                    <Link to="/login" style={{color: colors.primary} as any}>Sign in</Link>
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
