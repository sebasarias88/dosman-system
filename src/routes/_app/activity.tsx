import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { CircleAlert, Info, ScrollText, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TextInput } from '@/components/ui/field'
import { ListSkeleton } from '@/components/ui/skeleton'
import {
  activityQuery,
  alertCountsQuery,
  type ActivityEntry,
  type SeverityFilter,
} from '@/features/activity/activity-api'
import { ACTIVITY_GROUPS, describeEvent, type ActivityGroup } from '@/features/activity/describe'
import { requireModule } from '@/features/auth/require-module'
import { useStaff } from '@/features/auth/use-staff'
import { businessToday, describeRange, PERIODS, periodRange, type PeriodId } from '@/features/reports/periods'
import { cn } from '@/lib/cn'
import { formatTime } from '@/lib/format'

interface ActivitySearch {
  period: PeriodId
  from?: string
  to?: string
  branch?: string
  severity: SeverityFilter
  group: ActivityGroup
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
const SEVERITIES: { id: SeverityFilter; label: string }[] = [
  { id: 'all', label: 'Todo' },
  { id: 'alerts', label: 'Solo alertas' },
  { id: 'critical', label: 'Críticas' },
]

export const Route = createFileRoute('/_app/activity')({
  validateSearch: (search: Record<string, unknown>): ActivitySearch => ({
    period: [...PERIODS.map((p) => p.id), 'custom'].includes(search.period as string)
      ? (search.period as PeriodId)
      : 'week',
    from: typeof search.from === 'string' && DATE.test(search.from) ? search.from : undefined,
    to: typeof search.to === 'string' && DATE.test(search.to) ? search.to : undefined,
    branch: typeof search.branch === 'string' ? search.branch : undefined,
    severity: SEVERITIES.some((s) => s.id === search.severity) ? (search.severity as SeverityFilter) : 'all',
    group: ACTIVITY_GROUPS.some((g) => g.id === search.group) ? (search.group as ActivityGroup) : 'all',
  }),
  beforeLoad: requireModule('activity'),
  component: ActivityScreen,
})

const SEVERITY_STYLE = {
  info: { icon: Info, className: 'text-fg-subtle', label: 'Información' },
  warning: { icon: TriangleAlert, className: 'text-warning', label: 'Alerta' },
  critical: { icon: CircleAlert, className: 'text-danger', label: 'Crítico' },
} as const

const dayHeading = new Intl.DateTimeFormat('es-CO', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'America/Bogota',
})
const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' })

function Chips<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: readonly { id: T; label: string }[]
  value: T
  onChange: (id: T) => void
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1">
      <span className="mr-1 text-xs text-fg-subtle" aria-hidden>
        {label}
      </span>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            'h-10 rounded-xl px-3 text-sm transition-colors',
            value === o.id ? 'bg-fg text-ink' : 'bg-surface-2 text-fg-muted hover:text-fg',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function ActivityScreen() {
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const { branches } = useStaff()
  const today = businessToday()
  const branchNames = new Map(branches.map((b) => [b.id, b.name]))

  const branchId = branches.some((b) => b.id === search.branch) ? (search.branch ?? null) : null
  const range =
    search.period === 'custom' && search.from && search.to && search.from <= search.to
      ? { from: search.from, to: search.to }
      : periodRange(search.period === 'custom' ? 'week' : search.period, today)
  const filters = { ...range, branchId, severity: search.severity, group: search.group }

  const list = useInfiniteQuery(activityQuery(filters))
  const counts = useQuery(alertCountsQuery({ ...range, branchId }))
  const entries = list.data?.pages.flat() ?? []

  const setSearch = (patch: Partial<ActivitySearch>) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })

  // Group by calendar day in Colombia.
  const days: { key: string; label: string; items: ActivityEntry[] }[] = []
  for (const entry of entries) {
    const at = new Date(entry.created_at)
    const key = dayKey.format(at)
    const last = days[days.length - 1]
    if (last?.key === key) last.items.push(entry)
    else days.push({ key, label: dayHeading.format(at), items: [entry] })
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6 lg:p-10">
      <header className="flex flex-wrap items-center gap-4">
        <span className="grid size-12 place-items-center rounded-2xl bg-surface-2">
          <ScrollText className="size-6" aria-hidden />
        </span>
        <div className="min-w-[12rem] flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Actividad</h1>
          <p className="text-fg-muted">Quién hizo qué y cuándo · {describeRange(range.from, range.to)}</p>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => setSearch({ severity: 'critical' })}
          className="flex items-center gap-3 rounded-card border border-line bg-surface p-4 text-left hover:border-line-strong"
        >
          <CircleAlert className="size-6 text-danger" aria-hidden />
          <span>
            <span className="block text-2xl font-semibold tabular-nums">{counts.data?.critical ?? '—'}</span>
            <span className="text-sm text-fg-muted">Críticas (faltantes de caja)</span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => setSearch({ severity: 'alerts' })}
          className="flex items-center gap-3 rounded-card border border-line bg-surface p-4 text-left hover:border-line-strong"
        >
          <TriangleAlert className="size-6 text-warning" aria-hidden />
          <span>
            <span className="block text-2xl font-semibold tabular-nums">{counts.data?.warning ?? '—'}</span>
            <span className="text-sm text-fg-muted">Alertas (anulaciones, descuentos, mermas, precios)</span>
          </span>
        </button>
      </div>

      <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-3">
        <div className="flex flex-wrap items-end gap-3">
          <Chips
            label="Periodo"
            options={PERIODS}
            value={search.period === 'custom' ? ('' as PeriodId) : search.period}
            onChange={(id) => setSearch({ period: id, from: undefined, to: undefined })}
          />
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:items-end">
            <label className="flex flex-col gap-1 text-xs text-fg-subtle">
              Desde
              <TextInput
                type="date"
                className="h-10 w-full sm:w-40"
                max={today}
                value={range.from}
                onChange={(e) =>
                  e.target.value && setSearch({ period: 'custom', from: e.target.value, to: range.to })
                }
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-fg-subtle">
              Hasta
              <TextInput
                type="date"
                className="h-10 w-full sm:w-40"
                max={today}
                min={range.from}
                value={range.to}
                onChange={(e) =>
                  e.target.value && setSearch({ period: 'custom', from: range.from, to: e.target.value })
                }
              />
            </label>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <Chips
            label="Sede"
            options={[{ id: '', label: 'Todas' }, ...branches.map((b) => ({ id: b.id, label: b.name }))]}
            value={branchId ?? ''}
            onChange={(id) => setSearch({ branch: id || undefined })}
          />
          <Chips
            label="Importancia"
            options={SEVERITIES}
            value={search.severity}
            onChange={(severity) => setSearch({ severity })}
          />
        </div>
        <Chips
          label="Tipo"
          options={ACTIVITY_GROUPS}
          value={search.group}
          onChange={(group) => setSearch({ group })}
        />
      </div>

      {list.isPending ? (
        <ListSkeleton rows={8} />
      ) : list.isError ? (
        <p className="p-8 text-center text-danger">No se pudo cargar la actividad. Intenta de nuevo.</p>
      ) : entries.length === 0 ? (
        <p className="p-8 text-center text-fg-muted">No hay movimientos con estos filtros.</p>
      ) : (
        <div className="flex flex-col gap-6">
          {days.map((day) => (
            <section key={day.key} aria-label={day.label}>
              <h2 className="mb-2 text-sm font-medium text-fg-muted first-letter:uppercase">{day.label}</h2>
              <ul className="flex flex-col divide-y divide-line rounded-card border border-line bg-surface">
                {day.items.map((entry) => {
                  const style = SEVERITY_STYLE[entry.severity]
                  const Icon = style.icon
                  const text = describeEvent(entry, branchNames)
                  return (
                    <li key={entry.id} className="flex items-start gap-3 p-4">
                      <Icon
                        className={cn('mt-0.5 size-5 shrink-0', style.className)}
                        aria-label={style.label}
                      />
                      <div className="min-w-0 flex-1">
                        <p className={cn(entry.severity === 'critical' && 'font-medium text-danger')}>
                          {text.title}
                        </p>
                        {text.detail && <p className="text-sm text-fg-muted">{text.detail}</p>}
                        <p className="mt-0.5 text-xs text-fg-subtle">
                          {entry.actor?.full_name ?? 'Sistema'}
                          {entry.branches && ` · ${entry.branches.name}`}
                        </p>
                      </div>
                      <time
                        dateTime={entry.created_at}
                        className="shrink-0 text-sm text-fg-subtle tabular-nums"
                      >
                        {formatTime(entry.created_at)}
                      </time>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
          {list.hasNextPage && (
            <Button
              variant="secondary"
              className="self-center"
              loading={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              Ver más
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
