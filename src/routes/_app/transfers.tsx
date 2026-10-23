import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { ArrowLeftRight, PackageCheck, Send, Truck } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Badge, type BadgeTone } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, QuantityInput, SelectInput, TextArea } from '@/components/ui/field'
import { ReasonDialog } from '@/components/ui/reason-dialog'
import { Sheet } from '@/components/ui/sheet'
import { Spinner } from '@/components/ui/spinner'
import { requireModule } from '@/features/auth/require-module'
import { useStaff } from '@/features/auth/use-staff'
import { catalogQuery } from '@/features/catalog/catalog-api'
import { formatStock, UNITS } from '@/features/catalog/units'
import { newLine, SupplyLines, toBase, type DraftLine } from '@/features/inventory/components/supply-lines'
import {
  branchesQuery,
  cancelTransfer,
  createTransfer,
  receiveTransfer,
  stockQuery,
  transfersQuery,
  type Transfer,
  type TransferStatus,
} from '@/features/inventory/inventory-api'
import { useInventoryMutation } from '@/features/inventory/use-inventory-mutation'
import { cn } from '@/lib/cn'
import { formatDateTime } from '@/lib/format'
import type { Branch } from '@/types/app'

export const Route = createFileRoute('/_app/transfers')({
  beforeLoad: requireModule('transfers'),
  component: TransfersScreen,
})

const STATUS: Record<TransferStatus, { label: string; tone: BadgeTone }> = {
  sent: { label: 'Por recibir', tone: 'warning' },
  received: { label: 'Recibido completo', tone: 'success' },
  received_with_issues: { label: 'Recibido con diferencias', tone: 'danger' },
  cancelled: { label: 'Cancelado', tone: 'neutral' },
}

function TransfersScreen() {
  const { activeBranch } = useStaff()
  if (!activeBranch) return null
  return <Transfers key={activeBranch.id} branch={activeBranch} />
}

function Transfers({ branch }: { branch: Branch }) {
  const { data: transfers = [], isPending } = useQuery(transfersQuery(branch.id))
  const [creating, setCreating] = useState(false)
  const [receiving, setReceiving] = useState<Transfer | null>(null)
  const [cancelling, setCancelling] = useState<Transfer | null>(null)
  const cancel = useInventoryMutation(
    ({ id, reason }: { id: string; reason: string }) => cancelTransfer(id, reason),
    'Envío cancelado: la mercancía volvió al inventario',
  )

  const incoming = transfers.filter((t) => t.to_branch_id === branch.id && t.status === 'sent')

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6 lg:p-10">
      <header className="flex flex-wrap items-center gap-4">
        <span className="grid size-12 place-items-center rounded-2xl bg-surface-2">
          <ArrowLeftRight className="size-6" aria-hidden />
        </span>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Envíos entre sedes</h1>
          <p className="text-fg-muted">{branch.name}</p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Send className="size-4" aria-hidden />
          Nuevo envío
        </Button>
      </header>

      {incoming.length > 0 && (
        <section aria-labelledby="incoming-heading" className="flex flex-col gap-3">
          <h2 id="incoming-heading" className="flex items-center gap-2 font-semibold">
            <Truck className="size-5 text-warning" aria-hidden />
            Por recibir ({incoming.length})
          </h2>
          {incoming.map((transfer) => (
            <article
              key={transfer.id}
              className="flex flex-wrap items-center gap-4 rounded-card border border-warning/50 bg-warning-soft p-4"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  Desde {transfer.from_branch.name} · {transfer.transfer_items.length}{' '}
                  {transfer.transfer_items.length === 1 ? 'insumo' : 'insumos'}
                </p>
                <p className="text-sm text-fg-muted">
                  Enviado {formatDateTime(transfer.sent_at)}
                  {transfer.sender && ` por ${transfer.sender.full_name}`}
                </p>
              </div>
              <Button size="lg" onClick={() => setReceiving(transfer)}>
                <PackageCheck className="size-5" aria-hidden />
                Revisar y recibir
              </Button>
            </article>
          ))}
        </section>
      )}

      <section aria-labelledby="history-heading" className="flex flex-col gap-3">
        <h2 id="history-heading" className="font-semibold">
          Historial
        </h2>
        {isPending ? (
          <Spinner />
        ) : transfers.length === 0 ? (
          <p className="p-8 text-center text-fg-muted">Aún no hay envíos.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {transfers.map((transfer) => {
              const outgoing = transfer.from_branch_id === branch.id
              return (
                <li
                  key={transfer.id}
                  className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4"
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">
                        {outgoing ? `Para ${transfer.to_branch.name}` : `Desde ${transfer.from_branch.name}`}
                      </span>
                      <span className="text-sm text-fg-subtle">{formatDateTime(transfer.sent_at)}</span>
                    </span>
                    <Badge tone={STATUS[transfer.status].tone}>{STATUS[transfer.status].label}</Badge>
                    {outgoing && transfer.status === 'sent' && (
                      <Button variant="ghost" className="text-danger" onClick={() => setCancelling(transfer)}>
                        Cancelar
                      </Button>
                    )}
                  </div>
                  <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-fg-muted">
                    {transfer.transfer_items.map((item) => {
                      const short =
                        item.quantity_received !== null && item.quantity_received < item.quantity_sent
                      return (
                        <li key={item.supply_id} className={cn(short && 'text-danger')}>
                          {item.supplies.name}: {formatStock(item.supplies.unit, item.quantity_sent)}
                          {item.quantity_received !== null &&
                            item.quantity_received !== item.quantity_sent &&
                            ` → llegó ${formatStock(item.supplies.unit, item.quantity_received)}`}
                        </li>
                      )
                    })}
                  </ul>
                  {transfer.receive_notes && (
                    <p className="text-sm text-fg-muted">» {transfer.receive_notes}</p>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {creating && <NewTransferSheet branch={branch} onClose={() => setCreating(false)} />}
      {receiving && (
        <ReceiveSheet key={receiving.id} transfer={receiving} onClose={() => setReceiving(null)} />
      )}
      <ReasonDialog
        open={cancelling !== null}
        title="Cancelar envío"
        description="La mercancía vuelve al inventario de esta sede."
        confirmLabel="Cancelar envío"
        suggestions={['Se envió por error', 'Cambio de planes']}
        loading={cancel.isPending}
        onCancel={() => setCancelling(null)}
        onConfirm={(reason) =>
          cancelling && cancel.mutate({ id: cancelling.id, reason }, { onSuccess: () => setCancelling(null) })
        }
      />
    </div>
  )
}

function NewTransferSheet({ branch, onClose }: { branch: Branch; onClose: () => void }) {
  const { data: catalog } = useQuery(catalogQuery)
  const { data: branches = [] } = useQuery(branchesQuery)
  const { data: stock = [] } = useQuery(stockQuery(branch.id))
  const destinations = branches.filter((b) => b.id !== branch.id)
  const [toBranchId, setToBranchId] = useState('')
  const [lines, setLines] = useState<DraftLine[]>(() => [newLine()])
  const [notes, setNotes] = useState('')

  const supplies = useMemo(() => (catalog?.supplies ?? []).filter((s) => s.is_active), [catalog])
  const suppliesById = useMemo(() => new Map(supplies.map((s) => [s.id, s])), [supplies])
  const available = useMemo(() => new Map(stock.map((s) => [s.supply_id, s.quantity])), [stock])
  const destination = toBranchId || destinations[0]?.id || ''

  const send = useInventoryMutation(createTransfer, 'Envío registrado')
  const ready = destination && lines.every((l) => l.supplyId && l.quantity && l.quantity > 0)

  return (
    <Sheet
      open
      onClose={onClose}
      size="lg"
      title="Nuevo envío"
      description="Lo enviado sale del inventario de esta sede y queda pendiente hasta que la otra sede lo reciba."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={!ready}
            loading={send.isPending}
            onClick={() =>
              send.mutate(
                {
                  from_branch_id: branch.id,
                  to_branch_id: destination,
                  notes: notes.trim(),
                  items: lines.map((l) => ({
                    supply_id: l.supplyId,
                    quantity: toBase(l, suppliesById, l.quantity),
                  })),
                },
                { onSuccess: onClose },
              )
            }
          >
            <Send className="size-4" aria-hidden />
            Enviar
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        {destinations.length > 1 && (
          <Field label="Para">
            {(props) => (
              <SelectInput {...props} value={destination} onChange={(e) => setToBranchId(e.target.value)}>
                {destinations.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </SelectInput>
            )}
          </Field>
        )}
        {destinations.length === 1 && (
          <p className="text-fg-muted">
            Para <b className="text-fg">{destinations[0]?.name}</b>
          </p>
        )}
        <SupplyLines lines={lines} onChange={setLines} supplies={supplies} available={available} />
        <TextArea
          aria-label="Notas del envío"
          placeholder="Notas (opcional)"
          maxLength={280}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
    </Sheet>
  )
}

/** The receiving branch checks what actually arrived before it enters its inventory. */
function ReceiveSheet({ transfer, onClose }: { transfer: Transfer; onClose: () => void }) {
  const [received, setReceived] = useState<Record<string, number | null>>(() =>
    Object.fromEntries(
      transfer.transfer_items.map((i) => [i.supply_id, i.quantity_sent / UNITS[i.supplies.unit].factor]),
    ),
  )
  const [notes, setNotes] = useState('')
  const receive = useInventoryMutation(
    () =>
      receiveTransfer(
        transfer.id,
        transfer.transfer_items.map((i) => ({
          supply_id: i.supply_id,
          quantity_received: (received[i.supply_id] ?? 0) * UNITS[i.supplies.unit].factor,
        })),
        notes.trim(),
      ),
    (status) => (status === 'received' ? 'Envío recibido completo' : 'Envío recibido con diferencias'),
  )

  const differences = transfer.transfer_items.filter(
    (i) => Math.abs((received[i.supply_id] ?? 0) * UNITS[i.supplies.unit].factor - i.quantity_sent) > 0.0001,
  )
  const needsNote = differences.length > 0 && notes.trim().length < 3

  return (
    <Sheet
      open
      onClose={onClose}
      title={`Recibir envío de ${transfer.from_branch.name}`}
      description="Cuenta lo que llegó. Si algo no llegó completo, corrige la cantidad y explica qué pasó."
      footer={
        <div className="flex flex-col gap-2">
          {needsNote && (
            <p className="text-sm text-warning">Escribe qué pasó con lo que no llegó completo.</p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              disabled={needsNote}
              loading={receive.isPending}
              onClick={() => receive.mutate(undefined, { onSuccess: onClose })}
            >
              <PackageCheck className="size-4" aria-hidden />
              {differences.length > 0 ? 'Recibir con diferencias' : 'Recibir todo'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <ul className="flex flex-col gap-2">
          {transfer.transfer_items.map((item) => {
            const info = UNITS[item.supplies.unit]
            const value = received[item.supply_id] ?? null
            const differs = differences.some((d) => d.supply_id === item.supply_id)
            return (
              <li
                key={item.supply_id}
                className={cn(
                  'flex items-center gap-3 rounded-xl border p-3',
                  differs ? 'border-danger/60 bg-danger-soft' : 'border-line bg-surface-2',
                )}
              >
                <div className="min-w-0 flex-1">
                  <label htmlFor={`recv-${item.supply_id}`} className="font-medium">
                    {item.supplies.name}
                  </label>
                  <p className="text-sm text-fg-muted">
                    Enviado: {formatStock(item.supplies.unit, item.quantity_sent)}
                  </p>
                </div>
                <div className="w-32">
                  <QuantityInput
                    id={`recv-${item.supply_id}`}
                    value={value}
                    suffix={info.bulk}
                    onValueChange={(v) => setReceived((current) => ({ ...current, [item.supply_id]: v }))}
                  />
                </div>
              </li>
            )
          })}
        </ul>
        <Field label={differences.length > 0 ? 'Qué pasó (obligatorio)' : 'Notas (opcional)'}>
          {(props) => (
            <TextArea {...props} maxLength={280} value={notes} onChange={(e) => setNotes(e.target.value)} />
          )}
        </Field>
      </div>
    </Sheet>
  )
}
