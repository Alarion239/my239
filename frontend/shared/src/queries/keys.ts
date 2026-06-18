// Centralised TanStack Query keys so cache reads/writes/invalidations across
// the app (and across platforms) reference one source of truth.
export const queryKeys = {
  me: ['auth', 'me'] as const,
  mathCenterMe: ['mathcenter', 'me'] as const,
  adminUsers: ['admin', 'users'] as const,
  adminTokens: ['admin', 'tokens'] as const,
  adminCenters: ['admin', 'mathcenters'] as const,
  centerGroups: (centerId: number) =>
    ['admin', 'mathcenters', centerId, 'groups'] as const,
}
