-- =============================================================================
-- 02 · Catalog: products, sizes, add-ons, supplies, recipes, payment methods
-- =============================================================================
-- Prices are the same at both branches, so the catalog is global and only
-- managers (owner/admin) edit it. Recipes link what is sold to the supplies it
-- consumes; that is how stock is discounted and how the profit per product is
-- calculated.
-- =============================================================================

create type public.supply_unit as enum ('g', 'ml', 'unit');

-- -----------------------------------------------------------------------------
-- Categories
-- -----------------------------------------------------------------------------
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) between 2 and 40),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger categories_set_updated_at
  before update on public.categories
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Products and their sizes (variants). Every product has at least one variant;
-- a product without sizes simply has one called "Único".
-- -----------------------------------------------------------------------------
create table public.products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories (id),
  name text not null check (length(trim(name)) between 2 and 60),
  description text check (length(description) <= 280),
  -- R2 object key (products/<uuid>.webp), served through /api/media/<key>.
  image_key text check (image_key ~ '^products/[0-9a-f-]{36}\.(webp|jpg|png)$'),
  -- Item goes to the preparation screen / kitchen ticket when ordered.
  requires_preparation boolean not null default true,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index products_category_idx on public.products (category_id);

create trigger products_set_updated_at
  before update on public.products
  for each row execute function private.set_updated_at();

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  name text not null default 'Único' check (length(trim(name)) between 1 and 40),
  price numeric(12, 2) not null check (price >= 0),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, name)
);

create index product_variants_product_idx on public.product_variants (product_id);

create trigger product_variants_set_updated_at
  before update on public.product_variants
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Add-ons (adiciones) such as extra cheese, and which products accept them.
-- -----------------------------------------------------------------------------
create table public.add_ons (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) between 2 and 40),
  price numeric(12, 2) not null check (price >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger add_ons_set_updated_at
  before update on public.add_ons
  for each row execute function private.set_updated_at();

create table public.product_add_ons (
  product_id uuid not null references public.products (id) on delete cascade,
  add_on_id uuid not null references public.add_ons (id) on delete cascade,
  primary key (product_id, add_on_id)
);

create index product_add_ons_add_on_idx on public.product_add_ons (add_on_id);

-- -----------------------------------------------------------------------------
-- Supplies (insumos). Quantities are stored in a base unit (g, ml or unit);
-- the UI converts kg and liters. unit_cost is the weighted average cost per
-- base unit, updated by every purchase.
-- -----------------------------------------------------------------------------
create table public.supplies (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) between 2 and 60),
  unit public.supply_unit not null,
  unit_cost numeric(14, 4) not null default 0 check (unit_cost >= 0),
  -- Default low-stock threshold; each branch can override it in supply_stock.
  default_min_quantity numeric(14, 3) not null default 0 check (default_min_quantity >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger supplies_set_updated_at
  before update on public.supplies
  for each row execute function private.set_updated_at();

-- A recipe line belongs either to a product size or to an add-on.
create table public.recipe_items (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid references public.product_variants (id) on delete cascade,
  add_on_id uuid references public.add_ons (id) on delete cascade,
  supply_id uuid not null references public.supplies (id),
  quantity numeric(14, 3) not null check (quantity > 0),
  created_at timestamptz not null default now(),
  constraint recipe_items_single_owner check (num_nonnulls(variant_id, add_on_id) = 1)
);

create unique index recipe_items_variant_supply_idx
  on public.recipe_items (variant_id, supply_id) where variant_id is not null;
create unique index recipe_items_add_on_supply_idx
  on public.recipe_items (add_on_id, supply_id) where add_on_id is not null;
create index recipe_items_supply_idx on public.recipe_items (supply_id);

-- Cost of one unit of a size / add-on according to its recipe and current supply costs.
create view public.variant_costs
with (security_invoker = true) as
select
  v.id as variant_id,
  v.product_id,
  v.price,
  coalesce(sum(r.quantity * s.unit_cost), 0)::numeric(14, 2) as recipe_cost,
  (v.price - coalesce(sum(r.quantity * s.unit_cost), 0))::numeric(14, 2) as gross_profit
from public.product_variants v
left join public.recipe_items r on r.variant_id = v.id
left join public.supplies s on s.id = r.supply_id
group by v.id;

-- -----------------------------------------------------------------------------
-- Payment methods (configurable: cash, Nequi, Daviplata, card, transfer, credit)
-- -----------------------------------------------------------------------------
create type public.payment_kind as enum ('cash', 'digital', 'credit');

create table public.payment_methods (
  code text primary key check (code ~ '^[a-z_]{2,20}$'),
  name text not null,
  kind public.payment_kind not null,
  sort_order integer not null default 0,
  is_active boolean not null default true
);
comment on column public.payment_methods.kind is
  'cash counts toward the drawer; digital goes to accounts; credit creates customer debt (fiado).';

-- -----------------------------------------------------------------------------
-- Expense categories (rent, utilities, payroll...)
-- -----------------------------------------------------------------------------
create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) between 2 and 40),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
