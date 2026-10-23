import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Button } from './button'
import { Field, TextInput } from './field'

interface ReasonDialogProps {
  open: boolean
  title: string
  description?: ReactNode
  confirmLabel: string
  /** Quick answers the person can tap instead of typing. */
  suggestions?: string[]
  loading?: boolean
  onConfirm: (reason: string) => void
  onCancel: () => void
}

/** Asks for the reason of a sensitive action (void, cancel, cash out). Minimum 3 characters. */
export function ReasonDialog({
  open,
  title,
  description,
  confirmLabel,
  suggestions = [],
  loading = false,
  onConfirm,
  onCancel,
}: ReasonDialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const [reason, setReason] = useState('')

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  const valid = reason.trim().length >= 3

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (valid) onConfirm(reason.trim())
  }

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault()
        if (!loading) onCancel()
      }}
      onClose={() => setReason('')}
      aria-labelledby="reason-title"
      className="m-auto w-[min(28rem,calc(100%-2rem))] rounded-card border border-line bg-surface p-6 text-fg backdrop:bg-ink/70"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <h2 id="reason-title" className="text-lg font-semibold">
            {title}
          </h2>
          {description && <div className="mt-1 text-sm text-fg-muted">{description}</div>}
        </div>
        {suggestions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setReason(s)}
                className="h-10 rounded-full border border-line px-4 text-sm text-fg-muted hover:border-line-strong hover:text-fg"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        <Field label="Motivo" hint="Queda registrado con tu nombre y la hora.">
          {(props) => (
            <TextInput
              {...props}
              autoFocus
              maxLength={200}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={loading}>
            Cancelar
          </Button>
          <Button type="submit" variant="danger" disabled={!valid} loading={loading}>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </dialog>
  )
}
