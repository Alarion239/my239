import { FunctionSquare, GraduationCap, type LucideIcon } from 'lucide-react'

// The platform's modules. The nav rail and home page both render from this one
// list, so adding a module is a single entry here plus its routes. `status`
// distinguishes shipped modules from teased ("скоро") ones.
export interface ModuleDef {
  id: string
  label: string
  description: string
  path: string
  icon: LucideIcon
  status: 'active' | 'soon'
}

export const modules: ModuleDef[] = [
  {
    id: 'mathcenter',
    label: 'Матцентр',
    description: 'Серии задач, проверка работ и прогресс',
    path: '/mathcenter',
    icon: FunctionSquare,
    status: 'active',
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
