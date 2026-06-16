import { useId, type ReactNode } from 'react'
import { Label } from './label'

// Field wires a label, its control, and an error message together with the
// right ids/aria so forms stay accessible. Pass a render prop receiving the
// control id and an `invalid` flag.
export function Field({
  label,
  error,
  children,
}: {
  label: string
  error?: string
  children: (props: { id: string; invalid: boolean }) => ReactNode
}) {
  const id = useId()
  const invalid = !!error
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children({ id, invalid })}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  )
}
