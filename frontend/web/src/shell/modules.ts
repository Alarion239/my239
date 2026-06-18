import {
  FunctionSquare,
  GraduationCap,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react'

// A page within a module, surfaced as a tab in the top bar.
export interface ModulePage {
  label: string
  path: string
  end?: boolean
}

// The platform's modules. The nav rail and home page both render from this one
// list, so adding a module is a single entry here plus its routes. `status`
// distinguishes shipped modules from teased ("скоро") ones. `adminOnly` hides a
// module from non-admins. `pages` are the module's tabs shown in the top bar.
export interface ModuleDef {
  id: string
  label: string
  description: string
  path: string
  icon: LucideIcon
  status: 'active' | 'soon'
  adminOnly?: boolean
  pages?: ModulePage[]
}

export const modules: ModuleDef[] = [
  {
    id: 'mathcenter',
    label: 'Матцентр',
    description: 'Серии задач, проверка работ и прогресс',
    path: '/mathcenter',
    icon: FunctionSquare,
    status: 'active',
    // The "Проверка" (grading) tab is added in a later workflow.
    pages: [{ label: 'Серии', path: '/mathcenter', end: true }],
  },
  {
    id: 'admin',
    label: 'Администрирование',
    description: 'Пользователи, приглашения и матцентры',
    path: '/admin',
    icon: ShieldCheck,
    status: 'active',
    adminOnly: true,
    pages: [
      { label: 'Пользователи', path: '/admin/users' },
      { label: 'Матцентры', path: '/admin/math-centers' },
    ],
  },
  {
    id: 'alumni',
    label: 'Выпускники',
    description: 'Сообщество, встречи и связи',
    path: '/alumni',
    icon: GraduationCap,
    status: 'soon',
  },
]

// activeModule returns the accessible module whose `path` is the longest prefix
// of `pathname` (so /admin/users resolves to the admin module). `adminOnly`
// modules are excluded when the caller is not an admin.
export function activeModule(
  pathname: string,
  isAdmin: boolean,
): ModuleDef | undefined {
  let best: ModuleDef | undefined
  for (const m of modules) {
    if (m.adminOnly && !isAdmin) continue
    if (pathname === m.path || pathname.startsWith(m.path + '/')) {
      if (!best || m.path.length > best.path.length) best = m
    }
  }
  return best
}
