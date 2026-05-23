import {type ReactNode, useEffect, useState} from 'react'
import {Link, useLocation, useNavigate} from 'react-router-dom'
import {useAuth} from '../auth'

// /mathcenter/me is the source of truth for the user's center membership.
// Cache its grade(s) so the nav bar doesn't refetch on every route change.
interface CenterRoles {
    grades: number[]   // every grade the user is in (student + every teacher center)
}
let centerCache: {userID: number; roles: CenterRoles} | null = null
let centerInflight: Promise<CenterRoles> | null = null

interface MathCenterMe {
    teacher?: {centers: Array<{grade: number}>}
    student?: {center: {grade: number}}
}

function deriveRoles(me: MathCenterMe): CenterRoles {
    const grades = new Set<number>()
    for (const c of me.teacher?.centers ?? []) grades.add(c.grade)
    if (me.student) grades.add(me.student.center.grade)
    return {grades: Array.from(grades).sort((a, b) => a - b)}
}

export function Layout({children}: {children: ReactNode}) {
    const {user, authedFetch, logout} = useAuth()
    const navigate = useNavigate()
    const location = useLocation()
    const brand = useBrand(user, authedFetch)

    return (
        <div className="min-h-screen bg-page">
            <nav className="flex items-center justify-between px-6 py-3 bg-card border-b border-card-border">
                <span className="text-lg font-bold text-ink">{brand}</span>
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
                            centerCache = null
                            centerInflight = null
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

// useBrand resolves the nav-bar brand label. When the user is in exactly
// one grade (student, or teacher of a single center), it surfaces that
// grade — "Матцентр 10 класс" — so the per-page header can drop its
// redundant "10-й класс — выпуск …" tile.
function useBrand(
    user: ReturnType<typeof useAuth>['user'],
    authedFetch: ReturnType<typeof useAuth>['authedFetch'],
): string {
    function label(roles: CenterRoles | null): string {
        if (!roles || roles.grades.length === 0) return 'Матцентр'
        if (roles.grades.length === 1) return `Матцентр ${roles.grades[0]} класс`
        return 'Матцентр'
    }

    const initial = (() => {
        if (!user) return 'Матцентр'
        if (centerCache && centerCache.userID === user.id) return label(centerCache.roles)
        return 'Матцентр'
    })()
    const [brand, setBrand] = useState<string>(initial)

    useEffect(() => {
        if (!user) {
            setBrand('Матцентр')
            return
        }
        if (centerCache && centerCache.userID === user.id) {
            setBrand(label(centerCache.roles))
            return
        }
        let cancelled = false
        if (!centerInflight) {
            const uid = user.id
            centerInflight = authedFetch<MathCenterMe>('/mathcenter/me')
                .then(deriveRoles)
                .catch(() => ({grades: []}))
                .then(roles => {
                    centerCache = {userID: uid, roles}
                    centerInflight = null
                    return roles
                })
        }
        centerInflight.then(roles => {
            if (!cancelled) setBrand(label(roles))
        })
        return () => {
            cancelled = true
        }
    }, [user, authedFetch])

    return brand
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
