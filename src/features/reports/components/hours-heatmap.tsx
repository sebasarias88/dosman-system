import { useState } from 'react'
import { cn } from '@/lib/cn'
import { formatCurrency } from '@/lib/format'
import type { ReportOverview } from '../reports-api'

// Monday first, as people read a week in Colombia. Postgres: 0 = Sunday.
const DAYS = [
  { dow: 1, label: 'Lun', name: 'lunes' },
  { dow: 2, label: 'Mar', name: 'martes' },
  { dow: 3, label: 'Mié', name: 'miércoles' },
  { dow: 4, label: 'Jue', name: 'jueves' },
  { dow: 5, label: 'Vie', name: 'viernes' },
  { dow: 6, label: 'Sáb', name: 'sábado' },
  { dow: 0, label: 'Dom', name: 'domingo' },
]

const STEPS = ['bg-heat-1', 'bg-heat-2', 'bg-heat-3', 'bg-heat-4', 'bg-heat-5']

function hourLabel(hour: number) {
  const h = hour % 12 === 0 ? 12 : hour % 12
  return `${h}${hour < 12 ? 'a' : 'p'}`
}

/** Busy hours: weekday x hour, darker = fewer orders, lighter = more. */
export function HoursHeatmap({ hours }: { hours: ReportOverview['hours'] }) {
  const [active, setActive] = useState<{ dow: number; hour: number } | null>(null)
  if (hours.length === 0) return <p className="text-sm text-fg-subtle">Aún no hay ventas en este periodo.</p>

  const byKey = new Map(hours.map((h) => [`${h.dow}-${h.hour}`, h]))
  const used = hours.map((h) => h.hour)
  const first = Math.min(...used)
  const last = Math.max(...used)
  const range = Array.from({ length: last - first + 1 }, (_, i) => first + i)
  const max = Math.max(...hours.map((h) => h.orders))
  const step = (orders: number) =>
    STEPS[Math.min(Math.ceil((orders / max) * STEPS.length) - 1, STEPS.length - 1)]

  const busiest = [...hours].sort((a, b) => b.orders - a.orders)[0]
  const current = active ? byKey.get(`${active.dow}-${active.hour}`) : undefined
  const day = DAYS.find((d) => d.dow === (active ?? busiest)?.dow)

  return (
    <div className="flex flex-col gap-3">
      <p className="min-h-5 text-sm text-fg-muted" aria-live="polite">
        {active
          ? `${day?.name ?? ''} ${hourLabel(active.hour)}m: ${current?.orders ?? 0} pedidos · ${formatCurrency(current?.sales ?? 0)}`
          : busiest &&
            `Más movimiento: ${day?.name ?? ''} a las ${hourLabel(busiest.hour)}m (${busiest.orders} pedidos)`}
      </p>
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-0.5" onMouseLeave={() => setActive(null)}>
          <thead>
            <tr>
              <th />
              {range.map((hour) => (
                <th
                  key={hour}
                  scope="col"
                  className="px-0.5 text-center text-[11px] font-normal text-fg-subtle"
                >
                  {hourLabel(hour)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DAYS.map((d) => (
              <tr key={d.dow}>
                <th scope="row" className="pr-2 text-left text-xs font-normal text-fg-subtle">
                  {d.label}
                </th>
                {range.map((hour) => {
                  const cell = byKey.get(`${d.dow}-${hour}`)
                  return (
                    <td
                      key={hour}
                      title={`${d.name} ${hourLabel(hour)}m: ${cell?.orders ?? 0} pedidos`}
                      onMouseEnter={() => setActive({ dow: d.dow, hour })}
                      onClick={() => setActive({ dow: d.dow, hour })}
                      className={cn(
                        'size-7 min-w-7 rounded-md',
                        cell ? step(cell.orders) : 'bg-surface-2',
                        active?.dow === d.dow && active.hour === hour && 'ring-2 ring-fg',
                      )}
                    />
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2 text-xs text-fg-subtle">
        <span>Menos pedidos</span>
        {STEPS.map((s) => (
          <span key={s} className={cn('size-3.5 rounded', s)} aria-hidden />
        ))}
        <span>Más pedidos</span>
      </div>
    </div>
  )
}
