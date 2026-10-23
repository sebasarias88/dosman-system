-- =============================================================================
-- 03 · Inventory: stock per branch, movements, purchases, transfers, counts
-- =============================================================================
-- Stock is never edited by hand. Every change is a row in stock_movements
-- (purchase, sale, waste, adjustment, transfer...) and a trigger keeps
-- supply_stock in sync. That gives a full history of why each quantity changed.
-- =============================================================================

create type public.stock_movement_type as enum (
  'purchase',      -- merchandise received at the main branch
  'sale',          -- consumed by a sold item (from its recipe)
  'sale_reversal', -- an item was voided after its stock had been discounted
  'waste',         -- damaged / expired (merma)
  'adjustment',    -- physical count correction
  'transfer_out',  -- sent from the main branch
  'transfer_in'    -- received at the destination branch
);

-- -----------------------------------------------------------------------------
-- Current stock per branch
-- -----------------------------------------------------------------------------
create table public.supply_stock (
  branch_id uuid not null references public.branches (id),
  supply_id uuid not null references public.supplies (id),
  quantity numeric(14, 3) not null default 0,
  -- null = use supplies.default_min_quantity
  min_quantity numeric(14, 3) check (min_quantity >= 0),
  updated_at timestamptz not null default now(),
  primary key (branch_id, supply_id)
);

create index supply_stock_supply_idx on public.supply_stock (supply_id);

-- -----------------------------------------------------------------------------
-- Movement ledger (append-only)
-- -----------------------------------------------------------------------------
create table public.stock_movements (
  id bigint generated always as identity primary key,
  branch_id uuid not null references public.branches (id),
  supply_id uuid not null references public.supplies (id),
  movement_type public.stock_movement_type not null,
  -- Signed: positive adds stock, negative removes it.
  quantity numeric(14, 3) not null check (quantity <> 0),
  unit_cost numeric(14, 4),
  reason text check (length(reason) <= 200),
  -- Link to the document that caused it (order, purchase, transfer, count).
  order_item_id uuid,
  purchase_id uuid,
  transfer_id uuid,
  count_id uuid,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  constraint stock_movements_sign check (
    (movement_type in ('purchase', 'sale_reversal', 'transfer_in') and quantity > 0)
    or (movement_type in ('sale', 'transfer_out') and quantity < 0)
    or movement_type in ('waste', 'adjustment')
  ),
  constraint stock_movements_waste_negative check (movement_type <> 'waste' or quantity < 0),
  constraint stock_movements_reason_required check (
    movement_type not in ('waste', 'adjustment') or length(trim(coalesce(reason, ''))) >= 3
  )
);

create index stock_movements_branch_created_idx on public.stock_movements (branch_id, created_at desc);
create index stock_movements_supply_idx on public.stock_movements (supply_id);
create index stock_movements_created_by_idx on public.stock_movements (created_by);

create or replace function private.apply_stock_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.supply_stock (branch_id, supply_id, quantity, updated_at)
  values (new.branch_id, new.supply_id, new.quantity, now())
  on conflict (branch_id, supply_id)
  do update set quantity = public.supply_stock.quantity + excluded.quantity,
                updated_at = now();
  return new;
end;
$$;

create trigger stock_movements_apply
  after insert on public.stock_movements
  for each row execute function private.apply_stock_movement();

-- History is immutable. The only exception is the owner's data cleanup
-- function (storage screen), which deletes old rows after a backup and sets
-- `app.cleanup_in_progress` for its own transaction. Updates are never allowed.
create or replace function private.forbid_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and current_setting('app.cleanup_in_progress', true) = 'on' then
    return old;
  end if;
  raise exception 'Este registro es histórico y no se puede modificar ni borrar'
    using errcode = 'P0001';
end;
$$;

create trigger stock_movements_immutable
  before update or delete on public.stock_movements
  for each row execute function private.forbid_change();

-- Low-stock view per branch.
create view public.supply_stock_status
with (security_invoker = true) as
select
  st.branch_id,
  s.id as supply_id,
  s.name,
  s.unit,
  st.quantity,
  coalesce(st.min_quantity, s.default_min_quantity) as min_quantity,
  st.quantity <= coalesce(st.min_quantity, s.default_min_quantity) as is_low
from public.supply_stock st
join public.supplies s on s.id = st.supply_id
where s.is_active;

-- -----------------------------------------------------------------------------
-- Suppliers, purchases and what is owed to them
-- -----------------------------------------------------------------------------
create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) between 2 and 80),
  phone text check (length(phone) <= 30),
  notes text check (length(notes) <= 280),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger suppliers_set_updated_at
  before update on public.suppliers
  for each row execute function private.set_updated_at();

create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches (id),
  supplier_id uuid references public.suppliers (id),
  total numeric(12, 2) not null check (total >= 0),
  notes text check (length(notes) <= 280),
  receipt_key text check (receipt_key ~ '^receipts/[0-9a-f-]{36}\.(webp|jpg|png)$'),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create index purchases_branch_created_idx on public.purchases (branch_id, created_at desc);
create index purchases_supplier_idx on public.purchases (supplier_id);
create index purchases_created_by_idx on public.purchases (created_by);

create table public.purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases (id),
  supply_id uuid not null references public.supplies (id),
  quantity numeric(14, 3) not null check (quantity > 0),
  unit_cost numeric(14, 4) not null check (unit_cost >= 0),
  line_total numeric(12, 2) not null check (line_total >= 0)
);

create index purchase_items_purchase_idx on public.purchase_items (purchase_id);
create index purchase_items_supply_idx on public.purchase_items (supply_id);

create table public.supplier_payments (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers (id),
  purchase_id uuid references public.purchases (id),
  amount numeric(12, 2) not null check (amount > 0),
  method_code text not null references public.payment_methods (code),
  notes text check (length(notes) <= 280),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create index supplier_payments_supplier_idx on public.supplier_payments (supplier_id);
create index supplier_payments_purchase_idx on public.supplier_payments (purchase_id);
create index supplier_payments_created_by_idx on public.supplier_payments (created_by);

create view public.supplier_balances
with (security_invoker = true) as
select
  s.id as supplier_id,
  s.name,
  coalesce(p.purchased, 0) as purchased,
  coalesce(sp.paid, 0) as paid,
  coalesce(p.purchased, 0) - coalesce(sp.paid, 0) as balance
from public.suppliers s
left join (select supplier_id, sum(total) as purchased from public.purchases group by supplier_id) p
  on p.supplier_id = s.id
left join (select supplier_id, sum(amount) as paid from public.supplier_payments group by supplier_id) sp
  on sp.supplier_id = s.id;

-- -----------------------------------------------------------------------------
-- Transfers: the main branch sends supplies, the destination confirms receipt.
-- -----------------------------------------------------------------------------
create type public.transfer_status as enum ('sent', 'received', 'received_with_issues', 'cancelled');

create table public.transfers (
  id uuid primary key default gen_random_uuid(),
  from_branch_id uuid not null references public.branches (id),
  to_branch_id uuid not null references public.branches (id),
  status public.transfer_status not null default 'sent',
  notes text check (length(notes) <= 280),
  sent_by uuid not null references public.profiles (id),
  sent_at timestamptz not null default now(),
  received_by uuid references public.profiles (id),
  received_at timestamptz,
  receive_notes text check (length(receive_notes) <= 280),
  constraint transfers_distinct_branches check (from_branch_id <> to_branch_id)
);

create index transfers_from_idx on public.transfers (from_branch_id, sent_at desc);
create index transfers_to_idx on public.transfers (to_branch_id, status);
create index transfers_sent_by_idx on public.transfers (sent_by);
create index transfers_received_by_idx on public.transfers (received_by);

create table public.transfer_items (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references public.transfers (id),
  supply_id uuid not null references public.supplies (id),
  quantity_sent numeric(14, 3) not null check (quantity_sent > 0),
  quantity_received numeric(14, 3) check (quantity_received >= 0),
  unique (transfer_id, supply_id)
);

create index transfer_items_supply_idx on public.transfer_items (supply_id);

-- -----------------------------------------------------------------------------
-- Physical counts: staff count what is on the shelf; differences become
-- 'adjustment' movements with the count as reason.
-- -----------------------------------------------------------------------------
create type public.count_status as enum ('draft', 'applied');

create table public.inventory_counts (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches (id),
  status public.count_status not null default 'draft',
  notes text check (length(notes) <= 280),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  applied_at timestamptz
);

create index inventory_counts_branch_idx on public.inventory_counts (branch_id, created_at desc);
create index inventory_counts_created_by_idx on public.inventory_counts (created_by);

create table public.inventory_count_items (
  id uuid primary key default gen_random_uuid(),
  count_id uuid not null references public.inventory_counts (id),
  supply_id uuid not null references public.supplies (id),
  expected_quantity numeric(14, 3) not null,
  counted_quantity numeric(14, 3) not null check (counted_quantity >= 0),
  difference numeric(14, 3) generated always as (counted_quantity - expected_quantity) stored,
  unique (count_id, supply_id)
);

create index inventory_count_items_supply_idx on public.inventory_count_items (supply_id);

-- Late foreign keys from the ledger to its source documents.
alter table public.stock_movements
  add constraint stock_movements_purchase_fk foreign key (purchase_id) references public.purchases (id),
  add constraint stock_movements_transfer_fk foreign key (transfer_id) references public.transfers (id),
  add constraint stock_movements_count_fk foreign key (count_id) references public.inventory_counts (id);

create index stock_movements_purchase_idx on public.stock_movements (purchase_id) where purchase_id is not null;
create index stock_movements_transfer_idx on public.stock_movements (transfer_id) where transfer_id is not null;
create index stock_movements_count_idx on public.stock_movements (count_id) where count_id is not null;
