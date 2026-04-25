import {StyleSheet, Text, View} from 'react-native'
import {useAuth} from '../auth'
import {Card, colors, Heading, Subheading} from '../components/ui'

export default function ProfilePage() {
    const {user} = useAuth()
    if (!user) return null

    const fullName = [user.first_name, user.middle_name, user.last_name].filter(Boolean).join(' ')

    return (
        <Card style={{width: 480}}>
            <Heading>Profile</Heading>
            <Subheading>Signed in as @{user.username}</Subheading>
            <Row label="Name" value={fullName}/>
            <Row label="Username" value={user.username}/>
            <Row label="Role" value={user.is_admin ? 'Administrator' : 'Member'}/>
            <Row label="Joined" value={new Date(user.created_at).toLocaleString()}/>
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
