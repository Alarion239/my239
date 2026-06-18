import { createBrowserRouter, Navigate } from 'react-router-dom'
import { RedirectIfAuthed, RequireAuth, RequireRole } from '../auth/guards'
import { AppShell } from '../shell/app-shell'
import { LoginPage } from '../features/auth/login-page'
import { RegisterPage } from '../features/auth/register-page'
import { HomePage } from '../features/home/home-page'
import { ProfilePage } from '../features/profile/profile-page'
import { MathCenterPage } from '../features/mathcenter/mathcenter-page'
import { UsersPage } from '../features/admin/users-page'
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
          { path: 'mathcenter', element: <MathCenterPage /> },
          {
            element: <RequireRole roles={['admin']} />,
            children: [
              { path: 'admin', element: <Navigate to="/admin/users" replace /> },
              { path: 'admin/users', element: <UsersPage /> },
              { path: 'admin/math-centers', element: <MathCentersPage /> },
            ],
          },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
])
