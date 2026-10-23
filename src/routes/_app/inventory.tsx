import { createFileRoute, Link } from '@tanstack/react-router'
import { Boxes } from 'lucide-react'
import { requireModule } from '@/features/auth/require-module'
import { useStaff } from '@/features/auth/use-staff'
import { CountTab } from '@/features/inventory/components/count-tab'
import { MovementsTab } from '@/features/inventory/components/movements-tab'
import { StockTab } from '@/features/inventory/components/stock-tab'
import { cn } from '@/lib/cn'

const TABS = [
  { id: 'stock', label: 'Existencias' },
  { id: 'count', label: 'Conteo físico' },
  { id: 'movements', label: 'Movimientos' },
] as const

type TabId = (typeof TABS)[number]['id']

export const Route = createFileRoute('/_app/inventory')({
  validateSearch: (search: Record<string, unknown>): { tab: TabId } => ({
    tab: TABS.some((t) => t.id === search.tab) ? (search.tab as TabId) : 'stock',
  }),
  beforeLoad: requireModule('inventory'),
  component: InventoryScreen,
})

function InventoryScreen() {
  const { tab } = Route.useSearch()
  const { activeBranch, profile } = useStaff()
  if (!activeBranch) return null
  const isManager = profile.role === 'owner' || profile.role === 'admin'

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6 lg:p-10">
      <header className="flex items-center gap-4">
        <span className="grid size-12 place-items-center rounded-2xl bg-surface-2">
          <Boxes className="size-6" aria-hidden />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Inventario</h1>
          <p className="text-fg-muted">{activeBranch.name}</p>
        </div>
      </header>

      <nav
        aria-label="Secciones del inventario"
        className="-mx-1 flex gap-1 overflow-x-auto border-b border-line px-1"
      >
        {TABS.map((t) => (
          <Link
            key={t.id}
            to="/inventory"
            search={{ tab: t.id }}
            aria-current={tab === t.id ? 'page' : undefined}
            className={cn(
              '-mb-px flex h-11 shrink-0 items-center border-b-2 px-4 text-sm transition-colors',
              tab === t.id ? 'border-fg text-fg' : 'border-transparent text-fg-muted hover:text-fg',
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === 'stock' && <StockTab key={activeBranch.id} branchId={activeBranch.id} isManager={isManager} />}
      {tab === 'count' && <CountTab key={activeBranch.id} branchId={activeBranch.id} />}
      {tab === 'movements' && <MovementsTab key={activeBranch.id} branchId={activeBranch.id} />}
    </div>
  )
}
