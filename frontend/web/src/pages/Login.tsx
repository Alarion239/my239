import {useState} from 'react'
import {Link, useNavigate} from 'react-router-dom'
import {APIErrorImpl} from '../api'
import {useAuth} from '../auth'
import {Button, Card, ErrorBanner, Field, Heading, Subheading} from '../components/ui'

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
            setError(e instanceof APIErrorImpl ? e.message : 'Не удалось войти')
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-page">
            <Card className="w-[380px]">
                <Heading>Вход</Heading>
                <Subheading>Добро пожаловать в my239</Subheading>
                {error ? <ErrorBanner message={error}/> : null}
                <Field label="Логин" value={username} onChangeText={setUsername} placeholder="alice"/>
                <Field
                    label="Пароль"
                    value={password}
                    onChangeText={setPassword}
                    placeholder="••••••••"
                    secureTextEntry
                />
                <Button title={submitting ? 'Входим…' : 'Войти'} onPress={onSubmit} disabled={submitting}/>
                <p className="mt-4 text-[13px] text-muted text-center">
                    Нет аккаунта?{' '}
                    <Link to="/register" className="text-primary hover:underline">Зарегистрироваться</Link>
                </p>
            </Card>
        </div>
    )
}
