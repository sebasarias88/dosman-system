import type { SupplyUnit } from '@/features/catalog/types'
import { formatStock, UNITS } from '@/features/catalog/units'
import { formatCurrency, formatUnitCost } from '@/lib/format'
import type { ActivityEntry } from './activity-api'

export interface EventText {
  title: string
  /** Extra line: the reason, the numbers behind it. */
  detail?: string
}

type Details = Record<string, unknown>

const num = (d: Details, key: string) => Number(d[key] ?? 0)
const str = (d: Details, key: string) => (typeof d[key] === 'string' ? (d[key] as string) : '')
const money = (d: Details, key: string) => formatCurrency(num(d, key))
const reason = (d: Details) => (str(d, 'reason') ? `Motivo: ${str(d, 'reason')}` : undefined)
const order = (d: Details) => `pedido #${num(d, 'order_number')}`

const PURCHASE_PAYMENT: Record<string, string> = {
  cash_drawer: 'pagada con dinero de la caja',
  credit: 'a crédito con el proveedor',
  other: 'pagada aparte (Nequi, transferencia…)',
}

/**
 * Turns an audit entry into a sentence the owner understands without
 * knowing the database. Unknown actions fall back to their code.
 */
export function describeEvent(entry: ActivityEntry, branchNames: Map<string, string>): EventText {
  const d = entry.details
  switch (entry.action) {
    // Cash ------------------------------------------------------------------
    case 'cash.open':
      return { title: `Abrió la caja con una base de ${money(d, 'opening_amount')}` }
    case 'cash.cash_in':
      return { title: `Entrada de efectivo de ${money(d, 'amount')}`, detail: reason(d) }
    case 'cash.cash_out':
      return { title: `Salida de efectivo de ${money(d, 'amount')}`, detail: reason(d) }
    case 'cash.close': {
      const diff = num(d, 'difference')
      return {
        title:
          diff < 0
            ? `Cerró la caja con un FALTANTE de ${formatCurrency(-diff)}`
            : diff > 0
              ? `Cerró la caja con un sobrante de ${formatCurrency(diff)}`
              : 'Cerró la caja cuadrada',
        detail: `Esperado ${money(d, 'expected_cash')} · Contado ${money(d, 'counted_cash')}`,
      }
    }
    case 'customer.payment':
      return {
        title: `Abono de ${money(d, 'amount')} de ${str(d, 'customer')}`,
        detail:
          num(d, 'balance_after') > 0
            ? `Queda debiendo ${money(d, 'balance_after')}`
            : 'Quedó con la cuenta al día',
      }

    // Sales -----------------------------------------------------------------
    case 'order_item.void': {
      const variant = str(d, 'variant')
      const product = `${num(d, 'quantity')}× ${str(d, 'product')}${variant && variant !== 'Único' ? ` ${variant}` : ''}`
      return {
        title: `Anuló ${product} (${money(d, 'amount')}) del ${order(d)}`,
        detail: [
          reason(d),
          d.stock_returned
            ? 'Los insumos volvieron al inventario'
            : 'Ya estaba en preparación: los insumos no volvieron',
        ]
          .filter(Boolean)
          .join(' · '),
      }
    }
    case 'order.cancel':
      return { title: `Canceló el ${order(d)} (${money(d, 'amount')})`, detail: reason(d) }
    case 'order.discount':
      return {
        title: `Descuento de ${money(d, 'discount')} en el ${order(d)}`,
        detail: [`Subtotal ${money(d, 'subtotal')}`, reason(d)].filter(Boolean).join(' · '),
      }
    case 'order.credit_sale':
      return { title: `Venta fiada de ${money(d, 'amount')} (${order(d)})` }
    case 'order.move_table':
      return { title: `Pasó el ${order(d)} de ${str(d, 'from')} a ${str(d, 'to')}` }

    // Inventory -------------------------------------------------------------
    case 'inventory.waste': {
      const unit = str(d, 'unit') as SupplyUnit
      const qty = unit in UNITS ? formatStock(unit, num(d, 'quantity')) : String(num(d, 'quantity'))
      return { title: `Merma de ${qty} de ${str(d, 'supply')} (${money(d, 'value')})`, detail: reason(d) }
    }
    case 'inventory.count': {
      const shortage = num(d, 'shortage_value')
      return {
        title:
          shortage > 0
            ? `Conteo físico con faltantes por ${formatCurrency(shortage)}`
            : 'Conteo físico sin faltantes',
        detail: `${num(d, 'items')} insumos contados${num(d, 'surplus_value') > 0 ? ` · sobrantes ${money(d, 'surplus_value')}` : ''}`,
      }
    }
    case 'transfer.send':
      return {
        title: `Envió ${num(d, 'lines')} insumo(s) a ${branchNames.get(str(d, 'to_branch_id')) ?? 'la otra sede'}`,
      }
    case 'transfer.receive':
      return str(d, 'status') === 'received'
        ? { title: 'Recibió un envío completo' }
        : {
            title: `Recibió un envío con diferencias (faltan ${money(d, 'missing_value')})`,
            detail: str(d, 'notes') ? `Nota: ${str(d, 'notes')}` : undefined,
          }
    case 'transfer.cancel':
      return { title: 'Canceló un envío entre sedes', detail: reason(d) }
    case 'purchase.create':
      return {
        title: `Compra de ${money(d, 'total')}${str(d, 'supplier') ? ` a ${str(d, 'supplier')}` : ''}`,
        detail: PURCHASE_PAYMENT[str(d, 'payment')],
      }
    case 'supplier.payment':
      return {
        title: `Pagó ${money(d, 'amount')} a ${str(d, 'supplier')}`,
        detail: d.from_cash_drawer ? 'Con dinero de la caja' : undefined,
      }

    // Expenses --------------------------------------------------------------
    case 'expense.created':
      return {
        title: `Gasto de ${money(d, 'amount')}: ${str(d, 'description')}`,
        detail: [str(d, 'category'), d.from_drawer ? 'Salió de la caja' : ''].filter(Boolean).join(' · '),
      }
    case 'expense.voided':
      return {
        title: `Anuló un gasto de ${money(d, 'amount')}: ${str(d, 'description')}`,
        detail: [reason(d), d.cash_returned ? 'El dinero volvió a la caja' : ''].filter(Boolean).join(' · '),
      }
    case 'expense.recurring_created':
      return {
        title: `Creó el gasto fijo "${str(d, 'name')}" de ${money(d, 'amount')} (día ${num(d, 'day')})`,
      }
    case 'expense.recurring_changed':
      return {
        title: `Cambió el gasto fijo "${str(d, 'name')}": ${money(d, 'old_amount')} → ${money(d, 'new_amount')}`,
        detail: d.is_active === false ? 'Quedó pausado' : undefined,
      }

    // Prices and costs --------------------------------------------------------
    case 'product_variant.price_change':
      return {
        title: `Cambió un precio (tamaño ${str(d, 'name')}): ${money(d, 'old_price')} → ${money(d, 'new_price')}`,
      }
    case 'add_on.price_change':
      return {
        title: `Cambió el precio de la adición ${str(d, 'name')}: ${money(d, 'old_price')} → ${money(d, 'new_price')}`,
      }
    case 'supply.cost_change': {
      const unit = str(d, 'unit') as SupplyUnit
      const base = unit in UNITS ? UNITS[unit].base : ''
      return {
        title: `El costo de ${str(d, 'name')} cambió: ${formatUnitCost(num(d, 'old_unit_cost'))} → ${formatUnitCost(num(d, 'new_unit_cost'))} por ${base}`,
      }
    }
    default:
      return { title: entry.action }
  }
}

/** Families of actions for the filter chips. */
export const ACTIVITY_GROUPS = [
  { id: 'all', label: 'Todo', prefixes: [] },
  { id: 'sales', label: 'Ventas y anulaciones', prefixes: ['order.', 'order_item.'] },
  { id: 'cash', label: 'Caja y abonos', prefixes: ['cash.', 'customer.'] },
  {
    id: 'inventory',
    label: 'Inventario y compras',
    prefixes: ['inventory.', 'transfer.', 'purchase.', 'supplier.'],
  },
  { id: 'expenses', label: 'Gastos', prefixes: ['expense.'] },
  { id: 'prices', label: 'Precios y costos', prefixes: ['product_variant.', 'add_on.', 'supply.'] },
] as const

export type ActivityGroup = (typeof ACTIVITY_GROUPS)[number]['id']
