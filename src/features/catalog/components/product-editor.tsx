import { Archive, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Field, MoneyInput, SelectInput, Switch, TextArea, TextInput } from '@/components/ui/field'
import { Sheet } from '@/components/ui/sheet'
import { cn } from '@/lib/cn'
import { formatCurrency } from '@/lib/format'
import { deleteMedia, uploadMedia } from '@/lib/media'
import { removeCatalogItem, saveProduct, type ProductInput } from '../catalog-api'
import type { Catalog, Product, Supply } from '../types'
import { useCatalogMutation } from '../use-catalog-mutation'
import { ImagePicker, type ImageState } from './image-picker'
import { RecipeEditor, toDraftLines, toRecipeLines, type DraftRecipeLine } from './recipe-editor'

interface DraftVariant {
  key: string
  id?: string
  name: string
  price: number | null
  is_active: boolean
  recipe: DraftRecipeLine[]
}

interface Draft {
  name: string
  category_id: string
  description: string
  requires_preparation: boolean
  is_active: boolean
  image: ImageState
  variants: DraftVariant[]
  add_on_ids: string[]
}

function emptyVariant(name = 'Único'): DraftVariant {
  return { key: crypto.randomUUID(), name, price: null, is_active: true, recipe: [] }
}

function toDraft(product: Product | null, defaultCategoryId: string): Draft {
  if (!product) {
    return {
      name: '',
      category_id: defaultCategoryId,
      description: '',
      requires_preparation: true,
      is_active: true,
      image: { kind: 'none' },
      variants: [emptyVariant()],
      add_on_ids: [],
    }
  }
  return {
    name: product.name,
    category_id: product.category_id,
    description: product.description ?? '',
    requires_preparation: product.requires_preparation,
    is_active: product.is_active,
    image: product.image_key ? { kind: 'existing', key: product.image_key } : { kind: 'none' },
    variants: product.product_variants.map((v) => ({
      key: v.id,
      id: v.id,
      name: v.name,
      price: v.price,
      is_active: v.is_active,
      recipe: toDraftLines(v.recipe_items),
    })),
    add_on_ids: product.product_add_ons.map((a) => a.add_on_id),
  }
}

type Errors = Partial<Record<'name' | 'category' | 'variants', string>>

function validate(draft: Draft): Errors {
  const errors: Errors = {}
  if (draft.name.trim().length < 2) errors.name = 'Escribe el nombre del producto'
  if (!draft.category_id) errors.category = 'Elige una categoría'
  const names = draft.variants.map((v) => v.name.trim().toLowerCase())
  if (draft.variants.some((v) => !v.name.trim() || v.price === null)) {
    errors.variants = 'Cada tamaño necesita nombre y precio'
  } else if (new Set(names).size !== names.length) {
    errors.variants = 'Hay dos tamaños con el mismo nombre'
  }
  return errors
}

interface ProductEditorProps {
  open: boolean
  product: Product | null
  catalog: Catalog
  suppliesById: Map<string, Supply>
  onClose: () => void
}

export function ProductEditor({ open, product, catalog, suppliesById, onClose }: ProductEditorProps) {
  const activeCategories = catalog.categories.filter((c) => c.is_active || c.id === product?.category_id)
  const [draft, setDraft] = useState<Draft>(() => toDraft(product, activeCategories[0]?.id ?? ''))
  const [attempted, setAttempted] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)

  const save = useCatalogMutation(
    async (current: Draft) => {
      const previousKey = product?.image_key ?? null
      let imageKey = current.image.kind === 'existing' ? current.image.key : null
      if (current.image.kind === 'new') imageKey = await uploadMedia(current.image.blob, 'products')

      const input: ProductInput = {
        id: product?.id,
        category_id: current.category_id,
        name: current.name.trim(),
        description: current.description.trim(),
        image_key: imageKey,
        requires_preparation: current.requires_preparation,
        is_active: current.is_active,
        variants: current.variants.map((v) => ({
          id: v.id,
          name: v.name.trim(),
          price: v.price ?? 0,
          is_active: v.is_active,
          recipe: toRecipeLines(v.recipe),
        })),
        add_on_ids: current.add_on_ids,
      }
      await saveProduct(input)
      if (previousKey && previousKey !== imageKey) await deleteMedia(previousKey)
    },
    product ? 'Producto actualizado' : 'Producto creado',
  )

  const remove = useCatalogMutation(
    async (target: Product) => {
      const result = await removeCatalogItem('product', target.id)
      if (result === 'deleted' && target.image_key) await deleteMedia(target.image_key)
      return result
    },
    (result) =>
      result === 'deleted' ? 'Producto eliminado' : 'Producto archivado: ya tiene ventas registradas',
  )

  function patch(values: Partial<Draft>) {
    setDraft((d) => ({ ...d, ...values }))
  }

  function patchVariant(key: string, values: Partial<DraftVariant>) {
    setDraft((d) => ({ ...d, variants: d.variants.map((v) => (v.key === key ? { ...v, ...values } : v)) }))
  }

  // Errors appear after the first save attempt and then update while typing.
  const errors: Errors = attempted ? validate(draft) : {}

  function handleSave() {
    setAttempted(true)
    if (Object.keys(validate(draft)).length > 0) return
    save.mutate(draft, { onSuccess: onClose })
  }

  const activeAddOns = catalog.addOns.filter((a) => a.is_active || draft.add_on_ids.includes(a.id))

  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="lg"
      title={product ? 'Editar producto' : 'Nuevo producto'}
      description="Los cambios de precio quedan registrados en la actividad."
      footer={
        <div className="flex items-center gap-2">
          {product && (
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
      <div className="flex flex-col gap-8">
        <section className="flex flex-col gap-4">
          <ImagePicker value={draft.image} onChange={(image) => patch({ image })} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nombre" error={errors.name}>
              {(props) => (
                <TextInput
                  {...props}
                  value={draft.name}
                  maxLength={60}
                  placeholder="ej. Cholao tradicional"
                  onChange={(e) => patch({ name: e.target.value })}
                />
              )}
            </Field>
            <Field label="Categoría" error={errors.category}>
              {(props) => (
                <SelectInput
                  {...props}
                  value={draft.category_id}
                  onChange={(e) => patch({ category_id: e.target.value })}
                >
                  <option value="" disabled>
                    Elegir…
                  </option>
                  {activeCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </SelectInput>
              )}
            </Field>
          </div>
          <Field label="Descripción (opcional)">
            {(props) => (
              <TextArea
                {...props}
                value={draft.description}
                maxLength={280}
                onChange={(e) => patch({ description: e.target.value })}
              />
            )}
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Switch
              label="Va a preparación"
              description="Aparece en la pantalla de preparación y en la comanda"
              checked={draft.requires_preparation}
              onCheckedChange={(requires_preparation) => patch({ requires_preparation })}
            />
            <Switch
              label="Disponible para vender"
              description="Si lo apagas, no aparece en la caja"
              checked={draft.is_active}
              onCheckedChange={(is_active) => patch({ is_active })}
            />
          </div>
        </section>

        <section className="flex flex-col gap-4" aria-labelledby="variants-heading">
          <div>
            <h3 id="variants-heading" className="font-semibold">
              Tamaños y precios
            </h3>
            <p className="text-sm text-fg-muted">
              Si el producto tiene un solo precio, deja un único tamaño llamado “Único”.
            </p>
            {errors.variants && (
              <p role="alert" className="mt-1 text-sm text-danger">
                {errors.variants}
              </p>
            )}
          </div>

          {draft.variants.map((variant, index) => (
            <article
              key={variant.key}
              className={cn(
                'flex flex-col gap-4 rounded-card border border-line bg-surface-2/40 p-4',
                !variant.is_active && 'opacity-60',
              )}
            >
              <div className="grid grid-cols-[1fr_9rem_auto] items-end gap-2">
                <Field label="Tamaño">
                  {(props) => (
                    <TextInput
                      {...props}
                      value={variant.name}
                      maxLength={40}
                      onChange={(e) => patchVariant(variant.key, { name: e.target.value })}
                    />
                  )}
                </Field>
                <Field label="Precio">
                  {(props) => (
                    <MoneyInput
                      {...props}
                      value={variant.price}
                      onValueChange={(price) => patchVariant(variant.key, { price })}
                    />
                  )}
                </Field>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Quitar tamaño ${variant.name || index + 1}`}
                  disabled={draft.variants.length === 1}
                  onClick={() => patch({ variants: draft.variants.filter((v) => v.key !== variant.key) })}
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </div>
              {variant.id && !variant.is_active && (
                <p className="flex items-center gap-2 text-sm text-fg-muted">
                  <Archive className="size-4" aria-hidden /> Tamaño archivado.
                  <button
                    type="button"
                    className="underline"
                    onClick={() => patchVariant(variant.key, { is_active: true })}
                  >
                    Reactivar
                  </button>
                </p>
              )}
              <RecipeEditor
                lines={variant.recipe}
                onChange={(recipe) => patchVariant(variant.key, { recipe })}
                supplies={catalog.supplies}
                suppliesById={suppliesById}
                price={variant.price ?? 0}
              />
            </article>
          ))}

          <Button
            variant="secondary"
            className="self-start"
            onClick={() => patch({ variants: [...draft.variants, emptyVariant('')] })}
          >
            <Plus className="size-4" aria-hidden />
            Agregar tamaño
          </Button>
        </section>

        <section className="flex flex-col gap-3" aria-labelledby="addons-heading">
          <div>
            <h3 id="addons-heading" className="font-semibold">
              Adiciones permitidas
            </h3>
            <p className="text-sm text-fg-muted">Lo que el cliente puede agregarle a este producto.</p>
          </div>
          {activeAddOns.length === 0 ? (
            <p className="text-sm text-fg-subtle">Aún no hay adiciones. Créalas en la pestaña Adiciones.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {activeAddOns.map((addOn) => {
                const selected = draft.add_on_ids.includes(addOn.id)
                return (
                  <button
                    key={addOn.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() =>
                      patch({
                        add_on_ids: selected
                          ? draft.add_on_ids.filter((id) => id !== addOn.id)
                          : [...draft.add_on_ids, addOn.id],
                      })
                    }
                    className={cn(
                      'h-11 rounded-xl border px-4 text-sm transition-colors',
                      selected
                        ? 'border-fg bg-fg text-ink'
                        : 'border-line bg-surface-2 text-fg-muted hover:border-line-strong',
                    )}
                  >
                    {addOn.name} · {formatCurrency(addOn.price)}
                  </button>
                )
              })}
            </div>
          )}
        </section>
      </div>

      {product && (
        <ConfirmDialog
          open={confirmRemove}
          title={`¿Eliminar “${product.name}”?`}
          confirmLabel="Eliminar"
          loading={remove.isPending}
          onCancel={() => setConfirmRemove(false)}
          onConfirm={() =>
            remove.mutate(product, {
              onSuccess: () => {
                setConfirmRemove(false)
                onClose()
              },
            })
          }
        >
          Si ya tiene ventas registradas no se borra: queda archivado para no perder el historial.
        </ConfirmDialog>
      )}
    </Sheet>
  )
}
