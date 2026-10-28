import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, Switch, TextInput } from '@/components/ui/field'
import { Select } from '@/components/ui/select'
import { CardsSkeleton } from '@/components/ui/skeleton'
import { branchSettingsQuery, updateBranch, type BranchSettings } from '../settings-api'
import { useSettingsMutation } from '../use-settings-mutation'

// The business day can end between midnight and 8 a.m.
const CUTOFFS = ['00:00', '01:00', '02:00', '03:00', '04:00', '05:00', '06:00', '07:00', '08:00']

export function BranchesTab() {
  const { data: branches = [], isPending } = useQuery(branchSettingsQuery)
  if (isPending) return <CardsSkeleton />
  return (
    <div className="flex flex-col gap-4">
      {branches.map((branch) => (
        <BranchCard key={branch.id} branch={branch} />
      ))}
      <Link
        to="/tables"
        className="inline-flex items-center gap-1 self-start text-sm text-fg-muted underline-offset-4 hover:text-fg hover:underline"
      >
        Las zonas y mesas se editan en Mesas
        <ArrowRight className="size-3.5" aria-hidden />
      </Link>
    </div>
  )
}

function BranchCard({ branch }: { branch: BranchSettings }) {
  const [name, setName] = useState(branch.name)
  const [waiters, setWaiters] = useState(branch.uses_waiters)
  const [delivery, setDelivery] = useState(branch.takes_delivery)
  const [cutoff, setCutoff] = useState(branch.day_cutoff.slice(0, 5))
  const save = useSettingsMutation(updateBranch, 'Sede guardada')

  const changed =
    name.trim() !== branch.name ||
    waiters !== branch.uses_waiters ||
    delivery !== branch.takes_delivery ||
    cutoff !== branch.day_cutoff.slice(0, 5)

  return (
    <section className="flex flex-col gap-5 rounded-card border border-line bg-surface p-5">
      <header className="flex items-center gap-2">
        <h2 className="font-semibold">{branch.name}</h2>
        {branch.is_main && <Badge>Principal · compra y envía</Badge>}
      </header>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nombre">
          {(props) => (
            <TextInput {...props} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          )}
        </Field>
        <Field
          label="El día de ventas termina a las"
          hint="Lo vendido de madrugada antes de esta hora cuenta para el día anterior."
        >
          {(props) => (
            <Select
              {...props}
              value={cutoff}
              onValueChange={setCutoff}
              searchable={false}
              options={CUTOFFS.map((c) => ({
                value: c,
                label: c === '00:00' ? '12:00 a. m. (medianoche)' : `${Number(c.slice(0, 2))}:00 a. m.`,
              }))}
            />
          )}
        </Field>
      </div>
      <div className="flex flex-col gap-3">
        <Switch
          label="Trabaja con mesas y meseros"
          description="Muestra Mesas y deja crear empleados con rol de mesero en esta sede."
          checked={waiters}
          onCheckedChange={setWaiters}
        />
        <Switch
          label="Recibe domicilios"
          description="Pedidos por WhatsApp o llamada con dirección y valor del domicilio."
          checked={delivery}
          onCheckedChange={setDelivery}
        />
      </div>
      {changed && (
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              setName(branch.name)
              setWaiters(branch.uses_waiters)
              setDelivery(branch.takes_delivery)
              setCutoff(branch.day_cutoff.slice(0, 5))
            }}
          >
            Descartar
          </Button>
          <Button
            disabled={name.trim().length < 2}
            loading={save.isPending}
            onClick={() =>
              save.mutate({
                id: branch.id,
                name: name.trim(),
                uses_waiters: waiters,
                takes_delivery: delivery,
                day_cutoff: cutoff,
              })
            }
          >
            Guardar sede
          </Button>
        </div>
      )}
    </section>
  )
}
