import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Field, MoneyInput, QuantityInput, SelectInput, Switch, TextInput } from '@/components/ui/field'
import { Sheet } from '@/components/ui/sheet'
import { formatUnitCost } from '@/lib/format'
import { removeCatalogItem, saveSupply } from '../catalog-api'
import type { Supply, SupplyUnit } from '../types'
import { useCatalogMutation } from '../use-catalog-mutation'
import {
  baseToBulk,
  bulkPriceToUnitCost,
  bulkToBase,
  SUPPLY_UNITS,
  unitCostToBulkPrice,
  UNITS,
} from '../units'

interface SupplyEditorProps {
  open: boolean
  supply: Supply | null
  /** How many product sizes / add-ons use it, to warn before archiving. */
  usedInRecipes: number
  onClose: () => void
}

export function SupplyEditor({ open, supply, usedInRecipes, onClose }: SupplyEditorProps) {
  const [name, setName] = useState(supply?.name ?? '')
  const [unit, setUnit] = useState<SupplyUnit>(supply?.unit ?? 'g')
  const [bulkPrice, setBulkPrice] = useState<number | null>(
    supply ? Math.round(unitCostToBulkPrice(supply.unit, supply.unit_cost)) : null,
  )
  const [minQuantity, setMinQuantity] = useState<number | null>(
    supply ? baseToBulk(supply.unit, supply.default_min_quantity) : null,
  )
  const [isActive, setIsActive] = useState(supply?.is_active ?? true)
  const [attempted, setAttempted] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)

  const save = useCatalogMutation(saveSupply, supply ? 'Insumo actualizado' : 'Insumo creado')
  const remove = useCatalogMutation(
    (id: string) => removeCatalogItem('supply', id),
    (result) =>
      result === 'deleted' ? 'Insumo eliminado' : 'Insumo archivado: tiene movimientos de inventario',
  )

  const info = UNITS[unit]

  const errors = {
    name: attempted && name.trim().length < 2 ? 'Escribe el nombre' : undefined,
    price: attempted && bulkPrice === null ? 'Escribe el precio de compra' : undefined,
  }

  function handleSave() {
    setAttempted(true)
    if (name.trim().length < 2 || bulkPrice === null) return
    save.mutate(
      {
        id: supply?.id,
        name: name.trim(),
        unit,
        unit_cost: bulkPriceToUnitCost(unit, bulkPrice ?? 0),
        default_min_quantity: bulkToBase(unit, minQuantity ?? 0),
        is_active: isActive,
      },
      { onSuccess: onClose },
    )
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={supply ? 'Editar insumo' : 'Nuevo insumo'}
      description="Lo que se compra para preparar los productos: frutas, leche, vasos…"
      footer={
        <div className="flex items-center gap-2">
          {supply && (
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
      <div className="flex flex-col gap-5">
        <Field label="Nombre" error={errors.name}>
          {(props) => (
            <TextInput
              {...props}
              value={name}
              maxLength={60}
              placeholder="ej. Fresa"
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
        <Field
          label="Se mide por"
          hint={
            supply ? 'No se puede cambiar porque las recetas y el inventario ya usan esta medida.' : undefined
          }
        >
          {(props) => (
            <SelectInput
              {...props}
              value={unit}
              disabled={Boolean(supply)}
              onChange={(e) => setUnit(e.target.value as SupplyUnit)}
            >
              {SUPPLY_UNITS.map((u) => (
                <option key={u} value={u}>
                  {UNITS[u].kind}
                </option>
              ))}
            </SelectInput>
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={`Precio de compra por ${info.bulk}`}
            error={errors.price}
            hint={
              bulkPrice !== null && unit !== 'unit'
                ? `Equivale a ${formatUnitCost(bulkPriceToUnitCost(unit, bulkPrice))} por ${info.base}`
                : 'Las compras lo actualizarán automáticamente'
            }
          >
            {(props) => <MoneyInput {...props} value={bulkPrice} onValueChange={setBulkPrice} />}
          </Field>
          <Field label="Avisar cuando queden menos de" hint="Alerta de stock bajo en cada sede">
            {(props) => (
              <QuantityInput
                {...props}
                value={minQuantity}
                onValueChange={setMinQuantity}
                suffix={info.bulk}
              />
            )}
          </Field>
        </div>
        <Switch
          label="Activo"
          description="Si lo apagas, no se puede agregar a recetas nuevas"
          checked={isActive}
          onCheckedChange={setIsActive}
        />
      </div>

      {supply && (
        <ConfirmDialog
          open={confirmRemove}
          title={`¿Eliminar “${supply.name}”?`}
          confirmLabel="Eliminar"
          loading={remove.isPending}
          onCancel={() => setConfirmRemove(false)}
          onConfirm={() =>
            remove.mutate(supply.id, {
              onSuccess: () => {
                setConfirmRemove(false)
                onClose()
              },
            })
          }
        >
          {usedInRecipes > 0 && (
            <strong className="mb-2 block text-warning">
              Está en {usedInRecipes} {usedInRecipes === 1 ? 'receta' : 'recetas'}. Si nunca tuvo movimientos
              de inventario, se quitará de ellas.
            </strong>
          )}
          Si ya tiene compras o movimientos de inventario no se borra: queda archivado.
        </ConfirmDialog>
      )}
    </Sheet>
  )
}
