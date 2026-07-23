import { createContext, useContext } from 'react'
import type { MathCenterTerm } from '@my239/shared'

// CenterIdContext carries the resolved internal center id from CenterLayout down
// to the per-center pages (Series/Coffins/Manage/Thread), so they read it
// without re-resolving the :year URL segment. Kept in its own module so the
// layout file only exports components (react-refresh friendliness).
export const CenterIdContext = createContext<number>(0)

// useCenterIdContext returns the resolved internal center id provided by
// CenterLayout. Defaults to 0 when used outside the layout.
export function useCenterIdContext(): number {
  return useContext(CenterIdContext)
}

export interface CenterTermContextValue {
  termId: number
  term: MathCenterTerm | null
}

export const CenterTermContext = createContext<CenterTermContextValue>({
  termId: 0,
  term: null,
})

export function useCenterTermContext(): CenterTermContextValue {
  return useContext(CenterTermContext)
}
