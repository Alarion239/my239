// formatDateTime renders an ISO-8601 string in the user's locale.
// Missing or invalid values fall through to an em-dash so rows never
// read "Invalid Date". Used by both web and mobile.
//
// Locale is hard-coded to ru-RU because the whole product is Russian;
// when (if) we ever ship an English variant this becomes a parameter.
export function formatDateTime(iso: string | null | undefined): string {
    if (!iso) return '—'
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return '—'
    return d.toLocaleString('ru-RU', {dateStyle: 'medium', timeStyle: 'short'})
}
