// Homework landing page. Lists every series the current user can interact
// with — published series for students, all series for teachers — across
// every math center they belong to. One click drills into the per-series
// homework view, where the page itself decides whether to show a student
// rollup or a teacher grid.

import {useCallback, useEffect, useState} from 'react'
import {Pressable, StyleSheet, Text, View} from 'react-native'
import {useNavigate} from 'react-router-dom'
import {APIErrorImpl} from '../api'
import {listSeriesForCenter, Series} from '../api/series'
import {useAuth} from '../auth'
import {Card, colors, ErrorBanner, Heading, Subheading} from '../components/ui'
import {formatDateTime} from '../lib/format'

interface MeResponse {
    teacher?: {centers: TeacherCenter[]}
    student?: {center: StudentCenterRef; group: {id: number; name: string}}
}

interface TeacherCenter {
    id: number
    graduation_year: number
    grade: number
}

interface StudentCenterRef {
    id: number
    graduation_year: number
    grade: number
}

// CenterGroup is the grouping we render under: each math center the user
// belongs to becomes one section with its series list.
interface CenterGroup {
    centerID: number
    label: string  // "11-й класс — выпуск 2026"
    role: 'teacher' | 'student'
    series: Series[]
}

export default function HomeworkPage() {
    const {authedFetch} = useAuth()
    const navigate = useNavigate()
    const [groups, setGroups] = useState<CenterGroup[] | null>(null)
    const [error, setError] = useState<string | null>(null)

    const load = useCallback(async () => {
        try {
            const me = await authedFetch<MeResponse>('/mathcenter/me')
            const out: CenterGroup[] = []
            // Teacher centers first — they get to see drafts. Students see
            // only published series (the backend filters this for us via
            // the published-only list endpoint).
            // Newest series at the top — the user nearly always wants the
            // most recent pset, not the oldest. Sort by series number DESC.
            const byNewest = (xs: Series[]) => xs.slice().sort((a, b) => b.number - a.number)
            if (me.teacher) {
                for (const c of me.teacher.centers) {
                    const series = await listSeriesForCenter(authedFetch, c.id)
                    out.push({
                        centerID: c.id,
                        label: `${c.grade}-й класс — выпуск ${c.graduation_year}`,
                        role: 'teacher',
                        series: byNewest(series),
                    })
                }
            }
            if (me.student) {
                const series = await listSeriesForCenter(authedFetch, me.student.center.id)
                out.push({
                    centerID: me.student.center.id,
                    label: `${me.student.center.grade}-й класс — выпуск ${me.student.center.graduation_year}`,
                    role: 'student',
                    series: byNewest(series.filter(s => s.published)),
                })
            }
            setGroups(out)
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
                <Heading>Домашка</Heading>
                <ErrorBanner message={error}/>
            </Card>
        )
    }
    if (!groups) {
        return (
            <Card style={{width: 720}}>
                <Heading>Домашка</Heading>
                <Subheading>Загрузка…</Subheading>
            </Card>
        )
    }
    if (groups.length === 0) {
        return (
            <Card style={{width: 720}}>
                <Heading>Домашка</Heading>
                <Subheading>Вы пока не состоите в матцентре.</Subheading>
            </Card>
        )
    }

    return (
        <View style={{width: 760, gap: 24} as any}>
            {groups.map(g => (
                <Card key={`${g.role}-${g.centerID}`}>
                    <Heading>{g.label}</Heading>
                    <Subheading>{g.role === 'teacher' ? 'Преподаватель' : 'Ученик'}</Subheading>
                    {g.series.length === 0 ? (
                        <Text style={s.empty}>Серий пока нет.</Text>
                    ) : (
                        g.series.map(series => (
                            <SeriesRow
                                key={series.id}
                                series={series}
                                onOpen={() => navigate(`/homework/series/${series.id}`)}
                            />
                        ))
                    )}
                </Card>
            ))}
        </View>
    )
}

function SeriesRow({series, onOpen}: { series: Series; onOpen: () => void }) {
    const due = formatDateTime(series.due_at)
    const overdue = !!series.due_at && new Date(series.due_at).getTime() < Date.now()
    return (
        <Pressable onPress={onOpen} style={({pressed}) => [s.row, pressed && {backgroundColor: '#f9fafb'}]}>
            <View style={{flex: 1}}>
                <Text style={s.rowTitle}>{series.display_name}</Text>
                <Text style={s.rowMeta}>
                    Срок: {due}
                    {overdue ? <Text style={{color: colors.danger}}> · просрочено</Text> : null}
                    {series.published ? null : <Text style={{color: colors.textMuted}}> · черновик</Text>}
                </Text>
            </View>
            <Text style={s.openArrow}>Открыть →</Text>
        </Pressable>
    )
}


const s = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 12,
        paddingHorizontal: 12,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        borderRadius: 6,
    },
    rowTitle: {fontSize: 15, fontWeight: '600', color: colors.text, marginBottom: 4},
    rowMeta: {fontSize: 13, color: colors.textMuted},
    openArrow: {fontSize: 14, fontWeight: '500', color: colors.primary, marginLeft: 12},
    empty: {fontSize: 13, color: colors.textMuted, fontStyle: 'italic', paddingVertical: 8},
})
