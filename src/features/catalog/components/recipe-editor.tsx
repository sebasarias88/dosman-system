import { Plus, Trash2 } from 'lucide-react'
import { useId } from 'react'
import { QuantityInput } from '@/components/ui/field'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/format'
import { summarizeCost } from '../costing'
import type { RecipeLine, Supply } from '../types'
import { UNITS } from '../units'
import { MarginBadge } from './margin-badge'

/** A recipe line while it is being edited: the quantity may still be empty. */
export interface DraftRecipeLine {
  key: string
  supply_id: string
  quantity: number | null
}

export function toDraftLines(lines: RecipeLine[]): DraftRecipeLine[] {
  return lines.map((line) => ({ key: crypto.randomUUID(), ...line }))
}

export function toRecipeLines(lines: DraftRecipeLine[]): RecipeLine[] {
  return lines
    .filter((l) => l.supply_id && l.quantity !== null && l.quantity > 0)
    .map(({ supply_id, quantity }) => ({ supply_id, quantity: quantity ?? 0 }))
}

interface RecipeEditorProps {
  lines: DraftRecipeLine[]
  onChange: (lines: DraftRecipeLine[]) => void
  supplies: Supply[]
  suppliesById: Map<string, Supply>
  price: number
}

/**
 * Ingredients of one size or add-on with the live cost and margin, so the
 * owner sees right away how much each sale really leaves.
 */
export function RecipeEditor({ lines, onChange, supplies, suppliesById, price }: RecipeEditorProps) {
  const headingId = useId()
  const summary = summarizeCost(price, toRecipeLines(lines), suppliesById)
  const usedIds = new Set(lines.map((l) => l.supply_id))
  const activeSupplies = supplies.filter((s) => s.is_active)

  function update(key: string, patch: Partial<DraftRecipeLine>) {
    onChange(lines.map((line) => (line.key === key ? { ...line, ...patch } : line)))
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h4 id={headingId} className="text-sm font-medium text-fg-muted">
          Receta (lo que gasta cada venta)
        </h4>
        <MarginBadge summary={summary} />
      </div>

      {lines.length === 0 && (
        <p className="rounded-xl border border-dashed border-line-strong px-4 py-3 text-sm text-fg-subtle">
          Sin insumos. Agrega lo que lleva para calcular el costo y descontar el inventario.
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {lines.map((line) => {
          const supply = suppliesById.get(line.supply_id)
          const lineCost = supply && line.quantity ? supply.unit_cost * line.quantity : 0
          return (
            <li
              key={line.key}
              className="grid grid-cols-[1fr_7.5rem_auto] items-center gap-2 sm:grid-cols-[1fr_8rem_5.5rem_auto]"
            >
              <Select
                aria-label="Insumo"
                placeholder="Elegir insumo…"
                value={line.supply_id}
                onValueChange={(supply_id) => update(line.key, { supply_id })}
                options={[
                  ...activeSupplies.map((s) => ({
                    value: s.id,
                    label: s.name,
                    hint: usedIds.has(s.id) && s.id !== line.supply_id ? 'Ya está en la receta' : undefined,
                    disabled: usedIds.has(s.id) && s.id !== line.supply_id,
                  })),
                  ...(supply && !supply.is_active
                    ? [{ value: supply.id, label: `${supply.name} (desactivado)` }]
                    : []),
                ]}
              />
              <QuantityInput
                aria-label="Cantidad"
                value={line.quantity}
                onValueChange={(quantity) => update(line.key, { quantity })}
                suffix={supply ? UNITS[supply.unit].base : undefined}
              />
              <span className="hidden text-right text-sm text-fg-muted tabular-nums sm:block">
                {formatCurrency(lineCost)}
              </span>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Quitar ${supply?.name ?? 'insumo'}`}
                onClick={() => onChange(lines.filter((l) => l.key !== line.key))}
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </li>
          )
        })}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          variant="secondary"
          onClick={() => onChange([...lines, { key: crypto.randomUUID(), supply_id: '', quantity: null }])}
          disabled={activeSupplies.length === 0}
        >
          <Plus className="size-4" aria-hidden />
          Agregar insumo
        </Button>
        <dl className="flex gap-5 text-sm">
          <div>
            <dt className="text-fg-subtle">Costo</dt>
            <dd className="font-medium tabular-nums">{formatCurrency(summary.cost)}</dd>
          </div>
          <div>
            <dt className="text-fg-subtle">Ganancia</dt>
            <dd className="font-medium tabular-nums">{formatCurrency(summary.profit)}</dd>
          </div>
        </dl>
      </div>
      {activeSupplies.length === 0 && (
        <p className="text-xs text-fg-subtle">Primero crea los insumos en la pestaña Insumos.</p>
      )}
    </section>
  )
}
