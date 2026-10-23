import { Plus, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TextInput } from '@/components/ui/field'
import { cn } from '@/lib/cn'
import { formatCurrency, formatUnitCost } from '@/lib/format'
import type { Catalog, Supply } from '../types'
import { baseToBulk, formatQuantity, unitCostToBulkPrice, UNITS } from '../units'
import { SupplyEditor } from './supply-editor'

export function SuppliesTab({ catalog }: { catalog: Catalog }) {
  const [search, setSearch] = useState('')
  const [editor, setEditor] = useState<{ supply: Supply | null; session: number } | null>(null)

  // How many recipes (product sizes and add-ons) use each supply.
  const usage = useMemo(() => {
    const counts = new Map<string, number>()
    const recipes = [
      ...catalog.products.flatMap((p) => p.product_variants.map((v) => v.recipe_items)),
      ...catalog.addOns.map((a) => a.recipe_items),
    ]
    for (const recipe of recipes) {
      for (const line of recipe) counts.set(line.supply_id, (counts.get(line.supply_id) ?? 0) + 1)
    }
    return counts
  }, [catalog])

  const term = search.trim().toLowerCase()
  const supplies = catalog.supplies.filter((s) => !term || s.name.toLowerCase().includes(term))

  return (
    <div className="flex flex-col gap-6">
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
        <Button onClick={() => setEditor({ supply: null, session: Date.now() })}>
          <Plus className="size-4" aria-hidden />
          Nuevo insumo
        </Button>
      </div>
      <p className="-mt-2 text-sm text-fg-subtle">
        Las existencias de cada sede se manejan en el módulo de Inventario.
      </p>

      {supplies.length === 0 ? (
        <p className="rounded-card border border-dashed border-line-strong p-8 text-center text-fg-muted">
          {catalog.supplies.length === 0 ? 'Aún no hay insumos.' : 'No hay insumos con ese nombre.'}
        </p>
      ) : (
        <div className="overflow-hidden rounded-card border border-line">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-2 text-xs text-fg-subtle">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  Insumo
                </th>
                <th scope="col" className="hidden px-4 py-3 font-medium md:table-cell">
                  Precio de compra
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Costo en receta
                </th>
                <th scope="col" className="hidden px-4 py-3 font-medium lg:table-cell">
                  Aviso de stock bajo
                </th>
                <th scope="col" className="hidden px-4 py-3 font-medium sm:table-cell">
                  Recetas
                </th>
              </tr>
            </thead>
            <tbody>
              {supplies.map((supply) => {
                const info = UNITS[supply.unit]
                const used = usage.get(supply.id) ?? 0
                return (
                  <tr
                    key={supply.id}
                    onClick={() => setEditor({ supply, session: Date.now() })}
                    className={cn(
                      'cursor-pointer border-t border-line transition-colors hover:bg-surface-2',
                      !supply.is_active && 'opacity-60',
                    )}
                  >
                    <th scope="row" className="px-4 py-3 font-medium">
                      <button
                        type="button"
                        className="flex flex-wrap items-center gap-2 text-left"
                        onClick={(e) => {
                          e.stopPropagation()
                          setEditor({ supply, session: Date.now() })
                        }}
                      >
                        {supply.name}
                        {!supply.is_active && <Badge>Archivado</Badge>}
                      </button>
                    </th>
                    <td className="hidden px-4 py-3 tabular-nums md:table-cell">
                      {formatCurrency(unitCostToBulkPrice(supply.unit, supply.unit_cost))} / {info.bulk}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-fg-muted">
                      {formatUnitCost(supply.unit_cost)} / {info.base}
                    </td>
                    <td className="hidden px-4 py-3 tabular-nums text-fg-muted lg:table-cell">
                      {supply.default_min_quantity > 0
                        ? `${formatQuantity(baseToBulk(supply.unit, supply.default_min_quantity))} ${info.bulk}`
                        : '—'}
                    </td>
                    <td className="hidden px-4 py-3 sm:table-cell">
                      {used > 0 ? used : <span className="text-fg-subtle">Sin usar</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {editor && (
        <SupplyEditor
          key={editor.session}
          open
          supply={editor.supply}
          usedInRecipes={editor.supply ? (usage.get(editor.supply.id) ?? 0) : 0}
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  )
}
