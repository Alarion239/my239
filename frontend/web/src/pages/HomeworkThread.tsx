// HomeworkThread shows the timeline of a single (student, subproblem)
// thread plus a role-appropriate compact action panel. After the series
// deadline the submit form is hidden entirely — only the history and the
// inline appeal panel remain available to the student. The backend would
// 409 a late submit anyway, but the form is removed so the student isn't
// nudged toward an action they can't actually take.
//
// The page is also used at /homework/new/:subproblemID for first-time
// submissions; an outer route wrapper key-remounts the inner component
// on every URL change so hooks reset cleanly and we don't render with
// stale state across navigations.

import {useCallback, useEffect, useRef, useState} from 'react'
import {Pressable, StyleSheet, Text, View} from 'react-native'
import {useNavigate, useParams} from 'react-router-dom'
import {APIErrorImpl} from '../api'
import {
    EventView,
    SubproblemContext,
    ThreadView,
    appealGrade,
    claimThread,
    eventKindLabel,
    getSubproblemContext,
    getThread,
    gradeThread,
    heartbeatClaim,
    isClosed,
    newEventUUID,
    releaseClaim,
    retractGrade,
    statusBackgroundColor,
    statusBorderColor,
    statusLabel,
    submitAttempt,
    userNameFromThread,
} from '../api/homework'
import {useAuth} from '../auth'
import {SubmitForm} from '../components/homework/SubmitForm'
import {Button, Card, colors, ErrorBanner, Heading, Subheading} from '../components/ui'
import {formatDateTime} from '../lib/format'

interface MeResponse {
    teacher?: {centers: Array<{id: number}>}
    student?: {center: {id: number}}
}

type Role = 'teacher' | 'student' | 'admin' | 'none'

interface MeForCheck {
    role: Role
    userID: number
}

type Mode =
    | {kind: 'thread'; threadID: number}
    | {kind: 'new'; subproblemID: number}

// Outer route wrapper: re-keys the inner component on every URL change so
// hooks reset cleanly across thread/new navigations.
export default function HomeworkThreadRoute() {
    const params = useParams<{threadID?: string; subproblemID?: string}>()
    const key = params.threadID ? `t:${params.threadID}` : `n:${params.subproblemID ?? ''}`
    return <HomeworkThreadPage key={key}/>
}

function HomeworkThreadPage() {
    const params = useParams<{threadID?: string; subproblemID?: string}>()
    const mode: Mode | null = parseMode(params.threadID, params.subproblemID)
    const navigate = useNavigate()
    const {user, authedFetch, authedFetchRaw} = useAuth()
    const [thread, setThread] = useState<ThreadView | null>(null)
    const [newCtx, setNewCtx] = useState<SubproblemContext | null>(null)
    const [me, setMe] = useState<MeForCheck | null>(null)
    const [error, setError] = useState<string | null>(null)

    const modeKey = mode?.kind === 'thread' ? `t:${mode.threadID}` : mode?.kind === 'new' ? `n:${mode.subproblemID}` : 'none'
    const load = useCallback(async () => {
        if (!user) return
        if (!mode) {
            setError('Некорректный URL')
            return
        }
        try {
            const meResp = await authedFetch<MeResponse>('/mathcenter/me')
            const teacherIDs = new Set((meResp.teacher?.centers ?? []).map(c => c.id))
            const studentCenterID = meResp.student?.center.id

            if (mode.kind === 'thread') {
                const t = await getThread(authedFetch, mode.threadID)
                setThread(t)
                setMe({role: resolveRole(user, teacherIDs, studentCenterID, t.math_center_id, t.student_user_id), userID: user.id})
            } else {
                // New-submission flow: fetch the subproblem context so we
                // can label the page and (more importantly) decide
                // whether the series deadline has already passed.
                const ctx = await getSubproblemContext(authedFetch, mode.subproblemID)
                setNewCtx(ctx)
                let role: Role = 'none'
                if (user.is_admin) role = 'admin'
                else if (teacherIDs.has(ctx.math_center_id)) role = 'teacher'
                else if (studentCenterID === ctx.math_center_id) role = 'student'
                setMe({role, userID: user.id})
            }
        } catch (e) {
            setError(e instanceof APIErrorImpl ? e.message : 'Не удалось загрузить')
        }
        // modeKey is the stable serialization of mode; using it in deps
        // keeps us from re-running on every render of the inline IIFE.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [modeKey, user, authedFetch])

    useEffect(() => {
        void load()
    }, [load])

    useClaimHeartbeat(thread, me, authedFetchRaw)

    if (error) {
        return (
            <View style={s.wrap}>
                <BackLink onPress={() => navigate(-1)}/>
                <Card><ErrorBanner message={error}/></Card>
            </View>
        )
    }
    if (!mode) {
        return <Card style={{width: 720}}><ErrorBanner message="Некорректный URL"/></Card>
    }
    if (mode.kind === 'thread' && (!thread || !me)) {
        return <LoadingFrame onBack={() => navigate(-1)}/>
    }
    if (mode.kind === 'new' && (!newCtx || !me)) {
        return <LoadingFrame onBack={() => navigate(-1)}/>
    }

    return (
        <View style={s.wrap}>
            <BackLink onPress={() => navigate(-1)}/>
            {mode.kind === 'thread' && thread && me ? (
                <ThreadModeBody thread={thread} role={me.role} userID={me.userID} setThread={setThread} setError={setError}/>
            ) : null}
            {mode.kind === 'new' && newCtx && me ? (
                <NewModeBody ctx={newCtx} role={me.role} onCreated={t => {
                    setThread(t)
                    navigate(`/homework/threads/${t.id}`, {replace: true})
                }}/>
            ) : null}
        </View>
    )
}

function parseMode(threadID: string | undefined, subproblemID: string | undefined): Mode | null {
    if (threadID) {
        const n = Number.parseInt(threadID, 10)
        return Number.isFinite(n) ? {kind: 'thread', threadID: n} : null
    }
    if (subproblemID) {
        const n = Number.parseInt(subproblemID, 10)
        return Number.isFinite(n) ? {kind: 'new', subproblemID: n} : null
    }
    return null
}

// resolveRole maps the auth context to one of the four buckets the page
// branches on. Admin always wins; otherwise the center ID decides.
function resolveRole(
    user: {id: number; is_admin: boolean},
    teacherIDs: Set<number>,
    studentCenterID: number | undefined,
    threadCenterID: number,
    threadStudentID: number,
): Role {
    if (user.is_admin) return 'admin'
    if (teacherIDs.has(threadCenterID)) return 'teacher'
    if (studentCenterID === threadCenterID && threadStudentID === user.id) return 'student'
    return 'none'
}

// useClaimHeartbeat keeps the soft TTL claim alive while a grader who
// holds it is on the page, and releases it on unmount so it doesn't sit
// locked for the full 15-minute server-side TTL after the grader leaves.
function useClaimHeartbeat(thread: ThreadView | null, me: MeForCheck | null, authedFetchRaw: ReturnType<typeof useAuth>['authedFetchRaw']) {
    const heldByMe = !!thread
        && me?.role === 'teacher'
        && thread.claim_holder_user_id === me.userID
        && (!thread.claim_expires_at || new Date(thread.claim_expires_at).getTime() > Date.now())
    const claimIDRef = useRef<number | null>(null)
    useEffect(() => {
        if (!heldByMe || !thread) {
            claimIDRef.current = null
            return
        }
        claimIDRef.current = thread.id
        const tick = setInterval(() => {
            const id = claimIDRef.current
            if (id == null) return
            heartbeatClaim(authedFetchRaw, id).catch(() => undefined)
        }, 8 * 60 * 1000)
        return () => clearInterval(tick)
    }, [heldByMe, thread, authedFetchRaw])
    useEffect(() => {
        return () => {
            const id = claimIDRef.current
            if (id != null) {
                releaseClaim(authedFetchRaw, id).catch(() => undefined)
            }
        }
    }, [authedFetchRaw])
}

// LoadingFrame is the holding state shown while load() is in flight.
// Includes the back link so the user always has an exit even from a slow
// or stuck load.
function LoadingFrame({onBack}: {onBack: () => void}) {
    return (
        <View style={s.wrap}>
            <BackLink onPress={onBack}/>
            <Card><Subheading>Загрузка…</Subheading></Card>
        </View>
    )
}

function ThreadModeBody({thread, role, userID, setThread, setError}: {
    thread: ThreadView;
    role: Role;
    userID: number;
    setThread: (t: ThreadView) => void;
    setError: (msg: string) => void;
}) {
    const closed = isClosed(thread.series_due_at)
    return (
        <>
            <ThreadHeader thread={thread} userID={userID}/>
            <Timeline
                thread={thread}
                role={role}
                closed={closed}
                userID={userID}
                onUpdate={setThread}
            />
            <ActionPanel
                thread={thread}
                role={role}
                userID={userID}
                closed={closed}
                onUpdate={setThread}
                onError={setError}
            />
        </>
    )
}

function NewModeBody({ctx, role, onCreated}: {
    ctx: SubproblemContext;
    role: Role;
    onCreated: (t: ThreadView) => void;
}) {
    const closed = isClosed(ctx.series_due_at)
    return (
        <>
            <Card style={s.tightCard}>
                <View style={s.headerRow}>
                    <Text style={s.taskTitle}>{taskLabel(ctx)}</Text>
                </View>
                <Text style={s.muted}>Срок: {formatDateTime(ctx.series_due_at)}</Text>
            </Card>
            {closed ? (
                <Card style={s.tightCard}>
                    <Subheading>Серия закрыта — отправка новых решений недоступна.</Subheading>
                </Card>
            ) : (
                <NewSubmissionPanel subproblemID={ctx.subproblem_id} onCreated={onCreated} role={role}/>
            )}
        </>
    )
}

// taskLabel renders "Задача 3 (а)" / "Задача 3" depending on whether the
// subproblem has a real letter or is a sentinel.
function taskLabel(ctx: SubproblemContext): string {
    return ctx.subproblem_label
        ? `${ctx.problem_display} (${ctx.subproblem_label})`
        : ctx.problem_display
}

function BackLink({onPress}: {onPress: () => void}) {
    return (
        <Pressable onPress={onPress} style={s.back}>
            <Text style={s.backText}>← Назад</Text>
        </Pressable>
    )
}

function ThreadHeader({thread, userID}: {thread: ThreadView; userID: number}) {
    const status = thread.current_status
    const liveClaim = !!thread.claim_holder_user_id
        && (!thread.claim_expires_at || new Date(thread.claim_expires_at).getTime() > Date.now())
    const claimedByMe = liveClaim && thread.claim_holder_user_id === userID
    const claimedByOther = liveClaim && thread.claim_holder_user_id !== userID
    return (
        <Card style={claimedByMe ? {...s.tightCard, ...s.claimedByMeCard} : s.tightCard}>
            <View style={s.headerRow}>
                <View style={s.headerLeft}>
                    <Text style={s.taskTitle}>Задача</Text>
                    {claimedByMe ? (
                        <View style={s.youCheckBadge}>
                            <Text style={s.youCheckBadgeText}>На вашей проверке</Text>
                        </View>
                    ) : null}
                </View>
                <View style={[s.statusPill, {backgroundColor: statusBackgroundColor(status), borderColor: statusBorderColor(status)}]}>
                    <Text style={s.statusPillText}>{statusLabel(status)}</Text>
                </View>
            </View>
            {claimedByMe ? (
                <Text style={s.muted}>
                    Вы проверяете эту задачу
                    {thread.claim_expires_at ? ` — лок до ${formatDateTime(thread.claim_expires_at)}` : null}
                </Text>
            ) : claimedByOther ? (
                <Text style={s.muted}>
                    Проверяет: {userNameFromThread(thread, thread.claim_holder_user_id)}
                    {thread.claim_expires_at ? ` (до ${formatDateTime(thread.claim_expires_at)})` : null}
                </Text>
            ) : null}
        </Card>
    )
}

function Timeline({thread, role, closed, userID, onUpdate}: {
    thread: ThreadView;
    role: Role;
    closed: boolean;
    userID: number;
    onUpdate: (t: ThreadView) => void;
}) {
    const {authedFetch} = useAuth()
    const events = thread.events
    if (events.length === 0) {
        return <Card style={s.tightCard}><Text style={s.muted}>Пока ничего не отправлено.</Text></Card>
    }
    // The appeal panel attaches to the most recent rejection event so the
    // student sees it inline. Appeals stay allowed even after the deadline
    // — the user can still ask for a re-read of an existing attempt.
    const lastRejectionID = (() => {
        for (let i = events.length - 1; i >= 0; i--) {
            if (events[i].kind === 'graded' && events[i].verdict === 'rejected') return events[i].id
        }
        return -1
    })()
    const canAppeal = role === 'student' && thread.current_status === 'rejected'
    return (
        <Card style={s.tightCard}>
            <Heading>История</Heading>
            {events.map(ev => (
                <View key={ev.id}>
                    <EventCard event={ev} thread={thread} userID={userID}/>
                    {canAppeal && ev.id === lastRejectionID ? (
                        <InlineAppeal
                            onSubmit={async body => {
                                const t = await appealGrade(authedFetch, thread.subproblem_id, {
                                    event_uuid: newEventUUID(),
                                    body,
                                    object_keys: [],
                                })
                                onUpdate(t)
                            }}
                        />
                    ) : null}
                </View>
            ))}
            {/* `closed` informs sibling components; not used here directly. */}
            {void closed}
        </Card>
    )
}

function EventCard({event, thread, userID}: {event: EventView; thread: ThreadView; userID: number}) {
    const isStudent = event.actor_user_id === thread.student_user_id
    const accent = event.kind === 'graded'
        ? (event.verdict === 'accepted' ? '#15803d' : '#dc2626')
        : event.kind === 'appealed' ? '#7c3aed'
        : event.kind === 'retracted' ? colors.textMuted
        : isStudent ? colors.primary : colors.text
    const actorIsMe = event.actor_user_id === userID
    const actorName = actorIsMe ? 'Вы' : userNameFromThread(thread, event.actor_user_id)
    return (
        <View style={[s.event, {borderLeftColor: accent}]}>
            <View style={s.eventHeader}>
                <Text style={[s.eventKind, {color: accent}]}>
                    {eventKindLabel(event.kind, event.verdict)}
                </Text>
                <Text style={s.eventMeta}>
                    {actorName} · {formatDateTime(event.created_at)}
                </Text>
            </View>
            {event.body ? <Text style={s.eventBody}>{event.body}</Text> : null}
            {event.photos.length > 0 ? (
                <View style={s.photoRow}>
                    {event.photos.map(p => (
                        <a key={p.object_key} href={p.url} target="_blank" rel="noreferrer">
                            <img
                                src={p.url}
                                alt=""
                                style={{
                                    width: 96,
                                    height: 96,
                                    objectFit: 'cover',
                                    borderRadius: 6,
                                    background: '#f3f4f6',
                                    border: `1px solid ${colors.border}`,
                                    display: 'block',
                                }}
                            />
                        </a>
                    ))}
                </View>
            ) : null}
        </View>
    )
}

function InlineAppeal({onSubmit}: {onSubmit: (body: string) => Promise<void>}) {
    const [body, setBody] = useState('')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    return (
        <View style={s.appealBox}>
            {error ? <ErrorBanner message={error}/> : null}
            <Text style={s.appealLabel}>Подать апелляцию (без новых фото — это запрос на пересмотр текущей попытки)</Text>
            <textarea
                value={body}
                onChange={e => setBody(e.target.value)}
                placeholder="Что нужно перепроверить?"
                style={{
                    minHeight: 60,
                    width: '100%',
                    border: `1px solid ${colors.border}`,
                    borderRadius: 6,
                    padding: 8,
                    fontSize: 14,
                    color: colors.text,
                    backgroundColor: '#fff',
                    resize: 'vertical',
                    fontFamily: 'inherit',
                    boxSizing: 'border-box',
                }}
            />
            <View style={{alignSelf: 'flex-start'}}>
                <Button
                    title={busy ? 'Отправляем…' : 'Отправить апелляцию'}
                    disabled={busy || body.trim() === ''}
                    onPress={async () => {
                        setBusy(true)
                        setError(null)
                        try {
                            await onSubmit(body.trim())
                            setBody('')
                        } catch (e) {
                            setError(e instanceof APIErrorImpl ? e.message : 'Не удалось отправить')
                        } finally {
                            setBusy(false)
                        }
                    }}
                />
            </View>
        </View>
    )
}

function ActionPanel({thread, role, userID, closed, onUpdate, onError}: {
    thread: ThreadView;
    role: Role;
    userID: number;
    closed: boolean;
    onUpdate: (t: ThreadView) => void;
    onError: (msg: string) => void;
}) {
    const {authedFetch} = useAuth()

    if (role === 'student') {
        // After the deadline the student can still appeal (inline in the
        // timeline) but they can no longer SEND a new attempt — neither
        // a first submission for an ungraded problem nor a resubmission
        // after rejection. The submit form is removed entirely.
        if (closed) return null
        if (thread.current_status === 'rejected' || thread.current_status === 'ungraded') {
            return (
                <Card style={s.tightCard}>
                    <Heading>
                        {thread.current_status === 'rejected' ? 'Отправить новое решение' : 'Отправить решение'}
                    </Heading>
                    <SubmitForm
                        purpose="submit"
                        presignKind="student"
                        presignID={thread.subproblem_id}
                        onSubmit={async args => {
                            const t = await submitAttempt(authedFetch, thread.subproblem_id, args)
                            onUpdate(t)
                        }}
                        submitLabel="Отправить решение"
                        bodyPlaceholder="Комментарий к решению (необязательно)…"
                    />
                </Card>
            )
        }
        return null
    }

    if (role === 'teacher' || role === 'admin') {
        const claimHolder = thread.claim_holder_user_id
        const claimLive = claimHolder != null && (!thread.claim_expires_at || new Date(thread.claim_expires_at).getTime() > Date.now())
        const heldByMe = claimLive && claimHolder === userID
        const canGrade = (thread.current_status === 'submitted' || thread.current_status === 'appealed') && heldByMe
        const canClaim = (thread.current_status === 'submitted' || thread.current_status === 'appealed') && !claimLive
        const canRetract = (thread.current_status === 'accepted' || thread.current_status === 'rejected')
            && (role === 'admin' || thread.last_grader_user_id === userID)

        return (
            <>
                {canClaim ? (
                    <Card style={s.tightCard}>
                        <Button
                            title="Взять в проверку"
                            onPress={async () => {
                                try {
                                    const t = await claimThread(authedFetch, thread.id)
                                    onUpdate(t)
                                } catch (e) {
                                    onError(e instanceof APIErrorImpl ? e.message : 'Не удалось занять задачу')
                                }
                            }}
                        />
                        <Text style={[s.muted, {marginTop: 6}]}>Лок на 15 минут с автопродлением.</Text>
                    </Card>
                ) : null}
                {canGrade ? (
                    <Card style={s.tightCard}>
                        <Heading>Поставить оценку</Heading>
                        <SubmitForm
                            purpose="grade"
                            presignKind="grader"
                            presignID={thread.id}
                            bodyRequired
                            showVerdictControls
                            onSubmit={async args => {
                                if (!args.verdict) return
                                const t = await gradeThread(authedFetch, thread.id, {
                                    verdict: args.verdict,
                                    body: args.body,
                                    event_uuid: args.event_uuid,
                                    object_keys: args.object_keys,
                                })
                                onUpdate(t)
                            }}
                            submitLabel="Сохранить оценку"
                            bodyPlaceholder="Что не так / что верно?"
                        />
                    </Card>
                ) : null}
                {claimLive && !heldByMe ? (
                    <Card style={s.tightCard}>
                        <Text style={s.muted}>
                            Сейчас задача занята: {userNameFromThread(thread, thread.claim_holder_user_id)}.
                        </Text>
                    </Card>
                ) : null}
                {canRetract ? (
                    <Card style={s.tightCard}>
                        <RetractPanel
                            threadID={thread.id}
                            onRetracted={onUpdate}
                        />
                    </Card>
                ) : null}
            </>
        )
    }

    return null
}

function RetractPanel({threadID, onRetracted}: {threadID: number; onRetracted: (t: ThreadView) => void}) {
    const {authedFetch} = useAuth()
    const [reason, setReason] = useState('')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    return (
        <View style={{gap: 8} as any}>
            {error ? <ErrorBanner message={error}/> : null}
            <Text style={s.appealLabel}>Отозвать оценку (вернёт задачу к предыдущему состоянию)</Text>
            <textarea
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder="Причина (необязательно)"
                style={{
                    minHeight: 50,
                    width: '100%',
                    border: `1px solid ${colors.border}`,
                    borderRadius: 6,
                    padding: 8,
                    fontSize: 14,
                    color: colors.text,
                    backgroundColor: '#fff',
                    resize: 'vertical',
                    fontFamily: 'inherit',
                    boxSizing: 'border-box',
                }}
            />
            <View style={{alignSelf: 'flex-start'}}>
                <Button
                    title={busy ? 'Отзываем…' : 'Отозвать оценку'}
                    variant="danger"
                    disabled={busy}
                    onPress={async () => {
                        setBusy(true)
                        setError(null)
                        try {
                            const t = await retractGrade(authedFetch, threadID, reason)
                            onRetracted(t)
                            setReason('')
                        } catch (e) {
                            setError(e instanceof APIErrorImpl ? e.message : 'Не удалось отозвать')
                        } finally {
                            setBusy(false)
                        }
                    }}
                />
            </View>
        </View>
    )
}

function NewSubmissionPanel({subproblemID, onCreated, role}: {
    subproblemID: number;
    onCreated: (t: ThreadView) => void;
    role: Role;
}) {
    const {authedFetch} = useAuth()
    // Only students get the submit form. Teachers/admins shouldn't be
    // landing here in practice (their tile clicks go to existing threads),
    // but if they do we show a neutral message rather than a useless form.
    if (role !== 'student') {
        return (
            <Card style={s.tightCard}>
                <Subheading>Решение может отправить только ученик.</Subheading>
            </Card>
        )
    }
    return (
        <Card style={s.tightCard}>
            <Heading>Отправить решение</Heading>
            <SubmitForm
                purpose="submit"
                presignKind="student"
                presignID={subproblemID}
                onSubmit={async args => {
                    const t = await submitAttempt(authedFetch, subproblemID, args)
                    onCreated(t)
                }}
                submitLabel="Отправить решение"
                bodyPlaceholder="Комментарий к решению (необязательно)…"
            />
        </Card>
    )
}

const s = StyleSheet.create({
    wrap: {width: 760, gap: 12} as any,
    back: {alignSelf: 'flex-start', paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6},
    backText: {fontSize: 14, fontWeight: '500', color: colors.primary},
    tightCard: {paddingVertical: 16, paddingHorizontal: 18},
    headerRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12} as any,
    taskTitle: {fontSize: 18, fontWeight: '600', color: colors.text},
    headerLeft: {flexDirection: 'row', alignItems: 'center', gap: 8} as any,
    statusPill: {
        paddingHorizontal: 10,
        paddingVertical: 3,
        borderRadius: 999,
        borderWidth: 1,
    },
    // Visual cue that this is the task the current user is grading.
    // A bright primary border around the whole card makes it stand out at
    // a glance against the rest of the (calm) page chrome.
    claimedByMeCard: {
        borderColor: colors.primary,
        borderWidth: 2,
        backgroundColor: '#eff6ff',
    },
    youCheckBadge: {
        backgroundColor: colors.primary,
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 999,
    },
    youCheckBadgeText: {fontSize: 11, fontWeight: '700', color: '#fff', letterSpacing: 0.3},
    statusPillText: {fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, color: colors.text},
    muted: {fontSize: 12, color: colors.textMuted},
    event: {
        borderLeftWidth: 3,
        paddingLeft: 10,
        paddingVertical: 8,
        marginTop: 8,
    },
    eventHeader: {flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4},
    eventKind: {fontSize: 13, fontWeight: '700'},
    eventMeta: {fontSize: 11, color: colors.textMuted},
    eventBody: {fontSize: 14, color: colors.text, marginTop: 4, marginBottom: 4},
    photoRow: {flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6} as any,
    appealBox: {
        marginLeft: 13,
        marginTop: 8,
        marginBottom: 4,
        gap: 8,
        padding: 10,
        backgroundColor: '#faf5ff',
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#e9d5ff',
    } as any,
    appealLabel: {fontSize: 12, color: colors.textMuted, fontStyle: 'italic'},
})
