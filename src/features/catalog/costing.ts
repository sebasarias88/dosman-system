import type { RecipeLine, Supply } from './types'

export interface CostSummary {
  cost: number
  profit: number
  /** 0–100, or null when there is no price or no recipe to compare against. */
  marginPercent: number | null
  hasRecipe: boolean
}

export function recipeCost(lines: RecipeLine[], suppliesById: Map<string, Supply>): number {
  return lines.reduce((total, line) => {
    const supply = suppliesById.get(line.supply_id)
    return total + (supply ? supply.unit_cost * line.quantity : 0)
  }, 0)
}

export function summarizeCost(
  price: number,
  lines: RecipeLine[],
  suppliesById: Map<string, Supply>,
): CostSummary {
  const cost = recipeCost(lines, suppliesById)
  const hasRecipe = lines.length > 0
  return {
    cost,
    profit: price - cost,
    marginPercent: hasRecipe && price > 0 ? ((price - cost) / price) * 100 : null,
    hasRecipe,
  }
}

export type MarginLevel = 'good' | 'warning' | 'low' | 'unknown'

/** Thresholds for a juice / cholado business, where 60%+ is a healthy margin. */
export function marginLevel(marginPercent: number | null): MarginLevel {
  if (marginPercent === null) return 'unknown'
  if (marginPercent < 40) return 'low'
  if (marginPercent < 60) return 'warning'
  return 'good'
}
