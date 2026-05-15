// Re-export from the shared workspace so existing web imports
// (`from '../lib/format'`) keep working unchanged. The single
// definition lives in frontend/shared/src/format/datetime.ts.

export {formatDateTime} from '@my239/shared/format/datetime'
