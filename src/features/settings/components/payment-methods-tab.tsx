import { useQuery } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Plus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch, TextInput } from '@/components/ui/field'
import { ListSkeleton } from '@/components/ui/skeleton'
import { methodSettingsQuery, savePaymentMethod, type PaymentMethodSettings } from '../settings-api'
import { useSettingsMutation } from '../use-settings-mutation'

const KIND_LABEL = {
  cash: 'Suma al efectivo de la caja',
  digital: 'Va a una cuenta (no entra a la caja)',
  credit: 'Fiado: queda como deuda del cliente',
} as const

export function PaymentMethodsTab() {
  const { data: methods = [], isPending } = useQuery(methodSettingsQuery)
  const [name, setName] = useState('')
  const save = useSettingsMutation(savePaymentMethod)
  // Swapping two methods is two saves (each one audited), done one after the other.
  const reorder = useSettingsMutation(
    async (pair: { moved: string; changes: Parameters<typeof savePaymentMethod>[0][] }) => {
      for (const change of pair.changes) await savePaymentMethod(change)
    },
  )

  function handleAdd(event: FormEvent) {
    event.preventDefault()
    if (name.trim().length < 2) return
    const last = methods[methods.length - 1]?.sort_order ?? 0
    save.mutate(
      { name: name.trim(), is_active: true, sort_order: last + 1 },
      { onSuccess: () => setName('') },
    )
  }

  /** Swaps the order with the neighbour (two saves, each one audited). */
  function move(index: number, direction: -1 | 1) {
    const a = methods[index]
    const b = methods[index + direction]
    if (!a || !b) return
    reorder.mutate({
      moved: `${a.code}:${direction}`,
      changes: [
        { code: a.code, name: a.name, is_active: a.is_active, sort_order: b.sort_order },
        { code: b.code, name: b.name, is_active: b.is_active, sort_order: a.sort_order },
      ],
    })
  }

  if (isPending) return <ListSkeleton rows={5} className="max-w-2xl" />

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <p className="text-sm text-fg-muted">
        Así aparecen al cobrar, en este orden. Los que apagues dejan de salir, pero las ventas viejas los
        conservan.
      </p>
      <ul className="flex flex-col divide-y divide-line rounded-card border border-line bg-surface">
        {methods.map((method, index) => (
          <MethodRow
            key={method.code}
            method={method}
            first={index === 0}
            last={index === methods.length - 1}
            moving={reorder.isPending ? reorder.variables.moved : null}
            onMove={(direction) => move(index, direction)}
          />
        ))}
      </ul>
      <form onSubmit={handleAdd} className="flex gap-2">
        <TextInput
          aria-label="Nuevo medio de pago"
          placeholder="Nuevo medio (ej. Bancolombia QR)"
          maxLength={30}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit" disabled={name.trim().length < 2} loading={save.isPending}>
          <Plus className="size-4" aria-hidden />
          Agregar
        </Button>
      </form>
    </div>
  )
}

function MethodRow({
  method,
  first,
  last,
  moving,
  onMove,
}: {
  method: PaymentMethodSettings
  first: boolean
  last: boolean
  /** "code:direction" of the arrow being saved, or null. */
  moving: string | null
  onMove: (direction: -1 | 1) => void
}) {
  const [name, setName] = useState(method.name)
  const save = useSettingsMutation(savePaymentMethod, 'Medio de pago guardado')
  const changed = name.trim() !== method.name && name.trim().length >= 2
  const savingSwitch = save.isPending && save.variables.is_active !== method.is_active
  const savingName = save.isPending && !savingSwitch

  return (
    <li className="flex flex-wrap items-center gap-3 p-3">
      <div className="flex flex-col">
        <Button
          variant="ghost"
          size="icon"
          className="h-6"
          aria-label={`Subir ${method.name}`}
          disabled={first || (moving !== null && moving !== `${method.code}:-1`)}
          loading={moving === `${method.code}:-1`}
          onClick={() => onMove(-1)}
        >
          <ArrowUp className="size-3.5" aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6"
          aria-label={`Bajar ${method.name}`}
          disabled={last || (moving !== null && moving !== `${method.code}:1`)}
          loading={moving === `${method.code}:1`}
          onClick={() => onMove(1)}
        >
          <ArrowDown className="size-3.5" aria-hidden />
        </Button>
      </div>
      <div className="min-w-[10rem] flex-1">
        <TextInput
          aria-label={`Nombre de ${method.name}`}
          maxLength={30}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <p className="mt-1 px-1 text-xs text-fg-subtle">{KIND_LABEL[method.kind]}</p>
      </div>
      {changed && (
        <Button
          variant="secondary"
          loading={savingName}
          disabled={savingSwitch}
          onClick={() =>
            save.mutate({
              code: method.code,
              name: name.trim(),
              is_active: method.is_active,
              sort_order: method.sort_order,
            })
          }
        >
          Guardar
        </Button>
      )}
      {method.kind === 'cash' ? (
        <Badge>Siempre activo</Badge>
      ) : (
        <Switch
          label={method.is_active ? 'Activo' : 'Apagado'}
          checked={method.is_active}
          loading={savingSwitch}
          disabled={savingName}
          onCheckedChange={(is_active) =>
            save.mutate({ code: method.code, name: method.name, is_active, sort_order: method.sort_order })
          }
        />
      )}
    </li>
  )
}
