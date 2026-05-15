# @my239/shared

Pure-TypeScript domain layer shared by the web (`../web`) and mobile
(`../mobile`) clients. The rule: nothing here imports the DOM, React,
React Native, or any platform-specific runtime. If a helper needs
`document`, `window`, `<View>`, `expo-*`, or `react-*`, it does not
belong here.

What does belong here:

- API request types and HTTP clients (the raw fetch call, error envelope).
- Validation, state machines, and pure domain logic.
- i18n / formatting helpers (Russian pluralization, date formatting).
- Anything that would otherwise be duplicated between web and mobile.

## Layout

```
shared/
  src/
    api/        HTTP wrapper + per-domain clients (homework, series, ...)
    homework/   domain helpers (counts, status labels, transitions)
    i18n/       Russian-language helpers (ruPlural, label dictionaries)
    format/     pure formatters (date, time, file size)
    index.ts    public barrel — re-export only what consumers import
```

## Tests

```
npm test --workspace=@my239/shared
```

vitest, no DOM, no jsdom — these are pure-TS unit tests.
