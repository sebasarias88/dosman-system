import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Field, MoneyInput, TextInput } from '@/components/ui/field'

function useModal(open: boolean) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])
  return ref
}

function DialogFrame({
  open,
  title,
  description,
  onCancel,
  busy,
  children,
}: {
  open: boolean
  title: string
  description?: ReactNode
  onCancel: () => void
  busy: boolean
  children: ReactNode
}) {
  const ref = useModal(open)
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault()
        if (!busy) onCancel()
      }}
      aria-labelledby="cash-dialog-title"
      className="m-auto w-[min(28rem,calc(100%-2rem))] rounded-card border border-line bg-surface p-6 text-fg backdrop:bg-ink/70"
    >
      {open && (
        <>
          <h2 id="cash-dialog-title" className="text-lg font-semibold">
            {title}
          </h2>
          {description && <div className="mt-1 text-sm text-fg-muted">{description}</div>}
          <div className="mt-5">{children}</div>
        </>
      )}
    </dialog>
  )
}

interface MovementDialogProps {
  open: boolean
  kind: 'in' | 'out'
  loading: boolean
  onConfirm: (input: { amount: number; reason: string }) => void
  onCancel: () => void
}

/** Cash that enters or leaves the drawer without being a sale. */
export function CashMovementDialog({ open, kind, loading, onConfirm, onCancel }: MovementDialogProps) {
  const [amount, setAmount] = useState<number | null>(null)
  const [reason, setReason] = useState('')
  const valid = (amount ?? 0) > 0 && reason.trim().length >= 3

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (valid) onConfirm({ amount: amount ?? 0, reason: reason.trim() })
  }

  return (
    <DialogFrame
      open={open}
      busy={loading}
      onCancel={onCancel}
      title={kind === 'in' ? 'Entrada de efectivo' : 'Salida de efectivo'}
      description={
        kind === 'in'
          ? 'Dinero que entra a la caja y no es una venta (ej. más sencillo).'
          : 'Dinero que sale de la caja (ej. pago a un proveedor). Queda registrado.'
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label="Valor">
          {(props) => <MoneyInput {...props} autoFocus value={amount} onValueChange={setAmount} />}
        </Field>
        <Field label="Motivo">
          {(props) => (
            <TextInput
              {...props}
              maxLength={200}
              placeholder={kind === 'in' ? 'ej. Sencillo para cambio' : 'ej. Pago del hielo'}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={loading}>
            Cancelar
          </Button>
          <Button type="submit" disabled={!valid} loading={loading}>
            Registrar
          </Button>
        </div>
      </form>
    </DialogFrame>
  )
}

interface CloseDialogProps {
  open: boolean
  loading: boolean
  onConfirm: (input: { countedCash: number; notes: string }) => void
  onCancel: () => void
}

/**
 * Blind close: the cashier counts the drawer and types the amount without
 * seeing what the system expects, so the count can't be "adjusted" to match.
 */
export function CloseSessionDialog({ open, loading, onConfirm, onCancel }: CloseDialogProps) {
  const [counted, setCounted] = useState<number | null>(null)
  const [notes, setNotes] = useState('')

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (counted !== null) onConfirm({ countedCash: counted, notes: notes.trim() })
  }

  return (
    <DialogFrame
      open={open}
      busy={loading}
      onCancel={onCancel}
      title="Cerrar turno de caja"
      description="Cuenta todo el efectivo que hay en la caja (incluida la base) y escribe el total."
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label="Efectivo contado">
          {(props) => (
            <MoneyInput
              {...props}
              autoFocus
              className="h-14 text-xl"
              value={counted}
              onValueChange={setCounted}
            />
          )}
        </Field>
        <Field label="Nota (opcional)">
          {(props) => (
            <TextInput
              {...props}
              maxLength={280}
              placeholder="ej. Se recibió un billete roto"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          )}
        </Field>
        <p className="rounded-xl bg-surface-2 p-3 text-sm text-fg-muted">
          Al cerrar, el sistema compara con lo esperado y envía el resumen a los dueños. No se puede deshacer.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={loading}>
            Cancelar
          </Button>
          <Button type="submit" disabled={counted === null} loading={loading}>
            Cerrar turno
          </Button>
        </div>
      </form>
    </DialogFrame>
  )
}
