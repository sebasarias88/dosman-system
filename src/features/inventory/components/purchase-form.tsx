import { useQuery } from '@tanstack/react-query'
import { Camera, PackageCheck, Plus, X } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Field, SelectInput, TextArea, TextInput } from '@/components/ui/field'
import { catalogQuery } from '@/features/catalog/catalog-api'
import { paymentMethodsQuery } from '@/features/sales/sales-api'
import { cn } from '@/lib/cn'
import { formatCurrency } from '@/lib/format'
import { optimizeImage, uploadMedia } from '@/lib/media'
import {
  branchesQuery,
  recordPurchase,
  saveSupplier,
  suppliersQuery,
  type PurchasePaymentKind,
} from '../inventory-api'
import { useInventoryMutation } from '../use-inventory-mutation'
import { newLine, SupplyLines, toBase, type DraftLine } from './supply-lines'

const PAYMENT_KINDS: { id: PurchasePaymentKind; label: string; description: string }[] = [
  { id: 'cash_drawer', label: 'De la caja', description: 'El dinero sale de la caja abierta' },
  { id: 'other', label: 'Pagado por fuera', description: 'Nequi, transferencia o dinero del dueño' },
  { id: 'credit', label: 'A crédito', description: 'Queda como deuda con el proveedor' },
]

export function PurchaseForm({ branchId }: { branchId: string }) {
  const { data: catalog } = useQuery(catalogQuery)
  const { data: suppliers = [] } = useQuery(suppliersQuery)
  const { data: branches = [] } = useQuery(branchesQuery)
  const { data: methods = [] } = useQuery(paymentMethodsQuery)

  const [supplierId, setSupplierId] = useState('')
  const [newSupplier, setNewSupplier] = useState<{ name: string; phone: string } | null>(null)
  const [lines, setLines] = useState<DraftLine[]>(() => [newLine()])
  const [paymentKind, setPaymentKind] = useState<PurchasePaymentKind>('cash_drawer')
  const [methodCode, setMethodCode] = useState('nequi')
  const [notes, setNotes] = useState('')
  const [receipt, setReceipt] = useState<Blob | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const supplies = useMemo(() => (catalog?.supplies ?? []).filter((s) => s.is_active), [catalog])
  const suppliesById = useMemo(() => new Map(supplies.map((s) => [s.id, s])), [supplies])
  const otherBranch = branches.find((b) => b.id !== branchId)
  const total = lines.reduce((sum, l) => sum + (l.total ?? 0), 0)

  const complete = lines.filter((l) => l.supplyId && l.quantity && l.quantity > 0 && l.total !== null)
  const sendTooMuch = lines.some((l) => (l.send ?? 0) > (l.quantity ?? 0))
  const problem =
    complete.length === 0
      ? 'Agrega al menos un insumo con cantidad y valor'
      : complete.length !== lines.length
        ? 'Completa o quita los renglones vacíos'
        : sendTooMuch
          ? 'No se puede enviar más de lo que se compró'
          : paymentKind === 'credit' && !supplierId && !newSupplier
            ? 'Para comprar a crédito elige el proveedor'
            : null

  const createSupplier = useInventoryMutation(saveSupplier, 'Proveedor creado')

  const save = useInventoryMutation(async () => {
    const receiptKey = receipt ? await uploadMedia(receipt, 'receipts') : null
    return recordPurchase({
      branch_id: branchId,
      supplier_id: supplierId || null,
      notes: notes.trim(),
      receipt_key: receiptKey,
      items: lines.map((l) => ({
        supply_id: l.supplyId,
        quantity: toBase(l, suppliesById, l.quantity),
        line_total: l.total ?? 0,
      })),
      send: otherBranch
        ? {
            to_branch_id: otherBranch.id,
            items: lines
              .filter((l) => (l.send ?? 0) > 0)
              .map((l) => ({ supply_id: l.supplyId, quantity: toBase(l, suppliesById, l.send) })),
          }
        : null,
      payment: { kind: paymentKind, method_code: paymentKind === 'other' ? methodCode : undefined },
    })
  }, 'Compra registrada')

  function reset() {
    setLines([newLine()])
    setNotes('')
    setReceipt(null)
  }

  async function pickReceipt(file: File | undefined) {
    if (!file) return
    try {
      setReceipt(await optimizeImage(file, 'receipts'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo leer la foto')
    }
  }

  const sending = lines.some((l) => (l.send ?? 0) > 0)

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3" aria-labelledby="supplier-heading">
        <h2 id="supplier-heading" className="font-semibold">
          Proveedor
        </h2>
        {newSupplier ? (
          <div className="grid gap-2 sm:grid-cols-[1fr_12rem_auto_auto]">
            <TextInput
              aria-label="Nombre del proveedor"
              placeholder="Nombre"
              maxLength={80}
              value={newSupplier.name}
              onChange={(e) => setNewSupplier({ ...newSupplier, name: e.target.value })}
            />
            <TextInput
              aria-label="Teléfono"
              placeholder="Teléfono"
              inputMode="tel"
              value={newSupplier.phone}
              onChange={(e) => setNewSupplier({ ...newSupplier, phone: e.target.value })}
            />
            <Button
              disabled={newSupplier.name.trim().length < 2}
              loading={createSupplier.isPending}
              onClick={() =>
                createSupplier.mutate(
                  { name: newSupplier.name.trim(), phone: newSupplier.phone.trim() },
                  {
                    onSuccess: (id) => {
                      setSupplierId(id)
                      setNewSupplier(null)
                    },
                  },
                )
              }
            >
              Guardar
            </Button>
            <Button variant="ghost" size="icon" aria-label="Cancelar" onClick={() => setNewSupplier(null)}>
              <X className="size-4" aria-hidden />
            </Button>
          </div>
        ) : (
          <div className="flex gap-2">
            <SelectInput
              aria-label="Proveedor"
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
            >
              <option value="">Sin proveedor (compra suelta)</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </SelectInput>
            <Button variant="secondary" onClick={() => setNewSupplier({ name: '', phone: '' })}>
              <Plus className="size-4" aria-hidden />
              Nuevo
            </Button>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="items-heading">
        <div>
          <h2 id="items-heading" className="font-semibold">
            Qué llegó
          </h2>
          {otherBranch && (
            <p className="text-sm text-fg-muted">
              En “Enviar a {otherBranch.name}” escribe la parte que se va de una vez para allá. Le llega como
              un envío pendiente de confirmar.
            </p>
          )}
        </div>
        <SupplyLines
          lines={lines}
          onChange={setLines}
          supplies={supplies}
          withTotal
          sendLabel={otherBranch ? `Enviar a ${otherBranch.name}` : undefined}
        />
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="payment-heading">
        <h2 id="payment-heading" className="font-semibold">
          Cómo se pagó
        </h2>
        <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Forma de pago">
          {PAYMENT_KINDS.map((kind) => (
            <button
              key={kind.id}
              type="button"
              role="radio"
              aria-checked={paymentKind === kind.id}
              onClick={() => setPaymentKind(kind.id)}
              className={cn(
                'flex flex-col items-start rounded-xl border p-3 text-left transition-colors',
                paymentKind === kind.id
                  ? 'border-fg bg-surface-3'
                  : 'border-line bg-surface hover:border-line-strong',
              )}
            >
              <span className="font-medium">{kind.label}</span>
              <span className="text-xs text-fg-muted">{kind.description}</span>
            </button>
          ))}
        </div>
        {paymentKind === 'other' && (
          <div className="max-w-xs">
            <Field label="Medio de pago">
              {(props) => (
                <SelectInput {...props} value={methodCode} onChange={(e) => setMethodCode(e.target.value)}>
                  {methods
                    .filter((m) => m.kind !== 'credit')
                    .map((m) => (
                      <option key={m.code} value={m.code}>
                        {m.name}
                      </option>
                    ))}
                </SelectInput>
              )}
            </Field>
          </div>
        )}
      </section>

      <section className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <TextArea
          aria-label="Notas de la compra"
          placeholder="Notas (opcional)"
          maxLength={280}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        <div className="flex flex-col gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            tabIndex={-1}
            onChange={(e) => {
              void pickReceipt(e.target.files?.[0])
              e.target.value = ''
            }}
          />
          <Button variant="secondary" onClick={() => fileRef.current?.click()}>
            <Camera className="size-4" aria-hidden />
            {receipt ? 'Cambiar foto de factura' : 'Foto de la factura'}
          </Button>
          {receipt && (
            <p className="text-xs text-success">Foto lista ({Math.round(receipt.size / 1024)} KB)</p>
          )}
        </div>
      </section>

      <div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-line bg-ink/95 py-4 backdrop-blur">
        <div className="flex-1">
          <p className="text-sm text-fg-muted">Total de la compra</p>
          <p className="text-2xl font-semibold tabular-nums">{formatCurrency(total)}</p>
        </div>
        {problem && <p className="w-full text-sm text-warning sm:w-auto">{problem}</p>}
        <Button
          size="lg"
          disabled={Boolean(problem)}
          loading={save.isPending}
          onClick={() => save.mutate(undefined, { onSuccess: reset })}
        >
          <PackageCheck className="size-5" aria-hidden />
          {sending && otherBranch ? `Registrar y enviar a ${otherBranch.name}` : 'Registrar compra'}
        </Button>
      </div>
    </div>
  )
}
