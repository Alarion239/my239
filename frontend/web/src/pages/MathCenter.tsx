import {useCallback, useEffect, useState} from 'react'
import {APIErrorImpl} from '../api'
import {useAuth} from '../auth'
import {SeriesHomeworkList} from '../components/homework/SeriesHomeworkList'
import {TeacherCenterView} from '../components/homework/TeacherCenterView'
import {Card, ErrorBanner, Heading, Subheading} from '../components/ui'

interface MeResponse {
    teacher?: TeacherView
    student?: StudentView
}

interface TeacherView {
    centers: TeacherCenterInfo[]
}

interface TeacherCenterInfo {
    id: number
    graduation_year: number
    grade: number
    is_head_teacher: boolean
    teachers: TeacherInfo[]
    groups: GroupWithStudents[]
}

interface TeacherInfo {
    user_id: number
    display_name: string
    is_head_teacher: boolean
}

interface StudentInfo {
    user_id: number
    display_name: string
}

interface GroupWithStudents {
    id: number
    name: string
    students: StudentInfo[]
}

interface StudentView {
    center: {id: number; graduation_year: number; grade: number}
    group: {id: number; name: string}
    head_teachers: TeacherInfo[]
}

export default function MathCenterPage() {
    const {authedFetch} = useAuth()
    const [data, setData] = useState<MeResponse | null>(null)
    const [error, setError] = useState<string | null>(null)

    const load = useCallback(async () => {
        try {
            setData(await authedFetch<MeResponse>('/mathcenter/me'))
        } catch (e) {
            setError(e instanceof APIErrorImpl ? e.message : 'Не удалось загрузить')
        }
    }, [authedFetch])

    useEffect(() => {
        void load()
    }, [load])

    if (error) {
        return (
            <Card className="w-[720px]">
                <Heading>Математический центр</Heading>
                <ErrorBanner message={error}/>
            </Card>
        )
    }

    if (!data) {
        return (
            <Card className="w-[720px]">
                <Heading>Математический центр</Heading>
                <Subheading>Загрузка…</Subheading>
            </Card>
        )
    }

    if (!data.teacher && !data.student) {
        return (
            <Card className="w-[720px]">
                <Heading>Математический центр</Heading>
                <Subheading>Вы пока не состоите в матцентре — обратитесь к администратору.</Subheading>
            </Card>
        )
    }

    // The wrapper is wide enough to host the teacher spreadsheet (many
    // subproblem columns × many students), capped at 1600px so very
    // wide monitors don't stretch lines to unreadable length.
    return (
        <div className="w-full max-w-[1600px] flex flex-col gap-6">
            {data.teacher ? <TeacherSection data={data.teacher}/> : null}
            {data.student ? <StudentSection data={data.student}/> : null}
        </div>
    )
}

function TeacherSection({data}: {data: TeacherView}) {
    return (
        <div className="flex flex-col gap-8">
            {data.centers.map(c => (
                <TeacherCenterView key={c.id} centerID={c.id}/>
            ))}
        </div>
    )
}

function StudentSection({data}: {data: StudentView}) {
    return (
        <div className="flex flex-col gap-4">
            <Card>
                <Heading>Математический центр — {data.center.grade}-й класс</Heading>
                <Subheading>Выпуск {data.center.graduation_year}</Subheading>

                <div className="flex items-center justify-between py-2 border-b border-card-border">
                    <span className="text-[13px] text-muted">Ваша группа</span>
                    <span className="text-sm font-medium text-ink">{data.group.name}</span>
                </div>

                <p className="mt-4 mb-2 text-xs font-bold uppercase tracking-wide text-muted">
                    Старшие преподаватели
                </p>
                {data.head_teachers.length === 0 ? (
                    <p className="text-[13px] italic text-muted">Не назначены</p>
                ) : (
                    data.head_teachers.map(t => (
                        <p key={t.user_id} className="text-sm text-ink py-1">{t.display_name}</p>
                    ))
                )}
            </Card>

            <p className="text-xs font-bold uppercase tracking-wide text-muted">Серии</p>
            <SeriesHomeworkList centerID={data.center.id}/>
        </div>
    )
}
