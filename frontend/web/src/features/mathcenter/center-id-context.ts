import { createContext, useContext } from 'react'

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
