import { FunctionSquare } from 'lucide-react'
import { useMathCenterMe } from '@my239/shared'
import { usePhoneViewport } from '../use-phone-viewport'
import { modules, type ModuleDef } from './modules'

// useNavModules builds the full module list for the current user: one "Матцентр
// {year}" module per math center they belong to (teacher centers + their own
// student center), sorted by graduation year descending, followed by the STATIC
// modules (admin, alumni). The nav rail, top bar, and home page all render from
// this so adding a center is automatic.
export function useNavModules(): ModuleDef[] {
  const me = useMathCenterMe()
  const isPhone = usePhoneViewport()

  const seen = new Set<number>()
  const teacherCenters = new Set<number>()
  const headTeacherCenters = new Set<number>()
  const centers: { id: number; graduationYear: number }[] = []
  const push = (id: number, graduationYear: number) => {
    if (seen.has(id)) return
    seen.add(id)
    centers.push({ id, graduationYear })
  }

  for (const c of me.data?.teacher?.centers ?? []) {
    teacherCenters.add(c.id)
    if (c.is_head_teacher) headTeacherCenters.add(c.id)
    push(c.id, c.graduation_year)
  }
  const student = me.data?.student?.center
  if (student) push(student.id, student.graduation_year)

  centers.sort((a, b) => b.graduationYear - a.graduationYear)

  const mathModules: ModuleDef[] = centers.map((c) => {
    // Centers are addressed by graduation YEAR in the URL (the canonical
    // scheme); the module base path is /mathcenter/{year}.
    const base = '/mathcenter/' + c.graduationYear
    return {
      id: 'mc-' + c.id,
      label: 'Матцентр ' + c.graduationYear,
      description: 'Серии задач и проверка',
      path: base,
      icon: FunctionSquare,
      status: 'active',
      centerId: c.id,
      canGrade: teacherCenters.has(c.id),
      pages: [
        ...(teacherCenters.has(c.id) && !isPhone
          ? [{ label: 'Кондуит', path: base + '/conduit' }]
          : []),
        // «Серии» now nests series/:id/:tab routes, so it must NOT use `end`:
        // it stays highlighted on deeper series paths via NavLink prefix match.
        { label: 'Серии', path: base + '/series', notification: 'series-queue' },
        { label: 'Гробы', path: base + '/coffins', notification: 'coffin-queue' },
        { label: 'Ликбезы', path: base + '/likbez' },
        // «Управление» (the management panel) is a head-teacher self-service tool.
        ...(headTeacherCenters.has(c.id)
          ? [{ label: 'Управление', path: base + '/manage' }]
          : []),
      ],
    }
  })

  return [...mathModules, ...modules]
}
