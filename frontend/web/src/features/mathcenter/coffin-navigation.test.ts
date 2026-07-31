import { describe, expect, it } from 'vitest'
import { coffinQueueThreadPath, threadBackPath } from './navigation-paths'

describe('coffin thread navigation', () => {
  it('keeps queue threads under the coffins module and preserves the term', () => {
    expect(coffinQueueThreadPath('2026', 7, 55, '?term_id=12')).toBe(
      '/mathcenter/2026/coffins/queue/7/thread/55?term_id=12',
    )
  })

  it('returns coffin threads to the same queue while series threads keep their old return path', () => {
    expect(threadBackPath('2026', 'coffins', '?term_id=12')).toBe(
      '/mathcenter/2026/coffins/queue?term_id=12',
    )
    expect(threadBackPath('2026', 'series', '?term_id=12')).toBe(
      '/mathcenter/2026/series?term_id=12',
    )
  })
})
