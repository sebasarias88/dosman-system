import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Pencil, UserCog, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { requireModule } from '@/features/auth/require-module'
import { useStaff } from '@/features/auth/use-staff'
import { StaffSheet } from '@/features/staff/components/staff-sheet'
import { ROLE_LABELS, staffQuery, type StaffMember } from '@/features/staff/staff-api'
import { cn } from '@/lib/cn'

export const Route = createFileRoute('/_app/staff')({
  beforeLoad: requireModule('staff'),
  component: StaffScreen,
})

type Editing = StaffMember | 'new' | null

function StaffScreen() {
  const { branches, profile } = useStaff()
  const { data: members = [], isPending } = useQuery(staffQuery)
  const [editing, setEditing] = useState<Editing>(null)
  const branchName = (id: string | null) =>
    id ? (branches.find((b) => b.id === id)?.name ?? 'Otra sede') : 'Todas las sedes'

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6 lg:p-10">
      <header className="flex flex-wrap items-center gap-4">
        <span className="grid size-12 place-items-center rounded-2xl bg-surface-2">
          <UserCog className="size-6" aria-hidden />
        </span>
        <div className="min-w-[12rem] flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Empleados</h1>
          <p className="text-fg-muted">Quién entra al sistema, con qué rol y en qué sede.</p>
        </div>
        <Button onClick={() => setEditing('new')}>
          <UserPlus className="size-4" aria-hidden />
          Nuevo empleado
        </Button>
      </header>

      {isPending ? (
        <Spinner />
      ) : (
        <ul className="flex flex-col gap-2">
          {members.map((member) => (
            <li
              key={member.id}
              className={cn(
                'flex flex-wrap items-center gap-3 rounded-card border border-line bg-surface p-4',
                !member.is_active && 'opacity-60',
              )}
            >
              <span
                className="grid size-11 shrink-0 place-items-center rounded-full bg-surface-3 font-semibold"
                aria-hidden
              >
                {member.full_name.charAt(0).toUpperCase()}
              </span>
              <span className="min-w-[10rem] flex-1">
                <span className="block font-medium">
                  {member.full_name}
                  {member.id === profile.id && <span className="text-fg-subtle"> (tú)</span>}
                </span>
                <span className="text-sm text-fg-subtle">
                  {member.username} · {branchName(member.branch_id)}
                </span>
              </span>
              <Badge tone={member.role === 'owner' ? 'success' : 'neutral'}>{ROLE_LABELS[member.role]}</Badge>
              {!member.is_active && <Badge tone="danger">Desactivado</Badge>}
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Editar ${member.full_name}`}
                onClick={() => setEditing(member)}
              >
                <Pencil className="size-4" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <p className="text-sm text-fg-subtle">
        Los empleados no se borran: al desactivarlos no pueden entrar, pero sus ventas y movimientos siguen en
        el historial. Si alguien olvida su PIN, entra aquí y ponle uno nuevo.
      </p>

      {editing && (
        <StaffSheet
          key={editing === 'new' ? 'new' : editing.id}
          member={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}
