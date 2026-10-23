import { useQuery } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field, MoneyInput, TextInput } from '@/components/ui/field'
import { cn } from '@/lib/cn'
import { formatCurrency } from '@/lib/format'
import { fetchOrder, payOrder, paymentMethodsQuery, type PaymentInput } from '../sales-api'
import { describeOrder, type Customer, type Order, type PaymentMethod } from '../types'
import { useSalesMutation } from '../use-sales-mutation'
import { CustomerPicker } from './customer-picker'

interface PaymentRow {
  key: string
  methodCode: string
  amount: number | null
  received: number | null
  customer: Customer | null
}

const BILLS = [5_000, 10_000, 20_000, 50_000, 100_000]

/** Exact amount plus the next bills that cover it, e.g. 13.000 -> exacto, 20.000, 50.000. */
function quickCash(amount: number): number[] {
  const options = BILLS.filter((bill) => bill > amount).slice(0, 3)
  const rounded = Math.ceil(amount / 10_000) * 10_000
  if (rounded > amount && !options.includes(rounded)) options.unshift(rounded)
  return [amount, ...options].slice(0, 4)
}

interface PaymentDialogProps {
  order: Order
  onPaid: (order: Order) => void
  onClose: () => void
}

export function PaymentDialog({ order, onPaid, onClose }: PaymentDialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const { data: methods = [] } = useQuery(paymentMethodsQuery)
  const [discountOpen, setDiscountOpen] = useState(false)
  const [discount, setDiscount] = useState<number | null>(null)
  const [discountReason, setDiscountReason] = useState('')
  const [tip, setTip] = useState<number | null>(null)
  const [rows, setRows] = useState<PaymentRow[]>([
    { key: crypto.randomUUID(), methodCode: 'cash', amount: null, received: null, customer: order.customers },
  ])

  const pay = useSalesMutation(async (input: Parameters<typeof payOrder>[1]) => {
    await payOrder(order.id, input)
    return fetchOrder(order.id)
  }, 'Pedido cobrado')

  useEffect(() => {
    ref.current?.showModal()
  }, [])

  const discountValue = discountOpen ? (discount ?? 0) : 0
  const total = Math.max(order.subtotal - discountValue, 0) + (tip ?? 0) + order.delivery_fee
  const single = rows.length === 1
  const effective = single ? rows.map((r) => ({ ...r, amount: total })) : rows
  const paid = effective.reduce((sum, r) => sum + (r.amount ?? 0), 0)
  const remaining = total - paid
  const method = (code: string) => methods.find((m) => m.code === code)

  const problems: string[] = []
  if (discountValue > order.subtotal) problems.push('El descuento es mayor que los productos')
  if (discountValue > 0 && discountReason.trim().length < 3) problems.push('Escribe el motivo del descuento')
  if (!single && remaining !== 0)
    problems.push(
      remaining > 0 ? `Faltan ${formatCurrency(remaining)}` : `Sobran ${formatCurrency(-remaining)}`,
    )
  for (const row of effective) {
    const kind = method(row.methodCode)?.kind
    if (!row.amount || row.amount <= 0) problems.push('Cada pago necesita un valor')
    if (kind === 'cash' && row.received !== null && row.received < (row.amount ?? 0))
      problems.push('El efectivo recibido no alcanza')
    if (kind === 'credit' && !row.customer) problems.push('Elige a quién se le fía')
  }

  function patchRow(key: string, patch: Partial<PaymentRow>) {
    setRows((current) => current.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  function splitPayment() {
    setRows((current) => {
      const first = current[0]
      const base = current.length === 1 && first ? [{ ...first, amount: Math.ceil(total / 2) }] : current
      const used = base.reduce((sum, r) => sum + (r.amount ?? 0), 0)
      return [
        ...base,
        {
          key: crypto.randomUUID(),
          methodCode: 'nequi',
          amount: Math.max(total - used, 0),
          received: null,
          customer: order.customers,
        },
      ]
    })
  }

  function confirm() {
    if (problems.length > 0) return
    const payments: PaymentInput[] = effective.map((row) => {
      const kind = method(row.methodCode)?.kind
      return {
        method_code: row.methodCode,
        amount: row.amount ?? 0,
        ...(kind === 'cash' && row.received !== null ? { cash_received: row.received } : {}),
        ...(kind === 'credit' && row.customer ? { customer_id: row.customer.id } : {}),
      }
    })
    pay.mutate(
      {
        discount_amount: discountValue,
        discount_reason: discountReason.trim(),
        tip_amount: tip ?? 0,
        payments,
      },
      { onSuccess: onPaid },
    )
  }

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault()
        if (!pay.isPending) onClose()
      }}
      aria-labelledby="pay-title"
      className="m-auto max-h-[94dvh] w-[min(46rem,calc(100%-1.5rem))] overflow-y-auto rounded-card border border-line bg-surface p-0 text-fg backdrop:bg-ink/70"
    >
      <div className="flex flex-col gap-6 p-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="pay-title" className="text-lg font-semibold">
              Cobrar pedido #{order.order_number}
            </h2>
            <p className="text-sm text-fg-muted">{describeOrder(order)}</p>
          </div>
          <div className="text-right">
            <p className="text-sm text-fg-muted">Total a cobrar</p>
            <p className="text-4xl font-semibold tabular-nums">{formatCurrency(total)}</p>
          </div>
        </header>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-xl bg-surface-2 p-4 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-fg-subtle">Productos</dt>
            <dd className="tabular-nums">{formatCurrency(order.subtotal)}</dd>
          </div>
          <div>
            <dt className="text-fg-subtle">Descuento</dt>
            <dd className="tabular-nums">{discountValue ? `− ${formatCurrency(discountValue)}` : '—'}</dd>
          </div>
          <div>
            <dt className="text-fg-subtle">Domicilio</dt>
            <dd className="tabular-nums">{order.delivery_fee ? formatCurrency(order.delivery_fee) : '—'}</dd>
          </div>
          <div>
            <dt className="text-fg-subtle">Propina</dt>
            <dd className="tabular-nums">{tip ? formatCurrency(tip) : '—'}</dd>
          </div>
        </dl>

        <section className="flex flex-col gap-4" aria-label="Pagos">
          {rows.map((row, index) => {
            const current = effective[index]
            const kind = method(row.methodCode)?.kind
            const amount = current?.amount ?? 0
            return (
              <div key={row.key} className="flex flex-col gap-3 rounded-xl border border-line p-4">
                <div className="flex items-start justify-between gap-2">
                  <MethodButtons
                    methods={methods}
                    value={row.methodCode}
                    onChange={(methodCode) => patchRow(row.key, { methodCode, received: null })}
                  />
                  {!single && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Quitar este pago"
                      onClick={() => setRows((current) => current.filter((r) => r.key !== row.key))}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  )}
                </div>

                {!single && (
                  <Field label="Valor de este pago">
                    {(props) => (
                      <MoneyInput
                        {...props}
                        value={row.amount}
                        onValueChange={(value) => patchRow(row.key, { amount: value })}
                      />
                    )}
                  </Field>
                )}

                {kind === 'cash' && (
                  <div className="flex flex-col gap-2">
                    <p className="text-sm text-fg-muted">¿Con cuánto paga?</p>
                    <div className="flex flex-wrap gap-2">
                      {quickCash(amount).map((value, i) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => patchRow(row.key, { received: value })}
                          className={cn(
                            'h-12 min-w-24 rounded-xl border px-3 text-sm tabular-nums transition-colors',
                            (row.received ?? amount) === value && (row.received !== null || i === 0)
                              ? 'border-fg bg-fg text-ink'
                              : 'border-line bg-surface-2 hover:border-line-strong',
                          )}
                        >
                          {i === 0 ? 'Exacto' : formatCurrency(value)}
                        </button>
                      ))}
                      <div className="w-40">
                        <MoneyInput
                          aria-label="Otro valor recibido"
                          placeholder="Otro"
                          value={row.received}
                          onValueChange={(value) => patchRow(row.key, { received: value })}
                        />
                      </div>
                    </div>
                    {row.received !== null && row.received >= amount && (
                      <p className="text-lg">
                        Cambio: <b className="tabular-nums">{formatCurrency(row.received - amount)}</b>
                      </p>
                    )}
                  </div>
                )}

                {kind === 'credit' && (
                  <CustomerPicker
                    label="¿A quién se le fía?"
                    value={row.customer}
                    onChange={(customer) => patchRow(row.key, { customer })}
                  />
                )}
              </div>
            )
          })}

          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={splitPayment}>
              <Plus className="size-4" aria-hidden />
              Dividir pago
            </Button>
            <Button variant="ghost" onClick={() => setDiscountOpen((v) => !v)}>
              {discountOpen ? 'Quitar descuento' : 'Descuento'}
            </Button>
          </div>
        </section>

        {discountOpen && (
          <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
            <Field label="Descuento">
              {(props) => <MoneyInput {...props} value={discount} onValueChange={setDiscount} />}
            </Field>
            <Field label="Motivo del descuento" hint="Los dueños reciben un aviso de cada descuento.">
              {(props) => (
                <TextInput
                  {...props}
                  maxLength={200}
                  placeholder="ej. Cliente frecuente"
                  value={discountReason}
                  onChange={(e) => setDiscountReason(e.target.value)}
                />
              )}
            </Field>
          </div>
        )}
        <div className="max-w-48">
          <Field label="Propina (opcional)">
            {(props) => <MoneyInput {...props} value={tip} onValueChange={setTip} />}
          </Field>
        </div>
      </div>

      <footer className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-line bg-surface px-6 py-4">
        <p role="status" className="flex-1 text-sm text-warning">
          {problems[0] ?? ''}
        </p>
        <Button variant="ghost" size="lg" onClick={onClose} disabled={pay.isPending}>
          Cancelar
        </Button>
        <Button size="lg" onClick={confirm} disabled={problems.length > 0} loading={pay.isPending}>
          Confirmar cobro
        </Button>
      </footer>
    </dialog>
  )
}

function MethodButtons({
  methods,
  value,
  onChange,
}: {
  methods: PaymentMethod[]
  value: string
  onChange: (code: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Método de pago">
      {methods.map((m) => (
        <button
          key={m.code}
          type="button"
          role="radio"
          aria-checked={value === m.code}
          onClick={() => onChange(m.code)}
          className={cn(
            'h-12 rounded-xl border px-4 text-sm font-medium transition-colors',
            value === m.code
              ? 'border-fg bg-fg text-ink'
              : 'border-line bg-surface-2 text-fg-muted hover:text-fg',
          )}
        >
          {m.name}
        </button>
      ))}
    </div>
  )
}
