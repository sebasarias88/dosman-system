import { useQuery } from '@tanstack/react-query'
import { ClipboardCheck, Search } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { QuantityInput, TextArea, TextInput } from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'
import { formatStock, UNITS } from '@/features/catalog/units'
import { cn } from '@/lib/cn'
import { formatCurrency } from '@/lib/format'
import { applyInventoryCount, fetchCountResult, stockQuery, type CountResultItem } from '../inventory-api'
import { useInventoryMutation } from '../use-inventory-mutation'

/** Counted values in kg / L / und, keyed by supply. */
type Counts = Record<string, number | null>

// The count in progress is kept on this device so closing the tab doesn't lose it.
const draftKey = (branchId: string) => `dosman.count-draft.${branchId}`

function loadDraft(branchId: string): Counts {
  try {
    const raw = window.localStorage.getItem(draftKey(branchId))
    return raw ? (JSON.parse(raw) as Counts) : {}
  } catch {
    return {}
  }
}

function saveDraft(branchId: string, counts: Counts) {
  try {
    if (Object.keys(counts).length === 0) window.localStorage.removeItem(draftKey(branchId))
    else window.localStorage.setItem(draftKey(branchId), JSON.stringify(counts))
  } catch {
    // Not remembered on this device; the count still works.
  }
}

/**
 * Blind physical count: people type what is on the shelf without seeing what
 * the system expects, so the count can't be "adjusted" to match. Supplies
 * left empty are not counted.
 */
export function CountTab({ branchId }: { branchId: string }) {
  const { data: rows = [], isPending } = useQuery(stockQuery(branchId))
  const [counts, setCounts] = useState<Counts>(() => loadDraft(branchId))
  const [search, setSearch] = useState('')
  const [notes, setNotes] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [result, setResult] = useState<CountResultItem[] | null>(null)

  const apply = useInventoryMutation(async () => {
    const items = rows
      .filter((r) => counts[r.supply_id] !== undefined && counts[r.supply_id] !== null)
      .map((r) => ({
        supply_id: r.supply_id,
        counted_quantity: (counts[r.supply_id] ?? 0) * UNITS[r.unit].factor,
      }))
    const countId = await applyInventoryCount(branchId, items, notes.trim())
    return fetchCountResult(countId)
  }, 'Conteo aplicado')

  function update(supplyId: string, value: number | null) {
    setCounts((current) => {
      const next = { ...current, [supplyId]: value }
      if (value === null) delete next[supplyId]
      saveDraft(branchId, next)
      return next
    })
  }

  if (isPending) return <Spinner />

  if (result) return <CountResult items={result} onDone={() => setResult(null)} />

  const counted = Object.keys(counts).length
  const term = search.trim().toLowerCase()
  const visible = rows.filter((r) => !term || r.name.toLowerCase().includes(term))

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-card border border-line bg-surface p-4 text-sm text-fg-muted">
        Cuenta lo que hay físicamente en la sede y escríbelo. No se muestra lo que dice el sistema: al
        aplicar, se corrigen las diferencias y el dueño recibe un aviso si falta algo. Los insumos que dejes
        vacíos no se cuentan.
      </div>

      <div className="relative">
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

      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map((row) => {
          const info = UNITS[row.unit]
          const value = counts[row.supply_id] ?? null
          return (
            <li
              key={row.supply_id}
              className={cn(
                'flex items-center gap-3 rounded-xl border p-3',
                value !== null ? 'border-success/50 bg-success-soft' : 'border-line bg-surface',
              )}
            >
              <label htmlFor={`count-${row.supply_id}`} className="min-w-0 flex-1 truncate font-medium">
                {row.name}
              </label>
              <div className="w-32">
                <QuantityInput
                  id={`count-${row.supply_id}`}
                  value={value}
                  onValueChange={(v) => update(row.supply_id, v)}
                  suffix={info.bulk}
                />
              </div>
            </li>
          )
        })}
      </ul>

      <TextArea
        aria-label="Notas del conteo"
        placeholder="Notas (opcional)"
        maxLength={280}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />

      <div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-line bg-ink/95 py-4 backdrop-blur">
        <p className="flex-1 text-sm text-fg-muted">
          {counted} de {rows.length} insumos contados
        </p>
        {counted > 0 && (
          <Button
            variant="ghost"
            onClick={() => {
              setCounts({})
              saveDraft(branchId, {})
            }}
          >
            Borrar conteo
          </Button>
        )}
        <Button size="lg" disabled={counted === 0} onClick={() => setConfirming(true)}>
          <ClipboardCheck className="size-5" aria-hidden />
          Aplicar conteo
        </Button>
      </div>

      <ConfirmDialog
        open={confirming}
        title="¿Aplicar el conteo?"
        confirmLabel="Aplicar"
        tone="primary"
        loading={apply.isPending}
        onCancel={() => setConfirming(false)}
        onConfirm={() =>
          apply.mutate(undefined, {
            onSuccess: (items) => {
              setConfirming(false)
              setCounts({})
              saveDraft(branchId, {})
              setNotes('')
              setResult(items)
            },
          })
        }
      >
        El inventario de {counted} {counted === 1 ? 'insumo' : 'insumos'} quedará igual a lo que contaste.
        Esto no se puede deshacer.
      </ConfirmDialog>
    </div>
  )
}

function CountResult({ items, onDone }: { items: CountResultItem[]; onDone: () => void }) {
  const shortage = items
    .filter((i) => i.difference < 0)
    .reduce((total, i) => total - i.difference * i.supplies.unit_cost, 0)
  const surplus = items
    .filter((i) => i.difference > 0)
    .reduce((total, i) => total + i.difference * i.supplies.unit_cost, 0)

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-card border border-line bg-surface p-5">
        <h2 className="text-lg font-semibold">Resultado del conteo</h2>
        {items.length === 0 ? (
          <p className="mt-1 text-success">Todo cuadra: lo contado es igual a lo que dice el sistema.</p>
        ) : (
          <p className="mt-1 text-fg-muted">
            Faltante: <b className="text-danger">{formatCurrency(shortage)}</b> · Sobrante:{' '}
            <b className="text-success">{formatCurrency(surplus)}</b>
          </p>
        )}
      </div>
      {items.length > 0 && (
        <div className="overflow-x-auto rounded-card border border-line">
          <table className="w-full min-w-[32rem] text-left text-sm">
            <thead className="bg-surface-2 text-xs text-fg-subtle">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  Insumo
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Sistema
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Contado
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Diferencia
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Valor
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.supply_id} className="border-t border-line">
                  <th scope="row" className="px-4 py-3 font-medium">
                    {item.supplies.name}
                  </th>
                  <td className="px-4 py-3 tabular-nums">
                    {formatStock(item.supplies.unit, item.expected_quantity)}
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {formatStock(item.supplies.unit, item.counted_quantity)}
                  </td>
                  <td
                    className={cn(
                      'px-4 py-3 tabular-nums',
                      item.difference < 0 ? 'text-danger' : 'text-success',
                    )}
                  >
                    {item.difference > 0 ? '+' : ''}
                    {formatStock(item.supplies.unit, item.difference)}
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {formatCurrency(Math.abs(item.difference) * item.supplies.unit_cost)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Button className="self-start" onClick={onDone}>
        Listo
      </Button>
    </div>
  )
}
