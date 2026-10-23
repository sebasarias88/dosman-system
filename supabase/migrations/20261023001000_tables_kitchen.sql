-- =============================================================================
-- 10 · Tables and kitchen: preparation states, moving tables, realtime
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Items remember whether they go to preparation (copied from the product at
-- sale time). Items that need no preparation (e.g. a bottled drink) start as
-- 'served' so they never appear on the preparation screen.
-- -----------------------------------------------------------------------------
alter table public.order_items
  add column requires_preparation boolean not null default true;

create index order_items_kitchen_idx on public.order_items (branch_id, prep_status)
  where voided_at is null and requires_preparation and prep_status <> 'served';

-- Same as migration 09, plus requires_preparation and the initial prep status.
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
    select pv.id, pv.name as variant_name, pv.price, p.id as product_id, p.name as product_name,
           p.requires_preparation
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

    select coalesce(sum(r.quantity * s.unit_cost), 0)
      into v_cost
      from public.recipe_items r
      join public.supplies s on s.id = r.supply_id
     where r.variant_id = v_variant.id or r.add_on_id = any (v_add_on_ids);

    insert into public.order_items (
      order_id, branch_id, variant_id, product_name, variant_name, quantity, unit_price,
      add_ons, line_total, unit_cost, notes, requires_preparation, prep_status, created_by
    )
    values (
      p_order_id, p_branch_id, v_variant.id, v_variant.product_name, v_variant.variant_name, v_quantity,
      v_variant.price, v_add_ons, (v_variant.price + v_add_ons_price) * v_quantity, round(v_cost, 2),
      nullif(trim(coalesce(v_item ->> 'notes', '')), ''), v_variant.requires_preparation,
      case when v_variant.requires_preparation then 'pending' else 'served' end::public.prep_status,
      p_actor
    )
    returning id into v_item_id;

    perform private.move_item_stock(v_item_id, -1, p_actor);
  end loop;

  perform private.recalculate_order(p_order_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- Voids: stock returns when the item was not prepared yet, or when it needs no
-- preparation at all (a bottled drink goes back to the shelf).
-- -----------------------------------------------------------------------------
create or replace function private.returns_stock_on_void(p_item public.order_items)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select not p_item.requires_preparation or p_item.prep_status = 'pending';
$$;

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
  v_returns boolean;
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

  v_returns := private.returns_stock_on_void(v_item);
  update public.order_items
     set voided_at = now(), voided_by = v_actor, void_reason = trim(p_reason)
   where id = p_item_id;
  if v_returns then
    perform private.move_item_stock(p_item_id, 1, v_actor);
  end if;
  perform private.recalculate_order(v_order.id);

  perform private.audit('order_item.void', 'order_item', p_item_id::text, v_order.branch_id, 'warning',
    jsonb_build_object('order_number', v_order.order_number, 'product', v_item.product_name,
                       'variant', v_item.variant_name, 'quantity', v_item.quantity,
                       'amount', v_item.line_total, 'reason', trim(p_reason),
                       'prep_status', v_item.prep_status, 'stock_returned', v_returns));
end;
$$;

create or replace function public.cancel_order(p_order_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_actor uuid;
  v_item public.order_items;
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

  for v_item in
    select * from public.order_items where order_id = p_order_id and voided_at is null
  loop
    update public.order_items
       set voided_at = now(), voided_by = v_actor, void_reason = 'Pedido anulado: ' || trim(p_reason)
     where id = v_item.id;
    if private.returns_stock_on_void(v_item) then
      perform private.move_item_stock(v_item.id, 1, v_actor);
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
-- set_prep_status(item_ids, status): preparation screen and waiters.
-- Kitchen moves items to 'preparing' / 'ready'; whoever delivers marks 'served'.
-- Works for paid orders too: counter orders are paid first and prepared after.
-- -----------------------------------------------------------------------------
create or replace function public.set_prep_status(p_item_ids uuid[], p_status public.prep_status)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_branch_ids uuid[];
  v_branch_id uuid;
  v_count integer;
begin
  if p_item_ids is null or array_length(p_item_ids, 1) is null then
    return 0;
  end if;

  select array_agg(distinct branch_id) into v_branch_ids
    from public.order_items where id = any (p_item_ids);
  if v_branch_ids is null then
    raise exception 'Los productos no existen' using errcode = 'P0002';
  end if;
  foreach v_branch_id in array v_branch_ids
  loop
    perform private.require_staff(
      array['owner', 'admin', 'cashier', 'waiter', 'kitchen']::public.app_role[], v_branch_id);
  end loop;

  update public.order_items oi
     set prep_status = p_status
    from public.orders o
   where oi.id = any (p_item_ids)
     and o.id = oi.order_id
     and o.status <> 'cancelled'
     and oi.voided_at is null
     and oi.requires_preparation;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- -----------------------------------------------------------------------------
-- move_order_table(order_id, table_id): the customers changed tables.
-- -----------------------------------------------------------------------------
create or replace function public.move_order_table(p_order_id uuid, p_table_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_from text;
  v_to text;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'El pedido no existe' using errcode = 'P0002';
  end if;
  perform private.require_staff(array['owner', 'admin', 'cashier', 'waiter']::public.app_role[], v_order.branch_id);
  if v_order.status <> 'open' or v_order.order_type <> 'table' then
    raise exception 'Solo se pueden mover pedidos de mesa sin cobrar' using errcode = 'P0001';
  end if;

  select name into v_to from public.dining_tables
   where id = p_table_id and branch_id = v_order.branch_id and is_active;
  if not found then
    raise exception 'La mesa no existe en esta sede' using errcode = 'P0002';
  end if;
  select name into v_from from public.dining_tables where id = v_order.table_id;

  update public.orders set table_id = p_table_id where id = p_order_id;

  perform private.audit('order.move_table', 'order', p_order_id::text, v_order.branch_id, 'info',
    jsonb_build_object('order_number', v_order.order_number, 'from', v_from, 'to', v_to));
exception
  when unique_violation then
    raise exception 'La mesa % ya tiene un pedido abierto', v_to using errcode = 'P0001';
end;
$$;

-- -----------------------------------------------------------------------------
-- Realtime: screens refresh as soon as another device changes an order.
-- Supabase Realtime respects RLS, so each device only receives its branch.
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.orders, public.order_items;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------
revoke all on function public.set_prep_status(uuid[], public.prep_status) from public, anon;
revoke all on function public.move_order_table(uuid, uuid) from public, anon;
grant execute on function public.set_prep_status(uuid[], public.prep_status) to authenticated;
grant execute on function public.move_order_table(uuid, uuid) to authenticated;
revoke all on function private.returns_stock_on_void(public.order_items) from public, anon, authenticated;
revoke all on function private.insert_order_items(uuid, uuid, jsonb, uuid) from public, anon, authenticated;
