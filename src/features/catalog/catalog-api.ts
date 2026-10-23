import { queryOptions } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { AddOn, Catalog, Category, Product, RecipeLine, Supply, SupplyUnit } from './types'

const RECIPE_SELECT = 'recipe_items(supply_id, quantity)'

async function fetchCatalog(): Promise<Catalog> {
  const [categories, supplies, addOns, products] = await Promise.all([
    supabase.from('categories').select('id, name, sort_order, is_active').order('sort_order').order('name'),
    supabase
      .from('supplies')
      .select('id, name, unit, unit_cost, default_min_quantity, is_active')
      .order('name'),
    supabase.from('add_ons').select(`id, name, price, is_active, ${RECIPE_SELECT}`).order('name'),
    supabase
      .from('products')
      .select(
        `id, category_id, name, description, image_key, requires_preparation, is_active,
         product_variants(id, name, price, sort_order, is_active, ${RECIPE_SELECT}),
         product_add_ons(add_on_id)`,
      )
      .order('sort_order')
      .order('name')
      .order('sort_order', { referencedTable: 'product_variants' }),
  ])

  for (const result of [categories, supplies, addOns, products]) {
    if (result.error) throw result.error
  }

  return {
    categories: (categories.data ?? []) as Category[],
    supplies: (supplies.data ?? []) as Supply[],
    addOns: (addOns.data ?? []) as AddOn[],
    products: (products.data ?? []) as Product[],
  }
}

export const catalogQuery = queryOptions({
  queryKey: ['catalog'],
  queryFn: fetchCatalog,
})

// ---------------------------------------------------------------------------
// Products and add-ons are saved through database functions so sizes, recipes
// and add-on links are written in a single transaction.
// ---------------------------------------------------------------------------

export interface ProductInput {
  id?: string
  category_id: string
  name: string
  description: string
  image_key: string | null
  requires_preparation: boolean
  is_active: boolean
  variants: { id?: string; name: string; price: number; is_active: boolean; recipe: RecipeLine[] }[]
  add_on_ids: string[]
}

export async function saveProduct(input: ProductInput): Promise<string> {
  const { data, error } = await supabase.rpc('save_product', { payload: input })
  if (error) throw error
  return data as string
}

export interface AddOnInput {
  id?: string
  name: string
  price: number
  is_active: boolean
  recipe: RecipeLine[]
}

export async function saveAddOn(input: AddOnInput): Promise<string> {
  const { data, error } = await supabase.rpc('save_add_on', { payload: input })
  if (error) throw error
  return data as string
}

export type RemovableKind = 'product' | 'add_on' | 'supply'

/** Deletes the item, or archives it when it already appears in sales or stock history. */
export async function removeCatalogItem(kind: RemovableKind, id: string): Promise<'deleted' | 'archived'> {
  const { data, error } = await supabase.rpc('remove_catalog_item', { kind, item_id: id })
  if (error) throw error
  return data as 'deleted' | 'archived'
}

// ---------------------------------------------------------------------------
// Supplies and categories are simple rows; RLS allows managers to write them.
// ---------------------------------------------------------------------------

export interface SupplyInput {
  id?: string
  name: string
  unit: SupplyUnit
  unit_cost: number
  default_min_quantity: number
  is_active: boolean
}

export async function saveSupply({ id, ...fields }: SupplyInput): Promise<void> {
  const query = id
    ? supabase.from('supplies').update(fields).eq('id', id)
    : supabase.from('supplies').insert(fields)
  const { error } = await query
  if (error) throw error
}

export async function saveCategory(category: {
  id?: string
  name: string
  sort_order: number
  is_active: boolean
}) {
  const { id, ...fields } = category
  const query = id
    ? supabase.from('categories').update(fields).eq('id', id)
    : supabase.from('categories').insert(fields)
  const { error } = await query
  if (error) throw error
}

export async function deleteCategory(id: string): Promise<void> {
  const { error } = await supabase.from('categories').delete().eq('id', id)
  if (error) throw error
}

/** Persists a new order for the categories (index = position). */
export async function reorderCategories(orderedIds: string[]): Promise<void> {
  const results = await Promise.all(
    orderedIds.map((id, index) =>
      supabase
        .from('categories')
        .update({ sort_order: index + 1 })
        .eq('id', id),
    ),
  )
  const failed = results.find((r) => r.error)
  if (failed?.error) throw failed.error
}
