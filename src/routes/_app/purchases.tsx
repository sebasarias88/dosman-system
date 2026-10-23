import { createFileRoute, Link } from '@tanstack/react-router'
import { ShoppingBasket } from 'lucide-react'
import { requireModule } from '@/features/auth/require-module'
import { useStaff } from '@/features/auth/use-staff'
import { PurchaseForm } from '@/features/inventory/components/purchase-form'
import { PurchasesHistory } from '@/features/inventory/components/purchases-history'
import { SuppliersTab } from '@/features/inventory/components/suppliers-tab'
import { cn } from '@/lib/cn'

const TABS = [
  { id: 'new', label: 'Nueva compra', managersOnly: false },
  { id: 'history', label: 'Historial', managersOnly: false },
  { id: 'suppliers', label: 'Proveedores', managersOnly: true },
] as const

type TabId = (typeof TABS)[number]['id']

export const Route = createFileRoute('/_app/purchases')({
  validateSearch: (search: Record<string, unknown>): { tab: TabId } => ({
    tab: TABS.some((t) => t.id === search.tab) ? (search.tab as TabId) : 'new',
  }),
  beforeLoad: requireModule('purchases'),
  component: PurchasesScreen,
})

function PurchasesScreen() {
  const { tab } = Route.useSearch()
  const { activeBranch, profile } = useStaff()
  if (!activeBranch) return null
  const isManager = profile.role === 'owner' || profile.role === 'admin'
  const tabs = TABS.filter((t) => !t.managersOnly || isManager)
  const current = tabs.some((t) => t.id === tab) ? tab : 'new'

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6 lg:p-10">
      <header className="flex items-center gap-4">
        <span className="grid size-12 place-items-center rounded-2xl bg-surface-2">
          <ShoppingBasket className="size-6" aria-hidden />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Compras</h1>
          <p className="text-fg-muted">La mercancía llega a {activeBranch.name} y desde aquí se reparte.</p>
        </div>
      </header>

      <nav
        aria-label="Secciones de compras"
        className="-mx-1 flex gap-1 overflow-x-auto border-b border-line px-1"
      >
        {tabs.map((t) => (
          <Link
            key={t.id}
            to="/purchases"
            search={{ tab: t.id }}
            aria-current={current === t.id ? 'page' : undefined}
            className={cn(
              '-mb-px flex h-11 shrink-0 items-center border-b-2 px-4 text-sm transition-colors',
              current === t.id ? 'border-fg text-fg' : 'border-transparent text-fg-muted hover:text-fg',
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {current === 'new' && <PurchaseForm branchId={activeBranch.id} />}
      {current === 'history' && <PurchasesHistory branchId={activeBranch.id} />}
      {current === 'suppliers' && <SuppliersTab />}
    </div>
  )
}
