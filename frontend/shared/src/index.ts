// @my239/shared — pure TypeScript domain layer shared by the web and
// mobile clients. Anything web-only (DOM, react-dom, react-router) or
// native-only (react-native, expo-*) lives in the respective client
// package; this barrel re-exports only platform-agnostic surface.
//
// The folder structure mirrors the bounded contexts:
//   api/         HTTP types + request shapes
//   homework/    homework-domain helpers (counts, pluralization, states)
//   i18n/        Russian-language helpers (plural, status labels)
//   format/      pure formatting (date/time)
//
// Add to this barrel only what at least two consumers need. Internal
// utilities can stay un-exported.
