import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Field, MoneyInput, Switch, TextInput } from '@/components/ui/field'
import { Sheet } from '@/components/ui/sheet'
import { removeCatalogItem, saveAddOn } from '../catalog-api'
import type { AddOn, Supply } from '../types'
import { useCatalogMutation } from '../use-catalog-mutation'
import { RecipeEditor, toDraftLines, toRecipeLines, type DraftRecipeLine } from './recipe-editor'

interface AddOnEditorProps {
  open: boolean
  addOn: AddOn | null
  supplies: Supply[]
  suppliesById: Map<string, Supply>
  onClose: () => void
}

export function AddOnEditor({ open, addOn, supplies, suppliesById, onClose }: AddOnEditorProps) {
  const [name, setName] = useState(addOn?.name ?? '')
  const [price, setPrice] = useState<number | null>(addOn?.price ?? null)
  const [isActive, setIsActive] = useState(addOn?.is_active ?? true)
  const [recipe, setRecipe] = useState<DraftRecipeLine[]>(() => toDraftLines(addOn?.recipe_items ?? []))
  const [attempted, setAttempted] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)

  const save = useCatalogMutation(saveAddOn, addOn ? 'Adición actualizada' : 'Adición creada')
  const remove = useCatalogMutation(
    (id: string) => removeCatalogItem('add_on', id),
    (result) =>
      result === 'deleted' ? 'Adición eliminada' : 'Adición archivada: ya tiene ventas registradas',
  )

  const errors = {
    name: attempted && name.trim().length < 2 ? 'Escribe el nombre' : undefined,
    price: attempted && price === null ? 'Escribe el precio' : undefined,
  }

  function handleSave() {
    setAttempted(true)
    if (name.trim().length < 2 || price === null) return
    save.mutate(
      {
        id: addOn?.id,
        name: name.trim(),
        price: price ?? 0,
        is_active: isActive,
        recipe: toRecipeLines(recipe),
      },
      { onSuccess: onClose },
    )
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={addOn ? 'Editar adición' : 'Nueva adición'}
      description="Extras que se cobran aparte, como queso o helado."
      footer={
        <div className="flex items-center gap-2">
          {addOn && (
            <Button variant="ghost" className="text-danger" onClick={() => setConfirmRemove(true)}>
              <Trash2 className="size-4" aria-hidden />
              Eliminar
            </Button>
          )}
          <span className="flex-1" />
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={handleSave} loading={save.isPending}>
            Guardar
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-[1fr_10rem] gap-3">
          <Field label="Nombre" error={errors.name}>
            {(props) => (
              <TextInput
                {...props}
                value={name}
                maxLength={40}
                placeholder="ej. Queso rallado"
                onChange={(e) => setName(e.target.value)}
              />
            )}
          </Field>
          <Field label="Precio" error={errors.price}>
            {(props) => <MoneyInput {...props} value={price} onValueChange={setPrice} />}
          </Field>
        </div>
        <Switch label="Disponible para vender" checked={isActive} onCheckedChange={setIsActive} />
        <RecipeEditor
          lines={recipe}
          onChange={setRecipe}
          supplies={supplies}
          suppliesById={suppliesById}
          price={price ?? 0}
        />
      </div>

      {addOn && (
        <ConfirmDialog
          open={confirmRemove}
          title={`¿Eliminar “${addOn.name}”?`}
          confirmLabel="Eliminar"
          loading={remove.isPending}
          onCancel={() => setConfirmRemove(false)}
          onConfirm={() =>
            remove.mutate(addOn.id, {
              onSuccess: () => {
                setConfirmRemove(false)
                onClose()
              },
            })
          }
        >
          Si ya se vendió alguna vez no se borra: queda archivada para no perder el historial.
        </ConfirmDialog>
      )}
    </Sheet>
  )
}
