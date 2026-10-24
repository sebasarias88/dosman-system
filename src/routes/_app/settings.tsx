import { createFileRoute, Link } from '@tanstack/react-router'
import { Settings } from 'lucide-react'
import { requireModule } from '@/features/auth/require-module'
import { BranchesTab } from '@/features/settings/components/branches-tab'
import { NotificationsTab } from '@/features/settings/components/notifications-tab'
import { PaymentMethodsTab } from '@/features/settings/components/payment-methods-tab'
import { cn } from '@/lib/cn'

const TABS = [
  { id: 'branches', label: 'Sedes' },
  { id: 'payments', label: 'Medios de pago' },
  { id: 'notifications', label: 'Notificaciones' },
] as const

type TabId = (typeof TABS)[number]['id']

export const Route = createFileRoute('/_app/settings')({
  validateSearch: (search: Record<string, unknown>): { tab: TabId } => ({
    tab: TABS.some((t) => t.id === search.tab) ? (search.tab as TabId) : 'branches',
  }),
  beforeLoad: requireModule('settings'),
  component: SettingsScreen,
})

function SettingsScreen() {
  const { tab } = Route.useSearch()
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6 lg:p-10">
      <header className="flex items-center gap-4">
        <span className="grid size-12 place-items-center rounded-2xl bg-surface-2">
          <Settings className="size-6" aria-hidden />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Ajustes</h1>
          <p className="text-fg-muted">Cómo trabaja cada sede, cómo pagan los clientes y qué te avisamos.</p>
        </div>
      </header>

      <nav
        aria-label="Secciones de ajustes"
        className="-mx-1 flex gap-1 overflow-x-auto border-b border-line px-1"
      >
        {TABS.map((t) => (
          <Link
            key={t.id}
            to="/settings"
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

      {tab === 'branches' && <BranchesTab />}
      {tab === 'payments' && <PaymentMethodsTab />}
      {tab === 'notifications' && <NotificationsTab />}
    </div>
  )
}
