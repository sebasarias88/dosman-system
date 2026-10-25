-- =============================================================================
-- 15 · Storage screen: database usage, backup bookkeeping and the cleanup of
--      old detail rows. Monthly summaries are saved first so old months keep
--      their totals after the detail is gone.
-- =============================================================================

alter table public.app_settings
  add column if not exists last_backup_at timestamptz,
  -- Everything before this date was included in the last backup.
  add column if not exists last_backup_until date,
  -- Detail rows (sales, audit) before this date were cleaned up.
  add column if not exists data_cleaned_before date,
  add column if not exists last_cleanup_at timestamptz;

-- Supabase Free: 500 MB of database. Kept here so a paid plan only changes a number.
alter table public.app_settings
  add column if not exists database_limit_mb integer not null default 500 check (database_limit_mb >= 100);

-- -----------------------------------------------------------------------------
-- storage_usage(): what the database weighs, the biggest tables and how many
-- sales each month has (to choose up to when to clean). Owner only.
-- -----------------------------------------------------------------------------
create or replace function public.storage_usage()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tables jsonb;
begin
  perform private.require_staff(array['owner']::public.app_role[], null);

  select coalesce(jsonb_agg(jsonb_build_object(
           'name', c.relname,
           'bytes', pg_total_relation_size(c.oid),
           'rows', greatest(c.reltuples, 0)::bigint)
         order by pg_total_relation_size(c.oid) desc), '[]'::jsonb)
    into v_tables
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r';

  return jsonb_build_object(
    'database_bytes', pg_database_size(current_database()),
    'limit_bytes', (select database_limit_mb from public.app_settings where id)::bigint * 1024 * 1024,
    'warning_percent', (select storage_warning_percent from public.app_settings where id),
    'tables', v_tables,
    'months', (
      select coalesce(jsonb_agg(jsonb_build_object('month', m.month, 'orders', m.orders) order by m.month), '[]'::jsonb)
        from (select date_trunc('month', business_date)::date as month, count(*) as orders
                from public.orders group by 1) m
    ),
    'audit_rows', (select count(*) from public.audit_log),
    'oldest_order', (select min(business_date) from public.orders),
    'last_backup_at', (select last_backup_at from public.app_settings where id),
    'last_backup_until', (select last_backup_until from public.app_settings where id),
    'data_cleaned_before', (select data_cleaned_before from public.app_settings where id),
    'last_cleanup_at', (select last_cleanup_at from public.app_settings where id)
  );
end;
$$;

-- The app calls this after the Excel file was generated and downloaded.
-- p_until null = full backup (everything up to today).
create or replace function public.record_backup(p_until date default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_until date := coalesce(p_until, private.local_today() + 1);
begin
  perform private.require_staff(array['owner']::public.app_role[], null);
  update public.app_settings set last_backup_at = now(), last_backup_until = v_until where id;
  perform private.audit('storage.backup', 'app_settings', null, null, 'info',
                        jsonb_build_object('until', v_until));
end;
$$;

-- Totals of one branch and month, the same way the reports compute them.
create or replace function private.month_summary(p_branch uuid, p_month date)
returns public.monthly_summaries
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_branch,
    p_month,
    count(*) filter (where o.status = 'paid')::integer,
    coalesce(sum(greatest(o.subtotal - o.discount_amount, 0)) filter (where o.status = 'paid'), 0),
    coalesce(sum(o.cost_total) filter (where o.status = 'paid'), 0),
    coalesce(sum(o.discount_amount) filter (where o.status = 'paid'), 0),
    coalesce(sum(o.tip_amount) filter (where o.status = 'paid'), 0),
    coalesce((select sum(e.amount) from public.expenses e
               where e.voided_at is null and e.branch_id = p_branch
                 and e.expense_date >= p_month and e.expense_date < (p_month + interval '1 month')::date), 0),
    coalesce((select count(*) from public.order_items oi
               join public.orders x on x.id = oi.order_id
              where oi.voided_at is not null and x.branch_id = p_branch
                and x.business_date >= p_month and x.business_date < (p_month + interval '1 month')::date), 0)::integer,
    count(*) filter (where o.status = 'cancelled')::integer,
    coalesce((select sum(s.difference) from public.cash_sessions s
               where s.status = 'closed' and s.branch_id = p_branch
                 and s.business_date >= p_month and s.business_date < (p_month + interval '1 month')::date), 0),
    now()
  from public.orders o
  where o.branch_id = p_branch
    and o.business_date >= p_month and o.business_date < (p_month + interval '1 month')::date;
$$;

-- -----------------------------------------------------------------------------
-- cleanup_old_data(before, confirmation) -> what was deleted
--
-- Deletes the DETAIL of old sales and the old activity log, never money that
-- still matters:
--   * Keeps the last 3 complete months (reports and comparisons keep working).
--   * Requires a backup made in the last 24 hours that covers the period.
--   * Keeps every credit (fiado) sale and every payment back, so what each
--     customer owes never changes.
--   * Keeps cash sessions, expenses, purchases, transfers and counts (small).
--   * Saves the monthly summary of each branch before deleting.
-- confirmation must be the word BORRAR (typed by the owner).
-- -----------------------------------------------------------------------------
create or replace function public.cleanup_old_data(p_before date, p_confirmation text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.app_settings;
  v_latest_allowed date := (date_trunc('month', private.local_today()) - interval '3 months')::date;
  v_orders uuid[];
  v_items uuid[];
  v_counts jsonb;
  v_n_orders integer;
  v_n_items integer;
  v_n_payments integer;
  v_n_moves integer;
  v_n_audit integer;
  v_n_outbox integer;
  v_size_before bigint := pg_database_size(current_database());
begin
  perform private.require_staff(array['owner']::public.app_role[], null);

  if p_confirmation is distinct from 'BORRAR' then
    raise exception 'Escribe BORRAR para confirmar' using errcode = '22023';
  end if;
  if p_before is null or extract(day from p_before) <> 1 then
    raise exception 'La fecha de limpieza debe ser el primer día de un mes' using errcode = '22023';
  end if;
  if p_before > v_latest_allowed then
    raise exception 'Solo se pueden limpiar datos de antes de %: los últimos 3 meses siempre se conservan',
      to_char(v_latest_allowed, 'DD/MM/YYYY') using errcode = 'P0001';
  end if;

  select * into v_settings from public.app_settings where id for update;
  if v_settings.last_backup_at is null or v_settings.last_backup_at < now() - interval '24 hours'
     or v_settings.last_backup_until is null or v_settings.last_backup_until < p_before then
    raise exception 'Primero descarga el respaldo en Excel de ese periodo (debe ser de las últimas 24 horas)'
      using errcode = 'P0001';
  end if;
  if exists (select 1 from public.orders where status = 'open' and business_date < p_before) then
    raise exception 'Hay pedidos abiertos de ese periodo. Cóbralos o anúlalos primero' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.cash_sessions where status = 'open' and business_date < p_before) then
    raise exception 'Hay un turno de caja abierto de ese periodo. Ciérralo primero' using errcode = 'P0001';
  end if;

  -- 1. Monthly summaries (only months that don't have one yet: a month that was
  --    already summarized and cleaned must keep its original totals).
  insert into public.monthly_summaries
  select (private.month_summary(b.id, m.month)).*
    from public.branches b
    cross join (select distinct date_trunc('month', business_date)::date as month
                  from public.orders where business_date < p_before) m
  on conflict (branch_id, month) do nothing;

  -- 2. Which orders go: old, closed, and without any credit (fiado) payment.
  select coalesce(array_agg(o.id), '{}') into v_orders
    from public.orders o
   where o.business_date < p_before
     and o.status in ('paid', 'cancelled')
     and not exists (select 1 from public.payments p
                       join public.payment_methods m on m.code = p.method_code and m.kind = 'credit'
                      where p.order_id = o.id);
  select coalesce(array_agg(id), '{}') into v_items from public.order_items where order_id = any (v_orders);

  -- History tables refuse deletes unless this flag is on (this transaction only).
  perform set_config('app.cleanup_in_progress', 'on', true);

  delete from public.stock_movements where order_item_id = any (v_items);
  get diagnostics v_n_moves = row_count;
  delete from public.payments where order_id = any (v_orders);
  get diagnostics v_n_payments = row_count;
  delete from public.order_items where id = any (v_items);
  get diagnostics v_n_items = row_count;
  delete from public.orders where id = any (v_orders);
  get diagnostics v_n_orders = row_count;

  -- Other stock history of the period (purchases, waste, counts...). Current
  -- stock lives in supply_stock and does not change.
  with gone as (
    delete from public.stock_movements
     where created_at < (p_before::timestamp at time zone (select timezone from public.app_settings where id))
       and order_item_id is null
    returning 1
  )
  select v_n_moves + count(*) into v_n_moves from gone;

  delete from public.audit_log
   where created_at < (p_before::timestamp at time zone (select timezone from public.app_settings where id));
  get diagnostics v_n_audit = row_count;

  -- Notifications already delivered are not needed after a month.
  delete from public.notification_outbox where status <> 'pending' and created_at < now() - interval '30 days';
  get diagnostics v_n_outbox = row_count;

  perform set_config('app.cleanup_in_progress', 'off', true);

  update public.app_settings
     set data_cleaned_before = greatest(coalesce(data_cleaned_before, p_before), p_before),
         last_cleanup_at = now()
   where id;

  v_counts := jsonb_build_object('orders', v_n_orders, 'order_items', v_n_items, 'payments', v_n_payments,
                                 'stock_movements', v_n_moves, 'audit_log', v_n_audit,
                                 'notifications', v_n_outbox, 'before', p_before,
                                 'size_before', v_size_before);
  -- Written after deleting, so this entry survives the cleanup it describes.
  perform private.audit('storage.cleanup', 'app_settings', null, null, 'warning', v_counts);
  return v_counts;
end;
$$;

-- Monthly totals saved by the cleanup (owner and admins see them in reports).
create or replace function public.monthly_history()
returns table (
  month date,
  branch_name text,
  orders_count integer,
  sales_total numeric,
  cost_total numeric,
  expenses_total numeric,
  cash_difference_total numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['owner', 'admin']::public.app_role[], null);
  return query
  select s.month, b.name, s.orders_count, s.sales_total, s.cost_total, s.expenses_total, s.cash_difference_total
    from public.monthly_summaries s
    join public.branches b on b.id = s.branch_id
   order by s.month desc, b.is_main desc;
end;
$$;

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.storage_usage()',
    'public.record_backup(date)',
    'public.cleanup_old_data(date, text)',
    'public.monthly_history()'
  ]
  loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
  execute 'revoke all on function private.month_summary(uuid, date) from public, anon, authenticated';
end;
$$;
