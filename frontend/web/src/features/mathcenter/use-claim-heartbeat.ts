import { useEffect } from 'react'
import {
  claimIsLive,
  heartbeatClaim,
  useApiClient,
  type ThreadView,
} from '@my239/shared'

// useClaimHeartbeat keeps a grader's claim alive while they sit on the thread
// page holding it. It deliberately does NOT release on unmount: a claim is "my
// work" and should survive navigation so the grader can find it again under
// "только мои" and come back to grade it. Abandoned claims still free up via
// the 15-minute server TTL (the heartbeat only extends while viewing); a grader
// can also drop one explicitly with the "Освободить" button. No-op for anyone
// who isn't the current claim holder.
export function useClaimHeartbeat(
  thread: ThreadView | null,
  isGrader: boolean,
  userId: number,
): void {
  const client = useApiClient()
  const heldByMe =
    !!thread &&
    isGrader &&
    thread.claim_holder_user_id === userId &&
    claimIsLive(thread)
  const threadId = thread?.id ?? 0

  useEffect(() => {
    if (!heldByMe || threadId <= 0) return
    const tick = setInterval(
      () => {
        heartbeatClaim(client, threadId).catch(() => undefined)
      },
      8 * 60 * 1000,
    )
    return () => clearInterval(tick)
  }, [heldByMe, threadId, client])
}
