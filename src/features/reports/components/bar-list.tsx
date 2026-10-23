import { formatCurrency } from '@/lib/format'

interface BarListProps {
  items: { label: string; value: number; detail?: string }[]
  empty: string
}

/** Ranked horizontal bars with the value always written next to them. */
export function BarList({ items, empty }: BarListProps) {
  if (items.length === 0) return <p className="text-sm text-fg-subtle">{empty}</p>
  const max = Math.max(...items.map((i) => i.value), 1)
  const total = items.reduce((sum, i) => sum + i.value, 0)
  return (
    <ul className="flex flex-col gap-3">
      {items.map((item) => (
        <li key={item.label} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate">
              {item.label}
              {item.detail && <span className="text-fg-subtle"> · {item.detail}</span>}
            </span>
            <span className="shrink-0 tabular-nums">
              {formatCurrency(item.value)}
              <span className="ml-1.5 text-xs text-fg-subtle">
                {total > 0 ? Math.round((item.value / total) * 100) : 0} %
              </span>
            </span>
          </div>
          <span className="h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden>
            <span
              className="block h-full rounded-full bg-chart"
              style={{ width: `${Math.max((item.value / max) * 100, 1.5)}%` }}
            />
          </span>
        </li>
      ))}
    </ul>
  )
}
