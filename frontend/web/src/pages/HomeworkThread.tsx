// HomeworkThread shows the timeline of a single (student, subproblem)
// thread plus a role-appropriate compact action panel. After the
// series deadline the submit form is hidden entirely — only the
// history and the inline appeal panel remain available to the
// student. The backend would 409 a late submit anyway, but the form
// is removed so the student isn't nudged toward an action they can't
// actually take.
//
// The page is also used at /homework/new/:subproblemID for first-time
// submissions; an outer route wrapper key-remounts the inner
// component on every URL change so hooks reset cleanly and we don't
// render with stale state across navigations.

import {useCallback, useEffect, useRef, useState} from 'react'
import {useNavigate, useParams} from 'react-router-dom'
import {APIErrorImpl} from '../api'
import {
    type EventView,
    type SubproblemContext,
    type ThreadView,
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

const tightCardClass = '!py-4 !px-[18px]'

// Outer route wrapper: re-keys the inner component on every URL change
// so hooks reset cleanly across thread/new navigations.
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

    const modeKey = mode?.kind === 'thread'
        ? `t:${mode.threadID}`
        : mode?.kind === 'new'
            ? `n:${mode.subproblemID}`
            : 'none'

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
                setMe({
                    role: resolveRole(user, teacherIDs, studentCenterID, t.math_center_id, t.student_user_id),
                    userID: user.id,
                })
            } else {
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [modeKey, user, authedFetch])

    useEffect(() => {
        void load()
    }, [load])

    useClaimHeartbeat(thread, me, authedFetchRaw)

    if (error) {
        return (
            <div className="w-[760px] flex flex-col gap-3">
                <BackLink onPress={() => navigate(-1)}/>
                <Card><ErrorBanner message={error}/></Card>
            </div>
        )
    }
    if (!mode) {
        return <Card className="w-[720px]"><ErrorBanner message="Некорректный URL"/></Card>
    }
    if (mode.kind === 'thread' && (!thread || !me)) {
        return <LoadingFrame onBack={() => navigate(-1)}/>
    }
    if (mode.kind === 'new' && (!newCtx || !me)) {
        return <LoadingFrame onBack={() => navigate(-1)}/>
    }

    return (
        <div className="w-[760px] flex flex-col gap-3">
            <BackLink onPress={() => navigate(-1)}/>
            {mode.kind === 'thread' && thread && me ? (
                <ThreadModeBody
                    thread={thread}
                    role={me.role}
                    userID={me.userID}
                    setThread={setThread}
                    setError={setError}
                />
            ) : null}
            {mode.kind === 'new' && newCtx && me ? (
                <NewModeBody
                    ctx={newCtx}
                    role={me.role}
                    onCreated={t => {
                        setThread(t)
                        navigate(`/homework/threads/${t.id}`, {replace: true})
                    }}
                />
            ) : null}
        </div>
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

function useClaimHeartbeat(
    thread: ThreadView | null,
    me: MeForCheck | null,
    authedFetchRaw: ReturnType<typeof useAuth>['authedFetchRaw'],
) {
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

function LoadingFrame({onBack}: {onBack: () => void}) {
    return (
        <div className="w-[760px] flex flex-col gap-3">
            <BackLink onPress={onBack}/>
            <Card><Subheading>Загрузка…</Subheading></Card>
        </div>
    )
}

function ThreadModeBody({thread, role, userID, setThread, setError}: {
    thread: ThreadView
    role: Role
    userID: number
    setThread: (t: ThreadView) => void
    setError: (msg: string) => void
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
    ctx: SubproblemContext
    role: Role
    onCreated: (t: ThreadView) => void
}) {
    const closed = isClosed(ctx.series_due_at)
    return (
        <>
            <Card className={tightCardClass}>
                <h3 className="text-lg font-semibold text-ink">{taskLabel(ctx)}</h3>
                <p className="text-xs text-muted">Срок: {formatDateTime(ctx.series_due_at)}</p>
            </Card>
            {closed ? (
                <Card className={tightCardClass}>
                    <Subheading>Серия закрыта — отправка новых решений недоступна.</Subheading>
                </Card>
            ) : (
                <NewSubmissionPanel subproblemID={ctx.subproblem_id} onCreated={onCreated} role={role}/>
            )}
        </>
    )
}

function taskLabel(ctx: SubproblemContext): string {
    return ctx.subproblem_label
        ? `${ctx.problem_display} (${ctx.subproblem_label})`
        : ctx.problem_display
}

function BackLink({onPress}: {onPress: () => void}) {
    return (
        <button
            type="button"
            onClick={onPress}
            className="self-start px-2 py-1 rounded-md text-sm font-medium text-primary hover:bg-page"
        >
            ← Назад
        </button>
    )
}

function ThreadHeader({thread, userID}: {thread: ThreadView; userID: number}) {
    const status = thread.current_status
    const liveClaim = !!thread.claim_holder_user_id
        && (!thread.claim_expires_at || new Date(thread.claim_expires_at).getTime() > Date.now())
    const claimedByMe = liveClaim && thread.claim_holder_user_id === userID
    const claimedByOther = liveClaim && thread.claim_holder_user_id !== userID
    const cardClass = claimedByMe
        ? `${tightCardClass} !border-2 !border-primary !bg-[#eff6ff]`
        : tightCardClass
    return (
        <Card className={cardClass}>
            <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <h3 className="text-lg font-semibold text-ink">Задача</h3>
                    {claimedByMe ? (
                        <div className="bg-primary px-2 py-0.5 rounded-full">
                            <span className="text-[11px] font-bold text-white tracking-wide">На вашей проверке</span>
                        </div>
                    ) : null}
                </div>
                <div
                    className="px-2.5 py-0.5 rounded-full border"
                    style={{backgroundColor: statusBackgroundColor(status), borderColor: statusBorderColor(status)}}
                >
                    <span className="text-[11px] font-bold uppercase tracking-wide text-ink">
                        {statusLabel(status)}
                    </span>
                </div>
            </div>
            {claimedByMe ? (
                <p className="text-xs text-muted mt-2">
                    Вы проверяете эту задачу
                    {thread.claim_expires_at ? ` — лок до ${formatDateTime(thread.claim_expires_at)}` : null}
                </p>
            ) : claimedByOther ? (
                <p className="text-xs text-muted mt-2">
                    Проверяет: {userNameFromThread(thread, thread.claim_holder_user_id)}
                    {thread.claim_expires_at ? ` (до ${formatDateTime(thread.claim_expires_at)})` : null}
                </p>
            ) : null}
        </Card>
    )
}

function Timeline({thread, role, closed, userID, onUpdate}: {
    thread: ThreadView
    role: Role
    closed: boolean
    userID: number
    onUpdate: (t: ThreadView) => void
}) {
    const {authedFetch} = useAuth()
    const events = thread.events
    if (events.length === 0) {
        return (
            <Card className={tightCardClass}>
                <p className="text-xs text-muted">Пока ничего не отправлено.</p>
            </Card>
        )
    }
    const lastRejectionID = (() => {
        for (let i = events.length - 1; i >= 0; i--) {
            if (events[i].kind === 'graded' && events[i].verdict === 'rejected') return events[i].id
        }
        return -1
    })()
    const canAppeal = role === 'student' && thread.current_status === 'rejected'
    void closed // informs sibling components; not used here directly.
    return (
        <Card className={tightCardClass}>
            <Heading>История</Heading>
            {events.map(ev => (
                <div key={ev.id}>
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
                </div>
            ))}
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
        <div className="border-l-[3px] pl-2.5 py-2 mt-2" style={{borderLeftColor: accent}}>
            <div className="flex justify-between mb-1">
                <span className="text-[13px] font-bold" style={{color: accent}}>
                    {eventKindLabel(event.kind, event.verdict)}
                </span>
                <span className="text-[11px] text-muted">
                    {actorName} · {formatDateTime(event.created_at)}
                </span>
            </div>
            {event.body ? <p className="text-sm text-ink mt-1 mb-1">{event.body}</p> : null}
            {event.photos.length > 0 ? (
                <div className="flex flex-wrap gap-2 mt-1.5">
                    {event.photos.map(p => (
                        <a key={p.object_key} href={p.url} target="_blank" rel="noreferrer">
                            <img
                                src={p.url}
                                alt=""
                                className="w-24 h-24 object-cover rounded-md border border-card-border bg-[#f3f4f6] block"
                            />
                        </a>
                    ))}
                </div>
            ) : null}
        </div>
    )
}

function InlineAppeal({onSubmit}: {onSubmit: (body: string) => Promise<void>}) {
    const [body, setBody] = useState('')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    return (
        <div className="ml-3 mt-2 mb-1 flex flex-col gap-2 p-2.5 bg-[#faf5ff] rounded-lg border border-[#e9d5ff]">
            {error ? <ErrorBanner message={error}/> : null}
            <p className="text-xs italic text-muted">
                Подать апелляцию (без новых фото — это запрос на пересмотр текущей попытки)
            </p>
            <textarea
                value={body}
                onChange={e => setBody(e.target.value)}
                placeholder="Что нужно перепроверить?"
                className="min-h-[60px] w-full rounded-md border border-card-border bg-white p-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary/30 resize-y"
            />
            <div className="self-start">
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
            </div>
        </div>
    )
}

function ActionPanel({thread, role, userID, closed, onUpdate, onError}: {
    thread: ThreadView
    role: Role
    userID: number
    closed: boolean
    onUpdate: (t: ThreadView) => void
    onError: (msg: string) => void
}) {
    const {authedFetch} = useAuth()

    if (role === 'student') {
        if (closed) return null
        if (thread.current_status === 'rejected' || thread.current_status === 'ungraded') {
            return (
                <Card className={tightCardClass}>
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
        const claimLive = claimHolder != null
            && (!thread.claim_expires_at || new Date(thread.claim_expires_at).getTime() > Date.now())
        const heldByMe = claimLive && claimHolder === userID
        const canGrade = (thread.current_status === 'submitted' || thread.current_status === 'appealed') && heldByMe
        const canClaim = (thread.current_status === 'submitted' || thread.current_status === 'appealed') && !claimLive
        const canRetract = (thread.current_status === 'accepted' || thread.current_status === 'rejected')
            && (role === 'admin' || thread.last_grader_user_id === userID)

        return (
            <>
                {canClaim ? (
                    <Card className={tightCardClass}>
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
                        <p className="text-xs text-muted mt-1.5">Лок на 15 минут с автопродлением.</p>
                    </Card>
                ) : null}
                {canGrade ? (
                    <Card className={tightCardClass}>
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
                    <Card className={tightCardClass}>
                        <p className="text-xs text-muted">
                            Сейчас задача занята: {userNameFromThread(thread, thread.claim_holder_user_id)}.
                        </p>
                    </Card>
                ) : null}
                {canRetract ? (
                    <Card className={tightCardClass}>
                        <RetractPanel threadID={thread.id} onRetracted={onUpdate}/>
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
        <div className="flex flex-col gap-2">
            {error ? <ErrorBanner message={error}/> : null}
            <p className="text-xs italic text-muted">
                Отозвать оценку (вернёт задачу к предыдущему состоянию)
            </p>
            <textarea
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder="Причина (необязательно)"
                className="min-h-[50px] w-full rounded-md border border-card-border bg-white p-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary/30 resize-y"
            />
            <div className="self-start">
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
            </div>
        </div>
    )
}

function NewSubmissionPanel({subproblemID, onCreated, role}: {
    subproblemID: number
    onCreated: (t: ThreadView) => void
    role: Role
}) {
    const {authedFetch} = useAuth()
    if (role !== 'student') {
        return (
            <Card className={tightCardClass}>
                <Subheading>Решение может отправить только ученик.</Subheading>
            </Card>
        )
    }
    return (
        <Card className={tightCardClass}>
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
