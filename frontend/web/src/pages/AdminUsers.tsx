import {useCallback, useEffect, useState} from 'react'
import {StyleSheet, Text, View} from 'react-native'
import {APIErrorImpl} from '../api'
import {useAuth, User} from '../auth'
import {Button, Card, colors, ErrorBanner, Heading, Subheading} from '../components/ui'

export default function AdminUsersPage() {
    const {authedFetch, user: me} = useAuth()
    const [users, setUsers] = useState<User[] | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [busy, setBusy] = useState<number | null>(null)

    const load = useCallback(async () => {
        try {
            const list = await authedFetch<User[]>('/admin/users')
            setUsers(list)
        } catch (e) {
            setError(e instanceof APIErrorImpl ? e.message : 'Не удалось загрузить пользователей')
        }
    }, [authedFetch])

    useEffect(() => {
        void load()
    }, [load])

    async function toggleAdmin(target: User) {
        setError(null)
        setBusy(target.id)
        try {
            await authedFetch(`/admin/users/${target.id}/admin`, {
                method: 'PATCH',
                body: {is_admin: !target.is_admin},
            })
            await load()
        } catch (e) {
            setError(e instanceof APIErrorImpl ? e.message : 'Не удалось обновить')
        } finally {
            setBusy(null)
        }
    }

    return (
        <Card style={{width: 720}}>
            <Heading>Пользователи</Heading>
            <Subheading>{users ? `Всего: ${users.length}` : 'Загрузка…'}</Subheading>
            {error ? <ErrorBanner message={error}/> : null}
            <View style={s.headerRow}>
                <Text style={[s.cell, s.cellId, s.h]}>ID</Text>
                <Text style={[s.cell, s.cellName, s.h]}>ФИО</Text>
                <Text style={[s.cell, s.cellUsername, s.h]}>Логин</Text>
                <Text style={[s.cell, s.cellRole, s.h]}>Роль</Text>
                <Text style={[s.cell, s.cellAction, s.h]}>Действие</Text>
            </View>
            {users?.map((u) => {
                const isSelf = me?.id === u.id
                return (
                    <View key={u.id} style={s.row}>
                        <Text style={[s.cell, s.cellId]}>{u.id}</Text>
                        <Text
                            style={[s.cell, s.cellName]}>
                            {[u.last_name, u.first_name, u.middle_name].filter(Boolean).join(' ')}
                        </Text>
                        <Text style={[s.cell, s.cellUsername]}>@{u.username}</Text>
                        <Text style={[s.cell, s.cellRole, u.is_admin && {color: colors.primary, fontWeight: '600'}]}>
                            {u.is_admin ? 'Админ' : 'Участник'}
                        </Text>
                        <View style={[s.cell, s.cellAction]}>
                            <Button
                                title={u.is_admin ? 'Снять права' : 'Сделать админом'}
                                variant="secondary"
                                onPress={() => toggleAdmin(u)}
                                disabled={busy === u.id || (isSelf && u.is_admin)}
                            />
                        </View>
                    </View>
                )
            })}
        </Card>
    )
}

const s = StyleSheet.create({
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
    cellId: {width: 50},
    cellName: {flex: 2},
    cellUsername: {flex: 2},
    cellRole: {flex: 1},
    cellAction: {width: 150},
})
