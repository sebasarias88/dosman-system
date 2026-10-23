-- =============================================================================
-- 11 · Inventory functions: purchases, transfers, waste, physical counts
-- =============================================================================
-- Quantities are always in base units (g, ml, unit). Every change is a row in
-- stock_movements; supply_stock is updated by its trigger (migration 03).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Low-stock alert: when a supply drops to its minimum in a branch, the owners
-- get a notification (only when crossing the line, not on every sale).
-- -----------------------------------------------------------------------------
create or replace function private.notify_low_stock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_min numeric;
  v_name text;
begin
  select coalesce(new.min_quantity, s.default_min_quantity), s.name
    into v_min, v_name
    from public.supplies s where s.id = new.supply_id;
  if v_min > 0 and new.quantity <= v_min and (tg_op = 'INSERT' or old.quantity > v_min) then
    insert into public.notification_outbox (kind, branch_id, payload)
    values ('low_stock', new.branch_id,
            jsonb_build_object('supply_id', new.supply_id, 'supply', v_name,
                               'quantity', new.quantity, 'min_quantity', v_min));
  end if;
  return new;
end;
$$;

create trigger supply_stock_low_alert
  after insert or update of quantity on public.supply_stock
  for each row execute function private.notify_low_stock();

-- Validates [{ supply_id, quantity }] lines: positive quantities, active supplies, no repeats.
create or replace function private.require_supply_lines(p_lines jsonb)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Agrega al menos un insumo' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_lines) l
    where coalesce((l ->> 'quantity')::numeric, 0) <= 0
  ) then
    raise exception 'Las cantidades deben ser mayores que cero' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_array_elements(p_lines))
     <> (select count(distinct l ->> 'supply_id') from jsonb_array_elements(p_lines) l) then
    raise exception 'Hay un insumo repetido' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_lines) l
    left join public.supplies s on s.id = (l ->> 'supply_id')::uuid and s.is_active
    where s.id is null
  ) then
    raise exception 'Un insumo no existe o está desactivado' using errcode = '22023';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Transfers between branches
-- -----------------------------------------------------------------------------
create or replace function private.send_transfer(
  p_from uuid, p_to uuid, p_lines jsonb, p_notes text, p_actor uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform private.require_supply_lines(p_lines);
  if p_from = p_to then
    raise exception 'La sede de destino debe ser otra' using errcode = '22023';
  end if;
  perform 1 from public.branches where id = p_to and is_active;
  if not found then
    raise exception 'La sede de destino no existe' using errcode = 'P0002';
  end if;

  insert into public.transfers (from_branch_id, to_branch_id, notes, sent_by)
  values (p_from, p_to, nullif(trim(coalesce(p_notes, '')), ''), p_actor)
  returning id into v_id;

  insert into public.transfer_items (transfer_id, supply_id, quantity_sent)
  select v_id, (l ->> 'supply_id')::uuid, (l ->> 'quantity')::numeric
  from jsonb_array_elements(p_lines) l;

  insert into public.stock_movements (branch_id, supply_id, movement_type, quantity, unit_cost, transfer_id, created_by)
  select p_from, ti.supply_id, 'transfer_out', -ti.quantity_sent, s.unit_cost, v_id, p_actor
  from public.transfer_items ti join public.supplies s on s.id = ti.supply_id
  where ti.transfer_id = v_id;

  perform private.audit('transfer.send', 'transfer', v_id::text, p_from, 'info',
    jsonb_build_object('to_branch_id', p_to, 'lines', jsonb_array_length(p_lines)));
  return v_id;
end;
$$;

-- create_transfer(payload) -> transfer id
-- payload: { from_branch_id, to_branch_id, notes?, items: [{ supply_id, quantity }] }
create or replace function public.create_transfer(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from uuid := (payload ->> 'from_branch_id')::uuid;
  v_actor uuid := private.require_staff(array['owner', 'admin', 'cashier']::public.app_role[], v_from);
begin
  return private.send_transfer(v_from, (payload ->> 'to_branch_id')::uuid, payload -> 'items',
                               payload ->> 'notes', v_actor);
end;
$$;

-- receive_transfer(transfer_id, items, notes)
-- items: [{ supply_id, quantity_received }] — what actually arrived.
create or replace function public.receive_transfer(p_transfer_id uuid, p_items jsonb, p_notes text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_transfer public.transfers;
  v_actor uuid;
  v_missing numeric;
  v_status public.transfer_status;
  v_issues jsonb;
begin
  select * into v_transfer from public.transfers where id = p_transfer_id for update;
  if not found then
    raise exception 'El envío no existe' using errcode = 'P0002';
  end if;
  v_actor := private.require_staff(array['owner', 'admin', 'cashier']::public.app_role[], v_transfer.to_branch_id);
  if v_transfer.status <> 'sent' then
    raise exception 'Este envío ya fue recibido o cancelado' using errcode = 'P0001';
  end if;

  update public.transfer_items ti
     set quantity_received = greatest(coalesce((
           select (l ->> 'quantity_received')::numeric
           from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) l
           where (l ->> 'supply_id')::uuid = ti.supply_id
         ), ti.quantity_sent), 0)
   where ti.transfer_id = p_transfer_id;

  insert into public.stock_movements (branch_id, supply_id, movement_type, quantity, unit_cost, transfer_id, created_by)
  select v_transfer.to_branch_id, ti.supply_id, 'transfer_in', ti.quantity_received, s.unit_cost, p_transfer_id, v_actor
  from public.transfer_items ti join public.supplies s on s.id = ti.supply_id
  where ti.transfer_id = p_transfer_id and ti.quantity_received > 0;

  select coalesce(sum((ti.quantity_sent - ti.quantity_received) * s.unit_cost) filter (where ti.quantity_received < ti.quantity_sent), 0),
         coalesce(jsonb_agg(jsonb_build_object('supply', s.name, 'sent', ti.quantity_sent, 'received', ti.quantity_received, 'unit', s.unit))
                  filter (where ti.quantity_received <> ti.quantity_sent), '[]'::jsonb)
    into v_missing, v_issues
    from public.transfer_items ti join public.supplies s on s.id = ti.supply_id
   where ti.transfer_id = p_transfer_id;

  v_status := case when jsonb_array_length(v_issues) > 0 then 'received_with_issues' else 'received' end;
  if v_status = 'received_with_issues' and length(trim(coalesce(p_notes, ''))) < 3 then
    raise exception 'Escribe qué pasó con lo que no llegó completo' using errcode = '22023';
  end if;

  update public.transfers
     set status = v_status, received_by = v_actor, received_at = now(),
         receive_notes = nullif(trim(coalesce(p_notes, '')), '')
   where id = p_transfer_id;

  perform private.audit('transfer.receive', 'transfer', p_transfer_id::text, v_transfer.to_branch_id,
    case when v_status = 'received' then 'info' else 'warning' end::public.audit_severity,
    jsonb_build_object('status', v_status, 'missing_value', round(v_missing), 'differences', v_issues,
                       'notes', nullif(trim(coalesce(p_notes, '')), '')));
  return v_status::text;
end;
$$;

-- cancel_transfer: the sender takes it back before it is received.
create or replace function public.cancel_transfer(p_transfer_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_transfer public.transfers;
  v_actor uuid;
begin
  select * into v_transfer from public.transfers where id = p_transfer_id for update;
  if not found then
    raise exception 'El envío no existe' using errcode = 'P0002';
  end if;
  v_actor := private.require_staff(array['owner', 'admin', 'cashier']::public.app_role[], v_transfer.from_branch_id);
  if v_transfer.status <> 'sent' then
    raise exception 'Solo se pueden cancelar envíos que no se han recibido' using errcode = 'P0001';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Escribe el motivo' using errcode = '22023';
  end if;

  insert into public.stock_movements (branch_id, supply_id, movement_type, quantity, unit_cost, transfer_id, reason, created_by)
  select v_transfer.from_branch_id, ti.supply_id, 'transfer_in', ti.quantity_sent, s.unit_cost, p_transfer_id,
         'Envío cancelado: ' || trim(p_reason), v_actor
  from public.transfer_items ti join public.supplies s on s.id = ti.supply_id
  where ti.transfer_id = p_transfer_id;

  update public.transfers
     set status = 'cancelled', receive_notes = 'Cancelado: ' || trim(p_reason)
   where id = p_transfer_id;

  perform private.audit('transfer.cancel', 'transfer', p_transfer_id::text, v_transfer.from_branch_id, 'warning',
    jsonb_build_object('reason', trim(p_reason)));
end;
$$;

-- -----------------------------------------------------------------------------
-- record_purchase(payload) -> purchase id
-- Merchandise arrives at the MAIN branch. Part of it can be sent right away to
-- another branch (one transfer created in the same transaction).
-- payload: {
--   branch_id, supplier_id?, notes?, receipt_key?,
--   items: [{ supply_id, quantity, line_total }],          -- quantity in base units
--   send: { to_branch_id, items: [{ supply_id, quantity }] }?,
--   payment: { kind: 'cash_drawer' | 'other' | 'credit', method_code? }
-- }
-- -----------------------------------------------------------------------------
create or replace function public.record_purchase(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_branch_id uuid := (payload ->> 'branch_id')::uuid;
  v_actor uuid := private.require_staff(array['owner', 'admin', 'cashier']::public.app_role[], v_branch_id);
  v_supplier_id uuid := nullif(payload ->> 'supplier_id', '')::uuid;
  v_payment_kind text := coalesce(payload #>> '{payment,kind}', 'other');
  v_method text := coalesce(nullif(payload #>> '{payment,method_code}', ''), 'cash');
  v_purchase_id uuid;
  v_total numeric;
  v_line jsonb;
  v_supply_id uuid;
  v_quantity numeric;
  v_unit_cost numeric;
  v_stock numeric;
  v_supplier_name text;
  v_transfer_id uuid;
begin
  perform 1 from public.branches where id = v_branch_id and is_main;
  if not found then
    raise exception 'Las compras se registran en la sede principal' using errcode = 'P0001';
  end if;
  perform private.require_supply_lines(payload -> 'items');
  if exists (
    select 1 from jsonb_array_elements(payload -> 'items') l
    where coalesce((l ->> 'line_total')::numeric, -1) < 0
  ) then
    raise exception 'Escribe cuánto se pagó por cada insumo' using errcode = '22023';
  end if;
  if v_payment_kind not in ('cash_drawer', 'other', 'credit') then
    raise exception 'Forma de pago no válida' using errcode = '22023';
  end if;
  if v_payment_kind = 'credit' and v_supplier_id is null then
    raise exception 'Para comprar a crédito elige el proveedor' using errcode = '22023';
  end if;
  if v_supplier_id is not null then
    select name into v_supplier_name from public.suppliers where id = v_supplier_id;
  end if;

  select sum((l ->> 'line_total')::numeric) into v_total from jsonb_array_elements(payload -> 'items') l;

  insert into public.purchases (branch_id, supplier_id, total, notes, receipt_key, created_by)
  values (v_branch_id, v_supplier_id, v_total, nullif(trim(coalesce(payload ->> 'notes', '')), ''),
          nullif(payload ->> 'receipt_key', ''), v_actor)
  returning id into v_purchase_id;

  for v_line in select * from jsonb_array_elements(payload -> 'items')
  loop
    v_supply_id := (v_line ->> 'supply_id')::uuid;
    v_quantity := (v_line ->> 'quantity')::numeric;
    v_unit_cost := (v_line ->> 'line_total')::numeric / v_quantity;

    insert into public.purchase_items (purchase_id, supply_id, quantity, unit_cost, line_total)
    values (v_purchase_id, v_supply_id, v_quantity, v_unit_cost, (v_line ->> 'line_total')::numeric);

    -- Weighted average cost over the stock of every branch (same supply everywhere).
    select coalesce(sum(greatest(quantity, 0)), 0) into v_stock
      from public.supply_stock where supply_id = v_supply_id;
    update public.supplies s
       set unit_cost = round(
             case when v_stock <= 0 then v_unit_cost
                  else (s.unit_cost * v_stock + v_unit_cost * v_quantity) / (v_stock + v_quantity) end, 4)
     where s.id = v_supply_id;

    insert into public.stock_movements (branch_id, supply_id, movement_type, quantity, unit_cost, purchase_id, created_by)
    values (v_branch_id, v_supply_id, 'purchase', v_quantity, v_unit_cost, v_purchase_id, v_actor);
  end loop;

  -- How it was paid.
  if v_payment_kind = 'cash_drawer' and v_total > 0 then
    insert into public.cash_movements (cash_session_id, branch_id, kind, amount, reason, created_by)
    values (private.open_session_id(v_branch_id), v_branch_id, 'out', v_total,
            'Compra' || coalesce(' a ' || v_supplier_name, '') , v_actor);
  end if;
  if v_supplier_id is not null and v_payment_kind <> 'credit' and v_total > 0 then
    insert into public.supplier_payments (supplier_id, purchase_id, amount, method_code, notes, created_by)
    values (v_supplier_id, v_purchase_id, v_total,
            case when v_payment_kind = 'cash_drawer' then 'cash' else v_method end,
            'Pagado al recibir', v_actor);
  end if;

  -- Part of the merchandise goes straight to another branch.
  if payload ? 'send' and jsonb_array_length(coalesce(payload #> '{send,items}', '[]'::jsonb)) > 0 then
    v_transfer_id := private.send_transfer(
      v_branch_id, (payload #>> '{send,to_branch_id}')::uuid, payload #> '{send,items}',
      'Desde la compra' || coalesce(' a ' || v_supplier_name, ''), v_actor);
  end if;

  perform private.audit('purchase.create', 'purchase', v_purchase_id::text, v_branch_id, 'info',
    jsonb_build_object('total', v_total, 'supplier', v_supplier_name, 'payment', v_payment_kind,
                       'transfer_id', v_transfer_id));
  return v_purchase_id;
end;
$$;

-- pay_supplier(supplier_id, amount, method_code, from_cash_drawer, notes)
create or replace function public.pay_supplier(
  p_supplier_id uuid, p_amount numeric, p_method_code text, p_from_cash_drawer boolean, p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_main uuid := (select id from public.branches where is_main);
  v_actor uuid := private.require_staff(array['owner', 'admin', 'cashier']::public.app_role[], v_main);
  v_id uuid;
  v_name text;
begin
  select name into v_name from public.suppliers where id = p_supplier_id;
  if not found then
    raise exception 'El proveedor no existe' using errcode = 'P0002';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'El valor debe ser mayor que cero' using errcode = '22023';
  end if;

  insert into public.supplier_payments (supplier_id, amount, method_code, notes, created_by)
  values (p_supplier_id, p_amount, case when p_from_cash_drawer then 'cash' else p_method_code end,
          nullif(trim(coalesce(p_notes, '')), ''), v_actor)
  returning id into v_id;

  if p_from_cash_drawer then
    insert into public.cash_movements (cash_session_id, branch_id, kind, amount, reason, created_by)
    values (private.open_session_id(v_main), v_main, 'out', p_amount, 'Pago a proveedor ' || v_name, v_actor);
  end if;

  perform private.audit('supplier.payment', 'supplier', p_supplier_id::text, v_main, 'info',
    jsonb_build_object('supplier', v_name, 'amount', p_amount, 'from_cash_drawer', p_from_cash_drawer));
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- record_waste(branch_id, supply_id, quantity, reason): damaged / expired.
-- -----------------------------------------------------------------------------
create or replace function public.record_waste(p_branch_id uuid, p_supply_id uuid, p_quantity numeric, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_staff(array['owner', 'admin', 'cashier', 'kitchen']::public.app_role[], p_branch_id);
  v_supply public.supplies;
begin
  select * into v_supply from public.supplies where id = p_supply_id;
  if not found then
    raise exception 'El insumo no existe' using errcode = 'P0002';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'La cantidad debe ser mayor que cero' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Escribe el motivo de la merma' using errcode = '22023';
  end if;

  insert into public.stock_movements (branch_id, supply_id, movement_type, quantity, unit_cost, reason, created_by)
  values (p_branch_id, p_supply_id, 'waste', -p_quantity, v_supply.unit_cost, trim(p_reason), v_actor);

  perform private.audit('inventory.waste', 'supply', p_supply_id::text, p_branch_id, 'warning',
    jsonb_build_object('supply', v_supply.name, 'unit', v_supply.unit, 'quantity', p_quantity,
                       'value', round(p_quantity * v_supply.unit_cost), 'reason', trim(p_reason)));
end;
$$;

-- -----------------------------------------------------------------------------
-- apply_inventory_count(branch_id, items, notes) -> count id
-- Blind count: staff type what is on the shelf; the system compares it with
-- what should be there and corrects the stock with 'adjustment' movements.
-- items: [{ supply_id, counted_quantity }]
-- -----------------------------------------------------------------------------
create or replace function public.apply_inventory_count(p_branch_id uuid, p_items jsonb, p_notes text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_staff(array['owner', 'admin', 'cashier']::public.app_role[], p_branch_id);
  v_count_id uuid;
  v_shortage numeric;
  v_surplus numeric;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'No hay insumos contados' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) l where (l ->> 'counted_quantity')::numeric < 0) then
    raise exception 'Las cantidades contadas no pueden ser negativas' using errcode = '22023';
  end if;

  insert into public.inventory_counts (branch_id, status, notes, created_by, applied_at)
  values (p_branch_id, 'applied', nullif(trim(coalesce(p_notes, '')), ''), v_actor, now())
  returning id into v_count_id;

  insert into public.inventory_count_items (count_id, supply_id, expected_quantity, counted_quantity)
  select v_count_id, (l ->> 'supply_id')::uuid, coalesce(st.quantity, 0), (l ->> 'counted_quantity')::numeric
  from jsonb_array_elements(p_items) l
  left join public.supply_stock st on st.branch_id = p_branch_id and st.supply_id = (l ->> 'supply_id')::uuid;

  insert into public.stock_movements (branch_id, supply_id, movement_type, quantity, unit_cost, count_id, reason, created_by)
  select p_branch_id, ci.supply_id, 'adjustment', ci.difference, s.unit_cost, v_count_id, 'Conteo físico', v_actor
  from public.inventory_count_items ci join public.supplies s on s.id = ci.supply_id
  where ci.count_id = v_count_id and ci.difference <> 0;

  select coalesce(sum(-ci.difference * s.unit_cost) filter (where ci.difference < 0), 0),
         coalesce(sum(ci.difference * s.unit_cost) filter (where ci.difference > 0), 0)
    into v_shortage, v_surplus
    from public.inventory_count_items ci join public.supplies s on s.id = ci.supply_id
   where ci.count_id = v_count_id;

  perform private.audit('inventory.count', 'inventory_count', v_count_id::text, p_branch_id,
    case when v_shortage > 0 then 'warning' else 'info' end::public.audit_severity,
    jsonb_build_object('items', jsonb_array_length(p_items), 'shortage_value', round(v_shortage),
                       'surplus_value', round(v_surplus)));
  return v_count_id;
exception
  when unique_violation then
    raise exception 'Hay un insumo repetido en el conteo' using errcode = '22023';
end;
$$;

-- -----------------------------------------------------------------------------
-- set_min_stock(branch_id, supply_id, min_quantity): low-stock threshold per branch.
-- -----------------------------------------------------------------------------
create or replace function public.set_min_stock(p_branch_id uuid, p_supply_id uuid, p_min_quantity numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['owner', 'admin']::public.app_role[], p_branch_id);
  if p_min_quantity is not null and p_min_quantity < 0 then
    raise exception 'El mínimo no puede ser negativo' using errcode = '22023';
  end if;
  insert into public.supply_stock (branch_id, supply_id, quantity, min_quantity)
  values (p_branch_id, p_supply_id, 0, p_min_quantity)
  on conflict (branch_id, supply_id) do update set min_quantity = excluded.min_quantity;
end;
$$;

-- save_supplier(payload): RLS only lets managers write suppliers, but the cashier
-- of the main branch must be able to add one while receiving merchandise.
create or replace function public.save_supplier(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_main uuid := (select id from public.branches where is_main);
  v_id uuid := nullif(payload ->> 'id', '')::uuid;
begin
  perform private.require_staff(array['owner', 'admin', 'cashier']::public.app_role[], v_main);
  if v_id is null then
    insert into public.suppliers (name, phone, notes)
    values (trim(payload ->> 'name'), nullif(trim(payload ->> 'phone'), ''), nullif(trim(payload ->> 'notes'), ''))
    returning id into v_id;
  else
    update public.suppliers
       set name = trim(payload ->> 'name'),
           phone = nullif(trim(payload ->> 'phone'), ''),
           notes = nullif(trim(payload ->> 'notes'), '')
     where id = v_id;
  end if;
  return v_id;
exception
  when unique_violation then
    raise exception 'Ya existe un proveedor con ese nombre' using errcode = '23505';
end;
$$;

-- Realtime: the receiving branch sees new transfers right away.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.transfers;
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
    'public.create_transfer(jsonb)',
    'public.receive_transfer(uuid, jsonb, text)',
    'public.cancel_transfer(uuid, text)',
    'public.record_purchase(jsonb)',
    'public.pay_supplier(uuid, numeric, text, boolean, text)',
    'public.record_waste(uuid, uuid, numeric, text)',
    'public.apply_inventory_count(uuid, jsonb, text)',
    'public.set_min_stock(uuid, uuid, numeric)',
    'public.save_supplier(jsonb)'
  ]
  loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;

  foreach fn in array array[
    'private.notify_low_stock()',
    'private.require_supply_lines(jsonb)',
    'private.send_transfer(uuid, uuid, jsonb, text, uuid)'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
  end loop;
end;
$$;
