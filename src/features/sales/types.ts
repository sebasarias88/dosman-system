export type OrderType = 'table' | 'counter' | 'takeaway' | 'park' | 'delivery'
export type OrderStatus = 'open' | 'paid' | 'cancelled'
export type PaymentKind = 'cash' | 'digital' | 'credit'

export interface PaymentMethod {
  code: string
  name: string
  kind: PaymentKind
  sort_order: number
}

export interface DiningTable {
  id: string
  name: string
  zone_id: string | null
  sort_order: number
  zones: { name: string; sort_order: number } | null
}

export interface Customer {
  id: string
  name: string
  phone: string | null
  address: string | null
}

export interface OrderAddOn {
  id: string
  name: string
  price: number
}

export interface OrderItem {
  id: string
  variant_id: string
  product_name: string
  variant_name: string
  quantity: number
  unit_price: number
  add_ons: OrderAddOn[]
  line_total: number
  notes: string | null
  created_at: string
  voided_at: string | null
  void_reason: string | null
}

export interface Payment {
  method_code: string
  amount: number
  cash_received: number | null
  change_given: number | null
}

export interface Order {
  id: string
  branch_id: string
  order_number: number
  order_type: OrderType
  status: OrderStatus
  table_id: string | null
  park_note: string | null
  customer_id: string | null
  delivery_address: string | null
  delivery_fee: number
  courier_name: string | null
  subtotal: number
  discount_amount: number
  discount_reason: string | null
  tip_amount: number
  total: number
  created_at: string
  paid_at: string | null
  dining_tables: { name: string } | null
  customers: Customer | null
  order_items: OrderItem[]
  payments: Payment[]
}

export interface CashSession {
  id: string
  branch_id: string
  business_date: string
  status: 'open' | 'closed'
  opening_amount: number
  opened_at: string
  opened_by: string
  expected_cash: number | null
  counted_cash: number | null
  difference: number | null
  close_notes: string | null
  closed_at: string | null
}

export interface CashMovement {
  id: string
  kind: 'in' | 'out'
  amount: number
  reason: string
  created_at: string
}

export interface MethodTotal {
  method_code: string
  name: string
  kind: PaymentKind
  total: number
  orders: number
}

export interface CashSummary {
  opening_amount: number
  by_method: MethodTotal[]
  cash_sales: number
  credit_sales: number
  customer_payments_cash: number
  customer_payments_total: number
  cash_in: number
  cash_out: number
  expected_cash: number
  paid_orders: number
  cancelled_orders: number
  voided_items: number
  net_sales: number
  tips: number
  discounts: number
  delivery_fees: number
  cost: number
  open_orders: number
  /** Only present in the result of closing a session. */
  counted_cash?: number
  difference?: number
}

export const ORDER_TYPE_LABELS: Record<OrderType, string> = {
  counter: 'Mostrador',
  takeaway: 'Para llevar',
  table: 'Mesa',
  park: 'Parque',
  delivery: 'Domicilio',
}

/** "Mesa 3", "Parque · señor de gorra roja", "Domicilio · Andrea"... */
export function describeOrder(
  order: Pick<Order, 'order_type' | 'dining_tables' | 'park_note' | 'customers'>,
): string {
  switch (order.order_type) {
    case 'table':
      return order.dining_tables?.name ?? 'Mesa'
    case 'park':
      return `Parque · ${order.park_note ?? ''}`
    case 'delivery':
      return `Domicilio · ${order.customers?.name ?? ''}`
    default:
      return ORDER_TYPE_LABELS[order.order_type]
  }
}
