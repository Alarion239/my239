# @my239/shared

The platform-agnostic domain layer for the my239 frontend. **Web uses it today;
the future React Native (Expo) app will reuse it unchanged.** This document is
the contract that keeps that promise — read it before adding code here.

## What lives here (reused by every platform)

| Module          | Contents                                                                 |
| --------------- | ------------------------------------------------------------------------ |
| `types/`        | TS interfaces mirroring backend JSON (`User`, `TokenPair`, `AuthResult`, request bodies, `ErrorEnvelope`). |
| `api/http.ts`   | Low-level `request()` + `APIError` envelope parsing. Uses only `fetch`.  |
| `api/client.ts` | `ApiClient`: in-memory access token, refresh-token persistence via a port, and transparent 401 → refresh → retry. |
| `ports/`        | Interfaces the host platform must implement (`TokenStore`).              |
| `queries/`      | TanStack Query hooks (`useMe`, `useLogin`, `useRegister`, `useLogout`) + `ApiClientProvider`. |
| `validation/`   | zod schemas mirroring backend auth validation; forms infer types from these. |
| `domain/`       | Pure helpers (`fullName`, `initials`, `primaryRole`, …).                  |
| `format/`       | Locale formatting (`formatDateTime`, `formatDate`).                       |

## What does NOT live here (stays platform-specific)

- **UI components** — web: Radix + Tailwind; native: RN primitives / NativeWind.
- **Routing** — web: React Router; native: Expo Router.
- **Token storage** — injected through the `TokenStore` port. Web → `localStorage`; native → `expo-secure-store`.

## Rules that keep this package native-safe

1. **No DOM globals.** Never reference `window`, `document`, `localStorage`,
   `sessionStorage`, or `navigator`. `fetch`, `Response`, and `BodyInit` are
   allowed — they exist on both web and React Native.
2. **No platform imports.** No Vite (`import.meta.env`), Tailwind, Radix, or
   `react-native` / `expo-*` imports.
3. **Runtime peers only:** `react`, `@tanstack/react-query`, `zod`. React is a
   peer dependency so the host owns the single React instance.
4. **Capabilities enter through `ports/`.** Anything the platform must provide
   (storage today; secure key-value, push tokens, file pickers tomorrow) is an
   interface here and an implementation in the app.

## How a platform wires it up

```ts
const client = new ApiClient({
  baseURL: '/api/v1',            // web: relative, proxied by nginx/Vite
  tokenStore: new WebTokenStore(), // implements the TokenStore port
})

// near the app root:
<QueryClientProvider client={queryClient}>
  <ApiClientProvider client={client}>
    <App />
  </ApiClientProvider>
</QueryClientProvider>
```

The access token is held in memory only; the rotating refresh token is the one
durable secret, kept by the `TokenStore`. After a reload the first authed
request 401s, `ApiClient` mints a fresh access token from the stored refresh
token, and retries — so sessions survive reloads without persisting the JWT.

> Web stores the refresh token in `localStorage`, which is readable by injected
> scripts (XSS). The backend is Bearer-based by design (no cookies,
> `AllowCredentials: false`), so this is the standard tradeoff; mitigate with a
> strict CSP. Native uses `expo-secure-store`, which is hardware-backed.
