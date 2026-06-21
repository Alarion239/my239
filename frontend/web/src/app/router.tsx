import { createBrowserRouter, Navigate } from 'react-router-dom'
import { RedirectIfAuthed, RequireAuth, RequireRole } from '../auth/guards'
import { AppShell } from '../shell/app-shell'
import { LoginPage } from '../features/auth/login-page'
import { RegisterPage } from '../features/auth/register-page'
import { HomePage } from '../features/home/home-page'
import { ProfilePage } from '../features/profile/profile-page'
import { MathCenterIndex, SeriesPage } from '../features/mathcenter/series-page'
import { CoffinsPage } from '../features/mathcenter/coffins-page'
import { ThreadPage } from '../features/mathcenter/thread-page'
import { UsersPage } from '../features/admin/users-page'
import { UserDetailPage } from '../features/admin/user-detail-page'
import { MathCentersPage } from '../features/admin/math-centers-page'

export const router = createBrowserRouter([
  {
    element: <RedirectIfAuthed />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/register', element: <RegisterPage /> },
    ],
  },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <HomePage /> },
          { path: 'profile', element: <ProfilePage /> },
          { path: 'mathcenter', element: <MathCenterIndex /> },
          { path: 'mathcenter/:centerId', element: <SeriesPage /> },
          { path: 'mathcenter/:centerId/coffins', element: <CoffinsPage /> },
          {
            path: 'mathcenter/:centerId/series/:seriesId/submit/:subproblemId',
            element: <ThreadPage />,
          },
          {
            path: 'mathcenter/:centerId/series/:seriesId/thread/:threadId',
            element: <ThreadPage />,
          },
          {
            element: <RequireRole roles={['admin']} />,
            children: [
              { path: 'admin', element: <Navigate to="/admin/users" replace /> },
              { path: 'admin/users', element: <UsersPage /> },
              { path: 'admin/users/:userId', element: <UserDetailPage /> },
              { path: 'admin/math-centers', element: <MathCentersPage /> },
            ],
          },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
])
