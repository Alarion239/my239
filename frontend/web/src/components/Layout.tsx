import {ReactNode, useEffect, useState} from 'react'
import {Pressable, StyleSheet, Text, View} from 'react-native'
import {Link, useLocation, useNavigate} from 'react-router-dom'
import {useAuth} from '../auth'
import {colors} from './ui'

// Module-level cache so we don't refetch /mathcenter/me on every page nav
// (Layout remounts per route). Keyed by user id so a logout-then-login
// with a different user invalidates correctly.
let teacherCheckCache: {userID: number; isTeacher: boolean} | null = null
let teacherCheckInflight: Promise<boolean> | null = null

// Layout renders the top nav bar and a centered content well. Public pages
// (login/register) skip this and render bare.
//
// The Домашка tab is hidden for student-only users — they get the unified
// homework hub on the Матцентр page. Admins and teachers still see it.
export function Layout({children}: { children: ReactNode }) {
    const {user, authedFetch, logout} = useAuth()
    const navigate = useNavigate()
    const location = useLocation()

    const showHomework = useShowHomeworkLink(user, authedFetch)

    return (
        <View style={s.root}>
            <View style={s.nav}>
                <Text style={s.brand}>my239</Text>
                <View style={s.navRight}>
                    <NavLink to="/profile" current={location.pathname}>Профиль</NavLink>
                    <NavLink to="/mathcenter" current={location.pathname}>Матцентр</NavLink>
                    {/*
                      The Домашка tab is gone — Матцентр is now the unified
                      hub for both roles. Teachers get the spreadsheet +
                      side-panel editor there; students get series-with-
                      progress cards there. /homework/* URLs still resolve
                      for direct/deep links, just not surfaced in the nav.
                      `showHomework` is still consulted for backwards-compat
                      with bookmarks-as-tabs, but defaults to off.
                    */}
                    {showHomework ? null : null}
                    {user?.is_admin ? (
                        <>
                            <NavLink to="/admin/users" current={location.pathname}>Пользователи</NavLink>
                            <NavLink to="/admin/tokens" current={location.pathname}>Токены</NavLink>
                            <NavLink to="/admin/mathcenter" current={location.pathname}>Управление МЦ</NavLink>
                        </>
                    ) : null}
                    <Pressable
                        onPress={async () => {
                            await logout()
                            // Clear the role cache so the next user's nav
                            // is computed fresh (a teacher logging in
                            // after a student should immediately see Домашка).
                            teacherCheckCache = null
                            teacherCheckInflight = null
                            await navigate('/login')
                        }}
                        style={s.logout}
                    >
                        <Text style={s.logoutText}>Выйти</Text>
                    </Pressable>
                </View>
            </View>
            <View style={s.content}>{children}</View>
        </View>
    )
}

// useShowHomeworkLink decides whether to show the Домашка tab. Admins
// always see it; everyone else only if they teach in at least one math
// center. While the check is in flight we err on the side of HIDDEN so
// students never see a brief flash of the unwanted link.
function useShowHomeworkLink(user: ReturnType<typeof useAuth>['user'], authedFetch: ReturnType<typeof useAuth>['authedFetch']): boolean {
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

function NavLink({to, current, children}: { to: string; current: string; children: ReactNode }) {
    const active = current === to || (to !== '/' && current.startsWith(to))
    return (
        <Link to={to} style={{textDecoration: 'none'} as any}>
            <Text style={[s.navLink, active && s.navLinkActive]}>{children}</Text>
        </Link>
    )
}

const s = StyleSheet.create({
    root: {minHeight: '100vh' as any, backgroundColor: colors.bg},
    nav: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 24,
        paddingVertical: 12,
        backgroundColor: colors.surface,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    brand: {fontSize: 18, fontWeight: '700', color: colors.text},
    navRight: {flexDirection: 'row', alignItems: 'center', gap: 16} as any,
    navLink: {fontSize: 14, color: colors.textMuted, fontWeight: '500'},
    navLinkActive: {color: colors.primary},
    logout: {
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: 6,
        backgroundColor: '#eef2f7',
    },
    logoutText: {fontSize: 13, color: colors.text, fontWeight: '500'},
    content: {padding: 32, alignItems: 'center'},
})
