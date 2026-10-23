import { useEffect, useRef, useState } from 'react'
import { formatCompactCurrency, formatCurrency } from '@/lib/format'
import { daysBetween, formatMonth, formatShortDate, formatWeekday } from '../periods'
import type { ReportOverview } from '../reports-api'

interface Bucket {
  key: string
  label: string
  title: string
  sales: number
  cogs: number
  expenses: number
  orders: number
}

/** Days for short ranges; months when the range is longer than ~2 months. */
function toBuckets(daily: ReportOverview['daily']): Bucket[] {
  const first = daily[0]
  const last = daily[daily.length - 1]
  if (!first || !last) return []
  const byMonth = daysBetween(first.date, last.date) > 62
  const short = daily.length <= 10
  const map = new Map<string, Bucket>()
  for (const day of daily) {
    const key = byMonth ? day.date.slice(0, 7) : day.date
    const bucket = map.get(key) ?? {
      key,
      label: byMonth ? formatMonth(`${key}-01`) : short ? formatWeekday(day.date) : formatShortDate(day.date),
      title: byMonth ? formatMonth(`${key}-01`) : formatWeekday(day.date),
      sales: 0,
      cogs: 0,
      expenses: 0,
      orders: 0,
    }
    bucket.sales += day.sales
    bucket.cogs += day.cogs
    bucket.expenses += day.expenses
    bucket.orders += day.orders
    map.set(key, bucket)
  }
  return [...map.values()]
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}

/** "Nice" axis maximum: 1, 2, 2.5 or 5 times a power of ten. */
function niceMax(value: number): number {
  if (value <= 0) return 1
  const power = 10 ** Math.floor(Math.log10(value))
  const step = [1, 2, 2.5, 5, 10].find((m) => m * power >= value) ?? 10
  return step * power
}

const HEIGHT = 240
const PAD = { top: 12, right: 8, bottom: 28, left: 64 }

/** Sales per day (or month) as bars, with a tooltip for the details. */
export function SalesChart({ daily }: { daily: ReportOverview['daily'] }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [active, setActive] = useState<number | null>(null)
  const buckets = toBuckets(daily)
  const max = niceMax(Math.max(...buckets.map((b) => b.sales), 0))
  const plotW = Math.max(width - PAD.left - PAD.right, 0)
  const plotH = HEIGHT - PAD.top - PAD.bottom
  const slot = buckets.length > 0 ? plotW / buckets.length : 0
  // 2px surface gap between bars, never wider than 48px.
  const barW = Math.max(Math.min(slot - 2, 48), 1)
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max)
  const labelEvery = Math.max(1, Math.ceil(buckets.length / Math.max(Math.floor(plotW / 64), 1)))
  const y = (value: number) => PAD.top + plotH - (value / max) * plotH
  const hovered = active !== null ? buckets[active] : undefined

  return (
    <div className="flex flex-col gap-3">
      <div ref={ref} className="relative" onMouseLeave={() => setActive(null)}>
        {width > 0 && (
          <svg width={width} height={HEIGHT} role="img" aria-label="Ventas por día">
            {ticks.map((tick) => (
              <g key={tick}>
                <line
                  x1={PAD.left}
                  x2={width - PAD.right}
                  y1={y(tick)}
                  y2={y(tick)}
                  className={tick === 0 ? 'stroke-line-strong' : 'stroke-line'}
                  strokeDasharray={tick === 0 ? undefined : '2 4'}
                />
                <text
                  x={PAD.left - 8}
                  y={y(tick)}
                  dy="0.32em"
                  textAnchor="end"
                  className="fill-fg-subtle text-[11px]"
                >
                  {formatCompactCurrency(tick)}
                </text>
              </g>
            ))}
            {buckets.map((bucket, i) => {
              const x = PAD.left + i * slot + (slot - barW) / 2
              const h = (bucket.sales / max) * plotH
              const r = Math.min(4, barW / 2, h)
              const top = PAD.top + plotH - h
              return (
                <g key={bucket.key}>
                  {h > 0 && (
                    <path
                      // Rounded only at the data end; square on the baseline.
                      d={`M${x},${top + h} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${top + h} Z`}
                      className={active === i ? 'fill-chart-hover' : 'fill-chart'}
                    />
                  )}
                  {i % labelEvery === 0 && (
                    <text
                      x={PAD.left + i * slot + slot / 2}
                      y={HEIGHT - 8}
                      textAnchor="middle"
                      className="fill-fg-subtle text-[11px]"
                    >
                      {bucket.label}
                    </text>
                  )}
                  {/* Hit target: the whole column, bigger than the bar. */}
                  <rect
                    x={PAD.left + i * slot}
                    y={PAD.top}
                    width={slot}
                    height={plotH}
                    fill="transparent"
                    onMouseEnter={() => setActive(i)}
                    onTouchStart={() => setActive(i)}
                  />
                </g>
              )
            })}
          </svg>
        )}
        {hovered && active !== null && (
          <div
            role="status"
            className="pointer-events-none absolute top-0 z-10 w-52 rounded-xl border border-line-strong bg-surface-3 p-3 text-sm shadow-lg"
            style={{
              left: Math.min(
                Math.max(PAD.left + active * slot + slot / 2 - 104, 0),
                Math.max(width - 208, 0),
              ),
            }}
          >
            <p className="mb-1.5 font-medium capitalize">{hovered.title}</p>
            <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-fg-muted">
              <dt>Ventas</dt>
              <dd className="text-right text-fg tabular-nums">{formatCurrency(hovered.sales)}</dd>
              <dt>Costo</dt>
              <dd className="text-right tabular-nums">{formatCurrency(hovered.cogs)}</dd>
              <dt>Ganancia bruta</dt>
              <dd className="text-right tabular-nums">{formatCurrency(hovered.sales - hovered.cogs)}</dd>
              <dt>Gastos</dt>
              <dd className="text-right tabular-nums">{formatCurrency(hovered.expenses)}</dd>
              <dt>Pedidos</dt>
              <dd className="text-right tabular-nums">{hovered.orders}</dd>
            </dl>
          </div>
        )}
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-fg-subtle hover:text-fg">Ver como tabla</summary>
        <div className="mt-2 max-h-72 overflow-auto">
          <table className="w-full text-left">
            <thead className="text-fg-subtle">
              <tr>
                <th className="py-1 font-normal">Fecha</th>
                <th className="py-1 text-right font-normal">Pedidos</th>
                <th className="py-1 text-right font-normal">Ventas</th>
                <th className="py-1 text-right font-normal">Costo</th>
                <th className="py-1 text-right font-normal">Gastos</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {buckets.map((b) => (
                <tr key={b.key}>
                  <td className="py-1 capitalize">{b.title}</td>
                  <td className="py-1 text-right tabular-nums">{b.orders}</td>
                  <td className="py-1 text-right tabular-nums">{formatCurrency(b.sales)}</td>
                  <td className="py-1 text-right tabular-nums">{formatCurrency(b.cogs)}</td>
                  <td className="py-1 text-right tabular-nums">{formatCurrency(b.expenses)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}
