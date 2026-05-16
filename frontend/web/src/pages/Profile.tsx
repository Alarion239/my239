import {useAuth} from '../auth'
import {Card, Heading, Subheading} from '../components/ui'

export default function ProfilePage() {
    const {user} = useAuth()
    if (!user) return null

    // ФИО (фамилия, имя, отчество) — пропускаем отсутствующие поля.
    const fullName = [user.last_name, user.first_name, user.middle_name].filter(Boolean).join(' ')

    return (
        <Card className="w-[480px]">
            <Heading>Профиль</Heading>
            <Subheading>Вы вошли как @{user.username}</Subheading>
            <Row label="ФИО" value={fullName || '—'}/>
            <Row label="Логин" value={user.username}/>
            <Row label="Роль" value={user.is_admin ? 'Администратор' : 'Участник'}/>
            <Row label="Дата регистрации" value={new Date(user.created_at).toLocaleString('ru-RU')}/>
        </Card>
    )
}

function Row({label, value}: {label: string; value: string}) {
    return (
        <div className="flex items-center justify-between py-2.5 border-b border-card-border last:border-b-0">
            <span className="text-sm text-muted">{label}</span>
            <span className="text-sm font-medium text-ink">{value}</span>
        </div>
    )
}
