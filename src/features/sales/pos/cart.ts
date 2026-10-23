import type { NewOrderItem } from '../sales-api'
import type { OrderAddOn } from '../types'

export interface CartLine {
  key: string
  variantId: string
  productName: string
  variantName: string
  /** Size price + add-ons, for one unit. Shown as a preview; the server recalculates. */
  unitPrice: number
  addOns: OrderAddOn[]
  quantity: number
  notes: string
}

export type CartAction =
  | { type: 'add'; line: Omit<CartLine, 'key'> }
  | { type: 'quantity'; key: string; quantity: number }
  | { type: 'remove'; key: string }
  | { type: 'clear' }

/** Two lines are the same if size, add-ons and notes match: then the quantity grows. */
function sameLine(a: Omit<CartLine, 'key'>, b: Omit<CartLine, 'key'>): boolean {
  const ids = (line: Omit<CartLine, 'key'>) =>
    line.addOns
      .map((x) => x.id)
      .sort()
      .join(',')
  return a.variantId === b.variantId && a.notes.trim() === b.notes.trim() && ids(a) === ids(b)
}

export function cartReducer(lines: CartLine[], action: CartAction): CartLine[] {
  switch (action.type) {
    case 'add': {
      const existing = lines.find((l) => sameLine(l, action.line))
      if (existing) {
        return lines.map((l) =>
          l.key === existing.key ? { ...l, quantity: Math.min(99, l.quantity + action.line.quantity) } : l,
        )
      }
      return [...lines, { ...action.line, key: crypto.randomUUID() }]
    }
    case 'quantity':
      return action.quantity <= 0
        ? lines.filter((l) => l.key !== action.key)
        : lines.map((l) => (l.key === action.key ? { ...l, quantity: Math.min(99, action.quantity) } : l))
    case 'remove':
      return lines.filter((l) => l.key !== action.key)
    case 'clear':
      return []
  }
}

export function cartTotal(lines: CartLine[]): number {
  return lines.reduce((total, l) => total + l.unitPrice * l.quantity, 0)
}

export function cartCount(lines: CartLine[]): number {
  return lines.reduce((count, l) => count + l.quantity, 0)
}

export function toOrderItems(lines: CartLine[]): NewOrderItem[] {
  return lines.map((l) => ({
    variant_id: l.variantId,
    quantity: l.quantity,
    add_on_ids: l.addOns.map((a) => a.id),
    notes: l.notes.trim(),
  }))
}
