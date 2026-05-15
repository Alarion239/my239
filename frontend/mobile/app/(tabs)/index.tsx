// Mobile landing screen — replaces the connectivity probe with a real
// first surface: hit /mathcenter/me, render role-appropriate content.
//
// Students see their cohort info + a basic list of published series in
// their center. Teachers see each center they teach in as a card with
// "X series" — tapping a series row would deep-link into a future
// homework detail screen (not built yet).
//
// Anything more ambitious (the spreadsheet, the side panel, PDF
// preview, threading) lives in the web client today; the mobile flows
// will get their own thumb-friendly designs in subsequent commits.

import {useCallback, useEffect, useState} from 'react'
import {Pressable, RefreshControl, ScrollView, StyleSheet, Text, View} from 'react-native'
import {APIErrorImpl} from '@my239/shared/api/http'
import {listSeriesForCenter, type Series} from '@my239/shared/api/series'
import {formatDateTime} from '@my239/shared/format/datetime'
import {useAuth} from '@/lib/auth'

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
}

interface StudentView {
    center: {id: number; graduation_year: number; grade: number}
    group: {id: number; name: string}
}

interface CenterBlock {
    centerID: number
    label: string
    role: 'teacher' | 'student'
    headTeacher?: boolean
    groupName?: string
    series: Series[]
}

export default function HomeScreen() {
    const {user, authedFetch, logout} = useAuth()
    const [blocks, setBlocks] = useState<CenterBlock[] | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [refreshing, setRefreshing] = useState(false)

    const load = useCallback(async () => {
        try {
            const me = await authedFetch<MeResponse>('/mathcenter/me')
            const out: CenterBlock[] = []
            // Sort series newest-first to match the web client.
            const byNewest = (xs: Series[]) => xs.slice().sort((a, b) => b.number - a.number)
            if (me.teacher) {
                for (const c of me.teacher.centers) {
                    const series = await listSeriesForCenter(authedFetch, c.id)
                    out.push({
                        centerID: c.id,
                        label: `${c.grade}-й класс — выпуск ${c.graduation_year}`,
                        role: 'teacher',
                        headTeacher: c.is_head_teacher,
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
                    groupName: me.student.group.name,
                    series: byNewest(series.filter(s => s.published)),
                })
            }
            setBlocks(out)
            setError(null)
        } catch (e) {
            setError(e instanceof APIErrorImpl ? e.message : 'Не удалось загрузить')
        }
    }, [authedFetch])

    useEffect(() => {
        void load()
    }, [load])

    async function onRefresh() {
        setRefreshing(true)
        await load()
        setRefreshing(false)
    }

    return (
        <ScrollView
            style={s.root}
            contentContainerStyle={s.content}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh}/>}
        >
            <View style={s.header}>
                <View style={{flex: 1}}>
                    <Text style={s.greeting}>Здравствуйте,</Text>
                    <Text style={s.userName}>{user?.first_name ?? ''}</Text>
                </View>
                <Pressable onPress={() => void logout()} style={s.logout}>
                    <Text style={s.logoutText}>Выйти</Text>
                </Pressable>
            </View>

            {error ? (
                <View style={s.errorBanner}>
                    <Text style={s.errorBannerText}>{error}</Text>
                </View>
            ) : null}

            {!blocks && !error ? (
                <Text style={s.muted}>Загрузка…</Text>
            ) : null}

            {blocks && blocks.length === 0 && !error ? (
                <View style={s.card}>
                    <Text style={s.cardTitle}>Матцентр</Text>
                    <Text style={s.muted}>Вы пока не состоите в матцентре. Обратитесь к администратору.</Text>
                </View>
            ) : null}

            {blocks?.map(b => (
                <View key={`${b.role}-${b.centerID}`} style={s.card}>
                    <Text style={s.cardTitle}>{b.label}</Text>
                    <Text style={s.muted}>
                        {b.role === 'teacher'
                            ? `Преподаватель${b.headTeacher ? ' · старший' : ''}`
                            : `Ученик · группа ${b.groupName ?? ''}`}
                    </Text>
                    <View style={s.section}>
                        <Text style={s.sectionLabel}>Серии</Text>
                        {b.series.length === 0 ? (
                            <Text style={s.muted}>Серий пока нет.</Text>
                        ) : (
                            b.series.map(series => (
                                <SeriesRow key={series.id} series={series}/>
                            ))
                        )}
                    </View>
                </View>
            ))}
        </ScrollView>
    )
}

function SeriesRow({series}: {series: Series}) {
    const overdue = !!series.due_at && new Date(series.due_at).getTime() < Date.now()
    return (
        <View style={[s.seriesRow, overdue && s.seriesRowOverdue]}>
            <Text style={s.seriesTitle}>{series.display_name}</Text>
            <Text style={[s.muted, overdue && {color: '#9ca3af'}]}>
                Срок: {formatDateTime(series.due_at)}
            </Text>
            {!series.published ? (
                <Text style={s.draftTag}>черновик</Text>
            ) : null}
        </View>
    )
}

const s = StyleSheet.create({
    root: {flex: 1, backgroundColor: '#f5f6f8'},
    content: {padding: 16, gap: 12},
    header: {flexDirection: 'row', alignItems: 'center', paddingBottom: 4},
    greeting: {fontSize: 14, color: '#6b7280'},
    userName: {fontSize: 24, fontWeight: '700', color: '#1f2933', marginTop: 2},
    logout: {paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, backgroundColor: '#eef2f7'},
    logoutText: {fontSize: 13, color: '#1f2933', fontWeight: '500'},
    card: {
        backgroundColor: '#ffffff',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#e1e4ea',
        padding: 16,
        gap: 4,
    },
    cardTitle: {fontSize: 18, fontWeight: '700', color: '#1f2933'},
    section: {marginTop: 12, gap: 6},
    sectionLabel: {fontSize: 12, fontWeight: '700', color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5},
    seriesRow: {
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#e1e4ea',
        backgroundColor: '#fff',
        gap: 2,
    },
    seriesRowOverdue: {backgroundColor: '#f3f4f6', borderColor: '#e5e7eb'},
    seriesTitle: {fontSize: 15, fontWeight: '600', color: '#1f2933'},
    draftTag: {fontSize: 11, color: '#92400e', textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 2},
    muted: {fontSize: 13, color: '#6b7280'},
    errorBanner: {
        backgroundColor: '#fef2f2',
        borderColor: '#fecaca',
        borderWidth: 1,
        borderRadius: 8,
        padding: 10,
    },
    errorBannerText: {color: '#dc2626', fontSize: 13},
})
