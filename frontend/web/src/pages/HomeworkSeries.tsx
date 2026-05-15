// Per-series homework view. Determines the caller's role for the series's
// math center and renders the appropriate layout:
//
//   • student: responsive split — PDF preview pinned on the left (laptop)
//     or stacked above the problems (phone). The series header card
//     carries the title on the left and the "Принято / Отклонено / В работе"
//     badges on the right, so progress is glanceable without a separate card.
//
//   • teacher: full-width spreadsheet (TeacherGrid).

import {useCallback, useEffect, useState} from 'react'
import {Pressable, StyleSheet, Text, useWindowDimensions, View} from 'react-native'
import {useNavigate, useParams} from 'react-router-dom'
import {APIErrorImpl} from '../api'
import {computeGranularCounts, getMyRollup, isClosed, type MyRollupResponse} from '../api/homework'
import {getSeries, type Series} from '../api/series'
import {formatDateTime} from '../lib/format'
import {useAuth} from '../auth'
import {PDFPanel} from '../components/homework/PDFPanel'
import {ProgressBadges} from '../components/homework/ProgressBadges'
import {StudentProblemList} from '../components/homework/StudentProblemList'
import {TeacherGrid} from '../components/homework/TeacherGrid'
import {Card, colors, ErrorBanner, Heading, Subheading} from '../components/ui'

interface MeResponse {
    teacher?: {centers: Array<{id: number}>}
    student?: {center: {id: number}}
}

type Role = 'teacher' | 'student' | 'none'

const RESPONSIVE_BREAKPOINT = 980

export default function HomeworkSeriesPage() {
    const {seriesID: rawID} = useParams<{seriesID: string}>()
    const seriesID = rawID ? Number.parseInt(rawID, 10) : NaN
    const {authedFetch} = useAuth()
    const navigate = useNavigate()
    const [series, setSeries] = useState<Series | null>(null)
    const [role, setRole] = useState<Role | null>(null)
    const [rollup, setRollup] = useState<MyRollupResponse | null>(null)
    const [error, setError] = useState<string | null>(null)

    const load = useCallback(async () => {
        if (Number.isNaN(seriesID)) {
            setError('Некорректный идентификатор серии')
            return
        }
        try {
            const [s, me] = await Promise.all([
                getSeries(authedFetch, seriesID),
                authedFetch<MeResponse>('/mathcenter/me'),
            ])
            const teacherIDs = new Set((me.teacher?.centers ?? []).map(c => c.id))
            const studentCenterID = me.student?.center.id
            let r: Role = 'none'
            if (teacherIDs.has(s.math_center_id)) r = 'teacher'
            else if (studentCenterID === s.math_center_id) r = 'student'
            setSeries(s)
            setRole(r)
            // For students, kick off the rollup fetch right after we know
            // their role — it powers both the header badges and the per-
            // problem grid below the PDF.
            if (r === 'student') {
                try {
                    setRollup(await getMyRollup(authedFetch, seriesID))
                } catch (e) {
                    // Non-fatal — the page can still render with an
                    // empty problem list and a placeholder header.
                    setError(e instanceof APIErrorImpl ? e.message : 'Не удалось загрузить прогресс')
                }
            }
        } catch (e) {
            setError(e instanceof APIErrorImpl ? e.message : 'Не удалось загрузить')
        }
    }, [authedFetch, seriesID])

    useEffect(() => {
        void load()
    }, [load])

    if (error && !series) {
        return (
            <Card style={{width: 720}}>
                <BackLink onPress={() => navigate('/mathcenter')}/>
                <Heading>Домашка</Heading>
                <ErrorBanner message={error}/>
            </Card>
        )
    }
    if (!series || !role) {
        return (
            <Card style={{width: 720}}>
                <Heading>Домашка</Heading>
                <Subheading>Загрузка…</Subheading>
            </Card>
        )
    }
    if (role === 'none') {
        return (
            <Card style={{width: 720}}>
                <BackLink onPress={() => navigate('/mathcenter')}/>
                <Heading>{series.display_name}</Heading>
                <ErrorBanner message="У вас нет доступа к этой серии."/>
            </Card>
        )
    }

    if (role === 'student') {
        return <StudentSeriesView series={series} rollup={rollup} onBack={() => navigate('/mathcenter')}/>
    }
    // teacher
    return (
        <View style={{width: 'min(100%, 1100px)', gap: 12} as any}>
            <BackLink onPress={() => navigate('/homework')}/>
            <Card style={{paddingVertical: 16, paddingHorizontal: 18}}>
                <Heading>{series.display_name}</Heading>
                <Subheading>Срок: {formatDateTime(series.due_at)} · преподаватель</Subheading>
            </Card>
            <TeacherGrid centerID={series.math_center_id} selectedSeriesID={series.id}/>
        </View>
    )
}

function StudentSeriesView({series, rollup, onBack}: {
    series: Series;
    rollup: MyRollupResponse | null;
    onBack: () => void;
}) {
    const {width} = useWindowDimensions()
    const wide = width >= RESPONSIVE_BREAKPOINT
    return (
        <View style={{width: 'min(100%, 1200px)', gap: 12} as any}>
            <BackLink onPress={onBack}/>

            {/* Unified header: title on the left, due date underneath, and
                the "Ваш прогресс" badges right-aligned. One card instead of
                two so the eye doesn't have to bounce between them. */}
            <Card style={s.headerCard}>
                <View style={s.headerRow}>
                    <View style={{flex: 1, minWidth: 0}}>
                        <Heading>{series.display_name}</Heading>
                        <Text style={s.headerMeta}>Срок: {formatDateTime(series.due_at)}</Text>
                    </View>
                    {rollup ? <ProgressBadges counts={computeGranularCounts(rollup.problems)}/> : null}
                </View>
            </Card>

            {/* Body: PDF left, problems right on laptops; stacked on phones.
                PDF uses position:sticky on wide screens so it stays in view
                while the student scrolls problem cards. */}
            <View style={[s.body, wide ? s.bodyRow : s.bodyCol]}>
                <View style={wide ? s.pdfSlotWide : s.pdfSlotNarrow}>
                    <PDFPanel seriesID={series.id} hasPDF={series.has_pdf} sticky={wide}/>
                </View>
                <View style={wide ? s.problemsSlotWide : s.problemsSlotNarrow}>
                    <StudentProblemList
                        problems={rollup?.problems ?? []}
                        closed={isClosed(series.due_at)}
                    />
                </View>
            </View>
        </View>
    )
}

function BackLink({onPress}: {onPress: () => void}) {
    return (
        <Pressable onPress={onPress} style={s.back}>
            <Text style={s.backText}>← К списку</Text>
        </Pressable>
    )
}

const s = StyleSheet.create({
    back: {alignSelf: 'flex-start', paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6},
    backText: {fontSize: 14, fontWeight: '500', color: colors.primary},
    headerCard: {paddingVertical: 16, paddingHorizontal: 20},
    headerRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16} as any,
    headerMeta: {fontSize: 13, color: colors.textMuted, marginTop: 2},
    body: {gap: 16} as any,
    bodyRow: {flexDirection: 'row', alignItems: 'flex-start'},
    bodyCol: {flexDirection: 'column'},
    // 4:6 split lets the PDF show pages at a readable width while the
    // problem grid uses the remainder. Both sides flex inside the row.
    pdfSlotWide: {flexBasis: 0, flexGrow: 4, minWidth: 320},
    pdfSlotNarrow: {width: '100%'},
    problemsSlotWide: {flexBasis: 0, flexGrow: 6, minWidth: 320},
    problemsSlotNarrow: {width: '100%'},
})
