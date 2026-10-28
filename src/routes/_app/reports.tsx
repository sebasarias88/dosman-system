import { useQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { BarChart3, FileSpreadsheet, Printer } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { TextInput } from '@/components/ui/field'
import { CardsSkeleton, ListSkeleton, StatsSkeleton } from '@/components/ui/skeleton'
import { requireModule } from '@/features/auth/require-module'
import { useStaff } from '@/features/auth/use-staff'
import { BarList } from '@/features/reports/components/bar-list'
import { BranchComparison, ControlPanel } from '@/features/reports/components/control-panel'
import { HoursHeatmap } from '@/features/reports/components/hours-heatmap'
import { KpiGrid } from '@/features/reports/components/kpi-grid'
import { ProductsTable } from '@/features/reports/components/products-table'
import { SalesChart } from '@/features/reports/components/sales-chart'
import {
  businessToday,
  daysBetween,
  describeRange,
  PERIODS,
  periodRange,
  type PeriodId,
} from '@/features/reports/periods'
import { exportReportXlsx, printReport } from '@/features/reports/report-export'
import { overviewQuery, productsReportQuery } from '@/features/reports/reports-api'
import { ORDER_TYPE_LABELS } from '@/features/sales/types'
import { MonthlyHistory } from '@/features/storage/components/monthly-history'
import { cleanedBeforeQuery } from '@/features/storage/storage-api'
import { cn } from '@/lib/cn'
import { formatCurrency } from '@/lib/format'

interface ReportSearch {
  period: PeriodId
  from?: string
  to?: string
  /** Branch id, or absent for both branches. */
  branch?: string
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

export const Route = createFileRoute('/_app/reports')({
  validateSearch: (search: Record<string, unknown>): ReportSearch => {
    const period = [...PERIODS.map((p) => p.id), 'custom'].includes(search.period as string)
      ? (search.period as PeriodId)
      : 'month'
    const from = typeof search.from === 'string' && DATE.test(search.from) ? search.from : undefined
    const to = typeof search.to === 'string' && DATE.test(search.to) ? search.to : undefined
    const branch = typeof search.branch === 'string' ? search.branch : undefined
    return { period, from, to, branch }
  },
  beforeLoad: requireModule('reports'),
  component: ReportsScreen,
})

function Panel({
  title,
  description,
  children,
  className,
}: {
  title: string
  description?: string
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={cn('flex min-w-0 flex-col gap-4 rounded-card border border-line bg-surface p-5', className)}
    >
      <header>
        <h2 className="font-semibold">{title}</h2>
        {description && <p className="text-sm text-fg-subtle">{description}</p>}
      </header>
      {children}
    </section>
  )
}

function ReportsScreen() {
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const { branches } = useStaff()
  const today = businessToday()

  const branchId = branches.some((b) => b.id === search.branch) ? (search.branch ?? null) : null
  const range =
    search.period === 'custom' && search.from && search.to && search.from <= search.to
      ? { from: search.from, to: search.to }
      : periodRange(search.period === 'custom' ? 'month' : search.period, today)
  const filters = { branchId, ...range }
  const scopeName = branches.find((b) => b.id === branchId)?.name ?? 'Las dos sedes'

  const overview = useQuery(overviewQuery(filters))
  const { data: cleanedBefore } = useQuery(cleanedBeforeQuery)
  const touchesCleaned = Boolean(cleanedBefore && range.from < cleanedBefore)
  const products = useQuery(productsReportQuery(filters))
  const [exporting, setExporting] = useState(false)

  const setSearch = (patch: Partial<ReportSearch>) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })

  const tooLong = daysBetween(range.from, range.to) > 400
  const data = overview.data

  async function handleExcel() {
    if (!data || !products.data) return
    setExporting(true)
    try {
      await exportReportXlsx({ overview: data, products: products.data, scopeName, ...range })
    } catch {
      toast.error('No se pudo generar el Excel')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6 lg:p-10">
      <header className="flex flex-wrap items-center gap-4">
        <span className="grid size-12 place-items-center rounded-2xl bg-surface-2">
          <BarChart3 className="size-6" aria-hidden />
        </span>
        <div className="min-w-[12rem] flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Reportes</h1>
          <p className="text-fg-muted">
            {scopeName} · {describeRange(range.from, range.to)}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            disabled={!data || !products.data}
            loading={exporting}
            onClick={() => void handleExcel()}
          >
            <FileSpreadsheet className="size-4" aria-hidden />
            Excel
          </Button>
          <Button
            variant="secondary"
            disabled={!data || !products.data}
            onClick={() =>
              data &&
              products.data &&
              printReport({ overview: data, products: products.data, scopeName, ...range })
            }
          >
            <Printer className="size-4" aria-hidden />
            PDF
          </Button>
        </div>
      </header>

      {/* Filters: one row, above every chart. */}
      <div className="flex flex-wrap items-end gap-3 rounded-card border border-line bg-surface p-3">
        <div role="group" aria-label="Periodo" className="flex flex-wrap gap-1">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={search.period === p.id}
              onClick={() => setSearch({ period: p.id, from: undefined, to: undefined })}
              className={cn(
                'h-10 rounded-xl px-3 text-sm transition-colors',
                search.period === p.id ? 'bg-fg text-ink' : 'bg-surface-2 text-fg-muted hover:text-fg',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
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
        <div role="group" aria-label="Sede" className="flex flex-wrap gap-1 lg:ml-auto">
          {[{ id: undefined, name: 'Todo' }, ...branches].map((b) => (
            <button
              key={b.id ?? 'all'}
              type="button"
              aria-pressed={(b.id ?? null) === branchId}
              onClick={() => setSearch({ branch: b.id })}
              className={cn(
                'h-10 rounded-xl px-3 text-sm transition-colors',
                (b.id ?? null) === branchId ? 'bg-fg text-ink' : 'bg-surface-2 text-fg-muted hover:text-fg',
              )}
            >
              {b.name}
            </button>
          ))}
        </div>
      </div>

      {touchesCleaned && (
        <div className="flex flex-col gap-4">
          <p className="rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning">
            El detalle de las ventas anteriores al {cleanedBefore} se limpió para ahorrar espacio. Para esos
            meses usa los resúmenes guardados de abajo (los fiados, gastos y cierres de caja sí se conservan).
          </p>
          <MonthlyHistory />
        </div>
      )}

      {tooLong ? (
        <p className="p-8 text-center text-warning">El rango máximo de un reporte es de un año.</p>
      ) : overview.isError ? (
        <p className="p-8 text-center text-danger">No se pudo cargar el reporte. Intenta de nuevo.</p>
      ) : !data ? (
        <div className="flex flex-col gap-6">
          <StatsSkeleton tiles={8} />
          <CardsSkeleton cards={1} />
        </div>
      ) : (
        <>
          <KpiGrid totals={data.totals} previous={data.previous} showShared={branchId !== null} />

          <Panel title="Ventas" description="Pasa el cursor (o toca) una barra para ver el detalle del día.">
            <SalesChart daily={data.daily} />
          </Panel>

          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="Control" description="Lo que conviene revisar cuando no estás en el local.">
              <ControlPanel totals={data.totals} />
            </Panel>
            <Panel title="Medios de pago">
              <BarList
                empty="Aún no hay ventas en este periodo."
                items={data.payment_methods.map((m) => ({
                  label: m.name,
                  value: m.total,
                  detail: `${m.count} ${m.count === 1 ? 'pedido' : 'pedidos'}`,
                }))}
              />
            </Panel>
          </div>

          <Panel
            title="Productos"
            description="Ordena por lo que más se vende o por lo que más ganancia deja."
          >
            {products.data ? <ProductsTable rows={products.data} /> : <ListSkeleton rows={6} />}
          </Panel>

          <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
            <Panel title="Horas pico" description="Pedidos cobrados por día de la semana y hora.">
              <HoursHeatmap hours={data.hours} />
            </Panel>
            <Panel title="Tipo de pedido">
              <BarList
                empty="Aún no hay ventas en este periodo."
                items={data.order_types.map((t) => ({
                  label: ORDER_TYPE_LABELS[t.type],
                  value: t.sales,
                  detail: `${t.orders} ${t.orders === 1 ? 'pedido' : 'pedidos'}`,
                }))}
              />
            </Panel>
          </div>

          <div className={cn('grid gap-6', data.branches.length > 0 && 'lg:grid-cols-[3fr_2fr]')}>
            {data.branches.length > 0 && (
              <Panel
                title="Comparación entre sedes"
                description={
                  data.totals.shared_expenses > 0
                    ? `Los gastos compartidos (${formatCurrency(data.totals.shared_expenses)}) no se reparten entre sedes; sí cuentan en la ganancia real total.`
                    : undefined
                }
              >
                <BranchComparison branches={data.branches} />
              </Panel>
            )}
            <Panel title="Gastos por categoría">
              <BarList
                empty="No hay gastos registrados en este periodo."
                items={data.expense_categories.map((c) => ({ label: c.name, value: c.total }))}
              />
            </Panel>
          </div>

          {(data.totals.tips > 0 || data.totals.delivery_fees > 0 || data.totals.discounts > 0) && (
            <p className="text-sm text-fg-subtle">
              Aparte de las ventas: propinas {formatCurrency(data.totals.tips)} · domicilios{' '}
              {formatCurrency(data.totals.delivery_fees)} · descuentos dados{' '}
              {formatCurrency(data.totals.discounts)}.
            </p>
          )}
        </>
      )}
    </div>
  )
}
