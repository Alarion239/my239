import {useCallback, useEffect, useMemo, useState} from 'react'
import {StyleSheet, Text, View} from 'react-native'
import {APIErrorImpl} from '../api'
import {useAuth, User} from '../auth'
import {Autocomplete, AutocompleteItem} from '../components/Autocomplete'
import {Button, Card, colors, ErrorBanner, Field, Heading, Subheading} from '../components/ui'

interface Center {
    id: number
    graduation_year: number
}

interface Group {
    id: number
    math_center_id: number
    name: string
}

interface TeacherRow {
    id: number
    user_id: number
    math_center_id: number
    is_head_teacher: boolean
    first_name: string
    middle_name: string | null
    last_name: string
}

interface StudentRow {
    id: number
    user_id: number
    group_id: number
    group_name: string
    first_name: string
    middle_name: string | null
    last_name: string
}

export default function AdminMathCenterPage() {
    const {authedFetch} = useAuth()
    const [centers, setCenters] = useState<Center[]>([])
    const [users, setUsers] = useState<User[]>([])
    const [error, setError] = useState<string | null>(null)
    const [newYear, setNewYear] = useState('')
    const [selectedId, setSelectedId] = useState<number | null>(null)

    const loadCenters = useCallback(async () => {
        try {
            const list = await authedFetch<Center[]>('/admin/mathcenter')
            setCenters(list)
            if (list.length > 0 && selectedId === null) setSelectedId(list[0].id)
        } catch (e) {
            setError(e instanceof APIErrorImpl ? e.message : 'Не удалось загрузить матцентры')
        }
    }, [authedFetch, selectedId])

    const loadUsers = useCallback(async () => {
        try {
            setUsers(await authedFetch<User[]>('/admin/users'))
        } catch {
            // user list is informational only on this page
        }
    }, [authedFetch])

    useEffect(() => {
        void loadCenters()
        void loadUsers()
    }, [loadCenters, loadUsers])

    async function createCenter() {
        setError(null)
        const y = parseInt(newYear, 10)
        if (!y) {
            setError('Введите год выпуска')
            return
        }
        try {
            await authedFetch('/admin/mathcenter', {body: {graduation_year: y}})
            setNewYear('')
            await loadCenters()
        } catch (e) {
            setError(e instanceof APIErrorImpl ? e.message : 'Не удалось создать')
        }
    }

    async function deleteCenter(c: Center) {
        if (!confirm(`Удалить матцентр выпуска ${c.graduation_year}? Это удалит все группы, студентов и преподавателей в нём.`)) return
        try {
            await authedFetch(`/admin/mathcenter/${c.id}`, {method: 'DELETE'})
            if (selectedId === c.id) setSelectedId(null)
            await loadCenters()
        } catch (e) {
            setError(e instanceof APIErrorImpl ? e.message : 'Не удалось удалить')
        }
    }

    return (
        <View style={{width: 900, gap: 24} as any}>
            <Card>
                <Heading>Управление матцентрами</Heading>
                <Subheading>Создавайте матцентры по году выпуска и наполняйте их группами и участниками.</Subheading>
                {error ? <ErrorBanner message={error}/> : null}
                <View style={s.inline}>
                    <View style={{flex: 1}}>
                        <Field label="Год выпуска" value={newYear} onChangeText={setNewYear}
                               placeholder="например, 2027"/>
                    </View>
                    <View style={{width: 16}}/>
                    <View style={{justifyContent: 'flex-end', paddingBottom: 12}}>
                        <Button title="Создать матцентр" onPress={createCenter}/>
                    </View>
                </View>
                <Text style={s.section}>Существующие матцентры</Text>
                {centers.length === 0 ? (
                    <Text style={s.muted}>Пока ничего не создано</Text>
                ) : (
                    centers.map((c) => (
                        <View key={c.id} style={s.row}>
                            <Text style={[s.name, selectedId === c.id && {color: colors.primary, fontWeight: '700'}]}>
                                Выпуск {c.graduation_year}
                            </Text>
                            <View style={{flexDirection: 'row', gap: 8} as any}>
                                <Button title="Открыть" variant="secondary" onPress={() => setSelectedId(c.id)}/>
                                <Button title="Удалить" variant="danger" onPress={() => deleteCenter(c)}/>
                            </View>
                        </View>
                    ))
                )}
            </Card>

            {selectedId !== null && centers.find((c) => c.id === selectedId) ? (
                <CenterDetail
                    key={selectedId}
                    center={centers.find((c) => c.id === selectedId)!}
                    users={users}
                    authedFetch={authedFetch}
                    onError={setError}
                />
            ) : null}
        </View>
    )
}

function CenterDetail(props: {
    center: Center
    users: User[]
    authedFetch: <T>(path: string, opts?: { method?: string; body?: unknown }) => Promise<T>
    onError: (m: string) => void
}) {
    const {center, users, authedFetch, onError} = props
    const [groups, setGroups] = useState<Group[]>([])
    const [teachers, setTeachers] = useState<TeacherRow[]>([])
    const [students, setStudents] = useState<StudentRow[]>([])
    const [newGroup, setNewGroup] = useState('')
    // Selected items from the autocompletes; commit handlers read .id off these
    // and clear the selection on success so the UI is ready for the next add.
    const [studentUser, setStudentUser] = useState<AutocompleteItem | null>(null)
    const [studentGroup, setStudentGroup] = useState<AutocompleteItem | null>(null)
    const [teacherUser, setTeacherUser] = useState<AutocompleteItem | null>(null)
    const [teacherIsHead, setTeacherIsHead] = useState(false)

    const reload = useCallback(async () => {
        try {
            const [g, t, s] = await Promise.all([
                authedFetch<Group[]>(`/admin/mathcenter/${center.id}/groups`),
                authedFetch<TeacherRow[]>(`/admin/mathcenter/${center.id}/teachers`),
                authedFetch<StudentRow[]>(`/admin/mathcenter/${center.id}/students`),
            ])
            setGroups(g)
            setTeachers(t)
            setStudents(s)
        } catch (e) {
            onError(e instanceof APIErrorImpl ? e.message : 'Не удалось загрузить детали')
        }
    }, [authedFetch, center.id, onError])

    useEffect(() => {
        void reload()
    }, [reload])

    const userById = useMemo(() => {
        const m = new Map<number, User>()
        users.forEach((u) => m.set(u.id, u))
        return m
    }, [users])

    // userItems is the autocomplete source for "pick a user". Label is the
    // full ФИО so the admin can search by any part of the name; sublabel
    // shows the username and also participates in matching (so typing
    // "@bob" finds Boris just as well).
    const userItems = useMemo<AutocompleteItem[]>(
        () =>
            users.map((u) => ({
                id: u.id,
                label: [u.last_name, u.first_name, u.middle_name].filter(Boolean).join(' ') || u.username,
                sublabel: '@' + u.username,
            })),
        [users],
    )

    // groupItems lists this center's groups for the student picker.
    const groupItems = useMemo<AutocompleteItem[]>(
        () => groups.map((g) => ({id: g.id, label: 'Группа ' + g.name})),
        [groups],
    )

    async function createGroup() {
        if (!newGroup.trim()) return
        try {
            await authedFetch(`/admin/mathcenter/${center.id}/groups`, {body: {name: newGroup.trim()}})
            setNewGroup('')
            await reload()
        } catch (e) {
            onError(e instanceof APIErrorImpl ? e.message : 'Не удалось создать группу')
        }
    }

    async function deleteGroup(g: Group) {
        if (!confirm(`Удалить группу ${g.name}? Все студенты в ней будут откреплены.`)) return
        try {
            await authedFetch(`/admin/mathcenter/${center.id}/groups/${g.id}`, {method: 'DELETE'})
            await reload()
        } catch (e) {
            onError(e instanceof APIErrorImpl ? e.message : 'Не удалось удалить группу')
        }
    }

    async function addStudent() {
        if (!studentUser || !studentGroup) {
            onError('Выберите пользователя и группу')
            return
        }
        try {
            await authedFetch('/admin/mathcenter/students', {
                body: {user_id: studentUser.id, group_id: studentGroup.id},
            })
            setStudentUser(null)
            // leave studentGroup set: typically the admin adds several students
            // in a row to the same group, this saves a click.
            await reload()
        } catch (e) {
            onError(e instanceof APIErrorImpl ? e.message : 'Не удалось добавить ученика')
        }
    }

    async function removeStudent(s: StudentRow) {
        try {
            await authedFetch(`/admin/mathcenter/students/${s.id}`, {method: 'DELETE'})
            await reload()
        } catch (e) {
            onError(e instanceof APIErrorImpl ? e.message : 'Не удалось убрать')
        }
    }

    async function addTeacher() {
        if (!teacherUser) {
            onError('Выберите пользователя')
            return
        }
        try {
            await authedFetch(`/admin/mathcenter/${center.id}/teachers`, {
                body: {user_id: teacherUser.id, is_head_teacher: teacherIsHead},
            })
            setTeacherUser(null)
            setTeacherIsHead(false)
            await reload()
        } catch (e) {
            onError(e instanceof APIErrorImpl ? e.message : 'Не удалось добавить преподавателя')
        }
    }

    async function toggleHead(t: TeacherRow) {
        try {
            await authedFetch(`/admin/mathcenter/teachers/${t.id}/head`, {
                method: 'PATCH',
                body: {is_head_teacher: !t.is_head_teacher},
            })
            await reload()
        } catch (e) {
            onError(e instanceof APIErrorImpl ? e.message : 'Не удалось обновить')
        }
    }

    async function removeTeacher(t: TeacherRow) {
        try {
            await authedFetch(`/admin/mathcenter/teachers/${t.id}`, {method: 'DELETE'})
            await reload()
        } catch (e) {
            onError(e instanceof APIErrorImpl ? e.message : 'Не удалось убрать')
        }
    }

    return (
        <Card>
            <Heading>Выпуск {center.graduation_year}</Heading>
            <Subheading>Управление группами, учениками и преподавателями</Subheading>

            <Text style={s.section}>Группы</Text>
            <View style={s.inline}>
                <View style={{flex: 1}}>
                    <Field label="Название группы" value={newGroup} onChangeText={setNewGroup} placeholder="A, Б, 1, …"/>
                </View>
                <View style={{width: 16}}/>
                <View style={{justifyContent: 'flex-end', paddingBottom: 12}}>
                    <Button title="Добавить группу" onPress={createGroup}/>
                </View>
            </View>
            {groups.length === 0 ? (
                <Text style={s.muted}>Пока групп нет</Text>
            ) : (
                groups.map((g) => (
                    <View key={g.id} style={s.row}>
                        <Text style={s.name}>Группа {g.name}</Text>
                        <Button title="Удалить" variant="danger" onPress={() => deleteGroup(g)}/>
                    </View>
                ))
            )}

            <Text style={s.section}>Преподаватели</Text>
            <View style={s.inline}>
                <View style={{flex: 1, zIndex: 30 as any}}>
                    <Autocomplete
                        label="Пользователь"
                        placeholder="начните вводить имя или логин"
                        items={userItems}
                        selected={teacherUser}
                        onSelect={setTeacherUser}
                    />
                </View>
                <View style={{width: 16}}/>
                <View style={{justifyContent: 'flex-end', paddingBottom: 12}}>
                    <Button
                        title={teacherIsHead ? 'Старший: да' : 'Старший: нет'}
                        variant="secondary"
                        onPress={() => setTeacherIsHead((v) => !v)}
                    />
                </View>
                <View style={{width: 8}}/>
                <View style={{justifyContent: 'flex-end', paddingBottom: 12}}>
                    <Button title="Добавить" onPress={addTeacher}/>
                </View>
            </View>
            {teachers.length === 0 ? (
                <Text style={s.muted}>Пока преподавателей нет</Text>
            ) : (
                teachers.map((t) => {
                    const u = userById.get(t.user_id)
                    const display = teacherDisplay(t.first_name, t.middle_name) +
                        (u ? ` (@${u.username})` : '')
                    return (
                        <View key={t.id} style={s.row}>
                            <Text style={s.name}>{display}</Text>
                            <View style={{flexDirection: 'row', gap: 8} as any}>
                                <Button
                                    title={t.is_head_teacher ? 'Снять старшего' : 'Сделать старшим'}
                                    variant="secondary"
                                    onPress={() => toggleHead(t)}
                                />
                                <Button title="Убрать" variant="danger" onPress={() => removeTeacher(t)}/>
                            </View>
                        </View>
                    )
                })
            )}

            <Text style={s.section}>Ученики</Text>
            <View style={s.inline}>
                <View style={{flex: 1, zIndex: 20 as any}}>
                    <Autocomplete
                        label="Пользователь"
                        placeholder="начните вводить имя или логин"
                        items={userItems}
                        selected={studentUser}
                        onSelect={setStudentUser}
                    />
                </View>
                <View style={{width: 16}}/>
                <View style={{flex: 1, zIndex: 20 as any}}>
                    <Autocomplete
                        label="Группа"
                        placeholder="название группы"
                        items={groupItems}
                        selected={studentGroup}
                        onSelect={setStudentGroup}
                        emptyMessage="Сначала создайте хотя бы одну группу"
                    />
                </View>
                <View style={{width: 16}}/>
                <View style={{justifyContent: 'flex-end', paddingBottom: 12}}>
                    <Button title="Добавить" onPress={addStudent}/>
                </View>
            </View>
            {students.length === 0 ? (
                <Text style={s.muted}>Пока учеников нет</Text>
            ) : (
                students.map((st) => {
                    const u = userById.get(st.user_id)
                    const display = studentDisplay(st.first_name, st.last_name) +
                        (u ? ` (@${u.username})` : '')
                    return (
                        <View key={st.id} style={s.row}>
                            <Text style={s.name}>{display} — группа {st.group_name}</Text>
                            <Button title="Убрать" variant="danger" onPress={() => removeStudent(st)}/>
                        </View>
                    )
                })
            )}
        </Card>
    )
}

function teacherDisplay(first: string, middle: string | null): string {
    return middle ? `${first} ${middle}` : first
}

function studentDisplay(first: string, last: string): string {
    return last ? `${first} ${last}` : first
}

const s = StyleSheet.create({
    inline: {flexDirection: 'row', alignItems: 'flex-start'},
    section: {
        marginTop: 18,
        marginBottom: 8,
        fontSize: 12,
        fontWeight: '700',
        color: colors.textMuted,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    row: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    name: {fontSize: 14, color: colors.text},
    muted: {fontSize: 13, color: colors.textMuted, fontStyle: 'italic'},
})
