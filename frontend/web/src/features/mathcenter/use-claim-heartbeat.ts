import { useEffect, useRef } from 'react'
import {
  claimIsLive,
  heartbeatClaim,
  releaseClaim,
  useApiClient,
  type ThreadView,
} from '@my239/shared'

// useClaimHeartbeat keeps a grader's 15-minute claim alive while they sit on the
// thread page holding it, and releases it on unmount so it doesn't stay locked
// for the full server-side TTL after they navigate away. No-op for anyone who
// isn't the current claim holder. The 8-minute interval comfortably beats the
// 15-minute lease.
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

  // idRef holds the thread id only while we genuinely own a live claim, so the
  // unmount cleanup releases exactly that and nothing else.
  const idRef = useRef<number | null>(null)

  useEffect(() => {
    if (!heldByMe || !thread) {
      idRef.current = null
      return
    }
    idRef.current = thread.id
    const tick = setInterval(
      () => {
        const id = idRef.current
        if (id == null) return
        heartbeatClaim(client, id).catch(() => undefined)
      },
      8 * 60 * 1000,
    )
    return () => clearInterval(tick)
  }, [heldByMe, thread, client])

  useEffect(() => {
    return () => {
      const id = idRef.current
      if (id != null) releaseClaim(client, id).catch(() => undefined)
    }
  }, [client])
}
