import {useCallback, useEffect, useState} from 'react'
import {APIErrorImpl} from '../api'
import {useAuth, User} from '../auth'
import {Button, Card, ErrorBanner, Heading, Subheading} from '../components/ui'

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
        <Card className="w-[720px]">
            <Heading>Пользователи</Heading>
            <Subheading>{users ? `Всего: ${users.length}` : 'Загрузка…'}</Subheading>
            {error ? <ErrorBanner message={error}/> : null}
            <div className="flex py-2 border-b border-card-border">
                <div className="w-[50px] px-1 text-xs font-semibold uppercase text-muted">ID</div>
                <div className="flex-[2] px-1 text-xs font-semibold uppercase text-muted">ФИО</div>
                <div className="flex-[2] px-1 text-xs font-semibold uppercase text-muted">Логин</div>
                <div className="flex-1 px-1 text-xs font-semibold uppercase text-muted">Роль</div>
                <div className="w-[150px] px-1 text-xs font-semibold uppercase text-muted">Действие</div>
            </div>
            {users?.map((u) => {
                const isSelf = me?.id === u.id
                const fullName = [u.last_name, u.first_name, u.middle_name].filter(Boolean).join(' ')
                return (
                    <div key={u.id} className="flex items-center py-2.5 border-b border-card-border">
                        <div className="w-[50px] px-1 text-sm text-ink">{u.id}</div>
                        <div className="flex-[2] px-1 text-sm text-ink">{fullName}</div>
                        <div className="flex-[2] px-1 text-sm text-ink">@{u.username}</div>
                        <div className={`flex-1 px-1 text-sm ${u.is_admin ? 'text-primary font-semibold' : 'text-ink'}`}>
                            {u.is_admin ? 'Админ' : 'Участник'}
                        </div>
                        <div className="w-[150px] px-1">
                            <Button
                                title={u.is_admin ? 'Снять права' : 'Сделать админом'}
                                variant="secondary"
                                onPress={() => toggleAdmin(u)}
                                disabled={busy === u.id || (isSelf && u.is_admin)}
                            />
                        </div>
                    </div>
                )
            })}
        </Card>
    )
}
