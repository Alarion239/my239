import {ReactNode} from 'react'
import {Pressable, StyleSheet, Text, View} from 'react-native'
import {Link, useLocation, useNavigate} from 'react-router-dom'
import {useAuth} from '../auth'
import {colors} from './ui'

// Layout renders the top nav bar (Profile / Admin / Logout) and a centered
// content well. Public pages (login/register) skip this and render bare.
export function Layout({children}: { children: ReactNode }) {
    const {user, logout} = useAuth()
    const navigate = useNavigate()
    const location = useLocation()

    return (
        <View style={s.root}>
            <View style={s.nav}>
                <Text style={s.brand}>my239</Text>
                <View style={s.navRight}>
                    <NavLink to="/profile" current={location.pathname}>Profile</NavLink>
                    {user?.is_admin ? (
                        <>
                            <NavLink to="/admin/users" current={location.pathname}>Users</NavLink>
                            <NavLink to="/admin/tokens" current={location.pathname}>Tokens</NavLink>
                        </>
                    ) : null}
                    <Pressable
                        onPress={async () => {
                            await logout()
                            navigate('/login')
                        }}
                        style={s.logout}
                    >
                        <Text style={s.logoutText}>Logout</Text>
                    </Pressable>
                </View>
            </View>
            <View style={s.content}>{children}</View>
        </View>
    )
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
