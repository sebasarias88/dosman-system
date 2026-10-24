import { Link } from '@tanstack/react-router'
import { ArrowRight, Ban, PackageX, ShoppingBag, Wallet } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { formatCurrency } from '@/lib/format'
import type { ReportOverview, ReportTotals } from '../reports-api'

function Row({
  icon,
  label,
  value,
  detail,
  alert,
}: {
  icon: ReactNode
  label: string
  value: string
  detail: string
  alert: boolean
}) {
  return (
    <li className="flex items-start gap-3 py-3">
      <span className={cn('mt-0.5 shrink-0', alert ? 'text-warning' : 'text-fg-subtle')}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block">{label}</span>
        <span className="text-xs text-fg-subtle">{detail}</span>
      </span>
      <span className={cn('font-semibold tabular-nums', alert && 'text-warning')}>{value}</span>
    </li>
  )
}

/**
 * The anti-loss view for absent owners: what was voided, cancelled, thrown
 * away or missing from the drawer. Each line links to a habit worth watching.
 */
export function ControlPanel({ totals }: { totals: ReportTotals }) {
  const cash = totals.cash_difference
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col divide-y divide-line">
        <Row
          icon={<Wallet className="size-4" aria-hidden />}
          label="Diferencias de caja"
          value={`${cash > 0 ? '+' : ''}${formatCurrency(cash)}`}
          detail={
            totals.short_closings > 0
              ? `${totals.short_closings} ${totals.short_closings === 1 ? 'cierre con faltante' : 'cierres con faltante'}`
              : 'Ningún cierre con faltante'
          }
          alert={cash < 0 || totals.short_closings > 0}
        />
        <Row
          icon={<Ban className="size-4" aria-hidden />}
          label="Productos anulados"
          value={formatCurrency(totals.voided_value)}
          detail={`${totals.voided_items} ${totals.voided_items === 1 ? 'anulación' : 'anulaciones'}`}
          alert={totals.voided_items > 0}
        />
        <Row
          icon={<ShoppingBag className="size-4" aria-hidden />}
          label="Pedidos cancelados"
          value={String(totals.cancelled_orders)}
          detail="Pedidos que se abrieron y no se cobraron"
          alert={totals.cancelled_orders > 0}
        />
        <Row
          icon={<PackageX className="size-4" aria-hidden />}
          label="Pérdidas de inventario"
          value={formatCurrency(totals.inventory_loss)}
          detail={`Mermas ${formatCurrency(totals.waste_cost)} · faltantes en conteos ${formatCurrency(totals.adjustment_cost)}`}
          alert={totals.adjustment_cost > 0}
        />
      </ul>
      <Link
        to="/activity"
        search={{ period: 'week', severity: 'alerts', group: 'all' }}
        className="inline-flex items-center gap-1 self-start text-sm text-fg-muted underline-offset-4 hover:text-fg hover:underline"
      >
        Ver quién lo hizo y por qué en Actividad
        <ArrowRight className="size-3.5" aria-hidden />
      </Link>
    </div>
  )
}

/** Side-by-side numbers for each branch (only when looking at both). */
export function BranchComparison({ branches }: { branches: ReportOverview['branches'] }) {
  const rows: { label: string; get: (b: ReportTotals) => number; money?: boolean }[] = [
    { label: 'Ventas', get: (b) => b.sales, money: true },
    { label: 'Pedidos', get: (b) => b.orders },
    { label: 'Ticket promedio', get: (b) => b.average_ticket, money: true },
    { label: 'Costo de lo vendido', get: (b) => b.cogs, money: true },
    { label: 'Ganancia bruta', get: (b) => b.gross_profit, money: true },
    { label: 'Gastos propios', get: (b) => b.expenses, money: true },
    { label: 'Pérdidas de inventario', get: (b) => b.inventory_loss, money: true },
    { label: 'Ganancia real', get: (b) => b.net_profit, money: true },
    { label: 'Diferencias de caja', get: (b) => b.cash_difference, money: true },
  ]
  const totalSales = branches.reduce((sum, b) => sum + b.sales, 0)

  return (
    <div className="flex flex-col gap-4">
      {totalSales > 0 && (
        <div>
          <div className="flex h-3 gap-0.5 overflow-hidden rounded-full" aria-hidden>
            {branches.map((b, i) => (
              <span
                key={b.id}
                className={i === 0 ? 'bg-chart' : 'bg-fg-subtle'}
                style={{ width: `${(b.sales / totalSales) * 100}%` }}
              />
            ))}
          </div>
          <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
            {branches.map((b, i) => (
              <li key={b.id} className="flex items-center gap-2">
                <span
                  className={cn('size-2.5 rounded-full', i === 0 ? 'bg-chart' : 'bg-fg-subtle')}
                  aria-hidden
                />
                {b.name}: {Math.round((b.sales / totalSales) * 100)} % de las ventas
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-fg-subtle">
              <th className="py-2 text-left font-normal" />
              {branches.map((b) => (
                <th key={b.id} className="py-2 pl-3 text-right font-medium text-fg">
                  {b.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => (
              <tr key={row.label} className={row.label === 'Ganancia real' ? 'font-semibold' : undefined}>
                <td className="py-2 text-fg-muted">{row.label}</td>
                {branches.map((b) => (
                  <td key={b.id} className="py-2 pl-3 text-right tabular-nums">
                    {row.money ? formatCurrency(row.get(b)) : row.get(b)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
