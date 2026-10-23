import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Badge, type BadgeTone } from '@/components/ui/badge'
import { SelectInput } from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'
import { formatStock } from '@/features/catalog/units'
import { cn } from '@/lib/cn'
import { formatDateTime } from '@/lib/format'
import { movementsQuery, stockQuery, type MovementType } from '../inventory-api'

const TYPE_LABELS: Record<MovementType, { label: string; tone: BadgeTone }> = {
  purchase: { label: 'Compra', tone: 'success' },
  sale: { label: 'Venta', tone: 'neutral' },
  sale_reversal: { label: 'Anulación', tone: 'neutral' },
  waste: { label: 'Merma', tone: 'danger' },
  adjustment: { label: 'Conteo', tone: 'warning' },
  transfer_out: { label: 'Envío', tone: 'neutral' },
  transfer_in: { label: 'Recibido', tone: 'success' },
}

/** History of every stock change in the branch: why each quantity moved. */
export function MovementsTab({ branchId }: { branchId: string }) {
  const [supplyId, setSupplyId] = useState<string | null>(null)
  const { data: supplies = [] } = useQuery(stockQuery(branchId))
  const { data: movements = [], isPending } = useQuery(movementsQuery(branchId, supplyId))

  return (
    <div className="flex flex-col gap-4">
      <div className="max-w-sm">
        <SelectInput
          aria-label="Filtrar por insumo"
          value={supplyId ?? ''}
          onChange={(e) => setSupplyId(e.target.value || null)}
        >
          <option value="">Todos los insumos</option>
          {supplies.map((s) => (
            <option key={s.supply_id} value={s.supply_id}>
              {s.name}
            </option>
          ))}
        </SelectInput>
      </div>

      {isPending ? (
        <Spinner />
      ) : movements.length === 0 ? (
        <p className="p-8 text-center text-fg-muted">No hay movimientos.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-card border border-line bg-surface">
          {movements.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
              <Badge tone={TYPE_LABELS[m.movement_type].tone}>{TYPE_LABELS[m.movement_type].label}</Badge>
              <span className="min-w-40 flex-1 font-medium">{m.supplies.name}</span>
              <span
                className={cn(
                  'w-28 text-right font-medium tabular-nums',
                  m.quantity < 0 ? 'text-danger' : 'text-success',
                )}
              >
                {m.quantity > 0 ? '+' : ''}
                {formatStock(m.supplies.unit, m.quantity)}
              </span>
              <span className="w-full text-xs text-fg-subtle sm:order-last">
                {formatDateTime(m.created_at)}
                {m.profiles && ` · ${m.profiles.full_name}`}
                {m.reason && ` · ${m.reason}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
