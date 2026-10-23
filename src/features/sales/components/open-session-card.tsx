import { Wallet } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Field, MoneyInput } from '@/components/ui/field'
import { openCashSession } from '../sales-api'
import { useSalesMutation } from '../use-sales-mutation'

/** Shown wherever money is handled while the branch has no open cash session. */
export function OpenSessionCard({ branchId, branchName }: { branchId: string; branchName: string }) {
  const [opening, setOpening] = useState<number | null>(null)
  const open = useSalesMutation(
    (amount: number) => openCashSession(branchId, amount),
    'Turno de caja abierto',
  )

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (opening !== null) open.mutate(opening)
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mx-auto flex w-full max-w-md flex-col gap-5 rounded-card border border-line bg-surface p-6"
    >
      <span className="grid size-12 place-items-center rounded-2xl bg-surface-2">
        <Wallet className="size-6" aria-hidden />
      </span>
      <div>
        <h2 className="text-xl font-semibold">La caja está cerrada</h2>
        <p className="text-fg-muted">
          Abre el turno de {branchName} para empezar a vender. Cuenta el dinero con el que inicia la caja.
        </p>
      </div>
      <Field label="Base de caja (efectivo inicial)">
        {(props) => (
          <MoneyInput {...props} className="h-14 text-xl" value={opening} onValueChange={setOpening} />
        )}
      </Field>
      <Button type="submit" size="lg" disabled={opening === null} loading={open.isPending}>
        Abrir turno
      </Button>
    </form>
  )
}
