import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowUpRight, TriangleAlert } from 'lucide-react'
import { modulesFor } from '@/config/modules'
import { alertCountsQuery } from '@/features/activity/activity-api'
import { useStaff } from '@/features/auth/use-staff'
import { businessToday } from '@/features/reports/periods'
import { overviewQuery } from '@/features/reports/reports-api'
import { cn } from '@/lib/cn'
import { formatCurrency } from '@/lib/format'

export const Route = createFileRoute('/_app/')({
  component: HomeScreen,
})

const todayFormatter = new Intl.DateTimeFormat('es-CO', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'America/Bogota',
})

function greeting(): string {
  const hour = Number(
    new Intl.DateTimeFormat('es-CO', {
      hour: 'numeric',
      hourCycle: 'h23',
      timeZone: 'America/Bogota',
    }).format(new Date()),
  )
  if (hour < 12) return 'Buenos días'
  if (hour < 19) return 'Buenas tardes'
  return 'Buenas noches'
}

/** Today at a glance for owners and admins: sales of both branches and alerts. */
function TodaySummary() {
  const today = businessToday()
  const { data } = useQuery(overviewQuery({ branchId: null, from: today, to: today }))
  const { data: alerts } = useQuery(alertCountsQuery({ from: today, to: today, branchId: null }))
  if (!data) return null
  const alertCount = (alerts?.warning ?? 0) + (alerts?.critical ?? 0)

  return (
    <section aria-label="Hoy" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div className="rounded-card border border-line bg-surface p-5">
        <p className="text-sm text-fg-muted">Ventas de hoy</p>
        <p className="text-2xl font-semibold tabular-nums">{formatCurrency(data.totals.sales)}</p>
        <p className="mt-1 text-xs text-fg-subtle">
          {data.branches.map((b) => `${b.name}: ${formatCurrency(b.sales)}`).join(' · ')}
        </p>
      </div>
      <div className="rounded-card border border-line bg-surface p-5">
        <p className="text-sm text-fg-muted">Pedidos cobrados</p>
        <p className="text-2xl font-semibold tabular-nums">{data.totals.orders}</p>
        <p className="mt-1 text-xs text-fg-subtle">
          Ticket promedio {formatCurrency(data.totals.average_ticket)}
        </p>
      </div>
      <div className="rounded-card border border-line bg-surface p-5">
        <p className="text-sm text-fg-muted">Ganancia bruta de hoy</p>
        <p className="text-2xl font-semibold tabular-nums">{formatCurrency(data.totals.gross_profit)}</p>
        <p className="mt-1 text-xs text-fg-subtle">Ventas menos el costo de las recetas</p>
      </div>
      <Link
        to="/activity"
        search={{ period: 'today', severity: 'alerts', group: 'all' }}
        className={cn(
          'rounded-card border p-5 transition-colors hover:border-line-strong',
          (alerts?.critical ?? 0) > 0 ? 'border-danger/40 bg-danger-soft' : 'border-line bg-surface',
        )}
      >
        <p className="flex items-center gap-2 text-sm text-fg-muted">
          <TriangleAlert className="size-4" aria-hidden />
          Alertas de hoy
        </p>
        <p className="text-2xl font-semibold tabular-nums">{alertCount}</p>
        <p className="mt-1 text-xs text-fg-subtle">
          {alertCount === 0 ? 'Todo en orden' : 'Anulaciones, descuentos, faltantes… Toca para ver'}
        </p>
      </Link>
    </section>
  )
}

function HomeScreen() {
  const { profile, activeBranch } = useStaff()
  const shortcuts = modulesFor(profile.role, activeBranch).filter((m) => m.key !== 'dashboard')
  const firstName = profile.full_name.split(' ')[0]

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 p-6 lg:p-10">
      <header>
        <p className="text-sm text-fg-subtle first-letter:uppercase">{todayFormatter.format(new Date())}</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          {greeting()}, {firstName}
        </h1>
        {activeBranch && <p className="mt-1 text-fg-muted">{activeBranch.name}</p>}
      </header>

      {(profile.role === 'owner' || profile.role === 'admin') && <TodaySummary />}

      <section aria-label="Accesos rápidos" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {shortcuts.map(({ key, path, label, description, icon: Icon }) => (
          <Link
            key={key}
            to={path}
            className="group flex min-h-28 gap-4 rounded-card border border-line bg-surface p-5 transition-colors hover:border-line-strong hover:bg-surface-2"
          >
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-surface-3 text-fg">
              <Icon className="size-5" aria-hidden />
            </span>
            <span className="flex-1">
              <span className="flex items-center justify-between font-medium">
                {label}
                <ArrowUpRight
                  className="size-4 text-fg-subtle transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                  aria-hidden
                />
              </span>
              <span className="mt-1 block text-sm text-fg-muted">{description}</span>
            </span>
          </Link>
        ))}
      </section>
    </div>
  )
}
