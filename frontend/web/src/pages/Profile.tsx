import {StyleSheet, Text, View} from 'react-native'
import {useAuth} from '../auth'
import {Card, colors, Heading, Subheading} from '../components/ui'

export default function ProfilePage() {
    const {user} = useAuth()
    if (!user) return null

    // ФИО (фамилия, имя, отчество) — пропускаем отсутствующие поля.
    const fullName = [user.last_name, user.first_name, user.middle_name].filter(Boolean).join(' ')

    return (
        <Card style={{width: 480}}>
            <Heading>Профиль</Heading>
            <Subheading>Вы вошли как @{user.username}</Subheading>
            <Row label="ФИО" value={fullName || '—'}/>
            <Row label="Логин" value={user.username}/>
            <Row label="Роль" value={user.is_admin ? 'Администратор' : 'Участник'}/>
            <Row label="Дата регистрации" value={new Date(user.created_at).toLocaleString('ru-RU')}/>
        </Card>
    )
}

function Row({label, value}: { label: string; value: string }) {
    return (
        <View style={s.row}>
            <Text style={s.label}>{label}</Text>
            <Text style={s.value}>{value}</Text>
        </View>
    )
}

const s = StyleSheet.create({
    row: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    label: {color: colors.textMuted, fontSize: 14},
    value: {color: colors.text, fontSize: 14, fontWeight: '500'},
})
