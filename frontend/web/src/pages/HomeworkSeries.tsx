// Per-series homework view. Determines the caller's role for the
// series's math center and renders the appropriate layout:
//
//   • student: responsive split — PDF preview pinned on the left
//     (laptop) or stacked above the problems (phone). The series
//     header card carries the title on the left and the progress
//     badges on the right, so progress is glanceable without a
//     separate card.
//
//   • teacher: full-width spreadsheet (TeacherGrid).

import {useCallback, useEffect, useState} from 'react'
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
import {Card, ErrorBanner, Heading, Subheading} from '../components/ui'

interface MeResponse {
    teacher?: {centers: Array<{id: number}>}
    student?: {center: {id: number}}
}

type Role = 'teacher' | 'student' | 'none'

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
            if (r === 'student') {
                try {
                    setRollup(await getMyRollup(authedFetch, seriesID))
                } catch (e) {
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
            <Card className="w-[720px]">
                <BackLink onPress={() => navigate('/mathcenter')}/>
                <Heading>Домашка</Heading>
                <ErrorBanner message={error}/>
            </Card>
        )
    }
    if (!series || !role) {
        return (
            <Card className="w-[720px]">
                <Heading>Домашка</Heading>
                <Subheading>Загрузка…</Subheading>
            </Card>
        )
    }
    if (role === 'none') {
        return (
            <Card className="w-[720px]">
                <BackLink onPress={() => navigate('/mathcenter')}/>
                <Heading>{series.display_name}</Heading>
                <ErrorBanner message="У вас нет доступа к этой серии."/>
            </Card>
        )
    }

    if (role === 'student') {
        return <StudentSeriesView series={series} rollup={rollup} onBack={() => navigate('/mathcenter')}/>
    }
    return (
        <div className="w-full max-w-[1100px] flex flex-col gap-3">
            <BackLink onPress={() => navigate('/homework')}/>
            <Card className="!py-4 !px-[18px]">
                <Heading>{series.display_name}</Heading>
                <Subheading>Срок: {formatDateTime(series.due_at)} · преподаватель</Subheading>
            </Card>
            <TeacherGrid centerID={series.math_center_id} selectedSeriesID={series.id}/>
        </div>
    )
}

function StudentSeriesView({series, rollup, onBack}: {
    series: Series
    rollup: MyRollupResponse | null
    onBack: () => void
}) {
    return (
        <div className="w-full max-w-[1200px] flex flex-col gap-3">
            <BackLink onPress={onBack}/>

            {/* Unified header: title on the left, due date underneath,
                progress badges right-aligned. One card so the eye
                doesn't bounce between two. */}
            <Card className="!py-4 !px-5">
                <div className="flex items-center justify-between gap-4">
                    <div className="flex-1 min-w-0">
                        <Heading>{series.display_name}</Heading>
                        <p className="text-[13px] text-muted mt-0.5">Срок: {formatDateTime(series.due_at)}</p>
                    </div>
                    {rollup ? <ProgressBadges counts={computeGranularCounts(rollup.problems)}/> : null}
                </div>
            </Card>

            {/* PDF left, problems right on laptops (lg+); stacked on
                phones. PDF uses position:sticky on wide screens so it
                stays in view while the student scrolls problem cards. */}
            <div className="flex flex-col lg:flex-row gap-4 items-start">
                <div className="w-full lg:basis-0 lg:grow-[4] lg:min-w-[320px]">
                    <PDFPanel seriesID={series.id} hasPDF={series.has_pdf} sticky/>
                </div>
                <div className="w-full lg:basis-0 lg:grow-[6] lg:min-w-[320px]">
                    <StudentProblemList
                        problems={rollup?.problems ?? []}
                        closed={isClosed(series.due_at)}
                    />
                </div>
            </div>
        </div>
    )
}

function BackLink({onPress}: {onPress: () => void}) {
    return (
        <button
            type="button"
            onClick={onPress}
            className="self-start px-2 py-1 rounded-md text-sm font-medium text-primary hover:bg-page"
        >
            ← К списку
        </button>
    )
}
