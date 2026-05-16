import {useCallback, useEffect, useMemo, useState} from 'react'
import {APIErrorImpl} from '../api'
import {useAuth, User} from '../auth'
import {Autocomplete, AutocompleteItem} from '../components/Autocomplete'
import {Button, Card, ErrorBanner, Field, Heading, Subheading} from '../components/ui'

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

const sectionLabelClass = 'mt-[18px] mb-2 text-xs font-bold uppercase tracking-wide text-muted'
const rowClass = 'flex items-center justify-between py-2 border-b border-card-border'
const mutedClass = 'text-[13px] italic text-muted'

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
        <div className="w-[900px] flex flex-col gap-6">
            <Card>
                <Heading>Управление матцентрами</Heading>
                <Subheading>Создавайте матцентры по году выпуска и наполняйте их группами и участниками.</Subheading>
                {error ? <ErrorBanner message={error}/> : null}
                <div className="flex items-end gap-4">
                    <div className="flex-1">
                        <Field
                            label="Год выпуска"
                            value={newYear}
                            onChangeText={setNewYear}
                            placeholder="например, 2027"
                        />
                    </div>
                    <div className="pb-3">
                        <Button title="Создать матцентр" onPress={createCenter}/>
                    </div>
                </div>
                <p className={sectionLabelClass}>Существующие матцентры</p>
                {centers.length === 0 ? (
                    <p className={mutedClass}>Пока ничего не создано</p>
                ) : (
                    centers.map((c) => (
                        <div key={c.id} className={rowClass}>
                            <p className={`text-sm ${selectedId === c.id ? 'text-primary font-bold' : 'text-ink'}`}>
                                Выпуск {c.graduation_year}
                            </p>
                            <div className="flex gap-2">
                                <Button title="Открыть" variant="secondary" onPress={() => setSelectedId(c.id)}/>
                                <Button title="Удалить" variant="danger" onPress={() => deleteCenter(c)}/>
                            </div>
                        </div>
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
        </div>
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

    const userItems = useMemo<AutocompleteItem[]>(
        () =>
            users.map((u) => ({
                id: u.id,
                label: [u.last_name, u.first_name, u.middle_name].filter(Boolean).join(' ') || u.username,
                sublabel: '@' + u.username,
            })),
        [users],
    )

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

            <p className={sectionLabelClass}>Группы</p>
            <div className="flex items-end gap-4">
                <div className="flex-1">
                    <Field label="Название группы" value={newGroup} onChangeText={setNewGroup} placeholder="A, Б, 1, …"/>
                </div>
                <div className="pb-3">
                    <Button title="Добавить группу" onPress={createGroup}/>
                </div>
            </div>
            {groups.length === 0 ? (
                <p className={mutedClass}>Пока групп нет</p>
            ) : (
                groups.map((g) => (
                    <div key={g.id} className={rowClass}>
                        <p className="text-sm text-ink">Группа {g.name}</p>
                        <Button title="Удалить" variant="danger" onPress={() => deleteGroup(g)}/>
                    </div>
                ))
            )}

            <p className={sectionLabelClass}>Преподаватели</p>
            <div className="flex items-end gap-4">
                <div className="flex-1">
                    <Autocomplete
                        label="Пользователь"
                        placeholder="начните вводить имя или логин"
                        items={userItems}
                        selected={teacherUser}
                        onSelect={setTeacherUser}
                    />
                </div>
                <div className="pb-3">
                    <Button
                        title={teacherIsHead ? 'Старший: да' : 'Старший: нет'}
                        variant="secondary"
                        onPress={() => setTeacherIsHead((v) => !v)}
                    />
                </div>
                <div className="pb-3">
                    <Button title="Добавить" onPress={addTeacher}/>
                </div>
            </div>
            {teachers.length === 0 ? (
                <p className={mutedClass}>Пока преподавателей нет</p>
            ) : (
                teachers.map((t) => {
                    const u = userById.get(t.user_id)
                    const display = teacherDisplay(t.first_name, t.middle_name) +
                        (u ? ` (@${u.username})` : '')
                    return (
                        <div key={t.id} className={rowClass}>
                            <p className="text-sm text-ink">{display}</p>
                            <div className="flex gap-2">
                                <Button
                                    title={t.is_head_teacher ? 'Снять старшего' : 'Сделать старшим'}
                                    variant="secondary"
                                    onPress={() => toggleHead(t)}
                                />
                                <Button title="Убрать" variant="danger" onPress={() => removeTeacher(t)}/>
                            </div>
                        </div>
                    )
                })
            )}

            <p className={sectionLabelClass}>Ученики</p>
            <div className="flex items-end gap-4">
                <div className="flex-1">
                    <Autocomplete
                        label="Пользователь"
                        placeholder="начните вводить имя или логин"
                        items={userItems}
                        selected={studentUser}
                        onSelect={setStudentUser}
                    />
                </div>
                <div className="flex-1">
                    <Autocomplete
                        label="Группа"
                        placeholder="название группы"
                        items={groupItems}
                        selected={studentGroup}
                        onSelect={setStudentGroup}
                        emptyMessage="Сначала создайте хотя бы одну группу"
                    />
                </div>
                <div className="pb-3">
                    <Button title="Добавить" onPress={addStudent}/>
                </div>
            </div>
            {students.length === 0 ? (
                <p className={mutedClass}>Пока учеников нет</p>
            ) : (
                students.map((st) => {
                    const u = userById.get(st.user_id)
                    const display = studentDisplay(st.first_name, st.last_name) +
                        (u ? ` (@${u.username})` : '')
                    return (
                        <div key={st.id} className={rowClass}>
                            <p className="text-sm text-ink">{display} — группа {st.group_name}</p>
                            <Button title="Убрать" variant="danger" onPress={() => removeStudent(st)}/>
                        </div>
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
