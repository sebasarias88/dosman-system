import { Minus, Plus, Trash2, X } from 'lucide-react'
import type { Dispatch } from 'react'
import { Button } from '@/components/ui/button'
import { Field, MoneyInput, SelectInput, TextInput } from '@/components/ui/field'
import type { Branch } from '@/types/app'
import { cn } from '@/lib/cn'
import { formatCurrency } from '@/lib/format'
import {
  describeOrder,
  ORDER_TYPE_LABELS,
  type Customer,
  type DiningTable,
  type Order,
  type OrderType,
} from '../types'
import { cartTotal, type CartAction, type CartLine } from './cart'
import { CustomerPicker } from './customer-picker'

export interface OrderDraft {
  type: OrderType
  tableId: string
  parkNote: string
  customer: Customer | null
  deliveryAddress: string
  deliveryFee: number | null
  courierName: string
}

export const EMPTY_DRAFT: OrderDraft = {
  type: 'counter',
  tableId: '',
  parkNote: '',
  customer: null,
  deliveryAddress: '',
  deliveryFee: null,
  courierName: '',
}

/** Orders that are charged later (the customer stays) vs. charged right away. */
const PAY_LATER: OrderType[] = ['table', 'park', 'delivery']

export function draftProblem(draft: OrderDraft, lines: CartLine[]): string | null {
  if (lines.length === 0) return 'Agrega productos al pedido'
  if (draft.type === 'table' && !draft.tableId) return 'Elige la mesa'
  if (draft.type === 'park' && draft.parkNote.trim().length < 2)
    return 'Escribe una seña del cliente en el parque'
  if (draft.type === 'delivery') {
    if (!draft.customer) return 'Elige el cliente del domicilio'
    if (!draft.deliveryAddress.trim() && !draft.customer.address) return 'Escribe la dirección'
  }
  return null
}

interface OrderPanelProps {
  branch: Branch
  tables: DiningTable[]
  occupiedTableIds: Set<string>
  draft: OrderDraft
  onDraftChange: (draft: OrderDraft) => void
  lines: CartLine[]
  dispatch: Dispatch<CartAction>
  /** When set, the cart adds items to this open order instead of creating a new one. */
  addingTo: Order | null
  onCancelAdding: () => void
  busy: boolean
  onSubmit: (payNow: boolean) => void
}

export function OrderPanel({
  branch,
  tables,
  occupiedTableIds,
  draft,
  onDraftChange,
  lines,
  dispatch,
  addingTo,
  onCancelAdding,
  busy,
  onSubmit,
}: OrderPanelProps) {
  const types: OrderType[] = ['counter', 'takeaway', 'park']
  if (tables.length > 0) types.splice(2, 0, 'table')
  if (branch.takes_delivery) types.push('delivery')

  const subtotal = cartTotal(lines)
  const deliveryFee = draft.type === 'delivery' ? (draft.deliveryFee ?? 0) : 0
  const problem = draftProblem(draft, lines)
  const payLater = PAY_LATER.includes(draft.type)
  const patch = (values: Partial<OrderDraft>) => onDraftChange({ ...draft, ...values })

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-col gap-4 border-b border-line p-4">
        {addingTo ? (
          <div className="flex items-center gap-2 rounded-xl bg-brand-soft px-3 py-2.5">
            <p className="flex-1 text-sm">
              Agregando al pedido <b>#{addingTo.order_number}</b> · {describeOrder(addingTo)}
            </p>
            <Button variant="ghost" size="icon" aria-label="Dejar de agregar" onClick={onCancelAdding}>
              <X className="size-4" aria-hidden />
            </Button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Tipo de pedido">
              {types.map((type) => (
                <button
                  key={type}
                  type="button"
                  role="radio"
                  aria-checked={draft.type === type}
                  onClick={() => patch({ type })}
                  className={cn(
                    'h-11 rounded-xl border text-sm font-medium transition-colors',
                    draft.type === type
                      ? 'border-fg bg-fg text-ink'
                      : 'border-line bg-surface-2 text-fg-muted hover:text-fg',
                  )}
                >
                  {ORDER_TYPE_LABELS[type]}
                </button>
              ))}
            </div>

            {draft.type === 'table' && (
              <Field label="Mesa">
                {(props) => (
                  <SelectInput
                    {...props}
                    value={draft.tableId}
                    onChange={(e) => patch({ tableId: e.target.value })}
                  >
                    <option value="" disabled>
                      Elegir mesa…
                    </option>
                    {tables.map((t) => (
                      <option key={t.id} value={t.id} disabled={occupiedTableIds.has(t.id)}>
                        {t.name}
                        {t.zones ? ` · ${t.zones.name}` : ''}
                        {occupiedTableIds.has(t.id) ? ' (ocupada)' : ''}
                      </option>
                    ))}
                  </SelectInput>
                )}
              </Field>
            )}
            {draft.type === 'park' && (
              <Field label="Seña del cliente" hint="Para encontrarlo al llevar el pedido.">
                {(props) => (
                  <TextInput
                    {...props}
                    maxLength={80}
                    placeholder="ej. Señora de camisa azul, banca de la fuente"
                    value={draft.parkNote}
                    onChange={(e) => patch({ parkNote: e.target.value })}
                  />
                )}
              </Field>
            )}
            {draft.type === 'delivery' && (
              <div className="flex flex-col gap-3">
                <CustomerPicker
                  value={draft.customer}
                  onChange={(customer) => patch({ customer, deliveryAddress: customer?.address ?? '' })}
                />
                {draft.customer && (
                  <>
                    <Field label="Dirección de entrega">
                      {(props) => (
                        <TextInput
                          {...props}
                          maxLength={200}
                          value={draft.deliveryAddress}
                          onChange={(e) => patch({ deliveryAddress: e.target.value })}
                        />
                      )}
                    </Field>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Valor domicilio">
                        {(props) => (
                          <MoneyInput
                            {...props}
                            value={draft.deliveryFee}
                            onValueChange={(deliveryFee) => patch({ deliveryFee })}
                          />
                        )}
                      </Field>
                      <Field label="Domiciliario">
                        {(props) => (
                          <TextInput
                            {...props}
                            maxLength={60}
                            value={draft.courierName}
                            onChange={(e) => patch({ courierName: e.target.value })}
                          />
                        )}
                      </Field>
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {lines.length === 0 ? (
          <p className="py-10 text-center text-sm text-fg-subtle">Toca un producto para agregarlo.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {lines.map((line) => (
              <li key={line.key} className="rounded-xl bg-surface-2 p-3">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="leading-snug font-medium">
                      {line.productName}
                      {line.variantName !== 'Único' && (
                        <span className="text-fg-muted"> · {line.variantName}</span>
                      )}
                    </p>
                    {line.addOns.length > 0 && (
                      <p className="text-sm text-fg-muted">+ {line.addOns.map((a) => a.name).join(', ')}</p>
                    )}
                    {line.notes && <p className="text-sm text-warning">» {line.notes}</p>}
                  </div>
                  <span className="font-medium tabular-nums">
                    {formatCurrency(line.unitPrice * line.quantity)}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-1.5">
                  <Button
                    variant="secondary"
                    size="icon"
                    aria-label={`Quitar uno de ${line.productName}`}
                    className="size-9"
                    onClick={() => dispatch({ type: 'quantity', key: line.key, quantity: line.quantity - 1 })}
                  >
                    <Minus className="size-4" aria-hidden />
                  </Button>
                  <span className="w-8 text-center tabular-nums">{line.quantity}</span>
                  <Button
                    variant="secondary"
                    size="icon"
                    aria-label={`Agregar uno de ${line.productName}`}
                    className="size-9"
                    onClick={() => dispatch({ type: 'quantity', key: line.key, quantity: line.quantity + 1 })}
                  >
                    <Plus className="size-4" aria-hidden />
                  </Button>
                  <span className="flex-1" />
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Eliminar ${line.productName}`}
                    className="size-9"
                    onClick={() => dispatch({ type: 'remove', key: line.key })}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-3 border-t border-line p-4">
        {deliveryFee > 0 && (
          <div className="flex justify-between text-sm text-fg-muted">
            <span>Domicilio</span>
            <span className="tabular-nums">{formatCurrency(deliveryFee)}</span>
          </div>
        )}
        <div className="flex items-baseline justify-between">
          <span className="text-fg-muted">{addingTo ? 'Se agrega' : 'Total'}</span>
          <span className="text-2xl font-semibold tabular-nums">
            {formatCurrency(subtotal + deliveryFee)}
          </span>
        </div>
        {lines.length > 0 && problem && <p className="text-sm text-warning">{problem}</p>}
        {addingTo ? (
          <Button size="lg" disabled={lines.length === 0} loading={busy} onClick={() => onSubmit(false)}>
            Agregar al pedido
          </Button>
        ) : payLater ? (
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="secondary"
              size="lg"
              disabled={Boolean(problem) || busy}
              onClick={() => onSubmit(true)}
            >
              Cobrar ya
            </Button>
            <Button size="lg" disabled={Boolean(problem)} loading={busy} onClick={() => onSubmit(false)}>
              Enviar pedido
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-[auto_1fr] gap-2">
            <Button
              variant="secondary"
              size="lg"
              disabled={Boolean(problem) || busy}
              onClick={() => onSubmit(false)}
            >
              Guardar
            </Button>
            <Button size="lg" disabled={Boolean(problem)} loading={busy} onClick={() => onSubmit(true)}>
              Cobrar {lines.length > 0 && formatCurrency(subtotal)}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
