// Re-export the platform-agnostic homework client from the shared
// workspace so existing web imports (`from '../api/homework'`) keep
// working unchanged. The actual surface lives in
// frontend/shared/src/api/homework.ts.

export * from '@my239/shared/api/homework'
