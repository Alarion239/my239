// @my239/shared — barrel for the platform-agnostic domain layer.
//
// Nothing here imports the DOM (window/document/localStorage), Vite, Tailwind,
// Radix, or any React Native module. Platform capabilities enter through the
// ports/ interfaces. See ./README.md for the full web <-> native reuse
// contract.

export * from './types'
export * from './api/http'
export * from './api/client'
export * from './api/sse'
export * from './ports/token-store'
export * from './domain/user'
export * from './domain/capabilities'
export * from './domain/homework'
export * from './domain/series-schedule'
export * from './format/datetime'
export * from './validation/auth'
export * from './validation/admin'
export * from './validation/series'
export * from './validation/likbez'
export * from './validation/manage'
export * from './queries/keys'
export * from './queries/context'
export * from './queries/auth'
export * from './queries/mathcenter'
export * from './queries/admin'
export * from './queries/series'
export * from './queries/likbez'
export * from './queries/homework'
export * from './queries/coffins'
export * from './queries/comments'
export * from './queries/manage'
