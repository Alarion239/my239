import { createBrowserRouter, Navigate } from 'react-router-dom'
import { RedirectIfAuthed, RequireAuth, RequireRole } from '../auth/guards'
import { AppShell } from '../shell/app-shell'
import { LoginPage } from '../features/auth/login-page'
import { RegisterPage } from '../features/auth/register-page'
import { HomePage } from '../features/home/home-page'
import { ProfilePage } from '../features/profile/profile-page'
import { MathCenterIndex, SeriesPage } from '../features/mathcenter/series-page'
import { CoffinsPage } from '../features/mathcenter/coffins-page'
import { LikbezPage } from '../features/mathcenter/likbez-page'
import { ConduitPage } from '../features/mathcenter/conduit-page'
import { ManagePage } from '../features/mathcenter/manage/manage-page'
import { ThreadPage } from '../features/mathcenter/thread-page'
import { StudentProfilePage } from '../features/mathcenter/student-profile-page'
import { CenterLayout } from '../features/mathcenter/center-layout'
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
          {
            // Per-center shell: :year -> center id, access gate, single SSE
            // stream, URL-driven tabs. Legacy /mathcenter/{id}/... URLs are
            // rewritten to the year URL inside CenterLayout.
            path: 'mathcenter/:year',
            element: <CenterLayout />,
            children: [
              { index: true, element: <Navigate to="series" replace /> },
              // Bare `series` resolves the current series + default tab inside
              // SeriesPage, then redirects to series/:seriesId/:tab.
              { path: 'series', element: <SeriesPage /> },
              { path: 'series/:seriesId/:tab', element: <SeriesPage /> },
              {
                path: 'series/:seriesId/submit/:subproblemId',
                element: <ThreadPage />,
              },
              {
                path: 'series/:seriesId/thread/:threadId',
                element: <ThreadPage />,
              },
              { path: 'coffins', element: <Navigate to="queue" replace /> },
              { path: 'coffins/:tab', element: <CoffinsPage /> },
              { path: 'likbez', element: <LikbezPage /> },
              { path: 'likbez/:likbezId', element: <LikbezPage /> },
              { path: 'conduit', element: <ConduitPage /> },
              { path: 'students/:studentUserId', element: <StudentProfilePage /> },
              { path: 'manage', element: <Navigate to="groups" replace /> },
              { path: 'manage/:tab', element: <ManagePage /> },
            ],
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
