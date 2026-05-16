import {type ReactNode, useEffect, useState} from 'react'
import {Link, useLocation, useNavigate} from 'react-router-dom'
import {useAuth} from '../auth'

// Module-level cache so we don't refetch /mathcenter/me on every page nav
// (Layout remounts per route). Keyed by user id so a logout-then-login
// with a different user invalidates correctly.
let teacherCheckCache: {userID: number; isTeacher: boolean} | null = null
let teacherCheckInflight: Promise<boolean> | null = null

// Layout renders the top nav bar and a centered content well. Public pages
// (login/register) skip this and render bare.
//
// The Домашка tab has been retired — Матцентр is the unified hub for
// both roles. /homework/* URLs still resolve for direct/deep links.
export function Layout({children}: {children: ReactNode}) {
    const {user, authedFetch, logout} = useAuth()
    const navigate = useNavigate()
    const location = useLocation()

    // Kept for backwards-compat — currently always renders nothing in
    // the nav, but the side-effect (precomputing the role) is useful
    // since downstream surfaces (HomeworkSeries, MathCenter) also need
    // to know whether the user teaches anywhere.
    useShowHomeworkLink(user, authedFetch)

    return (
        <div className="min-h-screen bg-page">
            <nav className="flex items-center justify-between px-6 py-3 bg-card border-b border-card-border">
                <span className="text-lg font-bold text-ink">my239</span>
                <div className="flex items-center gap-4">
                    <NavLink to="/profile" current={location.pathname}>Профиль</NavLink>
                    <NavLink to="/mathcenter" current={location.pathname}>Матцентр</NavLink>
                    {user?.is_admin ? (
                        <>
                            <NavLink to="/admin/users" current={location.pathname}>Пользователи</NavLink>
                            <NavLink to="/admin/tokens" current={location.pathname}>Токены</NavLink>
                            <NavLink to="/admin/mathcenter" current={location.pathname}>Управление МЦ</NavLink>
                        </>
                    ) : null}
                    <button
                        type="button"
                        onClick={async () => {
                            await logout()
                            // Clear the role cache so the next user's nav
                            // is computed fresh.
                            teacherCheckCache = null
                            teacherCheckInflight = null
                            navigate('/login')
                        }}
                        className="px-3 py-1.5 rounded-md bg-[#eef2f7] text-[13px] font-medium text-ink hover:bg-[#e5e9f0]"
                    >
                        Выйти
                    </button>
                </div>
            </nav>
            <div className="px-8 py-8 flex justify-center">{children}</div>
        </div>
    )
}

// useShowHomeworkLink — kept as a hook so downstream surfaces can call
// it later if needed. Returns true when the caller teaches in at least
// one center (or is admin). Caches the answer in module state across
// navigations within a single user session.
function useShowHomeworkLink(
    user: ReturnType<typeof useAuth>['user'],
    authedFetch: ReturnType<typeof useAuth>['authedFetch'],
): boolean {
    const initial = (() => {
        if (!user) return false
        if (user.is_admin) return true
        if (teacherCheckCache && teacherCheckCache.userID === user.id) return teacherCheckCache.isTeacher
        return false
    })()
    const [show, setShow] = useState<boolean>(initial)

    useEffect(() => {
        if (!user) {
            setShow(false)
            return
        }
        if (user.is_admin) {
            setShow(true)
            return
        }
        if (teacherCheckCache && teacherCheckCache.userID === user.id) {
            setShow(teacherCheckCache.isTeacher)
            return
        }
        let cancelled = false
        if (!teacherCheckInflight) {
            const uid = user.id
            teacherCheckInflight = authedFetch<{teacher?: {centers: Array<unknown>}}>('/mathcenter/me')
                .then(me => (me.teacher?.centers ?? []).length > 0)
                .catch(() => false)
                .then(t => {
                    teacherCheckCache = {userID: uid, isTeacher: t}
                    teacherCheckInflight = null
                    return t
                })
        }
        teacherCheckInflight.then(t => {
            if (!cancelled) setShow(t)
        })
        return () => {
            cancelled = true
        }
    }, [user, authedFetch])

    return show
}

function NavLink({to, current, children}: {to: string; current: string; children: ReactNode}) {
    const active = current === to || (to !== '/' && current.startsWith(to))
    return (
        <Link
            to={to}
            className={`text-sm font-medium no-underline ${active ? 'text-primary' : 'text-muted hover:text-ink'}`}
        >
            {children}
        </Link>
    )
}
