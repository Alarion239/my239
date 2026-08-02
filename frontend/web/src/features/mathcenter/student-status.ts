import type { HomeworkStatus, StatusMeta, StatusTone } from '@my239/shared'

// Student status presentation intentionally collapses all pending-review
// states into one yellow state. Teacher-facing surfaces continue to use the
// shared claim-aware displayStatusMeta helper, which preserves their finer
// grading distinctions.
export function studentStatusMeta(status: HomeworkStatus): StatusMeta {
  switch (status) {
    case 'accepted':
      return { label: 'Принято', tone: 'accepted', glyph: '' }
    case 'rejected':
      return { label: 'Отклонено', tone: 'rejected', glyph: '' }
    case 'submitted':
    case 'appealed':
      return { label: 'В очереди', tone: 'checking', glyph: '' }
    case 'ungraded':
      return { label: 'Не решено', tone: 'unsolved', glyph: '' }
  }
}

export function studentStatusToneClasses(tone: StatusTone): string {
  switch (tone) {
    case 'accepted':
      return 'bg-status-accepted-soft text-status-accepted'
    case 'checking':
      return 'bg-status-checking-soft text-status-checking'
    case 'rejected':
      return 'bg-status-rejected-soft text-status-rejected'
    case 'unsolved':
      return 'bg-status-unsolved-soft text-status-unsolved'
    case 'grading':
    case 'appeal':
      return 'bg-status-checking-soft text-status-checking'
  }
}

export function studentSubproblemIdentifier(
  label: string,
  problemNumber: number,
): string {
  if (label !== '') return label
  return problemNumber === 0 ? 'У' : String(problemNumber)
}
