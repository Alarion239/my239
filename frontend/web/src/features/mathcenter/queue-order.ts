import type { HomeworkStatus } from '@my239/shared'

export function appealsLast<T extends { current_status: HomeworkStatus }>(items: T[]): T[] {
  return [...items].sort(
    (a, b) => Number(a.current_status === 'appealed') - Number(b.current_status === 'appealed'),
  )
}
