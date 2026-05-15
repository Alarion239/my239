import {useCallback, useEffect, useState} from 'react'
import {StyleSheet, Text, View} from 'react-native'
import {APIErrorImpl} from '../api'
import {useAuth} from '../auth'
import {SeriesHomeworkList} from '../components/homework/SeriesHomeworkList'
import {TeacherCenterView} from '../components/homework/TeacherCenterView'
import {Card, colors, ErrorBanner, Heading, Subheading} from '../components/ui'

interface MeResponse {
    teacher?: TeacherView
    student?: StudentView
}

interface TeacherView {
    centers: TeacherCenterView[]
}

interface TeacherCenterView {
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
    center: { id: number; graduation_year: number; grade: number }
    group: { id: number; name: string }
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
            <Card style={{width: 720}}>
                <Heading>Математический центр</Heading>
                <ErrorBanner message={error}/>
            </Card>
        )
    }

    if (!data) {
        return (
            <Card style={{width: 720}}>
                <Heading>Математический центр</Heading>
                <Subheading>Загрузка…</Subheading>
            </Card>
        )
    }

    // A user with no math-center role at all sees a friendly empty state
    // rather than a confusing blank panel.
    if (!data.teacher && !data.student) {
        return (
            <Card style={{width: 720}}>
                <Heading>Математический центр</Heading>
                <Subheading>Вы пока не состоите в матцентре — обратитесь к администратору.</Subheading>
            </Card>
        )
    }

    // The wrapper is wide enough to host the teacher spreadsheet
    // (many subproblem columns × many students), capped so very wide
    // monitors don't stretch lines to unreadable length. Students get
    // the same wrapper but their inner cards/lists self-cap to keep
    // text readable; the wider outer just stops the page from feeling
    // squished on a laptop.
    return (
        <View style={{width: 'min(100%, 1600px)', gap: 24} as any}>
            {data.teacher ? <TeacherSection data={data.teacher}/> : null}
            {data.student ? <StudentSection data={data.student}/> : null}
        </View>
    )
}

function TeacherSection({data}: { data: TeacherView }) {
    // The unified teacher hub: one TeacherCenterView per center the
    // teacher belongs to. Group / student rosters are already visible
    // inside the spreadsheet (it groups rows by Группа N with student
    // names down the left), so this section is now just the
    // class-header + the consolidated view itself — no separate "groups"
    // / "teachers" / "series" sub-sections.
    return (
        <View style={{gap: 32} as any}>
            {data.centers.map((c) => (
                <TeacherCenterView
                    key={c.id}
                    centerID={c.id}
                    gradeLabel={`${c.grade}-й класс`}
                    graduationYear={c.graduation_year}
                />
            ))}
        </View>
    )
}

function StudentSection({data}: { data: StudentView }) {
    // The student dashboard merges what used to live behind two tabs
    // ("Матцентр" + "Домашка"): the cohort info card on top, then the
    // homework-aware series list (newest first, with inline progress
    // badges). Clicking a series goes to /homework/series/:id for the
    // full PDF + problem grid.
    return (
        <View style={{gap: 16} as any}>
            <Card>
                <Heading>Математический центр — {data.center.grade}-й класс</Heading>
                <Subheading>Выпуск {data.center.graduation_year}</Subheading>

                <View style={s.row}>
                    <Text style={s.label}>Ваша группа</Text>
                    <Text style={s.value}>{data.group.name}</Text>
                </View>

                <Text style={s.section}>Старшие преподаватели</Text>
                {data.head_teachers.length === 0 ? (
                    <Text style={s.muted}>Не назначены</Text>
                ) : (
                    data.head_teachers.map((t) => (
                        <Text key={t.user_id} style={s.studentLine}>{t.display_name}</Text>
                    ))
                )}
            </Card>

            <Text style={s.section}>Серии</Text>
            <SeriesHomeworkList centerID={data.center.id}/>
        </View>
    )
}

const s = StyleSheet.create({
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
    label: {fontSize: 13, color: colors.textMuted},
    value: {fontSize: 14, color: colors.text, fontWeight: '500'},
    badge: {
        fontSize: 11,
        fontWeight: '600',
        color: colors.primary,
        backgroundColor: '#eef2ff',
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 999,
    },
    group: {marginTop: 12},
    groupName: {fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 6},
    studentLine: {fontSize: 14, color: colors.text, paddingVertical: 4},
    muted: {fontSize: 13, color: colors.textMuted, fontStyle: 'italic'},
})
