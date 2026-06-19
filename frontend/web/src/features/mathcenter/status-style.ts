import {
  displayStatusMeta,
  homeworkStatusMeta,
  type HomeworkStatus,
  type StatusMeta,
  type StatusTone,
} from '@my239/shared'

// statusPillClasses maps an abstract status tone to the soft-fill + ink utility
// pair used by status pills across the submission/grading surfaces. Mirrors the
// StatusTile mapping so pills and tiles stay in visual lockstep.
export function statusPillClasses(tone: StatusTone): string {
  switch (tone) {
    case 'accepted':
      return 'bg-status-accepted-soft text-status-accepted'
    case 'checking':
      return 'bg-status-checking-soft text-status-checking'
    case 'grading':
      return 'bg-status-grading-soft text-status-grading'
    case 'rejected':
      return 'bg-status-rejected-soft text-status-rejected'
    case 'appeal':
      return 'bg-status-appeal-soft text-status-appeal'
    case 'unsolved':
      return 'bg-status-unsolved-soft text-status-unsolved'
  }
}

// statusPillClassesFor is the convenience form taking a raw status directly.
export function statusPillClassesFor(status: HomeworkStatus): string {
  return statusPillClasses(homeworkStatusMeta(status).tone)
}

// displayPill returns the claim-aware label + pill classes — "В очереди" vs
// "На проверке" — for a status given whether a grader holds it.
export function displayPill(
  status: HomeworkStatus,
  beingGraded: boolean,
): { meta: StatusMeta; className: string } {
  const meta = displayStatusMeta(status, beingGraded)
  return { meta, className: statusPillClasses(meta.tone) }
}
