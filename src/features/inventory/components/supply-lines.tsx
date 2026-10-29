import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MoneyInput, QuantityInput } from '@/components/ui/field'
import { Select } from '@/components/ui/select'
import type { Supply } from '@/features/catalog/types'
import { formatStock, UNITS } from '@/features/catalog/units'
import { cn } from '@/lib/cn'

/** A line while it is being typed. Quantities are in kg / L / und (bulk units). */
export interface DraftLine {
  key: string
  supplyId: string
  quantity: number | null
  /** Purchases: what was paid for this line. */
  total: number | null
  /** Purchases: how much of it goes straight to the other branch. */
  send: number | null
}

export function newLine(): DraftLine {
  return { key: crypto.randomUUID(), supplyId: '', quantity: null, total: null, send: null }
}

interface SupplyLinesProps {
  lines: DraftLine[]
  onChange: (lines: DraftLine[]) => void
  supplies: Supply[]
  /** Show the "paid" column (purchases). */
  withTotal?: boolean
  /** Label of the "send to the other branch" column; hidden when absent. */
  sendLabel?: string
  /** Stock available in base units, shown as a hint (transfers). */
  available?: Map<string, number>
}

export function SupplyLines({
  lines,
  onChange,
  supplies,
  withTotal,
  sendLabel,
  available,
}: SupplyLinesProps) {
  const byId = new Map(supplies.map((s) => [s.id, s]))
  const used = new Set(lines.map((l) => l.supplyId))
  const patch = (key: string, values: Partial<DraftLine>) =>
    onChange(lines.map((l) => (l.key === key ? { ...l, ...values } : l)))

  // PC and tablet: one row per supply. Phones: a small card per supply
  // (supply on top, numbers below), so nothing has to scroll sideways.
  const columns = cn(
    'sm:grid sm:min-w-[34rem] sm:items-start sm:gap-2',
    withTotal && sendLabel
      ? 'sm:grid-cols-[1fr_6.5rem_8.5rem_6.5rem_auto]'
      : withTotal
        ? 'sm:grid-cols-[1fr_7rem_9rem_auto]'
        : 'sm:grid-cols-[1fr_8rem_auto]',
  )
  const mobileLabel = 'mb-1 block text-xs text-fg-subtle sm:hidden'

  return (
    <div className="flex flex-col gap-2 sm:overflow-x-auto">
      <div className={cn(columns, 'hidden px-1 text-xs text-fg-subtle sm:grid')}>
        <span>Insumo</span>
        <span>Cantidad</span>
        {withTotal && <span>Valor pagado</span>}
        {sendLabel && <span>{sendLabel}</span>}
        <span className="w-11" />
      </div>
      {lines.map((line) => {
        const supply = byId.get(line.supplyId)
        const bulk = supply ? UNITS[supply.unit].bulk : ''
        const stock = supply && available ? available.get(supply.id) : undefined
        const tooMuch =
          supply &&
          line.quantity !== null &&
          stock !== undefined &&
          line.quantity * UNITS[supply.unit].factor > stock
        return (
          <div
            key={line.key}
            className={cn(
              columns,
              'grid grid-cols-2 gap-2 rounded-xl border border-line p-3 sm:rounded-none sm:border-0 sm:p-0',
            )}
          >
            <div className="col-span-2 sm:col-span-1">
              <Select
                aria-label="Insumo"
                placeholder="Elegir insumo…"
                value={line.supplyId}
                onValueChange={(supplyId) => patch(line.key, { supplyId })}
                options={supplies.map((s) => {
                  const taken = used.has(s.id) && s.id !== line.supplyId
                  return {
                    value: s.id,
                    label: s.name,
                    hint: taken ? 'Ya está en la lista' : undefined,
                    disabled: taken,
                  }
                })}
              />
              {supply && stock !== undefined && (
                <p className={cn('mt-1 px-1 text-xs', tooMuch ? 'text-warning' : 'text-fg-subtle')}>
                  Hay {formatStock(supply.unit, stock)}
                </p>
              )}
            </div>
            <div>
              <span className={mobileLabel}>Cantidad</span>
              <QuantityInput
                aria-label="Cantidad"
                value={line.quantity}
                suffix={bulk}
                onValueChange={(quantity) => patch(line.key, { quantity })}
              />
            </div>
            {withTotal && (
              <div>
                <span className={mobileLabel}>Valor pagado</span>
                <MoneyInput
                  aria-label="Valor pagado"
                  value={line.total}
                  onValueChange={(total) => patch(line.key, { total })}
                />
              </div>
            )}
            {sendLabel && (
              <div>
                <span className={mobileLabel}>{sendLabel}</span>
                <QuantityInput
                  aria-label={sendLabel}
                  value={line.send}
                  suffix={bulk}
                  onValueChange={(send) => patch(line.key, { send })}
                />
              </div>
            )}
            <Button
              className="self-end justify-self-end sm:self-auto"
              variant="ghost"
              size="icon"
              aria-label={`Quitar ${supply?.name ?? 'renglón'}`}
              disabled={lines.length === 1}
              onClick={() => onChange(lines.filter((l) => l.key !== line.key))}
            >
              <Trash2 className="size-4" aria-hidden />
            </Button>
          </div>
        )
      })}
      <Button variant="secondary" className="self-start" onClick={() => onChange([...lines, newLine()])}>
        <Plus className="size-4" aria-hidden />
        Agregar insumo
      </Button>
    </div>
  )
}

/** Base-unit quantity of a line (kg -> g, L -> ml). */
export function toBase(line: DraftLine, supplies: Map<string, Supply>, value: number | null): number {
  const supply = supplies.get(line.supplyId)
  return supply && value ? value * UNITS[supply.unit].factor : 0
}
