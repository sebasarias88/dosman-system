import { Badge, type BadgeTone } from '@/components/ui/badge'
import { formatPercent } from '@/lib/format'
import { marginLevel, type CostSummary, type MarginLevel } from '../costing'

const TONE: Record<MarginLevel, BadgeTone> = {
  good: 'success',
  warning: 'warning',
  low: 'danger',
  unknown: 'neutral',
}

/** Shows the profit margin, or "Sin receta" when the cost can't be known. */
export function MarginBadge({ summary }: { summary: CostSummary }) {
  if (!summary.hasRecipe) return <Badge tone="warning">Sin receta</Badge>
  const level = marginLevel(summary.marginPercent)
  return (
    <Badge tone={TONE[level]}>
      {summary.marginPercent === null ? '—' : `Margen ${formatPercent(summary.marginPercent)}`}
    </Badge>
  )
}
