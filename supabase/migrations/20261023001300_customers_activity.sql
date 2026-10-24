-- =============================================================================
-- 13 · Customer credit (fiado): payments back (abonos), debts with age, and
--      archiving customers. The activity screen reads audit_log (managers only).
-- =============================================================================

-- What a customer owes right now, counting every branch. Used inside
-- security-definer functions, where RLS does not filter by branch.
create or replace function private.customer_balance(p_customer_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce((
      select sum(p.amount)
        from public.payments p
        join public.payment_methods m on m.code = p.method_code and m.kind = 'credit'
        join public.orders o on o.id = p.order_id and o.status = 'paid'
       where p.customer_id = p_customer_id
    ), 0)
    - coalesce((select sum(amount) from public.customer_payments where customer_id = p_customer_id), 0);
$$;

-- -----------------------------------------------------------------------------
-- customer_debts(): one row per customer with credit history.
-- oldest_unpaid_at follows FIFO: payments back cancel the oldest credit sales
-- first, so it is the date of the oldest sale that is still (partly) unpaid.
-- security invoker: a cashier only sees the credit of their own branch (RLS).
-- -----------------------------------------------------------------------------
create or replace function public.customer_debts()
returns table (
  customer_id uuid,
  name text,
  phone text,
  address text,
  is_active boolean,
  credit_total numeric,
  paid_total numeric,
  balance numeric,
  oldest_unpaid_at timestamptz,
  last_payment_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  with credits as (
    select p.customer_id, p.amount, p.created_at,
           sum(p.amount) over (partition by p.customer_id order by p.created_at, p.id) as running
      from public.payments p
      join public.payment_methods m on m.code = p.method_code and m.kind = 'credit'
      join public.orders o on o.id = p.order_id and o.status = 'paid'
     where p.customer_id is not null
  ),
  paid as (
    select customer_id, sum(amount) as total, max(created_at) as last_at
      from public.customer_payments
     group by customer_id
  ),
  totals as (
    select customer_id, sum(amount) as total from credits group by customer_id
  )
  select c.id, c.name, c.phone, c.address, c.is_active,
         coalesce(t.total, 0),
         coalesce(pd.total, 0),
         coalesce(t.total, 0) - coalesce(pd.total, 0),
         (select min(cr.created_at) from credits cr
           where cr.customer_id = c.id and cr.running > coalesce(pd.total, 0)),
         pd.last_at
    from public.customers c
    left join totals t on t.customer_id = c.id
    left join paid pd on pd.customer_id = c.id;
$$;

-- -----------------------------------------------------------------------------
-- record_customer_payment(payload) -> { id, balance_before, balance_after }
-- payload: { customer_id, branch_id, amount, method_code, notes }
-- The money enters the open cash session of the branch (cash counts toward
-- the drawer; Nequi / Daviplata go to accounts). Never more than what is owed.
-- -----------------------------------------------------------------------------
create or replace function public.record_customer_payment(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer uuid := nullif(payload ->> 'customer_id', '')::uuid;
  v_branch uuid := nullif(payload ->> 'branch_id', '')::uuid;
  v_amount numeric := (payload ->> 'amount')::numeric;
  v_method text := payload ->> 'method_code';
  v_notes text := nullif(trim(coalesce(payload ->> 'notes', '')), '');
  v_actor uuid := private.require_staff(array['owner', 'admin', 'cashier']::public.app_role[], v_branch);
  v_name text;
  v_kind public.payment_kind;
  v_session uuid;
  v_balance numeric;
  v_id uuid;
begin
  if v_branch is null then
    raise exception 'Falta la sede' using errcode = '22023';
  end if;

  -- Locking the customer serializes two abonos typed at the same time.
  select name into v_name from public.customers where id = v_customer for update;
  if v_name is null then
    raise exception 'El cliente no existe' using errcode = 'P0002';
  end if;

  select kind into v_kind from public.payment_methods where code = v_method and is_active;
  if v_kind is null or v_kind = 'credit' then
    raise exception 'Elige cómo pagó el cliente (efectivo, Nequi…)' using errcode = '22023';
  end if;

  if v_amount is null or v_amount <= 0 then
    raise exception 'El valor del abono debe ser mayor que cero' using errcode = '22023';
  end if;

  v_balance := private.customer_balance(v_customer);
  if v_balance <= 0 then
    raise exception '% no tiene deudas pendientes', v_name using errcode = 'P0001';
  end if;
  if v_amount > v_balance then
    raise exception 'El abono es mayor que la deuda (%)', '$ ' || replace(to_char(v_balance, 'FM999,999,999'), ',', '.')
      using errcode = '22023';
  end if;

  v_session := private.open_session_id(v_branch);

  insert into public.customer_payments (customer_id, branch_id, cash_session_id, method_code, amount, notes, created_by)
  values (v_customer, v_branch, v_session, v_method, v_amount, v_notes, v_actor)
  returning id into v_id;

  perform private.audit('customer.payment', 'customer', v_customer::text, v_branch, 'info',
    jsonb_build_object('customer', v_name, 'amount', v_amount, 'method', v_method,
                       'balance_after', v_balance - v_amount));

  return jsonb_build_object('id', v_id, 'balance_before', v_balance, 'balance_after', v_balance - v_amount);
end;
$$;

-- -----------------------------------------------------------------------------
-- set_customer_active(id, active): managers hide duplicates or old customers.
-- A customer who still owes money can't be hidden (the debt would be lost).
-- -----------------------------------------------------------------------------
create or replace function public.set_customer_active(p_customer_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['owner', 'admin']::public.app_role[], null);
  if not p_active and private.customer_balance(p_customer_id) > 0 then
    raise exception 'No se puede archivar un cliente que todavía debe' using errcode = 'P0001';
  end if;
  update public.customers set is_active = p_active where id = p_customer_id;
  if not found then
    raise exception 'El cliente no existe' using errcode = 'P0002';
  end if;
end;
$$;

-- Activity screen: filter by action family and date quickly.
create index if not exists audit_log_created_idx on public.audit_log (created_at desc);
create index if not exists audit_log_action_idx on public.audit_log (action, created_at desc);

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.customer_debts()',
    'public.record_customer_payment(jsonb)',
    'public.set_customer_active(uuid, boolean)'
  ]
  loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;

  execute 'revoke all on function private.customer_balance(uuid) from public, anon, authenticated';
end;
$$;
