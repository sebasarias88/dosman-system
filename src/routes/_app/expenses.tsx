import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Receipt } from 'lucide-react'
import { useEffect } from 'react'
import { requireModule } from '@/features/auth/require-module'
import { CategoriesTab } from '@/features/expenses/components/categories-tab'
import { ExpensesTab } from '@/features/expenses/components/expenses-tab'
import { RecurringTab } from '@/features/expenses/components/recurring-tab'
import { expenseKeys, generateRecurringQuery } from '@/features/expenses/expenses-api'
import { cn } from '@/lib/cn'

const TABS = [
  { id: 'list', label: 'Gastos' },
  { id: 'recurring', label: 'Gastos fijos' },
  { id: 'categories', label: 'Categorías' },
] as const

type TabId = (typeof TABS)[number]['id']

export const Route = createFileRoute('/_app/expenses')({
  validateSearch: (search: Record<string, unknown>): { tab: TabId } => ({
    tab: TABS.some((t) => t.id === search.tab) ? (search.tab as TabId) : 'list',
  }),
  beforeLoad: requireModule('expenses'),
  component: ExpensesScreen,
})

function ExpensesScreen() {
  const { tab } = Route.useSearch()
  const queryClient = useQueryClient()
  // Enters this month's fixed expenses whose day has arrived (safe to repeat).
  const { data: generated } = useQuery(generateRecurringQuery)

  useEffect(() => {
    if (generated) void queryClient.invalidateQueries({ queryKey: [...expenseKeys.all, 'list'] })
  }, [generated, queryClient])

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6 lg:p-10">
      <header className="flex items-center gap-4">
        <span className="grid size-12 place-items-center rounded-2xl bg-surface-2">
          <Receipt className="size-6" aria-hidden />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Gastos</h1>
          <p className="text-fg-muted">Lo que cuesta mantener el negocio abierto, aparte de los insumos.</p>
        </div>
      </header>

      <nav
        aria-label="Secciones de gastos"
        className="-mx-1 flex gap-1 overflow-x-auto border-b border-line px-1"
      >
        {TABS.map((t) => (
          <Link
            key={t.id}
            to="/expenses"
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

      {tab === 'list' && <ExpensesTab />}
      {tab === 'recurring' && <RecurringTab />}
      {tab === 'categories' && <CategoriesTab />}
    </div>
  )
}
