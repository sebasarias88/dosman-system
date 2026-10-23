import { CupSoda, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { TextInput } from '@/components/ui/field'
import type { Catalog, Product } from '@/features/catalog/types'
import { cn } from '@/lib/cn'
import { formatCurrency } from '@/lib/format'
import { mediaUrl } from '@/lib/media'

interface ProductGridProps {
  catalog: Catalog
  onPick: (product: Product) => void
}

function priceLabel(product: Product): string {
  const prices = product.product_variants.filter((v) => v.is_active).map((v) => v.price)
  if (prices.length === 0) return ''
  const min = Math.min(...prices)
  return prices.length > 1 ? `desde ${formatCurrency(min)}` : formatCurrency(min)
}

/** Big touch buttons grouped by category, in the order set in the catalog. */
export function ProductGrid({ catalog, onPick }: ProductGridProps) {
  const categories = catalog.categories.filter((c) => c.is_active)
  const [categoryId, setCategoryId] = useState<string>('all')
  const [search, setSearch] = useState('')

  const products = useMemo(() => {
    const term = search.trim().toLowerCase()
    const order = new Map(categories.map((c, i) => [c.id, i]))
    return catalog.products
      .filter(
        (p) =>
          p.is_active &&
          order.has(p.category_id) &&
          p.product_variants.some((v) => v.is_active) &&
          (categoryId === 'all' || p.category_id === categoryId) &&
          (!term || p.name.toLowerCase().includes(term)),
      )
      .sort((a, b) => (order.get(a.category_id) ?? 0) - (order.get(b.category_id) ?? 0))
  }, [catalog.products, categories, categoryId, search])

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex gap-2">
        <div className="relative flex-1">
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
      </div>
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="group" aria-label="Categorías">
        {[{ id: 'all', name: 'Todo' }, ...categories].map((c) => (
          <button
            key={c.id}
            type="button"
            aria-pressed={categoryId === c.id}
            onClick={() => setCategoryId(c.id)}
            className={cn(
              'h-11 shrink-0 rounded-xl border px-4 text-sm font-medium transition-colors',
              categoryId === c.id
                ? 'border-fg bg-fg text-ink'
                : 'border-line bg-surface text-fg-muted hover:border-line-strong hover:text-fg',
            )}
          >
            {c.name}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-24 lg:pb-2">
        {products.length === 0 ? (
          <p className="p-8 text-center text-fg-muted">No hay productos para mostrar.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {products.map((product) => (
              <li key={product.id}>
                <button
                  type="button"
                  onClick={() => onPick(product)}
                  className="flex h-full min-h-20 w-full items-center gap-3 rounded-card border border-line bg-surface p-2.5 text-left transition-[border-color,transform] hover:border-line-strong active:scale-[0.98]"
                >
                  <span className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-xl bg-surface-2 text-fg-subtle">
                    {product.image_key ? (
                      <img
                        src={mediaUrl(product.image_key)}
                        alt=""
                        loading="lazy"
                        className="size-full object-cover"
                      />
                    ) : (
                      <CupSoda className="size-6" aria-hidden />
                    )}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="leading-snug font-medium">{product.name}</span>
                    <span className="text-sm text-fg-muted tabular-nums">{priceLabel(product)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
