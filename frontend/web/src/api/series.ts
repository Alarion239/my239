// Re-export the platform-agnostic series client from the shared
// workspace so existing web imports (`from '../api/series'` /
// `from '../../api/series'`) keep working unchanged. The actual surface
// lives in frontend/shared/src/api/series.ts.

export * from '@my239/shared/api/series'
