import { useQuery } from '@tanstack/react-query'
import { Archive, ArchiveRestore, HandCoins, MessageCircle, Pencil, Printer } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Field, MoneyInput, TextArea, TextInput } from '@/components/ui/field'
import { Select } from '@/components/ui/select'
import { Sheet } from '@/components/ui/sheet'
import { ListSkeleton } from '@/components/ui/skeleton'
import { useStaff } from '@/features/auth/use-staff'
import { getPrintSettings, printTicket } from '@/features/printing/print-store'
import { CustomerPaymentTicket } from '@/features/printing/tickets'
import { paymentMethodsQuery, saveCustomer } from '@/features/sales/sales-api'
import { useSalesMutation } from '@/features/sales/use-sales-mutation'
import { cn } from '@/lib/cn'
import { formatCurrency, formatDateTime } from '@/lib/format'
import {
  ledgerQuery,
  recordCustomerPayment,
  setCustomerActive,
  whatsappReminder,
  type CustomerDebt,
  type CustomerPaymentResult,
} from '../customers-api'

type Mode = 'view' | 'edit'

interface CustomerSheetProps {
  /** null = new customer */
  customer: CustomerDebt | null
  /** Open straight on the payment form. */
  startWithPayment?: boolean
  onClose: () => void
}

export function CustomerSheet({ customer, startWithPayment = false, onClose }: CustomerSheetProps) {
  const [mode, setMode] = useState<Mode>(customer ? 'view' : 'edit')
  const title = customer ? customer.name : 'Nuevo cliente'

  return (
    <Sheet
      open
      onClose={onClose}
      title={title}
      description={customer ? [customer.phone, customer.address].filter(Boolean).join(' · ') : undefined}
    >
      {mode === 'edit' ? (
        <CustomerForm
          customer={customer}
          onDone={() => (customer ? setMode('view') : onClose())}
          onCancel={() => (customer ? setMode('view') : onClose())}
        />
      ) : (
        customer && (
          <CustomerAccount
            customer={customer}
            startWithPayment={startWithPayment}
            onEdit={() => setMode('edit')}
            onClose={onClose}
          />
        )
      )}
    </Sheet>
  )
}

function CustomerForm({
  customer,
  onDone,
  onCancel,
}: {
  customer: CustomerDebt | null
  onDone: () => void
  onCancel: () => void
}) {
  const [name, setName] = useState(customer?.name ?? '')
  const [phone, setPhone] = useState(customer?.phone ?? '')
  const [address, setAddress] = useState(customer?.address ?? '')
  const save = useSalesMutation(saveCustomer, 'Cliente guardado')
  const phoneOk = phone.trim() === '' || /^[0-9+ ]{7,20}$/.test(phone.trim())
  const valid = name.trim().length >= 2 && phoneOk

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!valid) return
    save.mutate(
      { id: customer?.customer_id, name: name.trim(), phone: phone.trim(), address: address.trim() },
      { onSuccess: onDone },
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <Field label="Nombre">
        {(props) => (
          <TextInput
            {...props}
            autoFocus
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        )}
      </Field>
      <Field label="Teléfono (WhatsApp)" error={phoneOk ? undefined : 'Solo números, entre 7 y 20 dígitos'}>
        {(props) => (
          <TextInput
            {...props}
            inputMode="tel"
            maxLength={20}
            placeholder="ej. 3104567890"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        )}
      </Field>
      <Field label="Dirección (domicilios)">
        {(props) => (
          <TextArea
            {...props}
            maxLength={200}
            rows={2}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
        )}
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={!valid} loading={save.isPending}>
          Guardar cliente
        </Button>
      </div>
    </form>
  )
}

const dayFormatter = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', timeZone: 'UTC' })

function CustomerAccount({
  customer,
  startWithPayment,
  onEdit,
  onClose,
}: {
  customer: CustomerDebt
  startWithPayment: boolean
  onEdit: () => void
  onClose: () => void
}) {
  const { profile, activeBranch } = useStaff()
  const isManager = profile.role === 'owner' || profile.role === 'admin'
  const { data: ledger, isPending } = useQuery(ledgerQuery(customer.customer_id))
  const [paying, setPaying] = useState(startWithPayment && customer.balance > 0)
  const [lastPayment, setLastPayment] = useState<
    (CustomerPaymentResult & { amount: number; method: string; at: Date }) | null
  >(null)
  const archive = useSalesMutation(
    setCustomerActive,
    customer.is_active ? 'Cliente archivado' : 'Cliente activado',
  )

  // The ledger is the freshest balance after a payment; the list row may lag a moment.
  const balance = ledger?.[0]?.balance ?? customer.balance
  const reminder =
    customer.phone && balance > 0
      ? whatsappReminder(customer.phone, customer.name, formatCurrency(balance))
      : null

  function printPayment(payment: NonNullable<typeof lastPayment>) {
    void printTicket(
      <CustomerPaymentTicket
        branchName={activeBranch?.name ?? ''}
        customerName={customer.name}
        amount={payment.amount}
        methodName={payment.method}
        balanceBefore={payment.balance_before}
        balanceAfter={payment.balance_after}
        staffName={profile.full_name}
        at={payment.at}
      />,
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className={cn('rounded-xl p-3', balance > 0 ? 'bg-warning-soft' : 'bg-surface-2')}>
          <p className="text-xs text-fg-muted">Debe</p>
          <p className={cn('text-lg font-semibold tabular-nums', balance > 0 && 'text-warning')}>
            {formatCurrency(balance)}
          </p>
        </div>
        <div className="rounded-xl bg-surface-2 p-3">
          <p className="text-xs text-fg-muted">Total fiado</p>
          <p className="text-lg font-semibold tabular-nums">{formatCurrency(customer.credit_total)}</p>
        </div>
        <div className="rounded-xl bg-surface-2 p-3">
          <p className="text-xs text-fg-muted">Ha abonado</p>
          <p className="text-lg font-semibold tabular-nums">{formatCurrency(customer.paid_total)}</p>
        </div>
      </div>

      {lastPayment && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-success-soft p-3 text-sm text-success">
          <span className="flex-1">
            Abono de {formatCurrency(lastPayment.amount)} registrado.{' '}
            {lastPayment.balance_after > 0
              ? `Queda debiendo ${formatCurrency(lastPayment.balance_after)}.`
              : '¡Cuenta al día!'}
          </span>
          <Button variant="secondary" onClick={() => printPayment(lastPayment)}>
            <Printer className="size-4" aria-hidden />
            Imprimir comprobante
          </Button>
        </div>
      )}

      {paying ? (
        <PaymentForm
          customerId={customer.customer_id}
          balance={balance}
          onCancel={() => setPaying(false)}
          onPaid={(payment) => {
            setPaying(false)
            setLastPayment(payment)
            if (getPrintSettings().autoReceipt) printPayment(payment)
          }}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          {balance > 0 && (
            <Button onClick={() => setPaying(true)}>
              <HandCoins className="size-4" aria-hidden />
              Registrar abono
            </Button>
          )}
          {reminder && (
            <a
              href={reminder}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-11 items-center gap-2 rounded-xl bg-surface-3 px-4 text-sm hover:bg-line-strong"
            >
              <MessageCircle className="size-4" aria-hidden />
              Recordar por WhatsApp
            </a>
          )}
          <Button variant="ghost" onClick={onEdit}>
            <Pencil className="size-4" aria-hidden />
            Editar datos
          </Button>
          {isManager && (balance <= 0 || !customer.is_active) && (
            <Button
              variant="ghost"
              loading={archive.isPending}
              onClick={() =>
                archive.mutate(
                  { id: customer.customer_id, active: !customer.is_active },
                  { onSuccess: onClose },
                )
              }
            >
              {customer.is_active ? (
                <Archive className="size-4" aria-hidden />
              ) : (
                <ArchiveRestore className="size-4" aria-hidden />
              )}
              {customer.is_active ? 'Archivar' : 'Volver a activar'}
            </Button>
          )}
        </div>
      )}

      <section>
        <h3 className="mb-2 text-sm font-medium text-fg-muted">Movimientos de la cuenta</h3>
        {isPending ? (
          <ListSkeleton rows={3} />
        ) : !ledger || ledger.length === 0 ? (
          <p className="text-sm text-fg-subtle">Este cliente no tiene compras fiadas.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line rounded-xl border border-line">
            {ledger.map((entry) => (
              <li key={`${entry.kind}-${entry.id}`} className="flex items-start gap-3 px-3 py-2.5 text-sm">
                <span className="min-w-0 flex-1">
                  {entry.kind === 'credit' ? (
                    <>
                      <span className="block">Fiado · pedido #{entry.orderNumber}</span>
                      <span className="text-xs text-fg-subtle">
                        {dayFormatter.format(new Date(`${entry.businessDate}T00:00:00Z`))}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="block">Abono · {entry.method}</span>
                      <span className="text-xs text-fg-subtle">
                        {formatDateTime(entry.at)}
                        {entry.by && ` · ${entry.by}`}
                        {entry.notes && ` · ${entry.notes}`}
                      </span>
                    </>
                  )}
                </span>
                <span className="text-right">
                  <span
                    className={cn(
                      'block tabular-nums',
                      entry.kind === 'credit' ? 'text-warning' : 'text-success',
                    )}
                  >
                    {entry.kind === 'credit' ? '+' : '−'} {formatCurrency(entry.amount)}
                  </span>
                  <span className="text-xs text-fg-subtle tabular-nums">
                    Saldo {formatCurrency(entry.balance)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function PaymentForm({
  customerId,
  balance,
  onCancel,
  onPaid,
}: {
  customerId: string
  balance: number
  onCancel: () => void
  onPaid: (payment: CustomerPaymentResult & { amount: number; method: string; at: Date }) => void
}) {
  const { activeBranch } = useStaff()
  const { data: methods = [], isLoading: loadingMethods } = useQuery(paymentMethodsQuery)
  const [amount, setAmount] = useState<number | null>(balance)
  const [method, setMethod] = useState('cash')
  const [notes, setNotes] = useState('')
  const pay = useSalesMutation(recordCustomerPayment, 'Abono registrado')
  const tooMuch = (amount ?? 0) > balance
  const valid = (amount ?? 0) > 0 && !tooMuch && Boolean(activeBranch)

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!valid || !activeBranch) return
    const paid = amount ?? 0
    pay.mutate(
      {
        customer_id: customerId,
        branch_id: activeBranch.id,
        amount: paid,
        method_code: method,
        notes: notes.trim(),
      },
      {
        onSuccess: (result) =>
          onPaid({
            ...result,
            amount: paid,
            method: methods.find((m) => m.code === method)?.name ?? method,
            at: new Date(),
          }),
      },
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4 rounded-xl border border-line bg-surface-2 p-4"
    >
      <h3 className="font-medium">Registrar abono</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Valor"
          error={tooMuch ? `No puede ser mayor que la deuda (${formatCurrency(balance)})` : undefined}
        >
          {(props) => <MoneyInput {...props} autoFocus value={amount} onValueChange={setAmount} />}
        </Field>
        <Field label="Cómo pagó">
          {(props) => (
            <Select
              {...props}
              value={method}
              onValueChange={setMethod}
              loading={loadingMethods}
              options={methods
                .filter((m) => m.kind !== 'credit')
                .map((m) => ({ value: m.code, label: m.name }))}
            />
          )}
        </Field>
      </div>
      <Field label="Nota (opcional)">
        {(props) => (
          <TextInput {...props} maxLength={200} value={notes} onChange={(e) => setNotes(e.target.value)} />
        )}
      </Field>
      <p className="text-xs text-fg-subtle">
        Entra al turno de caja abierto de {activeBranch?.name ?? 'esta sede'}
        {method === 'cash' ? ' y suma al efectivo esperado.' : '.'}
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={!valid} loading={pay.isPending}>
          Registrar abono
        </Button>
      </div>
    </form>
  )
}
