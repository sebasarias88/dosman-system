-- =============================================================================
-- 08 · Catalog functions: save products / add-ons atomically, archive or delete
-- =============================================================================
-- A product is saved together with its sizes, their recipes and the add-ons it
-- accepts in ONE transaction, so the catalog never ends up half-saved.
-- Anything that already appears in a sale is archived (hidden) instead of
-- deleted, so past tickets and reports keep their history.
-- =============================================================================

create or replace function private.require_manager()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_manager() then
    raise exception 'No tienes permiso para modificar el catálogo' using errcode = '42501';
  end if;
end;
$$;

-- Replaces the recipe lines of one size or one add-on.
-- p_lines: [{ "supply_id": uuid, "quantity": number }]
create or replace function private.replace_recipe(p_variant_id uuid, p_add_on_id uuid, p_lines jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  line jsonb;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    p_lines := '[]'::jsonb;
  end if;

  if p_variant_id is not null then
    delete from public.recipe_items where variant_id = p_variant_id;
  else
    delete from public.recipe_items where add_on_id = p_add_on_id;
  end if;

  for line in select * from jsonb_array_elements(p_lines)
  loop
    if (line ->> 'quantity')::numeric <= 0 then
      raise exception 'Las cantidades de la receta deben ser mayores que cero' using errcode = '22023';
    end if;
    insert into public.recipe_items (variant_id, add_on_id, supply_id, quantity)
    values (p_variant_id, p_add_on_id, (line ->> 'supply_id')::uuid, (line ->> 'quantity')::numeric);
  end loop;
exception
  when unique_violation then
    -- 22023 (not 23505) so the caller's own unique_violation handler doesn't rewrite this message.
    raise exception 'Un insumo está repetido en la misma receta' using errcode = '22023';
end;
$$;

-- -----------------------------------------------------------------------------
-- save_product(payload) -> product id
-- payload: {
--   id?, category_id, name, description?, image_key?, requires_preparation, is_active,
--   variants: [{ id?, name, price, is_active, recipe: [{ supply_id, quantity }] }],
--   add_on_ids: [uuid]
-- }
-- -----------------------------------------------------------------------------
create or replace function public.save_product(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product_id uuid := nullif(payload ->> 'id', '')::uuid;
  v_variant jsonb;
  v_variant_id uuid;
  v_kept uuid[] := '{}';
  v_position integer := 0;
begin
  perform private.require_manager();

  if jsonb_array_length(coalesce(payload -> 'variants', '[]'::jsonb)) = 0 then
    raise exception 'El producto necesita al menos un tamaño con precio' using errcode = '22023';
  end if;

  if v_product_id is null then
    insert into public.products (category_id, name, description, image_key, requires_preparation, is_active)
    values (
      (payload ->> 'category_id')::uuid,
      trim(payload ->> 'name'),
      nullif(trim(payload ->> 'description'), ''),
      nullif(payload ->> 'image_key', ''),
      coalesce((payload ->> 'requires_preparation')::boolean, true),
      coalesce((payload ->> 'is_active')::boolean, true)
    )
    returning id into v_product_id;
  else
    update public.products
       set category_id = (payload ->> 'category_id')::uuid,
           name = trim(payload ->> 'name'),
           description = nullif(trim(payload ->> 'description'), ''),
           image_key = nullif(payload ->> 'image_key', ''),
           requires_preparation = coalesce((payload ->> 'requires_preparation')::boolean, true),
           is_active = coalesce((payload ->> 'is_active')::boolean, true)
     where id = v_product_id;
    if not found then
      raise exception 'El producto no existe' using errcode = 'P0002';
    end if;
  end if;

  for v_variant in select * from jsonb_array_elements(payload -> 'variants')
  loop
    v_position := v_position + 1;
    v_variant_id := nullif(v_variant ->> 'id', '')::uuid;

    if v_variant_id is not null then
      update public.product_variants
         set name = trim(v_variant ->> 'name'),
             price = (v_variant ->> 'price')::numeric,
             is_active = coalesce((v_variant ->> 'is_active')::boolean, true),
             sort_order = v_position
       where id = v_variant_id and product_id = v_product_id;
      if not found then
        raise exception 'Un tamaño no pertenece a este producto' using errcode = '22023';
      end if;
    else
      insert into public.product_variants (product_id, name, price, is_active, sort_order)
      values (
        v_product_id,
        trim(v_variant ->> 'name'),
        (v_variant ->> 'price')::numeric,
        coalesce((v_variant ->> 'is_active')::boolean, true),
        v_position
      )
      returning id into v_variant_id;
    end if;

    v_kept := v_kept || v_variant_id;
    perform private.replace_recipe(v_variant_id, null, v_variant -> 'recipe');
  end loop;

  -- Sizes removed from the form: archived if already sold, deleted otherwise.
  update public.product_variants pv
     set is_active = false
   where pv.product_id = v_product_id
     and not (pv.id = any (v_kept))
     and exists (select 1 from public.order_items oi where oi.variant_id = pv.id);

  delete from public.product_variants pv
   where pv.product_id = v_product_id
     and not (pv.id = any (v_kept))
     and not exists (select 1 from public.order_items oi where oi.variant_id = pv.id);

  delete from public.product_add_ons where product_id = v_product_id;
  insert into public.product_add_ons (product_id, add_on_id)
  select v_product_id, value::uuid
    from jsonb_array_elements_text(coalesce(payload -> 'add_on_ids', '[]'::jsonb));

  return v_product_id;
exception
  when unique_violation then
    raise exception 'Ya existe un tamaño con ese nombre en este producto' using errcode = '23505';
end;
$$;

-- -----------------------------------------------------------------------------
-- save_add_on(payload) -> add-on id
-- payload: { id?, name, price, is_active, recipe: [{ supply_id, quantity }] }
-- -----------------------------------------------------------------------------
create or replace function public.save_add_on(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := nullif(payload ->> 'id', '')::uuid;
begin
  perform private.require_manager();

  if v_id is null then
    insert into public.add_ons (name, price, is_active)
    values (trim(payload ->> 'name'), (payload ->> 'price')::numeric,
            coalesce((payload ->> 'is_active')::boolean, true))
    returning id into v_id;
  else
    update public.add_ons
       set name = trim(payload ->> 'name'),
           price = (payload ->> 'price')::numeric,
           is_active = coalesce((payload ->> 'is_active')::boolean, true)
     where id = v_id;
    if not found then
      raise exception 'La adición no existe' using errcode = 'P0002';
    end if;
  end if;

  perform private.replace_recipe(null, v_id, payload -> 'recipe');
  return v_id;
exception
  when unique_violation then
    raise exception 'Ya existe una adición con ese nombre' using errcode = '23505';
end;
$$;

-- -----------------------------------------------------------------------------
-- remove_catalog_item(kind, id) -> 'deleted' | 'archived'
-- kind: 'product' | 'add_on' | 'supply'
-- -----------------------------------------------------------------------------
create or replace function public.remove_catalog_item(kind text, item_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_in_use boolean;
begin
  perform private.require_manager();

  if kind = 'product' then
    select exists (
      select 1 from public.order_items oi
      join public.product_variants pv on pv.id = oi.variant_id
      where pv.product_id = item_id
    ) into v_in_use;
    if v_in_use then
      update public.products set is_active = false where id = item_id;
      update public.product_variants set is_active = false where product_id = item_id;
      return 'archived';
    end if;
    delete from public.products where id = item_id;
    return 'deleted';

  elsif kind = 'add_on' then
    select exists (
      select 1 from public.order_items oi
      where oi.add_ons @> jsonb_build_array(jsonb_build_object('id', item_id))
    ) into v_in_use;
    if v_in_use then
      update public.add_ons set is_active = false where id = item_id;
      return 'archived';
    end if;
    delete from public.add_ons where id = item_id;
    return 'deleted';

  elsif kind = 'supply' then
    select exists (select 1 from public.stock_movements where supply_id = item_id)
        or exists (select 1 from public.purchase_items where supply_id = item_id)
        or exists (select 1 from public.transfer_items where supply_id = item_id)
        or exists (select 1 from public.inventory_count_items where supply_id = item_id)
      into v_in_use;
    if v_in_use then
      update public.supplies set is_active = false where id = item_id;
      return 'archived';
    end if;
    -- Never used: remove it from recipes and delete it.
    delete from public.recipe_items where supply_id = item_id;
    delete from public.supply_stock where supply_id = item_id;
    delete from public.supplies where id = item_id;
    return 'deleted';
  end if;

  raise exception 'Tipo no válido' using errcode = '22023';
end;
$$;

-- -----------------------------------------------------------------------------
-- Supply cost changes are recorded (purchases will also update the cost).
-- -----------------------------------------------------------------------------
create or replace function private.audit_supply_cost_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.unit_cost is distinct from old.unit_cost then
    perform private.audit(
      'supply.cost_change', 'supply', new.id::text, null, 'info',
      jsonb_build_object('name', new.name, 'unit', new.unit,
                         'old_unit_cost', old.unit_cost, 'new_unit_cost', new.unit_cost)
    );
  end if;
  return new;
end;
$$;

create trigger supplies_audit_cost
  after update of unit_cost on public.supplies
  for each row execute function private.audit_supply_cost_change();

-- -----------------------------------------------------------------------------
-- Privileges: callable only by signed-in users (the functions check the role).
-- -----------------------------------------------------------------------------
revoke all on function public.save_product(jsonb) from public, anon;
revoke all on function public.save_add_on(jsonb) from public, anon;
revoke all on function public.remove_catalog_item(text, uuid) from public, anon;
grant execute on function public.save_product(jsonb) to authenticated;
grant execute on function public.save_add_on(jsonb) to authenticated;
grant execute on function public.remove_catalog_item(text, uuid) to authenticated;

revoke all on function private.require_manager() from public, anon, authenticated;
revoke all on function private.replace_recipe(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function private.audit_supply_cost_change() from public, anon, authenticated;
