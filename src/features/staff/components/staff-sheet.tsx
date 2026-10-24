import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Eye, EyeOff, KeyRound } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Field, SelectInput, Switch, TextInput } from '@/components/ui/field'
import { Sheet } from '@/components/ui/sheet'
import { useStaff } from '@/features/auth/use-staff'
import type { AppRole } from '@/types/app'
import {
  BRANCH_ROLES,
  createStaff,
  pinProblem,
  ROLE_HELP,
  ROLE_LABELS,
  suggestUsername,
  updateStaff,
  type StaffMember,
} from '../staff-api'

const ROLES: AppRole[] = ['cashier', 'waiter', 'kitchen', 'admin', 'owner']

function useStaffMutation<TInput, TResult>(fn: (input: TInput) => Promise<TResult>, message: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['staff'] })
      void queryClient.invalidateQueries({ queryKey: ['staff-context'] })
      toast.success(message)
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'No se pudo guardar'),
  })
}

function PinInput({
  value,
  onChange,
  label,
}: {
  value: string
  onChange: (v: string) => void
  label: string
}) {
  const [visible, setVisible] = useState(false)
  const problem = value.length === 6 ? pinProblem(value) : null
  return (
    <Field label={label} hint="6 números. Es su clave para entrar." error={problem ?? undefined}>
      {(props) => (
        <div className="relative">
          <TextInput
            {...props}
            type={visible ? 'text' : 'password'}
            inputMode="numeric"
            autoComplete="new-password"
            maxLength={6}
            className="pr-12 tracking-[0.4em]"
            value={value}
            onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
          />
          <button
            type="button"
            aria-label={visible ? 'Ocultar PIN' : 'Mostrar PIN'}
            onClick={() => setVisible(!visible)}
            className="absolute top-1/2 right-1 grid size-10 -translate-y-1/2 place-items-center text-fg-subtle hover:text-fg"
          >
            {visible ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
          </button>
        </div>
      )}
    </Field>
  )
}

interface StaffSheetProps {
  member: StaffMember | null
  onClose: () => void
}

export function StaffSheet({ member, onClose }: StaffSheetProps) {
  const { branches, profile } = useStaff()
  const isSelf = member?.id === profile.id
  const [fullName, setFullName] = useState(member?.full_name ?? '')
  const [username, setUsername] = useState(member?.username ?? '')
  const [usernameTouched, setUsernameTouched] = useState(false)
  const [role, setRole] = useState<AppRole>(member?.role ?? 'cashier')
  const [branchId, setBranchId] = useState(member?.branch_id ?? branches[0]?.id ?? '')
  const [active, setActive] = useState(member?.is_active ?? true)
  const [pin, setPin] = useState('')
  const [changingPin, setChangingPin] = useState(!member)

  const create = useStaffMutation(createStaff, 'Empleado creado. Ya puede entrar con su usuario y PIN.')
  const update = useStaffMutation(updateStaff, 'Cambios guardados')

  const needsBranch = BRANCH_ROLES.includes(role)
  const branchOptions = role === 'waiter' ? branches.filter((b) => b.uses_waiters) : branches
  const branchOk = !needsBranch || branchOptions.some((b) => b.id === branchId)

  const problem =
    fullName.trim().length < 2
      ? 'Escribe el nombre'
      : !member && !/^[a-z0-9._-]{3,30}$/.test(username)
        ? 'El usuario debe tener de 3 a 30 letras minúsculas (sin espacios)'
        : !branchOk
          ? role === 'waiter'
            ? 'Los meseros solo trabajan en sedes con mesas'
            : 'Elige la sede'
          : changingPin && pinProblem(pin)
            ? (pinProblem(pin) ?? '')
            : null

  function save() {
    const branch = needsBranch ? branchId : null
    if (!member) {
      create.mutate(
        { username, full_name: fullName.trim(), role, branch_id: branch, pin },
        { onSuccess: onClose },
      )
      return
    }
    update.mutate(
      {
        id: member.id,
        full_name: fullName.trim(),
        role,
        branch_id: branch,
        is_active: active,
        ...(changingPin ? { pin } : {}),
      },
      { onSuccess: onClose },
    )
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={member ? member.full_name : 'Nuevo empleado'}
      description={member ? `Usuario: ${member.username}` : 'Entrará con su usuario y un PIN de 6 números.'}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-3">
          {problem && <p className="mr-auto text-sm text-fg-subtle">{problem}</p>}
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={Boolean(problem)} loading={create.isPending || update.isPending} onClick={save}>
            {member ? 'Guardar cambios' : 'Crear empleado'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <Field label="Nombre completo">
          {(props) => (
            <TextInput
              {...props}
              autoFocus={!member}
              maxLength={80}
              value={fullName}
              onChange={(e) => {
                setFullName(e.target.value)
                if (!member && !usernameTouched) setUsername(suggestUsername(e.target.value))
              }}
            />
          )}
        </Field>
        {!member && (
          <Field label="Usuario para entrar" hint="Minúsculas, sin espacios. No se puede cambiar después.">
            {(props) => (
              <TextInput
                {...props}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                maxLength={30}
                value={username}
                onChange={(e) => {
                  setUsernameTouched(true)
                  setUsername(e.target.value.toLowerCase().replace(/\s/g, ''))
                }}
              />
            )}
          </Field>
        )}
        <Field label="Rol" hint={ROLE_HELP[role]}>
          {(props) => (
            <SelectInput
              {...props}
              value={role}
              disabled={isSelf}
              onChange={(e) => setRole(e.target.value as AppRole)}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </SelectInput>
          )}
        </Field>
        {needsBranch && (
          <Field label="Sede donde trabaja">
            {(props) => (
              <SelectInput {...props} value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                <option value="" disabled>
                  Elegir…
                </option>
                {branchOptions.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </SelectInput>
            )}
          </Field>
        )}

        {member && !changingPin ? (
          <Button variant="secondary" className="self-start" onClick={() => setChangingPin(true)}>
            <KeyRound className="size-4" aria-hidden />
            Cambiar PIN
          </Button>
        ) : (
          <PinInput label={member ? 'PIN nuevo' : 'PIN'} value={pin} onChange={setPin} />
        )}

        {member && !isSelf && (
          <Switch
            label="Puede entrar al sistema"
            description={
              active
                ? 'Si lo desactivas no podrá entrar, pero su historial se conserva.'
                : 'Está desactivado: no puede entrar.'
            }
            checked={active}
            onCheckedChange={setActive}
          />
        )}
      </div>
    </Sheet>
  )
}
