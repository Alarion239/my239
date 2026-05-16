import {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent} from 'react'
import {createPortal} from 'react-dom'

// Generic combobox: a text input that filters a known list of items as the
// user types, with a popup of suggestions below.
//
// Two non-obvious implementation choices, both for robustness:
//
//   1. The popup is rendered via createPortal into document.body so it
//      escapes any parent stacking context and paints on top of everything.
//
//   2. The popup closes via the input's onBlur (with a small grace timeout)
//      rather than a global mousedown listener. With onBlur + timeout, the
//      click on an option fires while the popup is still mounted; commit()
//      beats the timeout to setOpen(false).

export interface AutocompleteItem {
    id: number
    // label is what the user sees and types against. Matching is
    // case-insensitive substring on this.
    label: string
    // sublabel renders smaller under the label and also participates in the
    // search (e.g. "@username" so people can type the username too).
    sublabel?: string
}

interface Props {
    label: string
    placeholder?: string
    items: AutocompleteItem[]
    selected: AutocompleteItem | null
    onSelect: (item: AutocompleteItem | null) => void
    // emptyMessage shows in the popup when no item matches; defaults to a
    // generic "ничего не найдено".
    emptyMessage?: string
}

const MAX_VISIBLE = 8
const BLUR_GRACE_MS = 150

export function Autocomplete({label, placeholder, items, selected, onSelect, emptyMessage}: Props) {
    const [query, setQuery] = useState(selected?.label ?? '')
    const [open, setOpen] = useState(false)
    const [highlight, setHighlight] = useState(0)

    // anchorRef points at the wrapper div — its DOM rect tells the portal
    // where to put the popup.
    const anchorRef = useRef<HTMLDivElement | null>(null)
    const closeTimer = useRef<number | null>(null)

    // When the parent changes the selection (e.g. clears it after a successful
    // submit), reflect it in the visible text.
    useEffect(() => {
        setQuery(selected?.label ?? '')
    }, [selected])

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase()
        if (!q) return items.slice(0, MAX_VISIBLE)
        return items
            .filter((i) => i.label.toLowerCase().includes(q) || (i.sublabel?.toLowerCase().includes(q) ?? false))
            .slice(0, MAX_VISIBLE)
    }, [items, query])

    // Keep the highlight in range when the filtered list shrinks.
    useEffect(() => {
        if (highlight >= filtered.length) setHighlight(0)
    }, [filtered.length, highlight])

    const cancelClose = useCallback(() => {
        if (closeTimer.current !== null) {
            window.clearTimeout(closeTimer.current)
            closeTimer.current = null
        }
    }, [])

    const scheduleClose = useCallback(() => {
        cancelClose()
        // Long enough that an option's onClick fires first, short enough that
        // the popup feels responsive to the user clicking elsewhere.
        closeTimer.current = window.setTimeout(() => {
            closeTimer.current = null
            setOpen(false)
        }, BLUR_GRACE_MS)
    }, [cancelClose])

    useEffect(() => () => cancelClose(), [cancelClose])

    function commit(item: AutocompleteItem) {
        cancelClose()
        onSelect(item)
        setQuery(item.label)
        setOpen(false)
    }

    function clear() {
        cancelClose()
        onSelect(null)
        setQuery('')
        setOpen(true)
    }

    function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
        if (e.key === 'ArrowDown') {
            e.preventDefault()
            setOpen(true)
            setHighlight((h) => (filtered.length === 0 ? 0 : Math.min(h + 1, filtered.length - 1)))
        } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setHighlight((h) => Math.max(h - 1, 0))
        } else if (e.key === 'Enter') {
            if (open && filtered[highlight]) {
                e.preventDefault()
                commit(filtered[highlight])
            }
        } else if (e.key === 'Escape') {
            e.preventDefault()
            setOpen(false)
        }
    }

    return (
        <div ref={anchorRef} className="mb-3">
            <label className="block text-[13px] font-medium text-ink mb-1.5">{label}</label>
            <div className="flex items-center relative">
                <input
                    type="text"
                    value={query}
                    placeholder={placeholder}
                    onFocus={() => {
                        cancelClose()
                        setOpen(true)
                    }}
                    onBlur={scheduleClose}
                    onChange={(e) => {
                        setQuery(e.target.value)
                        setOpen(true)
                        // typing implicitly de-selects so the parent doesn't
                        // think the stale id is still chosen.
                        if (selected) onSelect(null)
                    }}
                    onKeyDown={onKeyDown}
                    autoCapitalize="off"
                    autoCorrect="off"
                    className={`block w-full rounded-lg border bg-white px-3 py-2.5 text-[15px] text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/30 ${
                        selected ? 'border-primary' : 'border-card-border'
                    }`}
                />
                {selected || query ? (
                    // onMouseDown preventDefault stops the input blur from
                    // firing — without it, clicking × would trigger close
                    // before clear() runs.
                    <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={clear}
                        aria-label="Очистить"
                        className="absolute right-1 w-7 h-7 flex items-center justify-center rounded-full text-muted hover:bg-page"
                    >
                        <span className="text-lg leading-none">×</span>
                    </button>
                ) : null}
            </div>

            <Popup
                anchorRef={anchorRef}
                open={open}
                items={filtered}
                highlight={highlight}
                emptyMessage={emptyMessage ?? 'Ничего не найдено'}
                onHover={setHighlight}
                onCommit={commit}
                onCancelClose={cancelClose}
            />
        </div>
    )
}

// Popup is the listbox itself, mounted on document.body. It positions itself
// just below the anchor's bounding rect and re-measures on scroll/resize.
function Popup(props: {
    anchorRef: React.RefObject<HTMLDivElement | null>
    open: boolean
    items: AutocompleteItem[]
    highlight: number
    emptyMessage: string
    onHover: (i: number) => void
    onCommit: (item: AutocompleteItem) => void
    onCancelClose: () => void
}) {
    const {anchorRef, open, items, highlight, emptyMessage, onHover, onCommit, onCancelClose} = props
    const [rect, setRect] = useState<{top: number; left: number; width: number} | null>(null)

    // Re-measure synchronously after layout so the popup never appears in the
    // wrong spot on the first frame.
    useLayoutEffect(() => {
        if (!open) return
        function measure() {
            const node = anchorRef.current
            if (!node) return
            const r = node.getBoundingClientRect()
            setRect({top: r.bottom + 4, left: r.left, width: r.width})
        }
        measure()
        window.addEventListener('scroll', measure, true)
        window.addEventListener('resize', measure)
        return () => {
            window.removeEventListener('scroll', measure, true)
            window.removeEventListener('resize', measure)
        }
    }, [open, anchorRef])

    if (!open || !rect || typeof document === 'undefined') return null

    return createPortal(
        <div
            // Cancel the input's pending close when the user reaches into the
            // popup with their cursor — keeps the popup alive even if focus
            // briefly moves to the body during the click sequence.
            onMouseDown={(e) => {
                e.preventDefault()
                onCancelClose()
            }}
            className="fixed z-[9999] bg-white border border-card-border rounded-lg shadow-lg overflow-hidden max-h-[280px] overflow-y-auto"
            style={{top: rect.top, left: rect.left, width: rect.width}}
        >
            {items.length === 0 ? (
                <p className="px-3 py-2.5 text-[13px] italic text-muted">{emptyMessage}</p>
            ) : (
                items.map((item, idx) => {
                    const active = idx === highlight
                    return (
                        <button
                            type="button"
                            key={item.id}
                            onClick={() => onCommit(item)}
                            onMouseEnter={() => onHover(idx)}
                            className={`block w-full text-left px-3 py-2 ${
                                active ? 'bg-primary text-white' : 'bg-white text-ink'
                            }`}
                        >
                            <span className="block text-sm">{item.label}</span>
                            {item.sublabel ? (
                                <span className={`block text-xs mt-0.5 ${active ? 'text-blue-100' : 'text-muted'}`}>
                                    {item.sublabel}
                                </span>
                            ) : null}
                        </button>
                    )
                })
            )}
        </div>,
        document.body,
    )
}
