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
  seriesList: (centerId: number) =>
    ['mathcenter', 'centers', centerId, 'series'] as const,
  series: (id: number) => ['mathcenter', 'series', id] as const,
  seriesTex: (id: number) => ['mathcenter', 'series', id, 'tex'] as const,
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
  graderStats: (centerId: number) =>
    ['homework', 'centers', centerId, 'grader-stats'] as const,
}
