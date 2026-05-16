// Shared UI primitives — plain React + Tailwind v4. The public API
// matches what the codebase has always used (onPress/onChangeText/title
// props) so the move off react-native-web only touches internals, not
// the dozens of call sites.
//
// `colors` is kept as a JS export for the few places that still need to
// reference brand colors from an inline style (e.g., a dynamically-
// colored cell border that depends on data). Most code should use the
// Tailwind tokens (bg-primary, text-muted, border-card-border) defined
// in src/index.css via @theme.

import {type CSSProperties, type ReactNode} from 'react'

export const colors = {
    bg: '#f5f6f8',
    surface: '#ffffff',
    border: '#e1e4ea',
    text: '#1f2933',
    textMuted: '#6b7280',
    primary: '#2563eb',
    primaryPressed: '#1e40af',
    danger: '#dc2626',
    ok: '#15803d',
}

interface CardProps {
    children: ReactNode
    className?: string
    // `style` is intentionally permissive during the RN-Web migration —
    // some callers still pass camelCase RN aliases like paddingVertical
    // alongside real CSS. React drops unknown keys at runtime, so this
    // is safe; once every call site has moved to Tailwind classes the
    // type will tighten back to a strict CSSProperties.
    style?: CSSProperties & Record<string, unknown>
}

export function Card({children, className = '', style}: CardProps) {
    return (
        <div
            className={`bg-card rounded-xl border border-card-border p-6 ${className}`}
            style={style as CSSProperties}
        >
            {children}
        </div>
    )
}

export function Heading({children}: {children: ReactNode}) {
    return <h2 className="text-[22px] font-semibold text-ink mb-2 leading-tight">{children}</h2>
}

export function Subheading({children}: {children: ReactNode}) {
    return <p className="text-sm text-muted mb-5">{children}</p>
}

interface FieldProps {
    label: string
    value: string
    // Keep both spellings during/after the RN-Web migration so existing
    // callers don't all have to be touched in one go.
    onChangeText?: (v: string) => void
    onChange?: (v: string) => void
    placeholder?: string
    secureTextEntry?: boolean
    autoCapitalize?: 'none' | 'sentences'
    error?: string
}

export function Field(props: FieldProps) {
    const handle = (v: string) => {
        props.onChangeText?.(v)
        props.onChange?.(v)
    }
    return (
        <div className="mb-3">
            <label className="block text-[13px] font-medium text-ink mb-1.5">{props.label}</label>
            <input
                type={props.secureTextEntry ? 'password' : 'text'}
                value={props.value}
                onChange={e => handle(e.target.value)}
                placeholder={props.placeholder}
                autoCapitalize={props.autoCapitalize ?? 'off'}
                className={`block w-full rounded-lg border ${props.error ? 'border-danger' : 'border-card-border'} bg-white px-3 py-2.5 text-[15px] text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/30`}
            />
            {props.error ? <p className="text-xs text-danger mt-1">{props.error}</p> : null}
        </div>
    )
}

interface ButtonProps {
    title: string
    onPress?: () => void
    onClick?: () => void
    disabled?: boolean
    variant?: 'primary' | 'secondary' | 'danger'
    className?: string
}

export function Button({title, onPress, onClick, disabled, variant = 'primary', className = ''}: ButtonProps) {
    const handleClick = () => {
        onPress?.()
        onClick?.()
    }
    const base = 'inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-[15px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
    const variants = {
        primary: 'bg-primary text-white hover:bg-primary-pressed',
        secondary: 'bg-[#eef2f7] text-ink hover:bg-[#e5e9f0]',
        danger: 'bg-danger text-white hover:bg-red-700',
    }
    return (
        <button onClick={handleClick} disabled={disabled} className={`${base} ${variants[variant]} ${className}`} type="button">
            {title}
        </button>
    )
}

export function ErrorBanner({message}: {message: string}) {
    return (
        <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 mb-3">
            <p className="text-sm text-danger">{message}</p>
        </div>
    )
}
