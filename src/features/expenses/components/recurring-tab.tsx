import { useQuery } from '@tanstack/react-query'
import { CalendarClock, Pencil, Plus } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Field, MoneyInput, Switch, TextInput } from '@/components/ui/field'
import { Select } from '@/components/ui/select'
import { Sheet } from '@/components/ui/sheet'
import { CardsSkeleton, ListSkeleton } from '@/components/ui/skeleton'
import { useStaff } from '@/features/auth/use-staff'
import { cn } from '@/lib/cn'
import { formatCurrency } from '@/lib/format'
import {
  expenseCategoriesQuery,
  recurringQuery,
  removeRecurring,
  saveRecurring,
  type RecurringExpense,
} from '../expenses-api'
import { useExpenseMutation } from '../use-expense-mutation'
import { SHARED } from './expense-sheet'

type Editing = RecurringExpense | 'new' | null

/** Fixed monthly expenses: the system enters them alone on their day of the month. */
export function RecurringTab() {
  const { data: items = [], isPending } = useQuery(recurringQuery)
  const [editing, setEditing] = useState<Editing>(null)

  if (isPending)
    return (
      <div className="flex flex-col gap-5">
        <CardsSkeleton cards={1} />
        <ListSkeleton rows={3} />
      </div>
    )
  const monthly = items.filter((i) => i.is_active).reduce((sum, i) => sum + i.amount, 0)

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-4 rounded-card border border-line bg-surface p-5">
        <CalendarClock className="size-8 text-fg-subtle" aria-hidden />
        <div className="min-w-[14rem] flex-1">
          <p className="text-sm text-fg-muted">Gastos fijos de cada mes</p>
          <p className="text-2xl font-semibold tabular-nums">{formatCurrency(monthly)}</p>
          <p className="text-sm text-fg-subtle">
            Se registran solos el día indicado. Si un mes cambia el valor (ej. la luz), anula ese gasto y
            registra el valor real.
          </p>
        </div>
        <Button onClick={() => setEditing('new')}>
          <Plus className="size-4" aria-hidden />
          Nuevo gasto fijo
        </Button>
      </div>

      {items.length === 0 ? (
        <p className="p-8 text-center text-fg-muted">
          Aún no hay gastos fijos. Agrega el arriendo, la nómina o el internet.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li
              key={item.id}
              className={cn(
                'flex flex-wrap items-center gap-3 rounded-card border border-line bg-surface p-4',
                !item.is_active && 'opacity-60',
              )}
            >
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-surface-2 text-sm font-semibold tabular-nums">
                {item.day_of_month}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{item.name}</span>
                <span className="text-sm text-fg-subtle">
                  Día {item.day_of_month} · {item.expense_categories.name} ·{' '}
                  {item.branches?.name ?? 'Compartido'}
                </span>
              </span>
              {!item.is_active && <Badge>Pausado</Badge>}
              <span className="font-semibold tabular-nums">{formatCurrency(item.amount)}</span>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Editar ${item.name}`}
                onClick={() => setEditing(item)}
              >
                <Pencil className="size-4" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <RecurringSheet
          key={editing === 'new' ? 'new' : editing.id}
          item={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function RecurringSheet({ item, onClose }: { item: RecurringExpense | null; onClose: () => void }) {
  const { branches } = useStaff()
  const { data: categories = [], isLoading: loadingCategories } = useQuery(expenseCategoriesQuery)
  const [branch, setBranch] = useState(item ? (item.branch_id ?? SHARED) : (branches[0]?.id ?? SHARED))
  const [categoryId, setCategoryId] = useState(item?.category_id ?? '')
  const [name, setName] = useState(item?.name ?? '')
  const [amount, setAmount] = useState<number | null>(item?.amount ?? null)
  const [day, setDay] = useState(item?.day_of_month ?? 1)
  const [active, setActive] = useState(item?.is_active ?? true)
  const [removing, setRemoving] = useState(false)

  const save = useExpenseMutation(saveRecurring, 'Gasto fijo guardado')
  const remove = useExpenseMutation(removeRecurring, (result) =>
    result === 'deleted' ? 'Gasto fijo eliminado' : 'Ya tenía meses registrados: quedó pausado',
  )
  const valid = categoryId && name.trim().length >= 3 && (amount ?? 0) > 0

  return (
    <Sheet
      open
      onClose={onClose}
      title={item ? 'Editar gasto fijo' : 'Nuevo gasto fijo'}
      description="Los cambios aplican desde el próximo mes que se registre."
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          {item && (
            <Button variant="ghost" className="mr-auto text-danger" onClick={() => setRemoving(true)}>
              Eliminar
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={!valid}
            loading={save.isPending}
            onClick={() =>
              save.mutate(
                {
                  id: item?.id,
                  branch_id: branch === SHARED ? null : branch,
                  category_id: categoryId,
                  name: name.trim(),
                  amount: amount ?? 0,
                  day_of_month: day,
                  is_active: active,
                },
                { onSuccess: onClose },
              )
            }
          >
            Guardar
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <Field label="Nombre">
          {(props) => (
            <TextInput
              {...props}
              maxLength={80}
              placeholder="ej. Arriendo del local"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Sede">
            {(props) => (
              <Select
                {...props}
                value={branch}
                onValueChange={setBranch}
                options={[
                  ...branches.map((b) => ({ value: b.id, label: b.name })),
                  { value: SHARED, label: 'Compartido (las dos sedes)' },
                ]}
              />
            )}
          </Field>
          <Field label="Categoría">
            {(props) => (
              <Select
                {...props}
                value={categoryId}
                onValueChange={setCategoryId}
                loading={loadingCategories}
                options={categories
                  .filter((c) => c.is_active || c.id === categoryId)
                  .map((c) => ({ value: c.id, label: c.name }))}
              />
            )}
          </Field>
          <Field label="Valor mensual">
            {(props) => <MoneyInput {...props} value={amount} onValueChange={setAmount} />}
          </Field>
          <Field label="Día del mes" hint="Del 1 al 28, para que exista en todos los meses">
            {(props) => (
              <Select
                {...props}
                value={String(day)}
                onValueChange={(next) => setDay(Number(next))}
                searchable={false}
                options={Array.from({ length: 28 }, (_, i) => ({
                  value: String(i + 1),
                  label: String(i + 1),
                }))}
              />
            )}
          </Field>
        </div>
        <Switch
          label="Activo"
          description="Si lo pausas, deja de registrarse cada mes"
          checked={active}
          onCheckedChange={setActive}
        />
      </div>
      {item && (
        <ConfirmDialog
          open={removing}
          title="Eliminar gasto fijo"
          confirmLabel="Eliminar"
          loading={remove.isPending}
          onCancel={() => setRemoving(false)}
          onConfirm={() => remove.mutate(item.id, { onSuccess: onClose })}
        >
          Los meses que ya se registraron se conservan. Si ya tiene meses, queda pausado en lugar de borrarse.
        </ConfirmDialog>
      )}
    </Sheet>
  )
}
