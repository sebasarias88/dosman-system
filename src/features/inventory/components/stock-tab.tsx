import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, PackageX, Search, SlidersHorizontal, Trash } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, QuantityInput, TextInput } from '@/components/ui/field'
import { Sheet } from '@/components/ui/sheet'
import { Spinner } from '@/components/ui/spinner'
import { formatStock, UNITS } from '@/features/catalog/units'
import { cn } from '@/lib/cn'
import { formatCurrency } from '@/lib/format'
import { recordWaste, setMinStock, stockQuery, type StockRow } from '../inventory-api'
import { useInventoryMutation } from '../use-inventory-mutation'

type Level = 'out' | 'low' | 'ok'

function levelOf(row: StockRow): Level {
  if (row.quantity <= 0) return 'out'
  if (row.min_quantity > 0 && row.quantity <= row.min_quantity) return 'low'
  return 'ok'
}

const LEVEL_BADGE: Record<Level, { label: string; tone: 'danger' | 'warning' | 'success' }> = {
  out: { label: 'Agotado', tone: 'danger' },
  low: { label: 'Bajo', tone: 'warning' },
  ok: { label: 'Bien', tone: 'success' },
}

export function StockTab({ branchId, isManager }: { branchId: string; isManager: boolean }) {
  const { data: rows = [], isPending } = useQuery(stockQuery(branchId))
  const [search, setSearch] = useState('')
  const [onlyLow, setOnlyLow] = useState(false)
  const [waste, setWaste] = useState<StockRow | null>(null)
  const [minimum, setMinimum] = useState<StockRow | null>(null)

  const summary = useMemo(
    () => ({
      value: rows.reduce((total, r) => total + Math.max(r.quantity, 0) * r.unit_cost, 0),
      low: rows.filter((r) => levelOf(r) === 'low').length,
      out: rows.filter((r) => levelOf(r) === 'out').length,
    }),
    [rows],
  )

  if (isPending) return <Spinner />

  const term = search.trim().toLowerCase()
  const visible = rows
    .filter((r) => !term || r.name.toLowerCase().includes(term))
    .filter((r) => !onlyLow || levelOf(r) !== 'ok')

  return (
    <div className="flex flex-col gap-5">
      <dl className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-card border border-line bg-surface p-4">
          <dt className="text-sm text-fg-muted">Valor del inventario</dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums">{formatCurrency(summary.value)}</dd>
        </div>
        <div className="rounded-card border border-line bg-surface p-4">
          <dt className="flex items-center gap-2 text-sm text-fg-muted">
            <AlertTriangle className="size-4 text-warning" aria-hidden /> Por acabarse
          </dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums">{summary.low}</dd>
        </div>
        <div className="rounded-card border border-line bg-surface p-4">
          <dt className="flex items-center gap-2 text-sm text-fg-muted">
            <PackageX className="size-4 text-danger" aria-hidden /> Agotados
          </dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums">{summary.out}</dd>
        </div>
      </dl>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-fg-subtle"
            aria-hidden
          />
          <TextInput
            type="search"
            aria-label="Buscar insumo"
            placeholder="Buscar insumo"
            className="pl-10"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button
          type="button"
          aria-pressed={onlyLow}
          onClick={() => setOnlyLow((v) => !v)}
          className={cn(
            'h-11 rounded-xl border px-4 text-sm transition-colors',
            onlyLow ? 'border-fg bg-fg text-ink' : 'border-line text-fg-muted hover:text-fg',
          )}
        >
          Solo bajos y agotados
        </button>
      </div>

      <div className="overflow-x-auto rounded-card border border-line">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <thead className="bg-surface-2 text-xs text-fg-subtle">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">
                Insumo
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Hay
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Avisar con
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Valor
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Estado
              </th>
              <th scope="col" className="px-4 py-3">
                <span className="sr-only">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const level = levelOf(row)
              return (
                <tr key={row.supply_id} className="border-t border-line">
                  <th scope="row" className="px-4 py-3 font-medium">
                    {row.name}
                  </th>
                  <td className="px-4 py-3 tabular-nums">{formatStock(row.unit, row.quantity)}</td>
                  <td className="px-4 py-3 text-fg-muted tabular-nums">
                    {row.min_quantity > 0 ? formatStock(row.unit, row.min_quantity) : '—'}
                  </td>
                  <td className="px-4 py-3 text-fg-muted tabular-nums">
                    {formatCurrency(Math.max(row.quantity, 0) * row.unit_cost)}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={LEVEL_BADGE[level].tone}>{LEVEL_BADGE[level].label}</Badge>
                  </td>
                  <td className="px-2 py-1.5 text-right whitespace-nowrap">
                    <Button variant="ghost" className="px-3 text-sm" onClick={() => setWaste(row)}>
                      <Trash className="size-4" aria-hidden />
                      Merma
                    </Button>
                    {isManager && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Cambiar el aviso de ${row.name}`}
                        onClick={() => setMinimum(row)}
                      >
                        <SlidersHorizontal className="size-4" aria-hidden />
                      </Button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {visible.length === 0 && (
          <p className="p-8 text-center text-fg-muted">
            {rows.length === 0
              ? 'Aún no hay insumos. Créalos en Productos y recetas.'
              : 'Nada con ese filtro.'}
          </p>
        )}
      </div>

      {waste && (
        <WasteSheet key={waste.supply_id} branchId={branchId} row={waste} onClose={() => setWaste(null)} />
      )}
      {minimum && (
        <MinimumSheet
          key={minimum.supply_id}
          branchId={branchId}
          row={minimum}
          onClose={() => setMinimum(null)}
        />
      )}
    </div>
  )
}

const WASTE_REASONS = ['Se dañó', 'Se venció', 'Se cayó o derramó', 'Prueba de producto']

function WasteSheet({ branchId, row, onClose }: { branchId: string; row: StockRow; onClose: () => void }) {
  const info = UNITS[row.unit]
  const [quantity, setQuantity] = useState<number | null>(null)
  const [reason, setReason] = useState('')
  const save = useInventoryMutation(recordWaste, 'Merma registrada')
  const base = (quantity ?? 0) * info.factor
  const valid = base > 0 && reason.trim().length >= 3

  return (
    <Sheet
      open
      onClose={onClose}
      title={`Merma de ${row.name}`}
      description="Lo que se dañó, se venció o se perdió. El dueño recibe un aviso."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="danger"
            disabled={!valid}
            loading={save.isPending}
            onClick={() =>
              save.mutate(
                { branchId, supplyId: row.supply_id, quantity: base, reason: reason.trim() },
                { onSuccess: onClose },
              )
            }
          >
            Registrar merma
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <p className="text-sm text-fg-muted">Hay {formatStock(row.unit, row.quantity)} en esta sede.</p>
        <Field
          label={`Cantidad perdida (${info.bulk})`}
          hint={base > 0 ? `Equivale a ${formatCurrency(base * row.unit_cost)}` : undefined}
        >
          {(props) => (
            <QuantityInput {...props} value={quantity} onValueChange={setQuantity} suffix={info.bulk} />
          )}
        </Field>
        <Field label="Motivo">
          {(props) => (
            <TextInput
              {...props}
              maxLength={200}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
        </Field>
        <div className="flex flex-wrap gap-2">
          {WASTE_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setReason(r)}
              className="h-10 rounded-full border border-line px-4 text-sm text-fg-muted hover:text-fg"
            >
              {r}
            </button>
          ))}
        </div>
      </div>
    </Sheet>
  )
}

function MinimumSheet({ branchId, row, onClose }: { branchId: string; row: StockRow; onClose: () => void }) {
  const info = UNITS[row.unit]
  const [value, setValue] = useState<number | null>(row.min_quantity / info.factor)
  const save = useInventoryMutation(
    (min: number | null) => setMinStock(branchId, row.supply_id, min),
    'Aviso actualizado',
  )

  return (
    <Sheet
      open
      onClose={onClose}
      title={`Aviso de ${row.name}`}
      description="Cuando queden menos de esta cantidad en esta sede, el dueño recibe un aviso."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            loading={save.isPending}
            onClick={() => save.mutate(value === null ? null : value * info.factor, { onSuccess: onClose })}
          >
            Guardar
          </Button>
        </div>
      }
    >
      <Field
        label={`Avisar cuando queden menos de (${info.bulk})`}
        hint="Déjalo vacío para usar el valor general del insumo."
      >
        {(props) => <QuantityInput {...props} value={value} onValueChange={setValue} suffix={info.bulk} />}
      </Field>
    </Sheet>
  )
}
