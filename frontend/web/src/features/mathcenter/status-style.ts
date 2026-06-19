import { homeworkStatusMeta, type HomeworkStatus, type StatusTone } from '@my239/shared'

// statusPillClasses maps an abstract status tone to the soft-fill + ink utility
// pair used by status pills across the submission/grading surfaces. Mirrors the
// StatusTile mapping so pills and tiles stay in visual lockstep.
export function statusPillClasses(tone: StatusTone): string {
  switch (tone) {
    case 'accepted':
      return 'bg-status-accepted-soft text-status-accepted'
    case 'checking':
      return 'bg-status-checking-soft text-status-checking'
    case 'rejected':
      return 'bg-status-rejected-soft text-status-rejected'
    case 'appeal':
      return 'bg-status-appeal-soft text-status-appeal'
    case 'unsolved':
      return 'bg-status-unsolved-soft text-status-unsolved'
  }
}

// statusPillClassesFor is the convenience form taking a status directly.
export function statusPillClassesFor(status: HomeworkStatus): string {
  return statusPillClasses(homeworkStatusMeta(status).tone)
}
