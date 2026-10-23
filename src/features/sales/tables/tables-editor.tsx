import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Eye, EyeOff, Plus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SelectInput, TextInput } from '@/components/ui/field'
import { Sheet } from '@/components/ui/sheet'
import { Spinner } from '@/components/ui/spinner'
import { toUserMessage } from '@/lib/errors'
import { cn } from '@/lib/cn'
import { saveTable, saveZone, seatingQuery } from '../sales-api'
import type { DiningTable, Zone } from '../types'

/**
 * Zones (salón, terraza…) and their tables. Tables are hidden instead of
 * deleted, because past orders point to them.
 */
export function TablesEditor({ branchId, onClose }: { branchId: string; onClose: () => void }) {
  const queryClient = useQueryClient()
  const { data } = useQuery(seatingQuery(branchId))
  const [busy, setBusy] = useState(false)

  async function run(action: () => Promise<void>, message?: string) {
    setBusy(true)
    try {
      await action()
      await queryClient.invalidateQueries({ queryKey: ['tables', branchId] })
      if (message) toast.success(message)
      return true
    } catch (error) {
      toast.error(toUserMessage(error))
      return false
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Editar mesas"
      description="Zonas del local y sus mesas, en el orden en que aparecen."
    >
      {!data ? (
        <Spinner />
      ) : (
        <div className="flex flex-col gap-8">
          <ZonesSection branchId={branchId} zones={data.zones} busy={busy} run={run} />
          <TablesSection branchId={branchId} zones={data.zones} tables={data.tables} busy={busy} run={run} />
        </div>
      )}
    </Sheet>
  )
}

type Run = (action: () => Promise<void>, message?: string) => Promise<boolean>

function ZonesSection({
  branchId,
  zones,
  busy,
  run,
}: {
  branchId: string
  zones: Zone[]
  busy: boolean
  run: Run
}) {
  const [name, setName] = useState('')

  async function add(event: FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    if (trimmed.length < 2) return
    const ok = await run(
      () => saveZone({ branch_id: branchId, name: trimmed, sort_order: zones.length + 1, is_active: true }),
      'Zona creada',
    )
    if (ok) setName('')
  }

  return (
    <section aria-labelledby="zones-heading" className="flex flex-col gap-3">
      <h3 id="zones-heading" className="font-semibold">
        Zonas
      </h3>
      <form onSubmit={(e) => void add(e)} className="flex gap-2">
        <TextInput
          aria-label="Nueva zona"
          placeholder="ej. Terraza"
          maxLength={40}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit" disabled={busy || name.trim().length < 2}>
          <Plus className="size-4" aria-hidden />
          Agregar
        </Button>
      </form>
      <ul className="flex flex-wrap gap-2">
        {zones.map((zone) => (
          <li key={zone.id}>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(
                  () => saveZone({ ...zone, branch_id: branchId, is_active: !zone.is_active }),
                  zone.is_active ? 'Zona oculta' : 'Zona visible',
                )
              }
              className={cn(
                'flex h-10 items-center gap-2 rounded-full border border-line px-4 text-sm',
                !zone.is_active && 'opacity-50',
              )}
              aria-label={`${zone.is_active ? 'Ocultar' : 'Mostrar'} la zona ${zone.name}`}
            >
              {zone.name}
              {zone.is_active ? (
                <Eye className="size-4" aria-hidden />
              ) : (
                <EyeOff className="size-4" aria-hidden />
              )}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function TablesSection({
  branchId,
  zones,
  tables,
  busy,
  run,
}: {
  branchId: string
  zones: Zone[]
  tables: DiningTable[]
  busy: boolean
  run: Run
}) {
  const [zoneId, setZoneId] = useState(zones[0]?.id ?? '')
  const [count, setCount] = useState('1')
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const activeZones = zones.filter((z) => z.is_active)

  // Adds N tables named after the zone ("Mesa 7", "Terraza 3"...), continuing the numbering.
  async function addTables(event: FormEvent) {
    event.preventDefault()
    const howMany = Math.min(Math.max(Number(count) || 1, 1), 30)
    const zone = zones.find((z) => z.id === zoneId)
    const prefix = !zone || zone.name.toLowerCase().startsWith('sal') ? 'Mesa' : zone.name
    const taken = new Set(tables.map((t) => t.name.toLowerCase()))
    const names: string[] = []
    for (let n = 1; names.length < howMany; n += 1) {
      const candidate = `${prefix} ${n}`
      if (!taken.has(candidate.toLowerCase())) names.push(candidate)
    }
    // Continue after the last position so new tables appear at the end.
    const start = tables.reduce((max, t) => Math.max(max, t.sort_order), 0)
    await run(
      async () => {
        for (const [index, tableName] of names.entries()) {
          await saveTable({
            branch_id: branchId,
            zone_id: zoneId || null,
            name: tableName,
            sort_order: start + index + 1,
            is_active: true,
          })
        }
      },
      names.length === 1 ? 'Mesa creada' : `${names.length} mesas creadas`,
    )
  }

  async function rename(event: FormEvent, table: DiningTable) {
    event.preventDefault()
    if (!renaming || renaming.name.trim().length < 1) return
    const ok = await run(
      () =>
        saveTable({
          id: table.id,
          branch_id: branchId,
          zone_id: table.zone_id,
          name: renaming.name.trim(),
          sort_order: table.sort_order,
          is_active: table.is_active,
        }),
      'Mesa actualizada',
    )
    if (ok) setRenaming(null)
  }

  return (
    <section aria-labelledby="tables-heading" className="flex flex-col gap-3">
      <h3 id="tables-heading" className="font-semibold">
        Mesas
      </h3>
      <form onSubmit={(e) => void addTables(e)} className="grid grid-cols-[1fr_5rem_auto] gap-2">
        <SelectInput aria-label="Zona" value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
          <option value="">Sin zona</option>
          {activeZones.map((z) => (
            <option key={z.id} value={z.id}>
              {z.name}
            </option>
          ))}
        </SelectInput>
        <TextInput
          aria-label="Cuántas mesas"
          inputMode="numeric"
          value={count}
          onChange={(e) => setCount(e.target.value.replace(/\D/g, '').slice(0, 2))}
        />
        <Button type="submit" disabled={busy}>
          <Plus className="size-4" aria-hidden />
          Agregar
        </Button>
      </form>

      <ul className="flex flex-col gap-2">
        {tables.map((table) => (
          <li
            key={table.id}
            className={cn(
              'flex items-center gap-2 rounded-xl bg-surface-2 py-1.5 pr-1.5 pl-4',
              !table.is_active && 'opacity-50',
            )}
          >
            {renaming?.id === table.id ? (
              <form className="flex flex-1 gap-2" onSubmit={(e) => void rename(e, table)}>
                <TextInput
                  autoFocus
                  aria-label="Nombre de la mesa"
                  maxLength={20}
                  value={renaming.name}
                  onChange={(e) => setRenaming({ id: table.id, name: e.target.value })}
                />
                <Button type="submit" size="icon" aria-label="Guardar nombre" disabled={busy}>
                  <Check className="size-4" aria-hidden />
                </Button>
              </form>
            ) : (
              <>
                <button
                  type="button"
                  className="flex-1 py-2 text-left"
                  onClick={() => setRenaming({ id: table.id, name: table.name })}
                  aria-label={`Renombrar ${table.name}`}
                >
                  {table.name}
                  <span className="ml-2 text-sm text-fg-subtle">{table.zones?.name ?? 'Sin zona'}</span>
                </button>
                {!table.is_active && <Badge>Oculta</Badge>}
                <Button
                  variant="ghost"
                  className="px-3 text-sm"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () =>
                        saveTable({
                          id: table.id,
                          branch_id: branchId,
                          zone_id: table.zone_id,
                          name: table.name,
                          sort_order: table.sort_order,
                          is_active: !table.is_active,
                        }),
                      table.is_active ? 'Mesa oculta' : 'Mesa visible',
                    )
                  }
                >
                  {table.is_active ? 'Ocultar' : 'Mostrar'}
                </Button>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
