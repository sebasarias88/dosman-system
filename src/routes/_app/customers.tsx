import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { HandCoins, Search, UserPlus, Users } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TextInput } from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'
import { requireModule } from '@/features/auth/require-module'
import { useStaff } from '@/features/auth/use-staff'
import { CustomerSheet } from '@/features/customers/components/customer-sheet'
import { debtsQuery, type CustomerDebt } from '@/features/customers/customers-api'
import { cn } from '@/lib/cn'
import { formatCurrency } from '@/lib/format'

export const Route = createFileRoute('/_app/customers')({
  beforeLoad: requireModule('customers'),
  component: CustomersScreen,
})

type Filter = 'debt' | 'all' | 'archived'

const DAY = 86_400_000

function daysSince(date: string | null): number | null {
  return date ? Math.floor((Date.now() - new Date(date).getTime()) / DAY) : null
}

/** Removes accents so "Gomez" finds "Gómez". */
const normalize = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

function AgeBadge({ days }: { days: number | null }) {
  if (days === null) return null
  const label = days === 0 ? 'Hoy' : days === 1 ? 'Hace 1 día' : `Hace ${days} días`
  return <Badge tone={days > 30 ? 'danger' : days > 15 ? 'warning' : 'neutral'}>{label}</Badge>
}

type Open = { id: string | null; pay: boolean } | null

function CustomersScreen() {
  const { profile } = useStaff()
  const isManager = profile.role === 'owner' || profile.role === 'admin'
  const { data: rows = [], isPending } = useQuery(debtsQuery)
  const [filter, setFilter] = useState<Filter>('debt')
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState<Open>(null)

  const withDebt = rows.filter((r) => r.balance > 0)
  const totalOwed = withDebt.reduce((sum, r) => sum + r.balance, 0)
  const overdue = withDebt.filter((r) => (daysSince(r.oldest_unpaid_at) ?? 0) > 30)

  const term = normalize(search.trim())
  const visible = rows
    .filter((r) => (filter === 'debt' ? r.balance > 0 : filter === 'archived' ? !r.is_active : r.is_active))
    .filter(
      (r) =>
        !term ||
        normalize(r.name).includes(term) ||
        (r.phone ?? '').replace(/\D/g, '').includes(term.replace(/\D/g, '') || '\u0000'),
    )
    .sort((a, b) =>
      filter === 'debt'
        ? (a.oldest_unpaid_at ?? '').localeCompare(b.oldest_unpaid_at ?? '')
        : a.name.localeCompare(b.name, 'es'),
    )

  // Always show the freshest row (the list refreshes after each payment).
  const selected: CustomerDebt | null = open?.id
    ? (rows.find((r) => r.customer_id === open.id) ?? null)
    : null

  const filters: { id: Filter; label: string }[] = [
    { id: 'debt', label: `Con deuda (${withDebt.length})` },
    { id: 'all', label: 'Todos' },
    ...(isManager ? [{ id: 'archived' as const, label: 'Archivados' }] : []),
  ]

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6 lg:p-10">
      <header className="flex flex-wrap items-center gap-4">
        <span className="grid size-12 place-items-center rounded-2xl bg-surface-2">
          <Users className="size-6" aria-hidden />
        </span>
        <div className="min-w-[12rem] flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Clientes y fiado</h1>
          <p className="text-fg-muted">Quién debe, desde cuándo, y sus abonos.</p>
        </div>
        <Button onClick={() => setOpen({ id: null, pay: false })}>
          <UserPlus className="size-4" aria-hidden />
          Nuevo cliente
        </Button>
      </header>

      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <div className="rounded-card border border-line bg-surface p-3 sm:p-4">
          <p className="text-xs text-fg-muted sm:text-sm">Total por cobrar</p>
          <p
            className={cn('text-lg font-semibold tabular-nums sm:text-2xl', totalOwed > 0 && 'text-warning')}
          >
            {formatCurrency(totalOwed)}
          </p>
        </div>
        <div className="rounded-card border border-line bg-surface p-3 sm:p-4">
          <p className="text-xs text-fg-muted sm:text-sm">Clientes con deuda</p>
          <p className="text-lg font-semibold tabular-nums sm:text-2xl">{withDebt.length}</p>
        </div>
        <div className="rounded-card border border-line bg-surface p-3 sm:p-4">
          <p className="text-xs text-fg-muted sm:text-sm">Deben hace más de 30 días</p>
          <p
            className={cn(
              'text-lg font-semibold tabular-nums sm:text-2xl',
              overdue.length > 0 && 'text-danger',
            )}
          >
            {overdue.length}
            {overdue.length > 0 && (
              <span className="ml-2 hidden text-base font-normal sm:inline">
                {formatCurrency(overdue.reduce((sum, r) => sum + r.balance, 0))}
              </span>
            )}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="relative min-w-[14rem] flex-1">
          <span className="sr-only">Buscar cliente</span>
          <Search
            className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-fg-subtle"
            aria-hidden
          />
          <TextInput
            className="h-11 pl-10"
            placeholder="Buscar por nombre o teléfono"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <div role="group" aria-label="Filtrar clientes" className="flex flex-wrap gap-1">
          {filters.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                'h-11 rounded-xl px-3.5 text-sm transition-colors',
                filter === f.id ? 'bg-fg text-ink' : 'bg-surface-2 text-fg-muted hover:text-fg',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {isPending ? (
        <Spinner />
      ) : visible.length === 0 ? (
        <p className="p-8 text-center text-fg-muted">
          {filter === 'debt' && !term ? 'Nadie debe nada. ¡Todo al día!' : 'No hay clientes que coincidan.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((row) => (
            <li
              key={row.customer_id}
              className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-surface p-4"
            >
              <button
                type="button"
                onClick={() => setOpen({ id: row.customer_id, pay: false })}
                className="min-w-[12rem] flex-1 text-left"
              >
                <span className="block font-medium">{row.name}</span>
                <span className="block truncate text-sm text-fg-subtle">
                  {[row.phone, row.address].filter(Boolean).join(' · ') || 'Sin datos de contacto'}
                </span>
              </button>
              {row.balance > 0 && <AgeBadge days={daysSince(row.oldest_unpaid_at)} />}
              <span
                className={cn(
                  'w-28 text-right font-semibold tabular-nums',
                  row.balance > 0 ? 'text-warning' : 'text-fg-muted',
                )}
              >
                {row.balance > 0 ? formatCurrency(row.balance) : 'Al día'}
              </span>
              {row.balance > 0 && (
                <Button variant="secondary" onClick={() => setOpen({ id: row.customer_id, pay: true })}>
                  <HandCoins className="size-4" aria-hidden />
                  Abonar
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {open && (open.id === null || selected) && (
        <CustomerSheet
          key={open.id ?? 'new'}
          customer={selected}
          startWithPayment={open.pay}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  )
}
