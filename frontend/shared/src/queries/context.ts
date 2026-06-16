// ApiClientProvider makes a single ApiClient instance available to the shared
// query hooks via React context. Written with createElement (no JSX) so this
// file stays a plain .ts module — React itself works the same on web and
// native, so the provider is reusable as-is.

import { createContext, createElement, useContext } from 'react'
import type { ReactNode } from 'react'
import type { ApiClient } from '../api/client'

const ApiClientContext = createContext<ApiClient | null>(null)

export function ApiClientProvider(props: {
  client: ApiClient
  children: ReactNode
}): ReturnType<typeof createElement> {
  return createElement(
    ApiClientContext.Provider,
    { value: props.client },
    props.children,
  )
}

export function useApiClient(): ApiClient {
  const client = useContext(ApiClientContext)
  if (!client) {
    throw new Error('useApiClient must be used within <ApiClientProvider>')
  }
  return client
}
