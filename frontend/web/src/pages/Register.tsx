import {useState} from 'react'
import {Link, useNavigate} from 'react-router-dom'
import {APIErrorImpl} from '../api'
import {useAuth} from '../auth'
import {Button, Card, ErrorBanner, Field, Heading, Subheading} from '../components/ui'

export default function RegisterPage() {
    const {register} = useAuth()
    const navigate = useNavigate()
    const [username, setUsername] = useState('')
    const [password, setPassword] = useState('')
    const [invitation, setInvitation] = useState('')
    const [firstName, setFirstName] = useState('')
    const [middleName, setMiddleName] = useState('')
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
                middle_name: middleName || undefined,
                last_name: lastName,
            })
            navigate('/profile')
        } catch (e) {
            if (e instanceof APIErrorImpl) {
                setError(e.message)
                setFields(e.fields ?? {})
            } else {
                setError('Не удалось зарегистрироваться')
            }
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-page">
            <Card className="w-[420px]">
                <Heading>Регистрация</Heading>
                <Subheading>Для регистрации нужен пригласительный токен от администратора</Subheading>
                {error ? <ErrorBanner message={error}/> : null}
                <Field
                    label="Пригласительный токен"
                    value={invitation}
                    onChangeText={setInvitation}
                    placeholder="вставьте сюда"
                    error={fields.InvitationToken}
                />
                <Field
                    label="Логин"
                    value={username}
                    onChangeText={setUsername}
                    placeholder="латиница и цифры, 3–50 символов"
                    error={fields.Username}
                />
                <Field
                    label="Пароль"
                    value={password}
                    onChangeText={setPassword}
                    placeholder="минимум 8 символов"
                    secureTextEntry
                    error={fields.Password}
                />
                <Field label="Имя" value={firstName} onChangeText={setFirstName} autoCapitalize="sentences" error={fields.FirstName}/>
                <Field label="Отчество" value={middleName} onChangeText={setMiddleName} autoCapitalize="sentences" error={fields.MiddleName}/>
                <Field label="Фамилия" value={lastName} onChangeText={setLastName} autoCapitalize="sentences" error={fields.LastName}/>
                <Button title={submitting ? 'Создаём аккаунт…' : 'Создать аккаунт'} onPress={onSubmit} disabled={submitting}/>
                <p className="mt-4 text-[13px] text-muted text-center">
                    Уже зарегистрированы?{' '}
                    <Link to="/login" className="text-primary hover:underline">Войти</Link>
                </p>
            </Card>
        </div>
    )
}
