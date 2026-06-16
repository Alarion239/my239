// Centralised TanStack Query keys so cache reads/writes/invalidations across
// the app (and across platforms) reference one source of truth.
export const queryKeys = {
  me: ['auth', 'me'] as const,
}
