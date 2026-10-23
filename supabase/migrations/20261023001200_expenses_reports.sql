-- =============================================================================
-- 12 · Expenses (one-off, paid from the drawer, recurring) and owner reports
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Expenses are never deleted: a mistake is voided with a reason, so the owner
-- can always see what was entered and who removed it. Reports skip voided rows.
-- -----------------------------------------------------------------------------
alter table public.expenses
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references public.profiles (id),
  add column if not exists void_reason text check (length(void_reason) <= 200);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'expenses_void_fields') then
    alter table public.expenses add constraint expenses_void_fields check (
      voided_at is null or (voided_by is not null and length(trim(coalesce(void_reason, ''))) >= 3)
    );
  end if;
end;
$$;

create index if not exists expenses_voided_by_idx on public.expenses (voided_by);
create index if not exists expenses_date_idx on public.expenses (expense_date desc) where voided_at is null;

-- Every expense now goes through record_expense(), which validates the drawer,
-- the dates and writes the audit entry. A direct insert would skip all that.
drop policy if exists expenses_insert_manager on public.expenses;

-- Managers, or the server itself (Cloudflare cron with the service key).
create or replace function private.require_manager_or_server()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if private.is_manager() then
    return;
  end if;
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role' then
    return;
  end if;
  raise exception 'Solo los administradores pueden hacer esto' using errcode = '42501';
end;
$$;

-- Today in Colombia (expense dates are calendar dates, not business dates).
create or replace function private.local_today()
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (now() at time zone s.timezone)::date from public.app_settings s;
$$;

-- -----------------------------------------------------------------------------
-- record_expense(payload) -> expense id
-- payload: {
--   branch_id: uuid | null      -- null = shared by both branches (managers only)
--   category_id: uuid
--   amount: number
--   description: text
--   expense_date: date          -- managers; ignored when paid from the drawer
--   receipt_key: text | null    -- photo of the receipt in R2
--   supplier_id: uuid | null
--   from_drawer: boolean        -- money taken from the open cash session
-- }
-- Cashiers may only record expenses paid from the drawer of their branch
-- (e.g. ice bought at the corner store). Everything else is for managers.
-- -----------------------------------------------------------------------------
create or replace function public.record_expense(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_branch uuid := nullif(payload ->> 'branch_id', '')::uuid;
  v_category uuid := nullif(payload ->> 'category_id', '')::uuid;
  v_amount numeric := (payload ->> 'amount')::numeric;
  v_description text := trim(coalesce(payload ->> 'description', ''));
  v_date date := nullif(payload ->> 'expense_date', '')::date;
  v_receipt text := nullif(payload ->> 'receipt_key', '');
  v_supplier uuid := nullif(payload ->> 'supplier_id', '')::uuid;
  v_from_drawer boolean := coalesce((payload ->> 'from_drawer')::boolean, false);
  v_manager boolean := private.is_manager();
  v_actor uuid;
  v_session public.cash_sessions;
  v_category_name text;
  v_id uuid;
begin
  if v_from_drawer then
    if v_branch is null then
      raise exception 'Elige la sede de la caja de donde sale el dinero' using errcode = '22023';
    end if;
    v_actor := private.require_staff(array['owner', 'admin', 'cashier']::public.app_role[], v_branch);
  else
    v_actor := private.require_staff(array['owner', 'admin']::public.app_role[], v_branch);
  end if;

  if v_amount is null or v_amount <= 0 then
    raise exception 'El valor del gasto debe ser mayor que cero' using errcode = '22023';
  end if;
  if length(v_description) < 3 then
    raise exception 'Describe el gasto (mínimo 3 letras)' using errcode = '22023';
  end if;

  select name into v_category_name
    from public.expense_categories where id = v_category and is_active;
  if v_category_name is null then
    raise exception 'Elige una categoría de gasto' using errcode = '22023';
  end if;

  if v_supplier is not null and not exists (select 1 from public.suppliers where id = v_supplier) then
    raise exception 'El proveedor no existe' using errcode = '22023';
  end if;

  if v_from_drawer then
    select * into v_session from public.cash_sessions
     where id = private.open_session_id(v_branch) for update;
    -- The money left the drawer today, whatever date was typed.
    v_date := v_session.business_date;
  else
    v_date := coalesce(v_date, private.local_today());
    if v_date > private.local_today() then
      raise exception 'La fecha del gasto no puede ser futura' using errcode = '22023';
    end if;
    if v_date < private.local_today() - 400 then
      raise exception 'La fecha del gasto es demasiado antigua' using errcode = '22023';
    end if;
  end if;

  insert into public.expenses (branch_id, category_id, amount, description, expense_date, receipt_key,
                               cash_session_id, supplier_id, created_by)
  values (v_branch, v_category, v_amount, v_description, v_date, v_receipt,
          v_session.id, v_supplier, v_actor)
  returning id into v_id;

  if v_from_drawer then
    insert into public.cash_movements (cash_session_id, branch_id, kind, amount, reason, expense_id, created_by)
    values (v_session.id, v_branch, 'out', v_amount,
            left('Gasto · ' || v_category_name || ': ' || v_description, 200), v_id, v_actor);
  end if;

  perform private.audit(
    'expense.created', 'expense', v_id::text, v_branch,
    -- Money a cashier takes out of the drawer is worth a notification to the owner.
    case when v_from_drawer and not v_manager then 'warning' else 'info' end::public.audit_severity,
    jsonb_build_object('amount', v_amount, 'category', v_category_name, 'description', v_description,
                       'from_drawer', v_from_drawer)
  );
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- void_expense(id, reason): managers only. When the expense came out of a
-- drawer that is still open, the money goes back in with a compensating cash
-- movement so the closing still adds up.
-- -----------------------------------------------------------------------------
create or replace function public.void_expense(p_expense_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expense public.expenses;
  v_actor uuid;
  v_session_open boolean := false;
begin
  select * into v_expense from public.expenses where id = p_expense_id for update;
  if not found then
    raise exception 'El gasto no existe' using errcode = 'P0002';
  end if;
  v_actor := private.require_staff(array['owner', 'admin']::public.app_role[], v_expense.branch_id);

  if v_expense.voided_at is not null then
    raise exception 'Este gasto ya fue anulado' using errcode = 'P0001';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Escribe por qué se anula el gasto' using errcode = '22023';
  end if;

  update public.expenses
     set voided_at = now(), voided_by = v_actor, void_reason = trim(p_reason)
   where id = p_expense_id;

  if v_expense.cash_session_id is not null then
    select status = 'open' into v_session_open
      from public.cash_sessions where id = v_expense.cash_session_id for update;
    if v_session_open then
      insert into public.cash_movements (cash_session_id, branch_id, kind, amount, reason, expense_id, created_by)
      values (v_expense.cash_session_id, v_expense.branch_id, 'in', v_expense.amount,
              left('Gasto anulado: ' || v_expense.description, 200), v_expense.id, v_actor);
    end if;
  end if;

  perform private.audit(
    'expense.voided', 'expense', p_expense_id::text, v_expense.branch_id, 'warning',
    jsonb_build_object('amount', v_expense.amount, 'description', v_expense.description,
                       'reason', trim(p_reason), 'cash_returned', coalesce(v_session_open, false))
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Recurring (fixed monthly) expenses
-- payload: { id?, branch_id|null, category_id, name, amount, day_of_month, is_active }
-- -----------------------------------------------------------------------------
create or replace function public.save_recurring_expense(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := nullif(payload ->> 'id', '')::uuid;
  v_branch uuid := nullif(payload ->> 'branch_id', '')::uuid;
  v_category uuid := nullif(payload ->> 'category_id', '')::uuid;
  v_name text := trim(coalesce(payload ->> 'name', ''));
  v_amount numeric := (payload ->> 'amount')::numeric;
  v_day smallint := (payload ->> 'day_of_month')::smallint;
  v_active boolean := coalesce((payload ->> 'is_active')::boolean, true);
  v_old public.recurring_expenses;
begin
  perform private.require_staff(array['owner', 'admin']::public.app_role[], v_branch);

  if length(v_name) < 3 or length(v_name) > 80 then
    raise exception 'El nombre del gasto fijo debe tener entre 3 y 80 letras' using errcode = '22023';
  end if;
  if v_amount is null or v_amount <= 0 then
    raise exception 'El valor debe ser mayor que cero' using errcode = '22023';
  end if;
  if v_day is null or v_day not between 1 and 28 then
    raise exception 'El día del mes debe estar entre 1 y 28' using errcode = '22023';
  end if;
  if not exists (select 1 from public.expense_categories where id = v_category and is_active) then
    raise exception 'Elige una categoría de gasto' using errcode = '22023';
  end if;

  if v_id is null then
    insert into public.recurring_expenses (branch_id, category_id, name, amount, day_of_month, is_active)
    values (v_branch, v_category, v_name, v_amount, v_day, v_active)
    returning id into v_id;
    perform private.audit('expense.recurring_created', 'recurring_expense', v_id::text, v_branch, 'info',
                          jsonb_build_object('name', v_name, 'amount', v_amount, 'day', v_day));
  else
    select * into v_old from public.recurring_expenses where id = v_id for update;
    if not found then
      raise exception 'El gasto fijo no existe' using errcode = 'P0002';
    end if;
    update public.recurring_expenses
       set branch_id = v_branch, category_id = v_category, name = v_name, amount = v_amount,
           day_of_month = v_day, is_active = v_active
     where id = v_id;
    if v_old.amount is distinct from v_amount or v_old.is_active is distinct from v_active then
      perform private.audit('expense.recurring_changed', 'recurring_expense', v_id::text, v_branch, 'info',
                            jsonb_build_object('name', v_name, 'old_amount', v_old.amount, 'new_amount', v_amount,
                                               'is_active', v_active));
    end if;
  end if;
  return v_id;
end;
$$;

-- remove_recurring_expense(id) -> 'deleted' | 'archived'
-- Already generated months keep their expenses, so a used template is archived.
create or replace function public.remove_recurring_expense(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['owner', 'admin']::public.app_role[], null);
  if exists (select 1 from public.expenses where recurring_expense_id = p_id) then
    update public.recurring_expenses set is_active = false where id = p_id;
    return 'archived';
  end if;
  delete from public.recurring_expenses where id = p_id;
  return 'deleted';
end;
$$;

-- -----------------------------------------------------------------------------
-- generate_recurring_expenses(month) -> number of expenses created
-- Creates this month's fixed expenses whose day has arrived. Safe to call any
-- number of times: the unique (recurring_expense_id, recurring_month) key makes
-- each one appear once, and a voided one is not created again. The expenses
-- screen calls it on open; the Worker cron will call it daily.
-- -----------------------------------------------------------------------------
create or replace function public.generate_recurring_expenses(p_month date default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := private.local_today();
  v_month date := date_trunc('month', coalesce(p_month, v_today))::date;
  v_last_day integer;
  v_count integer;
begin
  perform private.require_manager_or_server();

  if v_month > v_today then
    return 0;
  end if;
  -- Past months: every day has arrived. Current month: only up to today.
  v_last_day := case when v_month = date_trunc('month', v_today)::date
                     then extract(day from v_today)::integer else 31 end;

  insert into public.expenses (branch_id, category_id, amount, description, expense_date,
                               recurring_expense_id, created_by)
  select r.branch_id, r.category_id, r.amount, r.name, v_month + (r.day_of_month - 1),
         r.id, (select auth.uid())
    from public.recurring_expenses r
   where r.is_active
     and r.day_of_month <= v_last_day
     -- Never back-fill months before the fixed expense existed.
     and date_trunc('month', r.created_at at time zone 'America/Bogota')::date <= v_month
  on conflict (recurring_expense_id, recurring_month) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- =============================================================================
-- Reports (owners and admins). Everything is computed from the frozen sale
-- snapshots: prices and recipe costs at the moment of the sale.
--
--   product sales  = subtotal - discount   (tips and delivery fees apart)
--   cost of goods  = orders.cost_total (recipe cost of what was sold)
--   gross profit   = product sales - cost of goods
--   inventory loss = cost of waste + cost of count shortages
--   net profit     = gross profit - inventory loss - expenses
--
-- p_branch_id null = both branches. Shared expenses (branch null) only count
-- toward the net profit of the whole business; per branch they are listed apart.
-- =============================================================================
create or replace function private.check_report_range(p_from date, p_to date)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'El rango de fechas no es válido' using errcode = '22023';
  end if;
  if p_to - p_from > 400 then
    raise exception 'El rango máximo de un reporte es de un año' using errcode = '22023';
  end if;
end;
$$;

create or replace function private.report_totals(p_branch_id uuid, p_from date, p_to date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with o as (
    select
      count(*) filter (where status = 'paid') as orders,
      coalesce(sum(greatest(subtotal - discount_amount, 0)) filter (where status = 'paid'), 0) as sales,
      coalesce(sum(discount_amount) filter (where status = 'paid'), 0) as discounts,
      coalesce(sum(tip_amount) filter (where status = 'paid'), 0) as tips,
      coalesce(sum(delivery_fee) filter (where status = 'paid'), 0) as delivery_fees,
      coalesce(sum(cost_total) filter (where status = 'paid'), 0) as cogs,
      count(*) filter (where status = 'cancelled') as cancelled_orders
    from public.orders
    where business_date between p_from and p_to
      and (p_branch_id is null or branch_id = p_branch_id)
  ),
  v as (
    select count(*) as voided_items, coalesce(sum(oi.line_total), 0) as voided_value
    from public.order_items oi
    join public.orders ord on ord.id = oi.order_id
    where oi.voided_at is not null
      and ord.business_date between p_from and p_to
      and (p_branch_id is null or ord.branch_id = p_branch_id)
  ),
  l as (
    select
      coalesce(sum(-sm.quantity * coalesce(sm.unit_cost, s.unit_cost))
               filter (where sm.movement_type = 'waste'), 0) as waste_cost,
      -- Only shortages count as a loss. Surpluses (including the initial stock
      -- load) are shown apart and never inflate the profit.
      coalesce(sum(-sm.quantity * coalesce(sm.unit_cost, s.unit_cost))
               filter (where sm.movement_type = 'adjustment' and sm.quantity < 0), 0) as adjustment_cost,
      coalesce(sum(sm.quantity * coalesce(sm.unit_cost, s.unit_cost))
               filter (where sm.movement_type = 'adjustment' and sm.quantity > 0), 0) as adjustment_surplus
    from public.stock_movements sm
    join public.supplies s on s.id = sm.supply_id
    where sm.movement_type in ('waste', 'adjustment')
      and private.business_date(sm.branch_id, sm.created_at) between p_from and p_to
      and (p_branch_id is null or sm.branch_id = p_branch_id)
  ),
  e as (
    select
      coalesce(sum(amount) filter (where branch_id is not null), 0) as branch_expenses,
      coalesce(sum(amount) filter (where branch_id is null), 0) as shared_expenses
    from public.expenses
    where voided_at is null
      and expense_date between p_from and p_to
      and (p_branch_id is null or branch_id = p_branch_id or branch_id is null)
  ),
  c as (
    select coalesce(sum(difference), 0) as cash_difference,
           count(*) filter (where difference < 0) as short_closings
    from public.cash_sessions
    where status = 'closed'
      and business_date between p_from and p_to
      and (p_branch_id is null or branch_id = p_branch_id)
  )
  select jsonb_build_object(
    'orders', o.orders,
    'sales', o.sales,
    'average_ticket', case when o.orders > 0 then round(o.sales / o.orders) else 0 end,
    'discounts', o.discounts,
    'tips', o.tips,
    'delivery_fees', o.delivery_fees,
    'cogs', o.cogs,
    'gross_profit', o.sales - o.cogs,
    'waste_cost', round(l.waste_cost),
    'adjustment_cost', round(l.adjustment_cost),
    'inventory_loss', round(l.waste_cost + l.adjustment_cost),
    'adjustment_surplus', round(l.adjustment_surplus),
    'expenses', e.branch_expenses + case when p_branch_id is null then e.shared_expenses else 0 end,
    'shared_expenses', e.shared_expenses,
    'net_profit', o.sales - o.cogs - round(l.waste_cost + l.adjustment_cost)
                  - e.branch_expenses - case when p_branch_id is null then e.shared_expenses else 0 end,
    'cancelled_orders', o.cancelled_orders,
    'voided_items', v.voided_items,
    'voided_value', v.voided_value,
    'cash_difference', c.cash_difference,
    'short_closings', c.short_closings
  )
  from o, v, l, e, c;
$$;

-- report_overview(branch, from, to) -> jsonb with totals, the previous period
-- of the same length, daily series, payment methods, busy hours, expense
-- categories and (for both branches) the comparison between branches.
create or replace function public.report_overview(p_branch_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days integer;
begin
  perform private.require_staff(array['owner', 'admin']::public.app_role[], p_branch_id);
  perform private.check_report_range(p_from, p_to);
  v_days := p_to - p_from + 1;

  return jsonb_build_object(
    'totals', private.report_totals(p_branch_id, p_from, p_to),
    'previous', private.report_totals(p_branch_id, p_from - v_days, p_from - 1),

    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'date', d.day::date, 'orders', coalesce(s.orders, 0), 'sales', coalesce(s.sales, 0),
               'cogs', coalesce(s.cogs, 0), 'expenses', coalesce(x.expenses, 0)) order by d.day), '[]'::jsonb)
      from generate_series(p_from, p_to, interval '1 day') as d (day)
      left join (
        select business_date, count(*) as orders,
               sum(greatest(subtotal - discount_amount, 0)) as sales, sum(cost_total) as cogs
        from public.orders
        where status = 'paid' and business_date between p_from and p_to
          and (p_branch_id is null or branch_id = p_branch_id)
        group by business_date
      ) s on s.business_date = d.day::date
      left join (
        select expense_date, sum(amount) as expenses
        from public.expenses
        where voided_at is null and expense_date between p_from and p_to
          and (case when p_branch_id is null then true else branch_id = p_branch_id end)
        group by expense_date
      ) x on x.expense_date = d.day::date
    ),

    'payment_methods', (
      select coalesce(jsonb_agg(jsonb_build_object('code', m.code, 'name', m.name, 'kind', m.kind,
                                                   'total', t.total, 'count', t.count)
                                order by t.total desc), '[]'::jsonb)
      from (
        select p.method_code, sum(p.amount) as total, count(distinct p.order_id) as count
        from public.payments p
        join public.orders o on o.id = p.order_id
        where o.status = 'paid' and o.business_date between p_from and p_to
          and (p_branch_id is null or o.branch_id = p_branch_id)
        group by p.method_code
      ) t
      join public.payment_methods m on m.code = t.method_code
    ),

    -- Busy hours: weekday (0 = Sunday) x hour of the local clock.
    'hours', (
      select coalesce(jsonb_agg(jsonb_build_object('dow', h.dow, 'hour', h.hour,
                                                   'orders', h.orders, 'sales', h.sales)), '[]'::jsonb)
      from (
        select extract(dow from o.paid_at at time zone s.timezone)::integer as dow,
               extract(hour from o.paid_at at time zone s.timezone)::integer as hour,
               count(*) as orders,
               sum(greatest(o.subtotal - o.discount_amount, 0)) as sales
        from public.orders o
        cross join public.app_settings s
        where o.status = 'paid' and o.business_date between p_from and p_to
          and (p_branch_id is null or o.branch_id = p_branch_id)
        group by 1, 2
      ) h
    ),

    'order_types', (
      select coalesce(jsonb_agg(jsonb_build_object('type', t.order_type, 'orders', t.orders, 'sales', t.sales)
                                order by t.sales desc), '[]'::jsonb)
      from (
        select order_type, count(*) as orders, sum(greatest(subtotal - discount_amount, 0)) as sales
        from public.orders
        where status = 'paid' and business_date between p_from and p_to
          and (p_branch_id is null or branch_id = p_branch_id)
        group by order_type
      ) t
    ),

    'expense_categories', (
      select coalesce(jsonb_agg(jsonb_build_object('name', c.name, 'total', t.total) order by t.total desc),
                      '[]'::jsonb)
      from (
        select category_id, sum(amount) as total
        from public.expenses
        where voided_at is null and expense_date between p_from and p_to
          and (case when p_branch_id is null then true else branch_id = p_branch_id end)
        group by category_id
      ) t
      join public.expense_categories c on c.id = t.category_id
    ),

    'branches', case when p_branch_id is null then (
      select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name)
                                || private.report_totals(b.id, p_from, p_to)
                                order by b.is_main desc, b.name), '[]'::jsonb)
      from public.branches b
      where b.is_active
    ) else '[]'::jsonb end
  );
end;
$$;

-- report_products(branch, from, to): what each size sold, what it cost and
-- what it left. Order-level discounts are not spread over the lines.
create or replace function public.report_products(p_branch_id uuid, p_from date, p_to date)
returns table (
  variant_id uuid,
  product_name text,
  variant_name text,
  category_name text,
  quantity bigint,
  sales numeric,
  cost numeric,
  profit numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['owner', 'admin']::public.app_role[], p_branch_id);
  perform private.check_report_range(p_from, p_to);

  return query
  select oi.variant_id,
         max(oi.product_name),
         max(oi.variant_name),
         max(c.name),
         sum(oi.quantity)::bigint,
         sum(oi.line_total),
         sum(oi.unit_cost * oi.quantity),
         sum(oi.line_total - oi.unit_cost * oi.quantity)
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    left join public.product_variants pv on pv.id = oi.variant_id
    left join public.products p on p.id = pv.product_id
    left join public.categories c on c.id = p.category_id
   where o.status = 'paid'
     and oi.voided_at is null
     and o.business_date between p_from and p_to
     and (p_branch_id is null or o.branch_id = p_branch_id)
   group by oi.variant_id
   order by sum(oi.line_total) desc;
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
    'public.record_expense(jsonb)',
    'public.void_expense(uuid, text)',
    'public.save_recurring_expense(jsonb)',
    'public.remove_recurring_expense(uuid)',
    'public.generate_recurring_expenses(date)',
    'public.report_overview(uuid, date, date)',
    'public.report_products(uuid, date, date)'
  ]
  loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;

  execute 'grant execute on function public.generate_recurring_expenses(date) to service_role';

  foreach fn in array array[
    'private.require_manager_or_server()',
    'private.local_today()',
    'private.check_report_range(date, date)',
    'private.report_totals(uuid, date, date)'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
  end loop;
end;
$$;
