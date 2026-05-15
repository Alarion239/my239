import {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react'
import {createPortal} from 'react-dom'
import {Pressable, StyleSheet, Text, TextInput, View} from 'react-native'
import {colors} from './ui'

// Generic combobox: a text input that filters a known list of items as the
// user types, with a popup of suggestions below. Follows the WAI-ARIA
// "combobox with listbox popup" pattern as far as RN-Web allows.
//
// Two non-obvious implementation choices, both for robustness:
//
//   1. The popup is rendered via createPortal into document.body. RN-Web's
//      stacking contexts are unpredictable when the parent layout has
//      multiple sibling rows / cards, and we kept hitting cases where the
//      dropdown rendered behind text below it. A portal sidesteps the
//      stacking question entirely — the popup is the last thing in the DOM,
//      so default paint order plus z-index puts it on top of everything.
//
//   2. The popup closes via the input's onBlur (with a small grace timeout)
//      rather than a global mousedown listener. The mousedown approach
//      raced the option click: mousedown fired first, closed the popup,
//      and the option unmounted before its onPress could run. With onBlur
//      + timeout, the click on an option fires while the popup is still
//      mounted; commit() then beats the timeout to setOpen(false).

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

    // anchorRef points at the input's wrapper View — its DOM rect tells the
    // portal where to put the popup. RN-Web forwards a View's ref to the
    // underlying div, so getBoundingClientRect works directly.
    const anchorRef = useRef<View | null>(null)
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
        // Long enough that an option's onPress fires first, short enough that
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

    // onKeyPress is the cross-platform React Native key handler — it works on
    // RN-Web (which forwards key names like 'ArrowDown' / 'Enter' / 'Escape')
    // and on native iOS/Android (where only printable keys fire, which is fine
    // because mobile users tap suggestions instead of arrow-keying). Earlier
    // we tried web-only onKeyDown via prop spreading; RN-Web's TextInput
    // doesn't pass that through to the underlying input, so it silently did
    // nothing.
    function onKeyPress(e: {nativeEvent: {key: string}; preventDefault?: () => void}) {
        const key = e.nativeEvent?.key
        const stop = () => e.preventDefault?.()
        if (key === 'ArrowDown') {
            stop()
            setOpen(true)
            setHighlight((h) => (filtered.length === 0 ? 0 : Math.min(h + 1, filtered.length - 1)))
        } else if (key === 'ArrowUp') {
            stop()
            setHighlight((h) => Math.max(h - 1, 0))
        } else if (key === 'Enter') {
            if (open && filtered[highlight]) {
                stop()
                commit(filtered[highlight])
            }
        } else if (key === 'Escape') {
            stop()
            setOpen(false)
        }
    }

    // onSubmitEditing covers the native-iOS case where onKeyPress doesn't fire
    // for the return key; it also fires on web when the user presses Enter,
    // giving us a second chance to commit if onKeyPress somehow missed it.
    function onSubmit() {
        if (filtered[highlight]) commit(filtered[highlight])
    }

    return (
        <View ref={anchorRef} style={s.wrap}>
            <Text style={s.label}>{label}</Text>
            <View style={s.inputRow}>
                <TextInput
                    style={[s.input, selected ? s.inputSelected : null]}
                    value={query}
                    placeholder={placeholder}
                    placeholderTextColor={colors.textMuted}
                    onFocus={() => {
                        cancelClose()
                        setOpen(true)
                    }}
                    onBlur={scheduleClose}
                    onChangeText={(t) => {
                        setQuery(t)
                        setOpen(true)
                        // typing implicitly de-selects so the parent doesn't
                        // think the stale id is still chosen.
                        if (selected) onSelect(null)
                    }}
                    onKeyPress={onKeyPress}
                    onSubmitEditing={onSubmit}
                    blurOnSubmit={false}
                    autoCapitalize="none"
                    autoCorrect={false}
                />
                {selected || query ? (
                    // onMouseDown preventDefault stops the input blur from
                    // firing — without it, clicking × would trigger close
                    // before clear() runs.
                    <Pressable
                        onPress={clear}
                        style={s.clearBtn}
                        accessibilityLabel="Очистить"
                        {...({onMouseDown: (e: React.MouseEvent) => e.preventDefault()} as object)}
                    >
                        <Text style={s.clearText}>×</Text>
                    </Pressable>
                ) : null}
            </View>

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
        </View>
    )
}

// Popup is the listbox itself, mounted on document.body. It positions itself
// just below the anchor's bounding rect and re-measures on scroll/resize so
// it tracks the page.
function Popup(props: {
    anchorRef: React.RefObject<View | null>
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

    // Re-measure synchronously after the DOM is laid out so the popup never
    // appears in the wrong spot on the first frame.
    useLayoutEffect(() => {
        if (!open) return
        function measure() {
            const node = anchorRef.current as unknown as HTMLElement | null
            if (!node || typeof node.getBoundingClientRect !== 'function') return
            const r = node.getBoundingClientRect()
            // Anchor below the input row. The label sits at the top of the
            // wrapper, the input row is below — we want the popup just under
            // the input, which is the bottom of the wrapper.
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
            style={{
                position: 'fixed',
                top: rect.top,
                left: rect.left,
                width: rect.width,
                zIndex: 9999,
                background: '#fff',
                border: `1px solid ${colors.border}`,
                borderRadius: 8,
                boxShadow: '0 8px 16px rgba(0,0,0,0.08)',
                overflow: 'hidden',
                maxHeight: 280,
                overflowY: 'auto',
            }}
        >
            {items.length === 0 ? (
                <Text style={s.emptyRow}>{emptyMessage}</Text>
            ) : (
                items.map((item, idx) => {
                    const active = idx === highlight
                    return (
                        <Pressable
                            key={item.id}
                            onPress={() => onCommit(item)}
                            onHoverIn={() => onHover(idx)}
                            style={[s.option, active && s.optionActive]}
                        >
                            <Text style={[s.optionLabel, active && s.optionLabelActive]}>{item.label}</Text>
                            {item.sublabel ? (
                                <Text style={[s.optionSub, active && s.optionSubActive]}>{item.sublabel}</Text>
                            ) : null}
                        </Pressable>
                    )
                })
            )}
        </div>,
        document.body,
    )
}

const s = StyleSheet.create({
    wrap: {marginBottom: 12},
    label: {fontSize: 13, fontWeight: '500', color: colors.text, marginBottom: 6},
    inputRow: {flexDirection: 'row', alignItems: 'center'},
    input: {
        flex: 1,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 8,
        paddingVertical: 10,
        paddingHorizontal: 12,
        fontSize: 15,
        color: colors.text,
        backgroundColor: '#fff',
    },
    inputSelected: {borderColor: colors.primary},
    clearBtn: {
        marginLeft: -34,
        width: 28,
        height: 28,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 999,
    },
    clearText: {fontSize: 18, color: colors.textMuted, lineHeight: 18},

    option: {
        paddingVertical: 8,
        paddingHorizontal: 12,
        backgroundColor: '#fff',
    },
    optionActive: {backgroundColor: colors.primary},
    optionLabel: {fontSize: 14, color: colors.text},
    optionLabelActive: {color: '#fff'},
    optionSub: {fontSize: 12, color: colors.textMuted, marginTop: 2},
    optionSubActive: {color: '#dbeafe'},
    emptyRow: {paddingVertical: 10, paddingHorizontal: 12, fontSize: 13, color: colors.textMuted, fontStyle: 'italic'},
})
