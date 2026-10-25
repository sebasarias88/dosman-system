import { useQuery } from '@tanstack/react-query'
import { formatCurrency } from '@/lib/format'
import { monthlyHistoryQuery } from '../storage-api'

const monthName = new Intl.DateTimeFormat('es-CO', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const formatMonth = (date: string) => monthName.format(new Date(`${date.slice(0, 10)}T00:00:00Z`))

/** Totals saved for the months whose detail was cleaned (storage screen and reports). */
export function MonthlyHistory() {
  const { data: rows = [] } = useQuery(monthlyHistoryQuery)
  if (rows.length === 0) return null
  return (
    <section className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5">
      <h2 className="font-semibold">Resúmenes de meses limpiados</h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-fg-subtle">
              <th className="py-2 font-normal">Mes</th>
              <th className="py-2 font-normal">Sede</th>
              <th className="py-2 text-right font-normal">Pedidos</th>
              <th className="py-2 text-right font-normal">Ventas</th>
              <th className="py-2 text-right font-normal">Ganancia bruta</th>
              <th className="py-2 text-right font-normal">Gastos</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={`${r.month}-${r.branch_name}`}>
                <td className="py-2 first-letter:uppercase">{formatMonth(r.month)}</td>
                <td className="py-2">{r.branch_name}</td>
                <td className="py-2 text-right tabular-nums">{r.orders_count}</td>
                <td className="py-2 text-right tabular-nums">{formatCurrency(r.sales_total)}</td>
                <td className="py-2 text-right tabular-nums">
                  {formatCurrency(r.sales_total - r.cost_total)}
                </td>
                <td className="py-2 text-right tabular-nums">{formatCurrency(r.expenses_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
