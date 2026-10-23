import { ImageOff, Plus, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TextInput } from '@/components/ui/field'
import { cn } from '@/lib/cn'
import { formatCurrency } from '@/lib/format'
import { mediaUrl } from '@/lib/media'
import { summarizeCost, type CostSummary } from '../costing'
import type { Catalog, Product, Supply } from '../types'
import { MarginBadge } from './margin-badge'
import { ProductEditor } from './product-editor'

interface EditorState {
  product: Product | null
  /** Changes on every open so the form always starts from fresh data. */
  session: number
}

/** The size with the lowest margin is the one worth watching. */
function worstSummary(product: Product, suppliesById: Map<string, Supply>): CostSummary | null {
  const summaries = product.product_variants
    .filter((v) => v.is_active)
    .map((v) => summarizeCost(v.price, v.recipe_items, suppliesById))
  if (summaries.length === 0) return null
  const missing = summaries.find((s) => !s.hasRecipe)
  if (missing) return missing
  return summaries.reduce((worst, s) => ((s.marginPercent ?? 100) < (worst.marginPercent ?? 100) ? s : worst))
}

export function ProductsTab({
  catalog,
  suppliesById,
}: {
  catalog: Catalog
  suppliesById: Map<string, Supply>
}) {
  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState<string | 'all'>('all')
  const [showArchived, setShowArchived] = useState(false)
  const [editor, setEditor] = useState<EditorState | null>(null)

  const groups = useMemo(() => {
    const term = search.trim().toLowerCase()
    return catalog.categories
      .filter((c) => categoryId === 'all' || c.id === categoryId)
      .map((category) => ({
        category,
        products: catalog.products.filter(
          (p) =>
            p.category_id === category.id &&
            (showArchived || p.is_active) &&
            (!term || p.name.toLowerCase().includes(term)),
        ),
      }))
      .filter((g) => g.products.length > 0)
  }, [catalog, search, categoryId, showArchived])

  const archivedCount = catalog.products.filter((p) => !p.is_active).length
  const noCategories = catalog.categories.filter((c) => c.is_active).length === 0

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
            aria-label="Buscar producto"
            placeholder="Buscar producto"
            className="pl-10"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button onClick={() => setEditor({ product: null, session: Date.now() })} disabled={noCategories}>
          <Plus className="size-4" aria-hidden />
          Nuevo producto
        </Button>
      </div>
      {noCategories && (
        <p className="text-sm text-warning">Primero crea al menos una categoría en la pestaña Categorías.</p>
      )}

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por categoría">
        {[{ id: 'all', name: 'Todas' }, ...catalog.categories.filter((c) => c.is_active)].map((c) => (
          <button
            key={c.id}
            type="button"
            aria-pressed={categoryId === c.id}
            onClick={() => setCategoryId(c.id)}
            className={cn(
              'h-10 rounded-full border px-4 text-sm transition-colors',
              categoryId === c.id
                ? 'border-fg bg-fg text-ink'
                : 'border-line text-fg-muted hover:border-line-strong hover:text-fg',
            )}
          >
            {c.name}
          </button>
        ))}
        {archivedCount > 0 && (
          <button
            type="button"
            aria-pressed={showArchived}
            onClick={() => setShowArchived((v) => !v)}
            className="h-10 rounded-full px-4 text-sm text-fg-subtle underline-offset-4 hover:underline"
          >
            {showArchived ? 'Ocultar archivados' : `Ver archivados (${archivedCount})`}
          </button>
        )}
      </div>

      {groups.length === 0 && (
        <p className="rounded-card border border-dashed border-line-strong p-8 text-center text-fg-muted">
          {catalog.products.length === 0
            ? 'Aún no hay productos. Crea el primero.'
            : 'No hay productos con ese filtro.'}
        </p>
      )}

      {groups.map(({ category, products }) => (
        <section key={category.id} aria-labelledby={`cat-${category.id}`} className="flex flex-col gap-2">
          <h2
            id={`cat-${category.id}`}
            className="px-1 text-xs font-medium tracking-[0.14em] text-fg-subtle uppercase"
          >
            {category.name}
          </h2>
          <ul className="flex flex-col gap-2">
            {products.map((product) => {
              const summary = worstSummary(product, suppliesById)
              const variants = product.product_variants.filter((v) => v.is_active)
              return (
                <li key={product.id}>
                  <button
                    type="button"
                    onClick={() => setEditor({ product, session: Date.now() })}
                    className={cn(
                      'flex w-full items-center gap-4 rounded-card border border-line bg-surface p-3 text-left transition-colors hover:border-line-strong hover:bg-surface-2',
                      !product.is_active && 'opacity-60',
                    )}
                  >
                    <span className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-xl bg-surface-3 text-fg-subtle">
                      {product.image_key ? (
                        <img
                          src={mediaUrl(product.image_key)}
                          alt=""
                          loading="lazy"
                          className="size-full object-cover"
                        />
                      ) : (
                        <ImageOff className="size-5" aria-hidden />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{product.name}</span>
                        {!product.is_active && <Badge>Archivado</Badge>}
                      </span>
                      <span className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-fg-muted">
                        {variants.map((v) => (
                          <span key={v.id} className="tabular-nums">
                            {variants.length > 1 || v.name !== 'Único' ? `${v.name} · ` : ''}
                            {formatCurrency(v.price)}
                          </span>
                        ))}
                      </span>
                    </span>
                    {summary && (
                      <span className="hidden shrink-0 sm:block">
                        <MarginBadge summary={summary} />
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ))}

      {editor && (
        <ProductEditor
          key={editor.session}
          open
          product={editor.product}
          catalog={catalog}
          suppliesById={suppliesById}
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  )
}
