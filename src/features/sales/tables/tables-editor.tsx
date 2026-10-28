import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Eye, EyeOff, Plus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TextInput } from '@/components/ui/field'
import { Select } from '@/components/ui/select'
import { Sheet } from '@/components/ui/sheet'
import { ListSkeleton } from '@/components/ui/skeleton'
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
  // Which action is saving ("add-zone", "table:<id>"…): only that button spins, the rest wait.
  const [pending, setPending] = useState<string | null>(null)

  async function run(key: string, action: () => Promise<void>, message?: string) {
    setPending(key)
    try {
      await action()
      await queryClient.invalidateQueries({ queryKey: ['tables', branchId] })
      if (message) toast.success(message)
      return true
    } catch (error) {
      toast.error(toUserMessage(error))
      return false
    } finally {
      setPending(null)
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
        <ListSkeleton rows={5} />
      ) : (
        <div className="flex flex-col gap-8">
          <ZonesSection branchId={branchId} zones={data.zones} pending={pending} run={run} />
          <TablesSection
            branchId={branchId}
            zones={data.zones}
            tables={data.tables}
            pending={pending}
            run={run}
          />
        </div>
      )}
    </Sheet>
  )
}

type Run = (key: string, action: () => Promise<void>, message?: string) => Promise<boolean>

function ZonesSection({
  branchId,
  zones,
  pending,
  run,
}: {
  branchId: string
  zones: Zone[]
  pending: string | null
  run: Run
}) {
  const [name, setName] = useState('')

  async function add(event: FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    if (trimmed.length < 2) return
    const ok = await run(
      'add-zone',
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
        <Button
          type="submit"
          loading={pending === 'add-zone'}
          disabled={pending !== null || name.trim().length < 2}
        >
          <Plus className="size-4" aria-hidden />
          Agregar
        </Button>
      </form>
      <ul className="flex flex-wrap gap-2">
        {zones.map((zone) => (
          <li key={zone.id}>
            <button
              type="button"
              disabled={pending !== null}
              aria-busy={pending === `zone:${zone.id}` || undefined}
              onClick={() =>
                void run(
                  `zone:${zone.id}`,
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
              {pending === `zone:${zone.id}` ? (
                <Spinner className="size-4" />
              ) : zone.is_active ? (
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
  pending,
  run,
}: {
  branchId: string
  zones: Zone[]
  tables: DiningTable[]
  pending: string | null
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
      'add-tables',
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
      `rename:${table.id}`,
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
        <Select
          aria-label="Zona"
          value={zoneId}
          onValueChange={setZoneId}
          options={[
            { value: '', label: 'Sin zona' },
            ...activeZones.map((z) => ({ value: z.id, label: z.name })),
          ]}
        />
        <TextInput
          aria-label="Cuántas mesas"
          inputMode="numeric"
          value={count}
          onChange={(e) => setCount(e.target.value.replace(/\D/g, '').slice(0, 2))}
        />
        <Button type="submit" loading={pending === 'add-tables'} disabled={pending !== null}>
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
                <Button
                  type="submit"
                  size="icon"
                  aria-label="Guardar nombre"
                  loading={pending === `rename:${table.id}`}
                  disabled={pending !== null}
                >
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
                  loading={pending === `table:${table.id}`}
                  disabled={pending !== null}
                  onClick={() =>
                    void run(
                      `table:${table.id}`,
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
