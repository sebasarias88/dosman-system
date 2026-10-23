import { useQuery } from '@tanstack/react-query'
import { HandCoins } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field, MoneyInput, SelectInput, Switch, TextInput } from '@/components/ui/field'
import { Sheet } from '@/components/ui/sheet'
import { Spinner } from '@/components/ui/spinner'
import { paymentMethodsQuery } from '@/features/sales/sales-api'
import { cn } from '@/lib/cn'
import { formatCurrency } from '@/lib/format'
import { paySupplier, supplierBalancesQuery, type SupplierBalance } from '../inventory-api'
import { useInventoryMutation } from '../use-inventory-mutation'

/** What is owed to each supplier (managers only). */
export function SuppliersTab() {
  const { data: balances = [], isPending } = useQuery(supplierBalancesQuery)
  const [paying, setPaying] = useState<SupplierBalance | null>(null)

  if (isPending) return <Spinner />
  const owed = balances.reduce((sum, b) => sum + Math.max(b.balance, 0), 0)

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-card border border-line bg-surface p-4">
        <p className="text-sm text-fg-muted">Total que se le debe a proveedores</p>
        <p className={cn('text-2xl font-semibold tabular-nums', owed > 0 && 'text-warning')}>
          {formatCurrency(owed)}
        </p>
      </div>
      {balances.length === 0 ? (
        <p className="p-8 text-center text-fg-muted">Aún no hay proveedores.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {balances.map((b) => (
            <li
              key={b.supplier_id}
              className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-surface p-4"
            >
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{b.name}</span>
                <span className="text-sm text-fg-subtle">
                  Comprado {formatCurrency(b.purchased)} · Pagado {formatCurrency(b.paid)}
                </span>
              </span>
              <span
                className={cn('font-semibold tabular-nums', b.balance > 0 ? 'text-warning' : 'text-fg-muted')}
              >
                {b.balance > 0 ? `Debe ${formatCurrency(b.balance)}` : 'Al día'}
              </span>
              {b.balance > 0 && (
                <Button variant="secondary" onClick={() => setPaying(b)}>
                  <HandCoins className="size-4" aria-hidden />
                  Pagar
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {paying && <PaySheet key={paying.supplier_id} supplier={paying} onClose={() => setPaying(null)} />}
    </div>
  )
}

function PaySheet({ supplier, onClose }: { supplier: SupplierBalance; onClose: () => void }) {
  const { data: methods = [] } = useQuery(paymentMethodsQuery)
  const [amount, setAmount] = useState<number | null>(supplier.balance)
  const [fromDrawer, setFromDrawer] = useState(false)
  const [methodCode, setMethodCode] = useState('nequi')
  const [notes, setNotes] = useState('')
  const pay = useInventoryMutation(paySupplier, 'Pago registrado')

  return (
    <Sheet
      open
      onClose={onClose}
      title={`Pagar a ${supplier.name}`}
      description={`Se le debe ${formatCurrency(supplier.balance)}.`}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={!amount || amount <= 0}
            loading={pay.isPending}
            onClick={() =>
              pay.mutate(
                {
                  supplierId: supplier.supplier_id,
                  amount: amount ?? 0,
                  methodCode,
                  fromCashDrawer: fromDrawer,
                  notes: notes.trim(),
                },
                { onSuccess: onClose },
              )
            }
          >
            Registrar pago
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <Field label="Valor">
          {(props) => <MoneyInput {...props} value={amount} onValueChange={setAmount} />}
        </Field>
        <Switch
          label="Sale de la caja"
          description="Se registra como salida de efectivo del turno abierto"
          checked={fromDrawer}
          onCheckedChange={setFromDrawer}
        />
        {!fromDrawer && (
          <Field label="Medio de pago">
            {(props) => (
              <SelectInput {...props} value={methodCode} onChange={(e) => setMethodCode(e.target.value)}>
                {methods
                  .filter((m) => m.kind !== 'credit')
                  .map((m) => (
                    <option key={m.code} value={m.code}>
                      {m.name}
                    </option>
                  ))}
              </SelectInput>
            )}
          </Field>
        )}
        <Field label="Nota (opcional)">
          {(props) => (
            <TextInput {...props} maxLength={200} value={notes} onChange={(e) => setNotes(e.target.value)} />
          )}
        </Field>
      </div>
    </Sheet>
  )
}
