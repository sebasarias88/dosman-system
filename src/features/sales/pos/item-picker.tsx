import { Minus, Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { TextInput } from '@/components/ui/field'
import type { AddOn, Product } from '@/features/catalog/types'
import { cn } from '@/lib/cn'
import { formatCurrency } from '@/lib/format'
import type { CartLine } from './cart'

const QUICK_NOTES = ['Sin hielo', 'Poco hielo', 'Sin azúcar', 'Poco dulce', 'Extra frío']

interface ItemPickerProps {
  product: Product | null
  addOns: AddOn[]
  onAdd: (line: Omit<CartLine, 'key'>) => void
  onClose: () => void
}

/** Size, add-ons, quantity and notes for one product, with big touch targets. */
export function ItemPicker({ product, addOns, onAdd, onClose }: ItemPickerProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const variants = product?.product_variants.filter((v) => v.is_active) ?? []
  const allowedAddOns = addOns.filter(
    (a) => a.is_active && product?.product_add_ons.some((link) => link.add_on_id === a.id),
  )
  const [variantId, setVariantId] = useState(variants.length === 1 ? (variants[0]?.id ?? '') : '')
  const [selectedAddOns, setSelectedAddOns] = useState<string[]>([])
  const [quantity, setQuantity] = useState(1)
  const [notes, setNotes] = useState('')

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (product && !dialog.open) dialog.showModal()
    if (!product && dialog.open) dialog.close()
  }, [product])

  if (!product) return <dialog ref={ref} className="hidden" />

  const variant = variants.find((v) => v.id === variantId)
  const chosenAddOns = allowedAddOns.filter((a) => selectedAddOns.includes(a.id))
  const unitPrice = (variant?.price ?? 0) + chosenAddOns.reduce((sum, a) => sum + a.price, 0)

  function toggleNote(note: string) {
    const parts = notes
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
    setNotes(parts.includes(note) ? parts.filter((p) => p !== note).join(', ') : [...parts, note].join(', '))
  }

  function handleAdd() {
    if (!variant || !product) return
    onAdd({
      variantId: variant.id,
      productName: product.name,
      variantName: variant.name,
      unitPrice,
      addOns: chosenAddOns.map((a) => ({ id: a.id, name: a.name, price: a.price })),
      quantity,
      notes,
    })
  }

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      aria-labelledby="picker-title"
      className="m-auto max-h-[92dvh] w-[min(40rem,calc(100%-1.5rem))] overflow-y-auto rounded-card border border-line bg-surface p-6 text-fg backdrop:bg-ink/70"
    >
      <h2 id="picker-title" className="text-xl font-semibold">
        {product.name}
      </h2>

      {variants.length > 1 && (
        <fieldset className="mt-5">
          <legend className="mb-2 text-sm text-fg-muted">Tamaño</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {variants.map((v) => (
              <button
                key={v.id}
                type="button"
                aria-pressed={variantId === v.id}
                onClick={() => setVariantId(v.id)}
                className={cn(
                  'flex h-16 flex-col items-center justify-center rounded-xl border text-sm transition-colors',
                  variantId === v.id
                    ? 'border-fg bg-fg text-ink'
                    : 'border-line bg-surface-2 hover:border-line-strong',
                )}
              >
                <span className="font-medium">{v.name}</span>
                <span className="tabular-nums opacity-80">{formatCurrency(v.price)}</span>
              </button>
            ))}
          </div>
        </fieldset>
      )}

      {allowedAddOns.length > 0 && (
        <fieldset className="mt-5">
          <legend className="mb-2 text-sm text-fg-muted">Adiciones</legend>
          <div className="flex flex-wrap gap-2">
            {allowedAddOns.map((a) => {
              const selected = selectedAddOns.includes(a.id)
              return (
                <button
                  key={a.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() =>
                    setSelectedAddOns((ids) => (selected ? ids.filter((id) => id !== a.id) : [...ids, a.id]))
                  }
                  className={cn(
                    'h-12 rounded-xl border px-4 text-sm transition-colors',
                    selected
                      ? 'border-fg bg-fg text-ink'
                      : 'border-line bg-surface-2 hover:border-line-strong',
                  )}
                >
                  + {a.name} · {formatCurrency(a.price)}
                </button>
              )
            })}
          </div>
        </fieldset>
      )}

      <fieldset className="mt-5">
        <legend className="mb-2 text-sm text-fg-muted">Notas para preparación</legend>
        <div className="mb-2 flex flex-wrap gap-2">
          {QUICK_NOTES.map((note) => (
            <button
              key={note}
              type="button"
              onClick={() => toggleNote(note)}
              className={cn(
                'h-10 rounded-full border px-3.5 text-sm transition-colors',
                notes.includes(note) ? 'border-fg text-fg' : 'border-line text-fg-muted hover:text-fg',
              )}
            >
              {note}
            </button>
          ))}
        </div>
        <TextInput
          aria-label="Nota"
          placeholder="Otra indicación…"
          maxLength={140}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </fieldset>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2" role="group" aria-label="Cantidad">
          <Button
            variant="secondary"
            size="icon"
            aria-label="Menos"
            onClick={() => setQuantity((q) => Math.max(1, q - 1))}
            disabled={quantity <= 1}
          >
            <Minus className="size-5" aria-hidden />
          </Button>
          <span className="w-10 text-center text-xl font-semibold tabular-nums" aria-live="polite">
            {quantity}
          </span>
          <Button
            variant="secondary"
            size="icon"
            aria-label="Más"
            onClick={() => setQuantity((q) => Math.min(99, q + 1))}
          >
            <Plus className="size-5" aria-hidden />
          </Button>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="lg" onClick={onClose}>
            Cancelar
          </Button>
          <Button size="lg" onClick={handleAdd} disabled={!variant}>
            Agregar · {formatCurrency(unitPrice * quantity)}
          </Button>
        </div>
      </div>
    </dialog>
  )
}
