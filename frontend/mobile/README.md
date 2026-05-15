# my239 mobile (Expo)

React Native client built with Expo SDK 54 + Expo Router. Lives alongside
the existing web client (`../web`); they will gradually share domain code
(types, API clients) as features land.

## Run on the iOS simulator

Prerequisite: Xcode installed (so the iOS simulator is available).

```bash
npm install        # only once
npm run ios        # opens the iOS simulator
```

The simulator shares the host Mac's network, so `http://localhost:8080`
in `app.json` works as-is when the backend runs in Docker on the same Mac.

## Run on a physical iPhone

Install the Expo Go app from the App Store and put the phone on the same
Wi-Fi as the dev machine.

1. Find the dev machine's LAN IP:
   ```bash
   ipconfig getifaddr en0  # → e.g. 192.168.1.42
   ```
2. Either edit `app.json` → `expo.extra.backendURL` to
   `http://192.168.1.42:8080`, or export the env var:
   ```bash
   EXPO_PUBLIC_BACKEND_URL=http://192.168.1.42:8080 npm start
   ```
3. `npm start` and scan the QR code with the iPhone camera.

## Layout

```
mobile/
  app/                       expo-router screens (file-based)
    _layout.tsx
    (tabs)/
      _layout.tsx
      index.tsx              connectivity probe (replace next)
      explore.tsx            placeholder
    modal.tsx
  components/                themed primitives from the Expo template
  lib/
    api.ts                   fetch wrapper + backend URL resolution
  app.json                   manifest + extra.backendURL config
```

## Backlog (what to add next)

- **Auth flow**: a real login screen using `/api/v1/auth/login`, with
  tokens stored in `expo-secure-store`. Tokens persist across launches,
  refresh on 401 just like the web `auth.tsx` does.
- **Domain reuse**: lift `api/homework.ts`, `api/series.ts`, the
  pluralization helpers, and the granular-counts helper from
  `frontend/web/src/` into a shared package, since they're pure TS with
  no DOM dependency.
- **Web-to-native patches** for components ported from `web/`:
  - replace `<iframe>` (PDF preview) with `expo-web-browser` or
    `react-native-pdf`
  - replace `<img>` (photos) with RN `<Image>`
  - replace `<textarea>` with `<TextInput multiline>`
  - replace `document.createElement('input')` with `expo-image-picker`
  - replace `position: sticky` with manual layout
  - replace `react-router-dom` with Expo Router (already installed)
- **Push notifications** for grader claim heartbeats / new submissions.
