-- =============================================================================
-- 05 · Expenses, audit log, notifications, push subscriptions, monthly summaries
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Expenses. branch_id null = shared by both branches (e.g. accountant).
-- -----------------------------------------------------------------------------
create table public.recurring_expenses (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid references public.branches (id),
  category_id uuid not null references public.expense_categories (id),
  name text not null check (length(trim(name)) between 2 and 80),
  amount numeric(12, 2) not null check (amount > 0),
  day_of_month smallint not null check (day_of_month between 1 and 28),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index recurring_expenses_branch_idx on public.recurring_expenses (branch_id);
create index recurring_expenses_category_idx on public.recurring_expenses (category_id);

create trigger recurring_expenses_set_updated_at
  before update on public.recurring_expenses
  for each row execute function private.set_updated_at();

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid references public.branches (id),
  category_id uuid not null references public.expense_categories (id),
  amount numeric(12, 2) not null check (amount > 0),
  description text not null check (length(trim(description)) between 3 and 200),
  expense_date date not null,
  receipt_key text check (receipt_key ~ '^receipts/[0-9a-f-]{36}\.(webp|jpg|png)$'),
  -- Paid with money from the drawer: linked to the cash session (and a cash movement).
  cash_session_id uuid references public.cash_sessions (id),
  recurring_expense_id uuid references public.recurring_expenses (id),
  supplier_id uuid references public.suppliers (id),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  -- Each recurring expense is generated at most once per month.
  recurring_month date generated always as (
    case when recurring_expense_id is not null
         then expense_date - (extract(day from expense_date)::integer - 1) end
  ) stored,
  unique (recurring_expense_id, recurring_month)
);

create index expenses_branch_date_idx on public.expenses (branch_id, expense_date desc);
create index expenses_category_idx on public.expenses (category_id);
create index expenses_session_idx on public.expenses (cash_session_id);
create index expenses_supplier_idx on public.expenses (supplier_id);
create index expenses_created_by_idx on public.expenses (created_by);

alter table public.cash_movements
  add constraint cash_movements_expense_fk foreign key (expense_id) references public.expenses (id);
create index cash_movements_expense_idx on public.cash_movements (expense_id) where expense_id is not null;

-- -----------------------------------------------------------------------------
-- Audit log: every sensitive action (voids, cancellations, discounts, price
-- changes, stock adjustments, cash differences). Append-only.
-- -----------------------------------------------------------------------------
create type public.audit_severity as enum ('info', 'warning', 'critical');

create table public.audit_log (
  id bigint generated always as identity primary key,
  branch_id uuid references public.branches (id),
  actor_id uuid references public.profiles (id),
  action text not null check (action ~ '^[a-z_]+\.[a-z_]+$'),
  entity_type text not null,
  entity_id text,
  severity public.audit_severity not null default 'info',
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_branch_created_idx on public.audit_log (branch_id, created_at desc);
create index audit_log_actor_idx on public.audit_log (actor_id);
create index audit_log_severity_idx on public.audit_log (severity, created_at desc) where severity <> 'info';

create trigger audit_log_immutable
  before update or delete on public.audit_log
  for each row execute function private.forbid_change();

-- Writes an audit entry and, for warnings and critical events, queues an
-- owner notification (Telegram / push) in the same transaction.
create or replace function private.audit(
  p_action text,
  p_entity_type text,
  p_entity_id text,
  p_branch_id uuid,
  p_severity public.audit_severity default 'info',
  p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_log (branch_id, actor_id, action, entity_type, entity_id, severity, details)
  values (p_branch_id, (select auth.uid()), p_action, p_entity_type, p_entity_id, p_severity, p_details);

  if p_severity <> 'info' then
    insert into public.notification_outbox (kind, branch_id, payload)
    values (
      'audit_alert',
      p_branch_id,
      jsonb_build_object('action', p_action, 'severity', p_severity, 'details', p_details,
                         'actor_id', (select auth.uid()))
    );
  end if;
end;
$$;

-- Price changes are always recorded, no matter which screen made them.
create or replace function private.audit_price_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.price is distinct from old.price then
    perform private.audit(
      tg_argv[0] || '.price_change', tg_argv[0], new.id::text, null, 'warning',
      jsonb_build_object('name', new.name, 'old_price', old.price, 'new_price', new.price)
    );
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Notification outbox: rows are delivered by the Cloudflare Worker (Telegram
-- and Web Push) and then marked as sent. Only the server can read it.
-- -----------------------------------------------------------------------------
create type public.notification_status as enum ('pending', 'sent', 'failed');

create table public.notification_outbox (
  id bigint generated always as identity primary key,
  kind text not null,
  branch_id uuid references public.branches (id),
  payload jsonb not null default '{}'::jsonb,
  status public.notification_status not null default 'pending',
  attempts smallint not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index notification_outbox_pending_idx on public.notification_outbox (created_at) where status = 'pending';
create index notification_outbox_branch_idx on public.notification_outbox (branch_id);

create trigger product_variants_audit_price
  after update of price on public.product_variants
  for each row execute function private.audit_price_change('product_variant');

create trigger add_ons_audit_price
  after update of price on public.add_ons
  for each row execute function private.audit_price_change('add_on');

-- -----------------------------------------------------------------------------
-- Web Push subscriptions (one per installed device).
-- -----------------------------------------------------------------------------
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

create index push_subscriptions_profile_idx on public.push_subscriptions (profile_id);

-- -----------------------------------------------------------------------------
-- Monthly summaries survive data cleanup, so old reports keep working.
-- -----------------------------------------------------------------------------
create table public.monthly_summaries (
  branch_id uuid not null references public.branches (id),
  month date not null check (extract(day from month) = 1),
  orders_count integer not null default 0,
  sales_total numeric(14, 2) not null default 0,
  cost_total numeric(14, 2) not null default 0,
  discounts_total numeric(14, 2) not null default 0,
  tips_total numeric(14, 2) not null default 0,
  expenses_total numeric(14, 2) not null default 0,
  voided_items_count integer not null default 0,
  cancelled_orders_count integer not null default 0,
  cash_difference_total numeric(14, 2) not null default 0,
  generated_at timestamptz not null default now(),
  primary key (branch_id, month)
);
