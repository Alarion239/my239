import {type ReactNode} from 'react'
import {Navigate, Route, Routes} from 'react-router-dom'
import {useAuth} from './auth'
import {Layout} from './components/Layout'
import LoginPage from './pages/Login'
import RegisterPage from './pages/Register'
import ProfilePage from './pages/Profile'
import MathCenterPage from './pages/MathCenter'
import HomeworkPage from './pages/Homework'
import HomeworkSeriesPage from './pages/HomeworkSeries'
import HomeworkThreadPage from './pages/HomeworkThread'
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
                path="/homework"
                element={
                    <RequireAuth>
                        <Layout>
                            <HomeworkPage/>
                        </Layout>
                    </RequireAuth>
                }
            />
            <Route
                path="/homework/series/:seriesID"
                element={
                    <RequireAuth>
                        <Layout>
                            <HomeworkSeriesPage/>
                        </Layout>
                    </RequireAuth>
                }
            />
            <Route
                path="/homework/threads/:threadID"
                element={
                    <RequireAuth>
                        <Layout>
                            <HomeworkThreadPage/>
                        </Layout>
                    </RequireAuth>
                }
            />
            <Route
                path="/homework/new/:subproblemID"
                element={
                    <RequireAuth>
                        <Layout>
                            <HomeworkThreadPage/>
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

function RequireAuth({children}: {children: ReactNode}) {
    const {user} = useAuth()
    if (!user) return <Navigate to="/login" replace/>
    return <>{children}</>
}

function RequireAdmin({children}: {children: ReactNode}) {
    const {user} = useAuth()
    if (!user?.is_admin) return <Navigate to="/profile" replace/>
    return <>{children}</>
}

// Splash is the loading state while the auth context hydrates from
// localStorage on first mount. Pure CSS animation — no react-native
// ActivityIndicator dependency.
function Splash() {
    return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-page">
            <div
                className="w-10 h-10 rounded-full border-4 border-primary/30 border-t-primary animate-spin"
                aria-label="loading"
            />
            <p className="mt-3 text-sm text-muted">Загрузка…</p>
        </div>
    )
}
