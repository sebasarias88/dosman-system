-- =============================================================================
-- 09 · Sales functions: cash sessions, orders, payments, credit, stock usage
-- =============================================================================
-- Every money or stock change goes through these functions. They:
--   * check who is calling (active staff, right role, right branch),
--   * take prices and costs from the database (never from the screen),
--   * lock the rows they change so two devices can't double-charge an order,
--   * discount stock from recipes and record sensitive actions in the audit log.
-- =============================================================================

-- One open order per table.
create unique index orders_one_open_per_table_idx on public.orders (table_id) where status = 'open';

-- -----------------------------------------------------------------------------
-- Guards
-- -----------------------------------------------------------------------------

-- Raises unless the caller is active staff with one of the roles and access to the branch.
create or replace function private.require_staff(p_roles public.app_role[], p_branch_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.app_role := private.current_app_role();
begin
  if v_role is null or not (v_role = any (p_roles)) then
    raise exception 'No tienes permiso para hacer esto' using errcode = '42501';
  end if;
  if p_branch_id is not null and not private.can_access_branch(p_branch_id) then
    raise exception 'No tienes acceso a esta sede' using errcode = '42501';
  end if;
  return (select auth.uid());
end;
$$;

-- The open cash session of a branch, or an error explaining what to do.
create or replace function private.open_session_id(p_branch_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select id into v_id from public.cash_sessions where branch_id = p_branch_id and status = 'open';
  if v_id is null then
    raise exception 'La caja está cerrada. Abre el turno de caja para registrar ventas' using errcode = 'P0001';
  end if;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Cash sessions
-- -----------------------------------------------------------------------------
create or replace function public.open_cash_session(p_branch_id uuid, p_opening_amount numeric)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_staff(array['owner', 'admin', 'cashier']::public.app_role[], p_branch_id);
  v_id uuid;
begin
  if p_opening_amount is null or p_opening_amount < 0 then
    raise exception 'La base de caja no es válida' using errcode = '22023';
  end if;

  insert into public.cash_sessions (branch_id, business_date, opening_amount, opened_by)
  values (p_branch_id, private.business_date(p_branch_id), p_opening_amount, v_actor)
  returning id into v_id;

  perform private.audit('cash.open', 'cash_session', v_id::text, p_branch_id, 'info',
                        jsonb_build_object('opening_amount', p_opening_amount));
  return v_id;
exception
  when unique_violation then
    raise exception 'Ya hay un turno de caja abierto en esta sede' using errcode = 'P0001';
end;
$$;

-- Totals of a session. Runs with the caller's permissions (RLS applies).
create or replace function public.cash_session_summary(p_session_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with s as (
    select * from public.cash_sessions where id = p_session_id
  ),
  pay as (
    select p.method_code, m.name, m.kind, sum(p.amount) as total, count(distinct p.order_id) as orders
    from public.payments p
    join public.payment_methods m on m.code = p.method_code
    where p.cash_session_id = p_session_id
    group by p.method_code, m.name, m.kind, m.sort_order
    order by m.sort_order
  ),
  abonos as (
    select coalesce(sum(cp.amount) filter (where m.kind = 'cash'), 0) as cash,
           coalesce(sum(cp.amount), 0) as total
    from public.customer_payments cp
    join public.payment_methods m on m.code = cp.method_code
    where cp.cash_session_id = p_session_id
  ),
  moves as (
    select coalesce(sum(amount) filter (where kind = 'in'), 0) as cash_in,
           coalesce(sum(amount) filter (where kind = 'out'), 0) as cash_out
    from public.cash_movements where cash_session_id = p_session_id
  ),
  ord as (
    select count(*) filter (where status = 'paid') as paid_orders,
           count(*) filter (where status = 'cancelled') as cancelled_orders,
           coalesce(sum(total - tip_amount - delivery_fee) filter (where status = 'paid'), 0) as net_sales,
           coalesce(sum(tip_amount) filter (where status = 'paid'), 0) as tips,
           coalesce(sum(discount_amount) filter (where status = 'paid'), 0) as discounts,
           coalesce(sum(delivery_fee) filter (where status = 'paid'), 0) as delivery_fees,
           coalesce(sum(cost_total) filter (where status = 'paid'), 0) as cost
    from public.orders where cash_session_id = p_session_id
  ),
  voids as (
    select count(*) as voided_items
    from public.order_items oi
    where oi.voided_at is not null
      and oi.branch_id = (select branch_id from s)
      and oi.voided_at >= (select opened_at from s)
      and oi.voided_at <= coalesce((select closed_at from s), now())
  )
  select jsonb_build_object(
    'opening_amount', s.opening_amount,
    'by_method', coalesce((select jsonb_agg(jsonb_build_object(
        'method_code', method_code, 'name', name, 'kind', kind, 'total', total, 'orders', orders)) from pay), '[]'::jsonb),
    'cash_sales', coalesce((select sum(total) from pay where kind = 'cash'), 0),
    'credit_sales', coalesce((select sum(total) from pay where kind = 'credit'), 0),
    'customer_payments_cash', abonos.cash,
    'customer_payments_total', abonos.total,
    'cash_in', moves.cash_in,
    'cash_out', moves.cash_out,
    'expected_cash', s.opening_amount + coalesce((select sum(total) from pay where kind = 'cash'), 0)
                     + abonos.cash + moves.cash_in - moves.cash_out,
    'paid_orders', ord.paid_orders,
    'cancelled_orders', ord.cancelled_orders,
    'voided_items', voids.voided_items,
    'net_sales', ord.net_sales,
    'tips', ord.tips,
    'discounts', ord.discounts,
    'delivery_fees', ord.delivery_fees,
    'cost', ord.cost,
    'open_orders', (select count(*) from public.orders o where o.branch_id = s.branch_id and o.status = 'open')
  )
  from s, abonos, moves, ord, voids;
$$;

create or replace function public.add_cash_movement(
  p_session_id uuid,
  p_kind public.cash_movement_kind,
  p_amount numeric,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.cash_sessions;
  v_actor uuid;
  v_id uuid;
begin
  select * into v_session from public.cash_sessions where id = p_session_id for update;
  if not found then
    raise exception 'El turno de caja no existe' using errcode = 'P0002';
  end if;
  v_actor := private.require_staff(array['owner', 'admin', 'cashier']::public.app_role[], v_session.branch_id);
  if v_session.status <> 'open' then
    raise exception 'El turno de caja ya está cerrado' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'El valor debe ser mayor que cero' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Escribe el motivo del movimiento' using errcode = '22023';
  end if;

  insert into public.cash_movements (cash_session_id, branch_id, kind, amount, reason, created_by)
  values (p_session_id, v_session.branch_id, p_kind, p_amount, trim(p_reason), v_actor)
  returning id into v_id;

  perform private.audit('cash.' || case p_kind when 'in' then 'cash_in' else 'cash_out' end,
                        'cash_movement', v_id::text, v_session.branch_id, 'info',
                        jsonb_build_object('amount', p_amount, 'reason', trim(p_reason)));
  return v_id;
end;
$$;

create or replace function public.close_cash_session(p_session_id uuid, p_counted_cash numeric, p_notes text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.cash_sessions;
  v_actor uuid;
  v_summary jsonb;
  v_expected numeric;
  v_difference numeric;
  v_open_orders integer;
begin
  select * into v_session from public.cash_sessions where id = p_session_id for update;
  if not found then
    raise exception 'El turno de caja no existe' using errcode = 'P0002';
  end if;
  v_actor := private.require_staff(array['owner', 'admin', 'cashier']::public.app_role[], v_session.branch_id);
  if v_session.status <> 'open' then
    raise exception 'El turno de caja ya está cerrado' using errcode = 'P0001';
  end if;
  if p_counted_cash is null or p_counted_cash < 0 then
    raise exception 'Escribe cuánto dinero hay en la caja' using errcode = '22023';
  end if;

  select count(*) into v_open_orders
    from public.orders where branch_id = v_session.branch_id and status = 'open';
  if v_open_orders > 0 then
    raise exception 'Hay % pedido(s) sin cobrar. Cóbralos o anúlalos antes de cerrar la caja', v_open_orders
      using errcode = 'P0001';
  end if;

  v_summary := public.cash_session_summary(p_session_id);
  v_expected := (v_summary ->> 'expected_cash')::numeric;
  v_difference := p_counted_cash - v_expected;

  update public.cash_sessions
     set status = 'closed',
         expected_cash = v_expected,
         counted_cash = p_counted_cash,
         close_notes = nullif(trim(coalesce(p_notes, '')), ''),
         closed_by = v_actor,
         closed_at = now()
   where id = p_session_id;

  perform private.audit(
    'cash.close', 'cash_session', p_session_id::text, v_session.branch_id,
    case when v_difference < 0 then 'critical' when v_difference > 0 then 'warning' else 'info' end::public.audit_severity,
    jsonb_build_object('expected_cash', v_expected, 'counted_cash', p_counted_cash, 'difference', v_difference)
  );

  -- Daily summary for the owners (Telegram / push).
  insert into public.notification_outbox (kind, branch_id, payload)
  values ('cash_session_closed', v_session.branch_id,
          v_summary || jsonb_build_object('session_id', p_session_id, 'counted_cash', p_counted_cash,
                                          'difference', v_difference, 'closed_by', v_actor));

  return v_summary || jsonb_build_object('counted_cash', p_counted_cash, 'difference', v_difference);
end;
$$;

-- -----------------------------------------------------------------------------
-- Customers (delivery and credit). Staff can create them and fix their data.
-- payload: { id?, name, phone?, address?, notes? }
-- -----------------------------------------------------------------------------
create or replace function public.save_customer(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_staff(array['owner', 'admin', 'cashier']::public.app_role[], null);
  v_id uuid := nullif(payload ->> 'id', '')::uuid;
  v_phone text := nullif(regexp_replace(coalesce(payload ->> 'phone', ''), '[^0-9+]', '', 'g'), '');
begin
  if v_id is null then
    insert into public.customers (name, phone, address, notes, created_by)
    values (trim(payload ->> 'name'), v_phone, nullif(trim(payload ->> 'address'), ''),
            nullif(trim(payload ->> 'notes'), ''), v_actor)
    returning id into v_id;
  else
    update public.customers
       set name = trim(payload ->> 'name'),
           phone = v_phone,
           address = nullif(trim(payload ->> 'address'), ''),
           notes = nullif(trim(payload ->> 'notes'), '')
     where id = v_id;
    if not found then
      raise exception 'El cliente no existe' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
exception
  when unique_violation then
    raise exception 'Ya existe un cliente con ese teléfono' using errcode = '23505';
end;
$$;

-- -----------------------------------------------------------------------------
-- Orders: internal helpers
-- -----------------------------------------------------------------------------

-- Recomputes subtotal, cost and total from the non-voided items.
create or replace function private.recalculate_order(p_order_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.orders o
     set subtotal = t.subtotal,
         cost_total = t.cost,
         total = greatest(t.subtotal - o.discount_amount, 0) + o.tip_amount + o.delivery_fee
    from (
      select coalesce(sum(line_total), 0) as subtotal,
             coalesce(sum(unit_cost * quantity), 0) as cost
      from public.order_items
      where order_id = p_order_id and voided_at is null
    ) t
   where o.id = p_order_id;
$$;

-- Stock used by one item (its size recipe + each add-on recipe) × quantity.
-- p_sign = -1 consumes stock (sale), +1 returns it (void / cancellation).
create or replace function private.move_item_stock(p_item_id uuid, p_sign integer, p_actor uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.stock_movements (branch_id, supply_id, movement_type, quantity, unit_cost, order_item_id, created_by)
  select oi.branch_id,
         usage.supply_id,
         case when p_sign < 0 then 'sale' else 'sale_reversal' end::public.stock_movement_type,
         p_sign * sum(usage.quantity) * oi.quantity,
         s.unit_cost,
         oi.id,
         p_actor
  from public.order_items oi
  cross join lateral (
    select r.supply_id, r.quantity from public.recipe_items r where r.variant_id = oi.variant_id
    union all
    select r.supply_id, r.quantity
    from jsonb_array_elements(oi.add_ons) a
    join public.recipe_items r on r.add_on_id = (a ->> 'id')::uuid
  ) usage
  join public.supplies s on s.id = usage.supply_id
  where oi.id = p_item_id
  group by oi.branch_id, usage.supply_id, s.unit_cost, oi.id, oi.quantity;
$$;

-- Inserts items with database prices, add-on validation and recipe cost, and discounts stock.
-- p_items: [{ variant_id, quantity, add_on_ids: [uuid], notes? }]
create or replace function private.insert_order_items(p_order_id uuid, p_branch_id uuid, p_items jsonb, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_variant record;
  v_quantity integer;
  v_add_on_ids uuid[];
  v_add_ons jsonb;
  v_add_ons_price numeric;
  v_valid_add_ons integer;
  v_cost numeric;
  v_item_id uuid;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'El pedido no tiene productos' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    select pv.id, pv.name as variant_name, pv.price, p.id as product_id, p.name as product_name
      into v_variant
      from public.product_variants pv
      join public.products p on p.id = pv.product_id
     where pv.id = (v_item ->> 'variant_id')::uuid and pv.is_active and p.is_active;
    if not found then
      raise exception 'Un producto del pedido ya no está disponible' using errcode = 'P0001';
    end if;

    v_quantity := coalesce((v_item ->> 'quantity')::integer, 1);
    if v_quantity < 1 or v_quantity > 99 then
      raise exception 'La cantidad debe estar entre 1 y 99' using errcode = '22023';
    end if;

    select coalesce(array_agg(distinct value::uuid), '{}')
      into v_add_on_ids
      from jsonb_array_elements_text(coalesce(v_item -> 'add_on_ids', '[]'::jsonb));

    -- Only active add-ons that this product accepts.
    select count(*),
           coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'price', a.price) order by a.name), '[]'::jsonb),
           coalesce(sum(a.price), 0)
      into v_valid_add_ons, v_add_ons, v_add_ons_price
      from public.add_ons a
      join public.product_add_ons pa on pa.add_on_id = a.id and pa.product_id = v_variant.product_id
     where a.id = any (v_add_on_ids) and a.is_active;
    if v_valid_add_ons <> coalesce(array_length(v_add_on_ids, 1), 0) then
      raise exception 'Una adición no está disponible para %', v_variant.product_name using errcode = 'P0001';
    end if;

    -- Cost of one unit = size recipe + add-on recipes, at current supply costs.
    select coalesce(sum(r.quantity * s.unit_cost), 0)
      into v_cost
      from public.recipe_items r
      join public.supplies s on s.id = r.supply_id
     where r.variant_id = v_variant.id or r.add_on_id = any (v_add_on_ids);

    insert into public.order_items (
      order_id, branch_id, variant_id, product_name, variant_name, quantity, unit_price,
      add_ons, line_total, unit_cost, notes, created_by
    )
    values (
      p_order_id, p_branch_id, v_variant.id, v_variant.product_name, v_variant.variant_name, v_quantity,
      v_variant.price, v_add_ons, (v_variant.price + v_add_ons_price) * v_quantity, round(v_cost, 2),
      nullif(trim(coalesce(v_item ->> 'notes', '')), ''), p_actor
    )
    returning id into v_item_id;

    perform private.move_item_stock(v_item_id, -1, p_actor);
  end loop;

  perform private.recalculate_order(p_order_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- create_order(payload) -> order id
-- payload: {
--   branch_id, order_type, table_id?, park_note?, customer_id?, delivery_address?,
--   delivery_fee?, courier_name?, notes?, items: [...]
-- }
-- Waiters can open table and park orders (they never charge them).
-- -----------------------------------------------------------------------------
create or replace function public.create_order(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_branch_id uuid := (payload ->> 'branch_id')::uuid;
  v_type public.order_type := (payload ->> 'order_type')::public.order_type;
  v_role public.app_role;
  v_actor uuid;
  v_branch public.branches;
  v_table_id uuid := nullif(payload ->> 'table_id', '')::uuid;
  v_customer_id uuid := nullif(payload ->> 'customer_id', '')::uuid;
  v_address text := nullif(trim(coalesce(payload ->> 'delivery_address', '')), '');
  v_order_id uuid;
begin
  v_actor := private.require_staff(array['owner', 'admin', 'cashier', 'waiter']::public.app_role[], v_branch_id);
  v_role := private.current_app_role();
  select * into v_branch from public.branches where id = v_branch_id and is_active;
  if not found then
    raise exception 'La sede no existe' using errcode = 'P0002';
  end if;
  perform private.open_session_id(v_branch_id);

  if v_role = 'waiter' and v_type not in ('table', 'park') then
    raise exception 'Los meseros solo toman pedidos de mesa o parque' using errcode = '42501';
  end if;
  if v_type = 'park' and length(trim(coalesce(payload ->> 'park_note', ''))) < 2 then
    raise exception 'Escribe una seña para encontrar al cliente en el parque' using errcode = '22023';
  end if;
  if v_type = 'delivery' and not v_branch.takes_delivery then
    raise exception 'Esta sede no recibe domicilios' using errcode = 'P0001';
  end if;
  if v_type = 'table' then
    perform 1 from public.dining_tables where id = v_table_id and branch_id = v_branch_id and is_active;
    if not found then
      raise exception 'La mesa no existe en esta sede' using errcode = 'P0002';
    end if;
  else
    v_table_id := null;
  end if;
  if v_type = 'delivery' then
    if v_customer_id is null then
      raise exception 'Elige el cliente del domicilio' using errcode = '22023';
    end if;
    if v_address is null then
      select address into v_address from public.customers where id = v_customer_id;
    end if;
    if v_address is null then
      raise exception 'Escribe la dirección del domicilio' using errcode = '22023';
    end if;
  end if;

  insert into public.orders (
    branch_id, business_date, order_number, order_type, table_id, park_note, customer_id,
    delivery_address, delivery_fee, courier_name, waiter_id, notes, created_by
  )
  values (
    v_branch_id, current_date, 0, v_type, v_table_id,
    case when v_type = 'park' then nullif(trim(coalesce(payload ->> 'park_note', '')), '') end,
    v_customer_id,
    case when v_type = 'delivery' then v_address end,
    case when v_type = 'delivery' then coalesce((payload ->> 'delivery_fee')::numeric, 0) else 0 end,
    case when v_type = 'delivery' then nullif(trim(coalesce(payload ->> 'courier_name', '')), '') end,
    case when v_role = 'waiter' then v_actor else nullif(payload ->> 'waiter_id', '')::uuid end,
    nullif(trim(coalesce(payload ->> 'notes', '')), ''),
    v_actor
  )
  returning id into v_order_id;

  perform private.insert_order_items(v_order_id, v_branch_id, payload -> 'items', v_actor);
  return v_order_id;
exception
  when unique_violation then
    raise exception 'Esa mesa ya tiene un pedido abierto' using errcode = 'P0001';
end;
$$;

-- Adds items to an open order (e.g. the table orders another round).
create or replace function public.add_order_items(p_order_id uuid, p_items jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_actor uuid;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'El pedido no existe' using errcode = 'P0002';
  end if;
  v_actor := private.require_staff(array['owner', 'admin', 'cashier', 'waiter']::public.app_role[], v_order.branch_id);
  if v_order.status <> 'open' then
    raise exception 'El pedido ya está cerrado' using errcode = 'P0001';
  end if;
  perform private.insert_order_items(p_order_id, v_order.branch_id, p_items, v_actor);
end;
$$;

-- Voids one item and notifies the owner. Stock returns only if it was not prepared.
create or replace function public.void_order_item(p_item_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.order_items;
  v_order public.orders;
  v_actor uuid;
begin
  select * into v_item from public.order_items where id = p_item_id;
  if not found then
    raise exception 'El producto no existe en el pedido' using errcode = 'P0002';
  end if;
  select * into v_order from public.orders where id = v_item.order_id for update;
  v_actor := private.require_staff(array['owner', 'admin', 'cashier']::public.app_role[], v_order.branch_id);
  if v_order.status <> 'open' then
    raise exception 'Solo se pueden anular productos de pedidos sin cobrar' using errcode = 'P0001';
  end if;
  if v_item.voided_at is not null then
    raise exception 'Ese producto ya estaba anulado' using errcode = 'P0001';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Escribe el motivo de la anulación' using errcode = '22023';
  end if;

  update public.order_items
     set voided_at = now(), voided_by = v_actor, void_reason = trim(p_reason)
   where id = p_item_id;
  -- Stock only comes back if the item was not prepared yet. Once it is being
  -- prepared (or served) the supplies were used, so a void can't hide them.
  if v_item.prep_status = 'pending' then
    perform private.move_item_stock(p_item_id, 1, v_actor);
  end if;
  perform private.recalculate_order(v_order.id);

  perform private.audit('order_item.void', 'order_item', p_item_id::text, v_order.branch_id, 'warning',
    jsonb_build_object('order_number', v_order.order_number, 'product', v_item.product_name,
                       'variant', v_item.variant_name, 'quantity', v_item.quantity,
                       'amount', v_item.line_total, 'reason', trim(p_reason),
                       'prep_status', v_item.prep_status,
                       'stock_returned', v_item.prep_status = 'pending'));
end;
$$;

-- Cancels a whole unpaid order. Items not prepared yet return their stock.
create or replace function public.cancel_order(p_order_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_actor uuid;
  v_item_id uuid;
  v_prep_status public.prep_status;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'El pedido no existe' using errcode = 'P0002';
  end if;
  v_actor := private.require_staff(array['owner', 'admin', 'cashier']::public.app_role[], v_order.branch_id);
  if v_order.status <> 'open' then
    raise exception 'Solo se pueden anular pedidos sin cobrar' using errcode = 'P0001';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Escribe el motivo de la anulación' using errcode = '22023';
  end if;

  for v_item_id, v_prep_status in
    select id, prep_status from public.order_items where order_id = p_order_id and voided_at is null
  loop
    update public.order_items
       set voided_at = now(), voided_by = v_actor, void_reason = 'Pedido anulado: ' || trim(p_reason)
     where id = v_item_id;
    -- Same rule as a single void: prepared items keep their stock as used.
    if v_prep_status = 'pending' then
      perform private.move_item_stock(v_item_id, 1, v_actor);
    end if;
  end loop;

  update public.orders
     set status = 'cancelled', cancelled_at = now(), cancelled_by = v_actor, cancel_reason = trim(p_reason),
         cash_session_id = (select id from public.cash_sessions where branch_id = v_order.branch_id and status = 'open')
   where id = p_order_id;
  perform private.recalculate_order(p_order_id);

  perform private.audit('order.cancel', 'order', p_order_id::text, v_order.branch_id, 'warning',
    jsonb_build_object('order_number', v_order.order_number, 'amount', v_order.total, 'reason', trim(p_reason)));
end;
$$;

-- -----------------------------------------------------------------------------
-- pay_order(order_id, payload)
-- payload: {
--   discount_amount?, discount_reason?, tip_amount?,
--   payments: [{ method_code, amount, cash_received?, customer_id? }]
-- }
-- The payments must add up exactly to the total. Cash change is calculated here.
-- -----------------------------------------------------------------------------
create or replace function public.pay_order(p_order_id uuid, payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_actor uuid;
  v_session_id uuid;
  v_discount numeric := coalesce((payload ->> 'discount_amount')::numeric, 0);
  v_discount_reason text := nullif(trim(coalesce(payload ->> 'discount_reason', '')), '');
  v_tip numeric := coalesce((payload ->> 'tip_amount')::numeric, 0);
  v_total numeric;
  v_paid numeric := 0;
  v_payment jsonb;
  v_method public.payment_methods;
  v_amount numeric;
  v_received numeric;
  v_customer_id uuid;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'El pedido no existe' using errcode = 'P0002';
  end if;
  v_actor := private.require_staff(array['owner', 'admin', 'cashier']::public.app_role[], v_order.branch_id);
  if v_order.status <> 'open' then
    raise exception 'Este pedido ya fue cobrado o anulado' using errcode = 'P0001';
  end if;
  v_session_id := private.open_session_id(v_order.branch_id);

  if v_discount < 0 or v_tip < 0 then
    raise exception 'Descuento y propina no pueden ser negativos' using errcode = '22023';
  end if;
  if v_discount > v_order.subtotal then
    raise exception 'El descuento no puede ser mayor que el valor de los productos' using errcode = '22023';
  end if;
  if v_discount > 0 and length(coalesce(v_discount_reason, '')) < 3 then
    raise exception 'Escribe el motivo del descuento' using errcode = '22023';
  end if;
  if v_order.subtotal <= 0 then
    raise exception 'El pedido no tiene productos para cobrar' using errcode = 'P0001';
  end if;

  v_total := v_order.subtotal - v_discount + v_tip + v_order.delivery_fee;

  if jsonb_array_length(coalesce(payload -> 'payments', '[]'::jsonb)) = 0 then
    raise exception 'Elige cómo paga el cliente' using errcode = '22023';
  end if;

  for v_payment in select * from jsonb_array_elements(payload -> 'payments')
  loop
    select * into v_method from public.payment_methods
     where code = v_payment ->> 'method_code' and is_active;
    if not found then
      raise exception 'Método de pago no válido' using errcode = '22023';
    end if;
    v_amount := (v_payment ->> 'amount')::numeric;
    if v_amount is null or v_amount <= 0 then
      raise exception 'Cada pago debe ser mayor que cero' using errcode = '22023';
    end if;

    v_received := null;
    if v_method.kind = 'cash' then
      v_received := coalesce((v_payment ->> 'cash_received')::numeric, v_amount);
      if v_received < v_amount then
        raise exception 'El efectivo recibido no alcanza para el pago' using errcode = '22023';
      end if;
    end if;

    v_customer_id := null;
    if v_method.kind = 'credit' then
      v_customer_id := nullif(v_payment ->> 'customer_id', '')::uuid;
      if v_customer_id is null then
        raise exception 'Para fiar hay que elegir el cliente' using errcode = '22023';
      end if;
    end if;

    insert into public.payments (order_id, branch_id, cash_session_id, method_code, amount,
                                 cash_received, change_given, customer_id, created_by)
    values (p_order_id, v_order.branch_id, v_session_id, v_method.code, v_amount,
            v_received, case when v_received is not null then v_received - v_amount end,
            v_customer_id, v_actor);

    if v_method.kind = 'credit' then
      perform private.audit('order.credit_sale', 'order', p_order_id::text, v_order.branch_id, 'info',
        jsonb_build_object('order_number', v_order.order_number, 'amount', v_amount, 'customer_id', v_customer_id));
    end if;
    v_paid := v_paid + v_amount;
  end loop;

  if v_paid <> v_total then
    raise exception 'Los pagos suman % pero el total es %', v_paid, v_total using errcode = '22023';
  end if;

  update public.orders
     set discount_amount = v_discount,
         discount_reason = case when v_discount > 0 then v_discount_reason end,
         tip_amount = v_tip,
         total = v_total,
         status = 'paid',
         paid_at = now(),
         paid_by = v_actor,
         cash_session_id = v_session_id
   where id = p_order_id;

  if v_discount > 0 then
    perform private.audit('order.discount', 'order', p_order_id::text, v_order.branch_id, 'warning',
      jsonb_build_object('order_number', v_order.order_number, 'subtotal', v_order.subtotal,
                         'discount', v_discount, 'reason', v_discount_reason));
  end if;
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
    'public.open_cash_session(uuid, numeric)',
    'public.cash_session_summary(uuid)',
    'public.add_cash_movement(uuid, public.cash_movement_kind, numeric, text)',
    'public.close_cash_session(uuid, numeric, text)',
    'public.save_customer(jsonb)',
    'public.create_order(jsonb)',
    'public.add_order_items(uuid, jsonb)',
    'public.void_order_item(uuid, text)',
    'public.cancel_order(uuid, text)',
    'public.pay_order(uuid, jsonb)'
  ]
  loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;

  foreach fn in array array[
    'private.require_staff(public.app_role[], uuid)',
    'private.open_session_id(uuid)',
    'private.recalculate_order(uuid)',
    'private.move_item_stock(uuid, integer, uuid)',
    'private.insert_order_items(uuid, uuid, jsonb, uuid)'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
  end loop;
end;
$$;
