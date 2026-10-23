import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { cn } from '@/lib/cn'
import { formatCurrency } from '@/lib/format'
import type { ReportTotals } from '../reports-api'

type Key = keyof ReportTotals

interface Kpi {
  key: Key
  label: string
  /**
   * true when a bigger number is good news (sales), false when it is bad news
   * (expenses), null when it just follows sales (cost of goods: selling more
   * costs more, that is not an alarm).
   */
  higherIsBetter: boolean | null
  hint?: (t: ReportTotals) => string | null
}

const KPIS: Kpi[] = [
  {
    key: 'sales',
    label: 'Ventas',
    higherIsBetter: true,
    hint: (t) =>
      `${t.orders} ${t.orders === 1 ? 'pedido' : 'pedidos'} · ticket promedio ${formatCurrency(t.average_ticket)}`,
  },
  {
    key: 'cogs',
    label: 'Costo de lo vendido',
    higherIsBetter: null,
    hint: (t) => (t.sales > 0 ? `${Math.round((t.cogs / t.sales) * 100)} % de las ventas` : null),
  },
  {
    key: 'gross_profit',
    label: 'Ganancia bruta',
    higherIsBetter: true,
    hint: (t) => (t.sales > 0 ? `Margen ${Math.round((t.gross_profit / t.sales) * 100)} %` : null),
  },
  {
    key: 'expenses',
    label: 'Gastos',
    higherIsBetter: false,
    hint: (t) =>
      t.inventory_loss > 0 ? `+ ${formatCurrency(t.inventory_loss)} en pérdidas de inventario` : null,
  },
]

function change(current: number, previous: number): number | null {
  if (previous === 0) return null
  return Math.round(((current - previous) / Math.abs(previous)) * 100)
}

function Delta({
  current,
  previous,
  higherIsBetter,
}: {
  current: number
  previous: number
  higherIsBetter: boolean | null
}) {
  const pct = change(current, previous)
  if (pct === null) return <span className="text-xs text-fg-subtle">Sin datos del periodo anterior</span>
  const good = pct === 0 || higherIsBetter === null ? null : pct > 0 === higherIsBetter
  const Icon = pct > 0 ? ArrowUpRight : pct < 0 ? ArrowDownRight : Minus
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs',
        good === null ? 'text-fg-subtle' : good ? 'text-success' : 'text-danger',
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {pct > 0 ? '+' : ''}
      {pct} % vs periodo anterior
    </span>
  )
}

/** Headline numbers plus the real profit, each compared with the previous period. */
export function KpiGrid({
  totals,
  previous,
  showShared,
}: {
  totals: ReportTotals
  previous: ReportTotals
  showShared: boolean
}) {
  const netMargin = totals.sales > 0 ? Math.round((totals.net_profit / totals.sales) * 100) : null
  return (
    <div className="grid gap-3 lg:grid-cols-[1.3fr_2fr]">
      <div
        className={cn(
          'flex flex-col justify-between gap-3 rounded-card border p-5',
          totals.net_profit < 0 ? 'border-danger/40 bg-danger-soft' : 'border-line bg-surface',
        )}
      >
        <div>
          <p className="text-sm text-fg-muted">Ganancia real</p>
          <p className="text-4xl font-semibold tracking-tight tabular-nums">
            {formatCurrency(totals.net_profit)}
          </p>
          {netMargin !== null && (
            <p className="mt-1 text-sm text-fg-subtle">{netMargin} % de lo que se vendió</p>
          )}
        </div>
        {/* How the number is built, so nobody has to trust a black box. */}
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-t border-line pt-3 text-sm">
          <dt className="text-fg-muted">Ventas</dt>
          <dd className="text-right tabular-nums">{formatCurrency(totals.sales)}</dd>
          <dt className="text-fg-muted">− Costo de lo vendido</dt>
          <dd className="text-right tabular-nums">{formatCurrency(totals.cogs)}</dd>
          <dt className="text-fg-muted">− Gastos</dt>
          <dd className="text-right tabular-nums">{formatCurrency(totals.expenses)}</dd>
          <dt className="text-fg-muted">− Pérdidas de inventario</dt>
          <dd className="text-right tabular-nums">{formatCurrency(totals.inventory_loss)}</dd>
        </dl>
        <Delta current={totals.net_profit} previous={previous.net_profit} higherIsBetter />
        {showShared && totals.shared_expenses > 0 && (
          <p className="text-xs text-fg-subtle">
            No incluye {formatCurrency(totals.shared_expenses)} de gastos compartidos entre sedes (salen en
            “Todo”).
          </p>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {KPIS.map((kpi) => (
          <div key={kpi.key} className="flex flex-col gap-1 rounded-card border border-line bg-surface p-4">
            <p className="text-sm text-fg-muted">{kpi.label}</p>
            <p className="text-2xl font-semibold tabular-nums">{formatCurrency(totals[kpi.key])}</p>
            {kpi.hint?.(totals) && <p className="text-xs text-fg-subtle">{kpi.hint(totals)}</p>}
            <Delta
              current={totals[kpi.key]}
              previous={previous[kpi.key]}
              higherIsBetter={kpi.higherIsBetter}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
