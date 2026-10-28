import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field, MoneyInput, Switch, TextInput } from '@/components/ui/field'
import { Select } from '@/components/ui/select'
import { Sheet } from '@/components/ui/sheet'
import { useStaff } from '@/features/auth/use-staff'
import { suppliersQuery } from '@/features/inventory/inventory-api'
import { uploadMedia } from '@/lib/media'
import { expenseCategoriesQuery, localToday, recordExpense } from '../expenses-api'
import { useExpenseMutation } from '../use-expense-mutation'
import { ReceiptPicker } from './receipt-picker'

/** Value of the branch select that means "shared by both branches". */
export const SHARED = 'shared'

export function ExpenseSheet({ onClose }: { onClose: () => void }) {
  const { branches, activeBranch } = useStaff()
  const { data: categories = [], isLoading: loadingCategories } = useQuery(expenseCategoriesQuery)
  const { data: suppliers = [], isLoading: loadingSuppliers } = useQuery(suppliersQuery)
  const today = localToday()

  const [branch, setBranch] = useState<string>(activeBranch?.id ?? SHARED)
  const [categoryId, setCategoryId] = useState('')
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState<number | null>(null)
  const [date, setDate] = useState(today)
  const [supplierId, setSupplierId] = useState('')
  const [fromDrawer, setFromDrawer] = useState(false)
  const [receipt, setReceipt] = useState<Blob | null>(null)

  const save = useExpenseMutation(async () => {
    const receiptKey = receipt ? await uploadMedia(receipt, 'receipts') : null
    return recordExpense({
      branch_id: branch === SHARED ? null : branch,
      category_id: categoryId,
      amount: amount ?? 0,
      description: description.trim(),
      expense_date: date,
      receipt_key: receiptKey,
      supplier_id: supplierId || null,
      from_drawer: fromDrawer,
    })
  }, 'Gasto registrado')

  const problem = !categoryId
    ? 'Elige la categoría'
    : description.trim().length < 3
      ? 'Describe el gasto'
      : !amount || amount <= 0
        ? 'Escribe el valor'
        : fromDrawer && branch === SHARED
          ? 'Para sacar de la caja elige la sede'
          : !fromDrawer && (!date || date > today)
            ? 'La fecha no puede ser futura'
            : null

  return (
    <Sheet
      open
      onClose={onClose}
      title="Nuevo gasto"
      description="Arriendo, servicios, nómina, mantenimiento… Las compras de insumos van en Compras."
      footer={
        <div className="flex flex-wrap items-center justify-end gap-3">
          {problem && <p className="mr-auto text-sm text-fg-subtle">{problem}</p>}
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={Boolean(problem)}
            loading={save.isPending}
            onClick={() => save.mutate(undefined, { onSuccess: onClose })}
          >
            Registrar gasto
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
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
                options={categories.filter((c) => c.is_active).map((c) => ({ value: c.id, label: c.name }))}
              />
            )}
          </Field>
        </div>
        <Field label="Descripción">
          {(props) => (
            <TextInput
              {...props}
              maxLength={200}
              placeholder="ej. Recibo de la luz de octubre"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Valor">
            {(props) => <MoneyInput {...props} value={amount} onValueChange={setAmount} />}
          </Field>
          <Field label="Fecha" hint={fromDrawer ? 'Sale de la caja hoy' : undefined}>
            {(props) => (
              <TextInput
                {...props}
                type="date"
                max={today}
                disabled={fromDrawer}
                value={fromDrawer ? today : date}
                onChange={(e) => setDate(e.target.value)}
              />
            )}
          </Field>
        </div>
        {suppliers.length > 0 && (
          <Field label="Proveedor (opcional)">
            {(props) => (
              <Select
                {...props}
                value={supplierId}
                onValueChange={setSupplierId}
                loading={loadingSuppliers}
                options={[
                  { value: '', label: 'Ninguno' },
                  ...suppliers.map((s) => ({ value: s.id, label: s.name })),
                ]}
              />
            )}
          </Field>
        )}
        <Switch
          label="Se pagó con dinero de la caja"
          description="Se registra como salida de efectivo del turno abierto de esa sede"
          checked={fromDrawer}
          onCheckedChange={setFromDrawer}
        />
        <ReceiptPicker value={receipt} onChange={setReceipt} />
      </div>
    </Sheet>
  )
}
