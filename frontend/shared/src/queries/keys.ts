// Centralised TanStack Query keys so cache reads/writes/invalidations across
// the app (and across platforms) reference one source of truth.
export const queryKeys = {
  me: ['auth', 'me'] as const,
  mathCenterMe: ['mathcenter', 'me'] as const,
  adminUsers: ['admin', 'users'] as const,
  adminUser: (id: number) => ['admin', 'users', id] as const,
  userEnrollments: (id: number) =>
    ['admin', 'users', id, 'enrollments'] as const,
  adminTokens: ['admin', 'tokens'] as const,
  adminCenters: ['admin', 'mathcenters'] as const,
  centerGroups: (centerId: number) =>
    ['admin', 'mathcenters', centerId, 'groups'] as const,
  // Head-teacher management panel ("Управление").
  manageGroups: (centerId: number) =>
    ['mathcenter', 'manage', centerId, 'groups'] as const,
  manageTeachers: (centerId: number) =>
    ['mathcenter', 'manage', centerId, 'teachers'] as const,
  manageStudents: (centerId: number) =>
    ['mathcenter', 'manage', centerId, 'students'] as const,
  manageInvites: (centerId: number) =>
    ['mathcenter', 'manage', centerId, 'invites'] as const,
  userSearch: (centerId: number, q: string) =>
    ['mathcenter', 'manage', centerId, 'user-search', q] as const,
  inviteContext: (token: string) => ['auth', 'invite', token] as const,
  seriesList: (centerId: number) =>
    ['mathcenter', 'centers', centerId, 'series'] as const,
  series: (id: number) => ['mathcenter', 'series', id] as const,
  seriesTex: (id: number) => ['mathcenter', 'series', id, 'tex'] as const,
  centerCoffins: (centerId: number) =>
    ['mathcenter', 'centers', centerId, 'coffins'] as const,
  coffinQueue: (centerId: number) =>
    ['mathcenter', 'centers', centerId, 'coffin-queue'] as const,
  // Per-subproblem «Разбор» LaTeX (keyed by subproblem id).
  subproblemSolutionTex: (id: number) =>
    ['mathcenter', 'subproblems', id, 'solution', 'tex'] as const,
  myRollup: (id: number) => ['homework', 'series', id, 'my'] as const,
  problemStats: (id: number) =>
    ['homework', 'series', id, 'problem-stats'] as const,
  thread: (id: number) => ['homework', 'thread', id] as const,
  subproblemContext: (id: number) =>
    ['homework', 'subproblem', id] as const,
  graderQueue: (seriesId: number, mine: boolean) =>
    ['homework', 'series', seriesId, 'queue', mine] as const,
  teacherGrid: (seriesId: number) =>
    ['homework', 'series', seriesId, 'grid'] as const,
  centerGrid: (centerId: number) =>
    ['homework', 'centers', centerId, 'grid'] as const,
  graderStats: (centerId: number) =>
    ['homework', 'centers', centerId, 'grader-stats'] as const,
  // Internal teacher-only notes on a solution thread.
  threadNotes: (threadId: number) =>
    ['homework', 'thread', threadId, 'notes'] as const,
  // Teacher-facing student profile + internal notes on a student.
  studentProfile: (centerId: number, studentUserId: number) =>
    ['mathcenter', 'centers', centerId, 'students', studentUserId] as const,
  studentNotes: (centerId: number, studentUserId: number) =>
    ['mathcenter', 'centers', centerId, 'students', studentUserId, 'notes'] as const,
}
