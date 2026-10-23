import { Plus } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'
import { formatCurrency } from '@/lib/format'
import { summarizeCost } from '../costing'
import type { AddOn, Catalog, Supply } from '../types'
import { AddOnEditor } from './add-on-editor'
import { MarginBadge } from './margin-badge'

export function AddOnsTab({
  catalog,
  suppliesById,
}: {
  catalog: Catalog
  suppliesById: Map<string, Supply>
}) {
  const [editor, setEditor] = useState<{ addOn: AddOn | null; session: number } | null>(null)

  const usage = new Map<string, number>()
  for (const product of catalog.products) {
    for (const link of product.product_add_ons)
      usage.set(link.add_on_id, (usage.get(link.add_on_id) ?? 0) + 1)
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-fg-muted">Extras que se cobran aparte. En cada producto eliges cuáles acepta.</p>
        <Button onClick={() => setEditor({ addOn: null, session: Date.now() })}>
          <Plus className="size-4" aria-hidden />
          Nueva adición
        </Button>
      </div>

      {catalog.addOns.length === 0 ? (
        <p className="rounded-card border border-dashed border-line-strong p-8 text-center text-fg-muted">
          Aún no hay adiciones.
        </p>
      ) : (
        <ul className="grid gap-2 md:grid-cols-2">
          {catalog.addOns.map((addOn) => {
            const used = usage.get(addOn.id) ?? 0
            return (
              <li key={addOn.id}>
                <button
                  type="button"
                  onClick={() => setEditor({ addOn, session: Date.now() })}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-card border border-line bg-surface p-4 text-left transition-colors hover:border-line-strong hover:bg-surface-2',
                    !addOn.is_active && 'opacity-60',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2 font-medium">
                      {addOn.name}
                      {!addOn.is_active && <Badge>Archivada</Badge>}
                    </span>
                    <span className="text-sm text-fg-muted">
                      {formatCurrency(addOn.price)} · en {used} {used === 1 ? 'producto' : 'productos'}
                    </span>
                  </span>
                  <MarginBadge summary={summarizeCost(addOn.price, addOn.recipe_items, suppliesById)} />
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {editor && (
        <AddOnEditor
          key={editor.session}
          open
          addOn={editor.addOn}
          supplies={catalog.supplies}
          suppliesById={suppliesById}
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  )
}
