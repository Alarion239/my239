// Shared formatting helpers used across pages. Kept tiny — anything bigger
// gets its own module under lib/.

// formatDateTime renders an ISO-8601 string in the user's locale. Missing or
// invalid values fall through to a dash so rows never read "Invalid Date".
// Copy of the helper that used to live on every page in the homework UI;
// hoisted here so there's exactly one definition.
export function formatDateTime(iso: string | null | undefined): string {
    if (!iso) return '—'
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return '—'
    return d.toLocaleString('ru-RU', {dateStyle: 'medium', timeStyle: 'short'})
}
