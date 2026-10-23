import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Switch, TextInput } from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'
import { expenseCategoriesQuery, saveExpenseCategory, type ExpenseCategory } from '../expenses-api'
import { useExpenseMutation } from '../use-expense-mutation'

/** Expense categories. They are never deleted (old expenses use them), only turned off. */
export function CategoriesTab() {
  const { data: categories = [], isPending } = useQuery(expenseCategoriesQuery)
  const [name, setName] = useState('')
  const save = useExpenseMutation(saveExpenseCategory)

  function handleAdd(event: FormEvent) {
    event.preventDefault()
    if (name.trim().length < 2) return
    save.mutate({ name, is_active: true }, { onSuccess: () => setName('') })
  }

  if (isPending) return <Spinner />

  return (
    <div className="flex max-w-xl flex-col gap-5">
      <form onSubmit={handleAdd} className="flex gap-2">
        <TextInput
          aria-label="Nueva categoría"
          placeholder="Nueva categoría (ej. Publicidad)"
          maxLength={40}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit" disabled={name.trim().length < 2} loading={save.isPending}>
          <Plus className="size-4" aria-hidden />
          Agregar
        </Button>
      </form>
      <ul className="flex flex-col divide-y divide-line rounded-card border border-line bg-surface">
        {categories.map((category) => (
          <CategoryRow key={category.id} category={category} />
        ))}
      </ul>
    </div>
  )
}

function CategoryRow({ category }: { category: ExpenseCategory }) {
  const [name, setName] = useState(category.name)
  const save = useExpenseMutation(saveExpenseCategory)
  const changed = name.trim() !== category.name && name.trim().length >= 2

  return (
    <li className="flex flex-wrap items-center gap-3 p-3">
      <TextInput
        aria-label={`Nombre de ${category.name}`}
        className="min-w-0 flex-1"
        maxLength={40}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      {changed && (
        <Button
          variant="secondary"
          loading={save.isPending}
          onClick={() => save.mutate({ id: category.id, name, is_active: category.is_active })}
        >
          Guardar
        </Button>
      )}
      <Switch
        label={category.is_active ? 'Activa' : 'Inactiva'}
        checked={category.is_active}
        onCheckedChange={(is_active) => save.mutate({ id: category.id, name: category.name, is_active })}
      />
    </li>
  )
}
