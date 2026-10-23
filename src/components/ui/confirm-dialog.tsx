import { useEffect, useRef, type ReactNode } from 'react'
import { Button } from './button'

interface ConfirmDialogProps {
  open: boolean
  title: string
  children: ReactNode
  confirmLabel: string
  tone?: 'danger' | 'primary'
  loading?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  tone = 'danger',
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault()
        if (!loading) onCancel()
      }}
      aria-labelledby="confirm-title"
      className="m-auto w-[min(26rem,calc(100%-2rem))] rounded-card border border-line bg-surface p-6 text-fg backdrop:bg-ink/70"
    >
      <h2 id="confirm-title" className="text-lg font-semibold">
        {title}
      </h2>
      <div className="mt-2 text-sm text-fg-muted">{children}</div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={loading}>
          Cancelar
        </Button>
        <Button variant={tone} onClick={onConfirm} loading={loading}>
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  )
}
