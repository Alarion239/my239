import { useState, type ReactNode } from 'react'
import { Button, type ButtonProps } from '../../design/ui'

// SectionHeader is a small reusable title + optional action row for the admin
// pages (e.g. "Приглашения" with a "Создать" button to the right).
export function SectionHeader({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div>
        <h2 className="font-display text-xl font-medium text-ink">{title}</h2>
        {description ? <p className="text-sm text-muted">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}

// ConfirmButton asks for an inline confirmation before firing its action, so
// destructive operations (revoke token, delete center/group) don't need a full
// dialog. First click arms it; a second click within the window confirms.
export function ConfirmButton({
  onConfirm,
  confirmLabel = 'Точно?',
  children,
  ...props
}: Omit<ButtonProps, 'onClick'> & {
  onConfirm: () => void
  confirmLabel?: string
  children: ReactNode
}) {
  const [armed, setArmed] = useState(false)

  if (armed) {
    return (
      <Button
        type="button"
        variant="danger"
        {...props}
        onClick={() => {
          setArmed(false)
          onConfirm()
        }}
        onBlur={() => setArmed(false)}
      >
        {confirmLabel}
      </Button>
    )
  }

  return (
    <Button type="button" {...props} onClick={() => setArmed(true)}>
      {children}
    </Button>
  )
}
