import { ArrowDown } from 'lucide-react'
import { useState } from 'react'
import { Badge, type BadgeTone } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { marginLevel, type MarginLevel } from '@/features/catalog/costing'
import { cn } from '@/lib/cn'
import { formatCurrency } from '@/lib/format'
import type { ProductRow } from '../reports-api'

type SortKey = 'quantity' | 'sales' | 'profit' | 'margin'

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'quantity', label: 'Vendidos' },
  { key: 'sales', label: 'Ventas' },
  { key: 'profit', label: 'Ganancia' },
  { key: 'margin', label: 'Margen' },
]

const TONE: Record<MarginLevel, BadgeTone> = {
  good: 'success',
  warning: 'warning',
  low: 'danger',
  unknown: 'neutral',
}

export const marginOf = (row: ProductRow) => (row.sales > 0 ? (row.profit / row.sales) * 100 : null)

const PAGE = 12

/** Which products sell the most and which ones actually leave money. */
export function ProductsTable({ rows }: { rows: ProductRow[] }) {
  const [sort, setSort] = useState<SortKey>('profit')
  const [showAll, setShowAll] = useState(false)

  if (rows.length === 0) return <p className="text-sm text-fg-subtle">Aún no hay ventas en este periodo.</p>

  const value = (row: ProductRow) => (sort === 'margin' ? (marginOf(row) ?? -1) : row[sort])
  const sorted = [...rows].sort((a, b) => value(b) - value(a))
  const visible = showAll ? sorted : sorted.slice(0, PAGE)
  const noRecipe = rows.filter((r) => r.cost === 0).length

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-left text-sm">
          <thead>
            <tr className="border-b border-line text-fg-subtle">
              <th className="py-2 pr-3 font-normal">Producto</th>
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  className="py-2 pl-3 text-right font-normal"
                  aria-sort={sort === c.key ? 'descending' : 'none'}
                >
                  <button
                    type="button"
                    onClick={() => setSort(c.key)}
                    className={cn(
                      'inline-flex min-h-8 items-center gap-1 hover:text-fg',
                      sort === c.key && 'font-medium text-fg',
                    )}
                  >
                    {c.label}
                    {sort === c.key && <ArrowDown className="size-3.5" aria-hidden />}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {visible.map((row, index) => {
              const margin = marginOf(row)
              return (
                <tr key={row.variant_id}>
                  <td className="py-2.5 pr-3">
                    <span className="mr-2 inline-block w-5 text-right text-xs text-fg-subtle tabular-nums">
                      {index + 1}
                    </span>
                    {row.product_name}
                    {row.variant_name !== 'Único' && (
                      <span className="text-fg-subtle"> · {row.variant_name}</span>
                    )}
                  </td>
                  <td className="py-2.5 pl-3 text-right tabular-nums">{row.quantity}</td>
                  <td className="py-2.5 pl-3 text-right tabular-nums">{formatCurrency(row.sales)}</td>
                  <td className="py-2.5 pl-3 text-right tabular-nums">{formatCurrency(row.profit)}</td>
                  <td className="py-2.5 pl-3 text-right">
                    {row.cost === 0 ? (
                      <Badge tone="warning">Sin receta</Badge>
                    ) : (
                      <Badge tone={TONE[marginLevel(margin)]}>
                        {margin === null ? '—' : `${Math.round(margin)} %`}
                      </Badge>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {rows.length > PAGE && (
          <Button variant="secondary" onClick={() => setShowAll(!showAll)}>
            {showAll ? 'Ver menos' : `Ver los ${rows.length} productos`}
          </Button>
        )}
        {noRecipe > 0 && (
          <p className="text-xs text-warning">
            {noRecipe} {noRecipe === 1 ? 'producto vendido no tiene' : 'productos vendidos no tienen'} receta:
            su ganancia sale inflada. Agrega la receta en Productos.
          </p>
        )}
      </div>
    </div>
  )
}
