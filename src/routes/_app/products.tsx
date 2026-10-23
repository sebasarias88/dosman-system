import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Tags } from 'lucide-react'
import { useMemo } from 'react'
import { catalogQuery } from '@/features/catalog/catalog-api'
import { AddOnsTab } from '@/features/catalog/components/add-ons-tab'
import { CategoriesTab } from '@/features/catalog/components/categories-tab'
import { ProductsTab } from '@/features/catalog/components/products-tab'
import { SuppliesTab } from '@/features/catalog/components/supplies-tab'
import { requireModule } from '@/features/auth/require-module'
import { cn } from '@/lib/cn'

const TABS = [
  { id: 'products', label: 'Productos' },
  { id: 'add-ons', label: 'Adiciones' },
  { id: 'supplies', label: 'Insumos' },
  { id: 'categories', label: 'Categorías' },
] as const

type TabId = (typeof TABS)[number]['id']

function isTab(value: unknown): value is TabId {
  return TABS.some((t) => t.id === value)
}

export const Route = createFileRoute('/_app/products')({
  validateSearch: (search: Record<string, unknown>): { tab: TabId } => ({
    tab: isTab(search.tab) ? search.tab : 'products',
  }),
  beforeLoad: requireModule('products'),
  loader: ({ context }) => context.queryClient.ensureQueryData(catalogQuery),
  component: CatalogScreen,
})

function CatalogScreen() {
  const { tab } = Route.useSearch()
  const { data: catalog } = useSuspenseQuery(catalogQuery)
  const suppliesById = useMemo(() => new Map(catalog.supplies.map((s) => [s.id, s])), [catalog.supplies])

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6 lg:p-10">
      <header className="flex items-center gap-4">
        <span className="grid size-12 place-items-center rounded-2xl bg-surface-2">
          <Tags className="size-6" aria-hidden />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Productos y recetas</h1>
          <p className="text-fg-muted">
            Precios iguales en las dos sedes. Las recetas calculan costo y ganancia.
          </p>
        </div>
      </header>

      <nav
        aria-label="Secciones del catálogo"
        className="-mx-1 flex gap-1 overflow-x-auto border-b border-line px-1"
      >
        {TABS.map((t) => (
          <Link
            key={t.id}
            to="/products"
            search={{ tab: t.id }}
            className={cn(
              '-mb-px flex h-11 shrink-0 items-center border-b-2 px-4 text-sm transition-colors',
              tab === t.id ? 'border-fg text-fg' : 'border-transparent text-fg-muted hover:text-fg',
            )}
            aria-current={tab === t.id ? 'page' : undefined}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === 'products' && <ProductsTab catalog={catalog} suppliesById={suppliesById} />}
      {tab === 'add-ons' && <AddOnsTab catalog={catalog} suppliesById={suppliesById} />}
      {tab === 'supplies' && <SuppliesTab catalog={catalog} />}
      {tab === 'categories' && <CategoriesTab catalog={catalog} />}
    </div>
  )
}
