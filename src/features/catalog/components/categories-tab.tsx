import { ArrowDown, ArrowUp, Check, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TextInput } from '@/components/ui/field'
import { cn } from '@/lib/cn'
import { deleteCategory, reorderCategories, saveCategory } from '../catalog-api'
import type { Catalog, Category } from '../types'
import { useCatalogMutation } from '../use-catalog-mutation'

export function CategoriesTab({ catalog }: { catalog: Catalog }) {
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')

  const create = useCatalogMutation(saveCategory, 'Categoría creada')
  const update = useCatalogMutation(saveCategory, 'Categoría actualizada')
  const remove = useCatalogMutation(deleteCategory, 'Categoría eliminada')
  const reorder = useCatalogMutation(reorderCategories, 'Orden guardado')

  const productCount = (id: string) => catalog.products.filter((p) => p.category_id === id).length
  const busy = create.isPending || update.isPending || remove.isPending || reorder.isPending

  function handleCreate(event: FormEvent) {
    event.preventDefault()
    const name = newName.trim()
    if (name.length < 2) return
    create.mutate(
      { name, sort_order: catalog.categories.length + 1, is_active: true },
      { onSuccess: () => setNewName('') },
    )
  }

  function move(index: number, direction: -1 | 1) {
    const ids = catalog.categories.map((c) => c.id)
    const target = index + direction
    const current = ids[index]
    const other = ids[target]
    if (current === undefined || other === undefined) return
    ids[index] = other
    ids[target] = current
    reorder.mutate(ids)
  }

  function saveName(category: Category) {
    const name = editingName.trim()
    if (name.length < 2 || name === category.name) {
      setEditingId(null)
      return
    }
    update.mutate({ ...category, name }, { onSuccess: () => setEditingId(null) })
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <p className="text-fg-muted">El orden de las categorías es el mismo en que aparecen en la caja.</p>

      <form onSubmit={handleCreate} className="flex gap-2">
        <TextInput
          aria-label="Nombre de la nueva categoría"
          placeholder="Nueva categoría, ej. Malteadas"
          maxLength={40}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <Button type="submit" loading={create.isPending} disabled={newName.trim().length < 2}>
          <Plus className="size-4" aria-hidden />
          Agregar
        </Button>
      </form>

      <ul className="flex flex-col gap-2">
        {catalog.categories.map((category, index) => {
          const count = productCount(category.id)
          const editing = editingId === category.id
          return (
            <li
              key={category.id}
              className={cn(
                'flex items-center gap-2 rounded-card border border-line bg-surface p-2 pl-4',
                !category.is_active && 'opacity-60',
              )}
            >
              {editing ? (
                <form
                  className="flex flex-1 gap-2"
                  onSubmit={(e) => {
                    e.preventDefault()
                    saveName(category)
                  }}
                >
                  <TextInput
                    aria-label="Nuevo nombre"
                    autoFocus
                    maxLength={40}
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                  />
                  <Button type="submit" size="icon" aria-label="Guardar nombre" loading={update.isPending}>
                    <Check className="size-4" aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Cancelar"
                    onClick={() => setEditingId(null)}
                  >
                    <X className="size-4" aria-hidden />
                  </Button>
                </form>
              ) : (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2 font-medium">
                      {category.name}
                      {!category.is_active && <Badge>Oculta</Badge>}
                    </span>
                    <span className="text-sm text-fg-subtle">
                      {count} {count === 1 ? 'producto' : 'productos'}
                    </span>
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Subir ${category.name}`}
                    disabled={index === 0 || busy}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp className="size-4" aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Bajar ${category.name}`}
                    disabled={index === catalog.categories.length - 1 || busy}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown className="size-4" aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Renombrar ${category.name}`}
                    onClick={() => {
                      setEditingId(category.id)
                      setEditingName(category.name)
                    }}
                  >
                    <Pencil className="size-4" aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    className="px-3 text-sm"
                    disabled={busy}
                    onClick={() => update.mutate({ ...category, is_active: !category.is_active })}
                  >
                    {category.is_active ? 'Ocultar' : 'Mostrar'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={
                      count > 0
                        ? `${category.name} tiene productos y no se puede eliminar`
                        : `Eliminar ${category.name}`
                    }
                    title={count > 0 ? 'Tiene productos: ocúltala en su lugar' : undefined}
                    disabled={count > 0 || busy}
                    onClick={() => remove.mutate(category.id)}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
