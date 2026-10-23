export type SupplyUnit = 'g' | 'ml' | 'unit'

export interface Category {
  id: string
  name: string
  sort_order: number
  is_active: boolean
}

export interface Supply {
  id: string
  name: string
  unit: SupplyUnit
  /** Cost per base unit (per gram, per milliliter or per unit). */
  unit_cost: number
  /** Low-stock threshold in base units. */
  default_min_quantity: number
  is_active: boolean
}

export interface RecipeLine {
  supply_id: string
  quantity: number
}

export interface AddOn {
  id: string
  name: string
  price: number
  is_active: boolean
  recipe_items: RecipeLine[]
}

export interface ProductVariant {
  id: string
  name: string
  price: number
  sort_order: number
  is_active: boolean
  recipe_items: RecipeLine[]
}

export interface Product {
  id: string
  category_id: string
  name: string
  description: string | null
  image_key: string | null
  requires_preparation: boolean
  is_active: boolean
  product_variants: ProductVariant[]
  product_add_ons: { add_on_id: string }[]
}

export interface Catalog {
  categories: Category[]
  supplies: Supply[]
  addOns: AddOn[]
  products: Product[]
}
