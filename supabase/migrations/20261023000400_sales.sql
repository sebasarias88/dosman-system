-- =============================================================================
-- 04 · Sales: tables, customers, cash sessions, orders, payments, credit (fiado)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Seating: zones (salón, terraza) and tables, per branch.
-- -----------------------------------------------------------------------------
create table public.zones (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches (id),
  name text not null check (length(trim(name)) between 2 and 40),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (branch_id, name)
);

create table public.dining_tables (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches (id),
  zone_id uuid references public.zones (id),
  name text not null check (length(trim(name)) between 1 and 20),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (branch_id, name)
);

create index dining_tables_zone_idx on public.dining_tables (zone_id);

-- -----------------------------------------------------------------------------
-- Customers: delivery clients and people who buy on credit.
-- -----------------------------------------------------------------------------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 80),
  phone text check (phone ~ '^[0-9+ ]{7,20}$'),
  address text check (length(address) <= 200),
  notes text check (length(notes) <= 280),
  is_active boolean not null default true,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index customers_phone_idx on public.customers (phone) where phone is not null;
create index customers_created_by_idx on public.customers (created_by);

create trigger customers_set_updated_at
  before update on public.customers
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Cash sessions (turnos de caja). One open session per branch at a time.
-- expected_cash is calculated by the close function; difference shows any
-- shortage (negative) or surplus (positive).
-- -----------------------------------------------------------------------------
create type public.cash_session_status as enum ('open', 'closed');

create table public.cash_sessions (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches (id),
  business_date date not null,
  status public.cash_session_status not null default 'open',
  opening_amount numeric(12, 2) not null check (opening_amount >= 0),
  opened_by uuid not null references public.profiles (id),
  opened_at timestamptz not null default now(),
  expected_cash numeric(12, 2),
  counted_cash numeric(12, 2) check (counted_cash >= 0),
  difference numeric(12, 2) generated always as (counted_cash - expected_cash) stored,
  close_notes text check (length(close_notes) <= 280),
  closed_by uuid references public.profiles (id),
  closed_at timestamptz,
  constraint cash_sessions_closed_fields check (
    status = 'open'
    or (closed_at is not null and closed_by is not null and counted_cash is not null and expected_cash is not null)
  )
);

create unique index cash_sessions_one_open_idx on public.cash_sessions (branch_id) where status = 'open';
create index cash_sessions_branch_date_idx on public.cash_sessions (branch_id, business_date desc);
create index cash_sessions_opened_by_idx on public.cash_sessions (opened_by);
create index cash_sessions_closed_by_idx on public.cash_sessions (closed_by);

-- Cash in / out of the drawer that is not a sale (e.g. paying a supplier from the drawer).
create type public.cash_movement_kind as enum ('in', 'out');

create table public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  cash_session_id uuid not null references public.cash_sessions (id),
  branch_id uuid not null references public.branches (id),
  kind public.cash_movement_kind not null,
  amount numeric(12, 2) not null check (amount > 0),
  reason text not null check (length(trim(reason)) between 3 and 200),
  expense_id uuid,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create index cash_movements_session_idx on public.cash_movements (cash_session_id);
create index cash_movements_branch_idx on public.cash_movements (branch_id, created_at desc);
create index cash_movements_created_by_idx on public.cash_movements (created_by);

-- -----------------------------------------------------------------------------
-- Orders
-- -----------------------------------------------------------------------------
create type public.order_type as enum (
  'table',     -- a numbered table
  'counter',   -- served at the counter
  'takeaway',  -- para llevar
  'park',      -- customer sits on a park bench; identified by a short note
  'delivery'   -- WhatsApp / phone orders (main branch)
);

create type public.order_status as enum ('open', 'paid', 'cancelled');

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches (id),
  business_date date not null,
  -- Short number shown on tickets; restarts every business day per branch.
  order_number integer not null,
  order_type public.order_type not null,
  status public.order_status not null default 'open',
  table_id uuid references public.dining_tables (id),
  park_note text check (length(park_note) <= 80),
  customer_id uuid references public.customers (id),
  delivery_address text check (length(delivery_address) <= 200),
  delivery_fee numeric(12, 2) not null default 0 check (delivery_fee >= 0),
  courier_name text check (length(courier_name) <= 60),
  -- Waiter who attends the order (service only, never handles money).
  waiter_id uuid references public.profiles (id),
  notes text check (length(notes) <= 280),
  subtotal numeric(12, 2) not null default 0 check (subtotal >= 0),
  discount_amount numeric(12, 2) not null default 0 check (discount_amount >= 0),
  discount_reason text check (length(discount_reason) <= 200),
  tip_amount numeric(12, 2) not null default 0 check (tip_amount >= 0),
  total numeric(12, 2) not null default 0 check (total >= 0),
  -- Recipe cost of everything sold in the order, frozen at sale time.
  cost_total numeric(14, 2) not null default 0 check (cost_total >= 0),
  cash_session_id uuid references public.cash_sessions (id),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  paid_by uuid references public.profiles (id),
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id),
  cancel_reason text check (length(cancel_reason) <= 200),
  unique (branch_id, business_date, order_number),
  constraint orders_table_required check (order_type <> 'table' or table_id is not null),
  constraint orders_park_note_required check (
    order_type <> 'park' or length(trim(coalesce(park_note, ''))) >= 2
  ),
  constraint orders_delivery_customer check (order_type <> 'delivery' or customer_id is not null),
  constraint orders_discount_reason check (discount_amount = 0 or length(trim(coalesce(discount_reason, ''))) >= 3),
  constraint orders_cancel_fields check (
    status <> 'cancelled' or (cancelled_at is not null and cancelled_by is not null
                               and length(trim(coalesce(cancel_reason, ''))) >= 3)
  ),
  constraint orders_paid_fields check (status <> 'paid' or (paid_at is not null and cash_session_id is not null))
);

create index orders_branch_status_idx on public.orders (branch_id, status);
create index orders_branch_date_idx on public.orders (branch_id, business_date desc);
create index orders_table_open_idx on public.orders (table_id) where status = 'open';
create index orders_customer_idx on public.orders (customer_id);
create index orders_session_idx on public.orders (cash_session_id);
create index orders_waiter_idx on public.orders (waiter_id);
create index orders_created_by_idx on public.orders (created_by);
create index orders_paid_by_idx on public.orders (paid_by);
create index orders_cancelled_by_idx on public.orders (cancelled_by);

-- Assigns the daily order number. The advisory lock serializes numbering per
-- branch so two cashiers can never get the same number.
create or replace function private.assign_order_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.business_date := private.business_date(new.branch_id, new.created_at);
  perform pg_advisory_xact_lock(hashtextextended(new.branch_id::text || new.business_date::text, 0));
  select coalesce(max(o.order_number), 0) + 1
    into new.order_number
    from public.orders o
   where o.branch_id = new.branch_id and o.business_date = new.business_date;
  return new;
end;
$$;

create trigger orders_assign_number
  before insert on public.orders
  for each row execute function private.assign_order_number();

-- -----------------------------------------------------------------------------
-- Order items. Product names and prices are copied at sale time so later
-- catalog edits never change past sales.
-- -----------------------------------------------------------------------------
create type public.prep_status as enum ('pending', 'preparing', 'ready', 'served');

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id),
  branch_id uuid not null references public.branches (id),
  variant_id uuid not null references public.product_variants (id),
  product_name text not null,
  variant_name text not null,
  quantity integer not null check (quantity between 1 and 99),
  unit_price numeric(12, 2) not null check (unit_price >= 0),
  -- [{ "id": uuid, "name": text, "price": number }]
  add_ons jsonb not null default '[]'::jsonb check (jsonb_typeof(add_ons) = 'array'),
  line_total numeric(12, 2) not null check (line_total >= 0),
  unit_cost numeric(14, 2) not null default 0 check (unit_cost >= 0),
  notes text check (length(notes) <= 140),
  prep_status public.prep_status not null default 'pending',
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references public.profiles (id),
  void_reason text check (length(void_reason) <= 200),
  constraint order_items_void_fields check (
    voided_at is null or (voided_by is not null and length(trim(coalesce(void_reason, ''))) >= 3)
  )
);

create index order_items_order_idx on public.order_items (order_id);
create index order_items_prep_idx on public.order_items (branch_id, prep_status) where voided_at is null;
create index order_items_variant_idx on public.order_items (variant_id);
create index order_items_created_by_idx on public.order_items (created_by);
create index order_items_voided_by_idx on public.order_items (voided_by);

alter table public.stock_movements
  add constraint stock_movements_order_item_fk foreign key (order_item_id) references public.order_items (id);
create index stock_movements_order_item_idx on public.stock_movements (order_item_id) where order_item_id is not null;

-- -----------------------------------------------------------------------------
-- Payments. One order can be paid with several methods (split / mixed).
-- -----------------------------------------------------------------------------
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id),
  branch_id uuid not null references public.branches (id),
  cash_session_id uuid not null references public.cash_sessions (id),
  method_code text not null references public.payment_methods (code),
  amount numeric(12, 2) not null check (amount > 0),
  -- Cash only: what the customer handed over and the change returned.
  cash_received numeric(12, 2) check (cash_received >= 0),
  change_given numeric(12, 2) check (change_given >= 0),
  -- Credit (fiado) payments must say who owes it.
  customer_id uuid references public.customers (id),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create index payments_order_idx on public.payments (order_id);
create index payments_session_idx on public.payments (cash_session_id);
create index payments_branch_created_idx on public.payments (branch_id, created_at desc);
create index payments_customer_idx on public.payments (customer_id);
create index payments_method_idx on public.payments (method_code);
create index payments_created_by_idx on public.payments (created_by);

-- Abonos: a customer paying back what they owe.
create table public.customer_payments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id),
  branch_id uuid not null references public.branches (id),
  cash_session_id uuid not null references public.cash_sessions (id),
  method_code text not null references public.payment_methods (code),
  amount numeric(12, 2) not null check (amount > 0),
  notes text check (length(notes) <= 200),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create index customer_payments_customer_idx on public.customer_payments (customer_id);
create index customer_payments_session_idx on public.customer_payments (cash_session_id);
create index customer_payments_branch_idx on public.customer_payments (branch_id);
create index customer_payments_method_idx on public.customer_payments (method_code);
create index customer_payments_created_by_idx on public.customer_payments (created_by);

-- What each customer owes: credit sales minus payments back.
create view public.customer_balances
with (security_invoker = true) as
select
  c.id as customer_id,
  c.name,
  c.phone,
  coalesce(cr.credit_total, 0) as credit_total,
  coalesce(cp.paid_total, 0) as paid_total,
  coalesce(cr.credit_total, 0) - coalesce(cp.paid_total, 0) as balance,
  cr.oldest_credit_at
from public.customers c
left join (
  select p.customer_id, sum(p.amount) as credit_total, min(p.created_at) as oldest_credit_at
  from public.payments p
  join public.payment_methods m on m.code = p.method_code and m.kind = 'credit'
  join public.orders o on o.id = p.order_id and o.status = 'paid'
  group by p.customer_id
) cr on cr.customer_id = c.id
left join (
  select customer_id, sum(amount) as paid_total from public.customer_payments group by customer_id
) cp on cp.customer_id = c.id;

-- Money records are append-only.
create trigger payments_immutable
  before update or delete on public.payments
  for each row execute function private.forbid_change();

create trigger customer_payments_immutable
  before update or delete on public.customer_payments
  for each row execute function private.forbid_change();

create trigger cash_movements_immutable
  before update or delete on public.cash_movements
  for each row execute function private.forbid_change();
