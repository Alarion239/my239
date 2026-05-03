import {ReactNode} from 'react'
import {ActivityIndicator, StyleSheet, Text, View} from 'react-native'
import {Navigate, Route, Routes} from 'react-router-dom'
import {useAuth} from './auth'
import {Layout} from './components/Layout'
import {colors} from './components/ui'
import LoginPage from './pages/Login'
import RegisterPage from './pages/Register'
import ProfilePage from './pages/Profile'
import MathCenterPage from './pages/MathCenter'
import AdminUsersPage from './pages/AdminUsers'
import AdminTokensPage from './pages/AdminTokens'
import AdminMathCenterPage from './pages/AdminMathCenter'

// App is the route table. RequireAuth gates the authenticated pages, and
// RequireAdmin layers an extra check on top of it for /admin/*.
export default function App() {
    const {loading} = useAuth()
    if (loading) return <Splash/>

    return (
        <Routes>
            <Route path="/login" element={<LoginPage/>}/>
            <Route path="/register" element={<RegisterPage/>}/>

            <Route
                path="/profile"
                element={
                    <RequireAuth>
                        <Layout>
                            <ProfilePage/>
                        </Layout>
                    </RequireAuth>
                }
            />

            <Route
                path="/mathcenter"
                element={
                    <RequireAuth>
                        <Layout>
                            <MathCenterPage/>
                        </Layout>
                    </RequireAuth>
                }
            />

            <Route
                path="/admin/users"
                element={
                    <RequireAuth>
                        <RequireAdmin>
                            <Layout>
                                <AdminUsersPage/>
                            </Layout>
                        </RequireAdmin>
                    </RequireAuth>
                }
            />
            <Route
                path="/admin/tokens"
                element={
                    <RequireAuth>
                        <RequireAdmin>
                            <Layout>
                                <AdminTokensPage/>
                            </Layout>
                        </RequireAdmin>
                    </RequireAuth>
                }
            />
            <Route
                path="/admin/mathcenter"
                element={
                    <RequireAuth>
                        <RequireAdmin>
                            <Layout>
                                <AdminMathCenterPage/>
                            </Layout>
                        </RequireAdmin>
                    </RequireAuth>
                }
            />

            <Route path="*" element={<Navigate to="/profile" replace/>}/>
        </Routes>
    )
}

function RequireAuth({children}: { children: ReactNode }) {
    const {user} = useAuth()
    if (!user) return <Navigate to="/login" replace/>
    return <>{children}</>
}

function RequireAdmin({children}: { children: ReactNode }) {
    const {user} = useAuth()
    if (!user?.is_admin) return <Navigate to="/profile" replace/>
    return <>{children}</>
}

function Splash() {
    return (
        <View style={s.splash}>
            <ActivityIndicator size="large" color={colors.primary}/>
            <Text style={s.splashText}>Loading…</Text>
        </View>
    )
}

const s = StyleSheet.create({
    splash: {
        flex: 1,
        minHeight: '100vh' as any,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.bg,
    },
    splashText: {marginTop: 12, color: colors.textMuted, fontSize: 14},
})
