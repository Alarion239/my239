import {
  GraduationCap,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react'

// A page within a module, surfaced as a tab in the top bar.
export interface ModulePage {
  label: string
  path: string
  end?: boolean
  notification?: 'series-queue' | 'coffin-queue'
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
  centerId?: number
  canGrade?: boolean
  pages?: ModulePage[]
}

// STATIC modules are the same for everyone (subject to `adminOnly`). The math
// center modules are dynamic — one per center the user belongs to — and are
// prepended at runtime by useNavModules().
export const modules: ModuleDef[] = [
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

// activeNavModule returns the accessible module from `mods` whose `path` is the
// longest prefix of `pathname` (so /admin/users resolves to the admin module,
// and /mathcenter/7 to that center's module). `adminOnly` modules are excluded
// when the caller is not an admin.
export function activeNavModule(
  mods: ModuleDef[],
  pathname: string,
  isAdmin: boolean,
): ModuleDef | undefined {
  let best: ModuleDef | undefined
  for (const m of mods) {
    if (m.adminOnly && !isAdmin) continue
    if (pathname === m.path || pathname.startsWith(m.path + '/')) {
      if (!best || m.path.length > best.path.length) best = m
    }
  }
  return best
}
