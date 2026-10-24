-- =============================================================================
-- 14 · Staff management (through the Worker), branch and payment-method
--      settings, Telegram notification settings and the server-side helpers
--      the Worker cron uses to deliver notifications.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Notification settings. The bot token is a Worker secret, never stored here;
-- the chat id only says where to send (a private chat or the owners' group).
-- -----------------------------------------------------------------------------
alter table public.app_settings
  add column if not exists telegram_chat_id text check (telegram_chat_id ~ '^-?[0-9]{3,20}$'),
  add column if not exists telegram_chat_title text check (length(telegram_chat_title) <= 120),
  add column if not exists notify_alerts boolean not null default true,
  add column if not exists notify_low_stock boolean not null default true,
  add column if not exists notify_cash_close boolean not null default true,
  add column if not exists notify_daily_summary boolean not null default true;

-- Only the server (service role) may run the functions below that take an
-- explicit actor: the Worker has already checked that the caller is the owner.
create or replace function private.require_server()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') <> 'service_role' then
    raise exception 'Solo el servidor puede hacer esto' using errcode = '42501';
  end if;
end;
$$;

-- Same as private.audit() but with the actor given by the Worker (auth.uid()
-- is empty when the server key is used).
create or replace function private.audit_as(
  p_actor uuid,
  p_action text,
  p_entity_type text,
  p_entity_id text,
  p_branch_id uuid,
  p_severity public.audit_severity,
  p_details jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_log (branch_id, actor_id, action, entity_type, entity_id, severity, details)
  values (p_branch_id, p_actor, p_action, p_entity_type, p_entity_id, p_severity, p_details);
  if p_severity <> 'info' then
    insert into public.notification_outbox (kind, branch_id, payload)
    values ('audit_alert', p_branch_id,
            jsonb_build_object('action', p_action, 'severity', p_severity, 'details', p_details, 'actor_id', p_actor));
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Staff. Accounts are created by the Worker through the Supabase Auth admin
-- API (the handle_new_user trigger creates the profile). These functions
-- validate the business rules and keep the audit trail.
-- -----------------------------------------------------------------------------
create or replace function private.check_staff_assignment(p_role public.app_role, p_branch uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_role in ('owner', 'admin') then
    return;
  end if;
  if p_branch is null or not exists (select 1 from public.branches where id = p_branch and is_active) then
    raise exception 'Elige la sede donde trabaja' using errcode = '22023';
  end if;
  if p_role = 'waiter' and not exists (select 1 from public.branches where id = p_branch and uses_waiters) then
    raise exception 'Esa sede no trabaja con meseros' using errcode = '22023';
  end if;
end;
$$;

-- Called by the Worker before creating the auth user: fails fast with a clear message.
create or replace function public.server_validate_new_staff(payload jsonb)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_username text := lower(trim(coalesce(payload ->> 'username', '')));
begin
  perform private.require_server();
  if v_username !~ '^[a-z0-9._-]{3,30}$' then
    raise exception 'El usuario debe tener de 3 a 30 letras minúsculas, números, punto o guion' using errcode = '22023';
  end if;
  if exists (select 1 from public.profiles where username = v_username) then
    raise exception 'Ya existe un empleado con el usuario %', v_username using errcode = '23505';
  end if;
  if length(trim(coalesce(payload ->> 'full_name', ''))) < 2 then
    raise exception 'Escribe el nombre del empleado' using errcode = '22023';
  end if;
  perform private.check_staff_assignment((payload ->> 'role')::public.app_role,
                                         nullif(payload ->> 'branch_id', '')::uuid);
end;
$$;

-- Called by the Worker after the auth user exists (audit only).
create or replace function public.server_staff_created(p_actor uuid, p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
begin
  perform private.require_server();
  select * into v_profile from public.profiles where id = p_profile_id;
  if not found then
    raise exception 'El empleado no existe' using errcode = 'P0002';
  end if;
  perform private.audit_as(p_actor, 'staff.created', 'profile', p_profile_id::text, v_profile.branch_id, 'info',
    jsonb_build_object('name', v_profile.full_name, 'username', v_profile.username, 'role', v_profile.role));
end;
$$;

-- server_update_staff(actor, payload) -> the updated profile
-- payload: { id, full_name, role, branch_id, is_active, pin_changed }
create or replace function public.server_update_staff(p_actor uuid, payload jsonb)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := (payload ->> 'id')::uuid;
  v_old public.profiles;
  v_new public.profiles;
  v_role public.app_role;
  v_branch uuid;
  v_active boolean;
  v_name text;
  v_changes jsonb := '{}'::jsonb;
  v_severity public.audit_severity := 'info';
begin
  perform private.require_server();
  select * into v_old from public.profiles where id = v_id for update;
  if not found then
    raise exception 'El empleado no existe' using errcode = 'P0002';
  end if;

  v_role := coalesce((payload ->> 'role')::public.app_role, v_old.role);
  v_branch := case when payload ? 'branch_id' then nullif(payload ->> 'branch_id', '')::uuid else v_old.branch_id end;
  v_active := coalesce((payload ->> 'is_active')::boolean, v_old.is_active);
  v_name := coalesce(nullif(trim(payload ->> 'full_name'), ''), v_old.full_name);
  if v_role in ('owner', 'admin') and not (payload ? 'branch_id') then
    v_branch := v_old.branch_id;
  end if;

  if v_id = p_actor and (v_role <> v_old.role or not v_active) then
    raise exception 'No puedes quitarte tu propio rol de dueño ni desactivarte' using errcode = 'P0001';
  end if;
  -- The business must always keep at least one active owner.
  if v_old.role = 'owner' and v_old.is_active and (v_role <> 'owner' or not v_active)
     and not exists (select 1 from public.profiles where role = 'owner' and is_active and id <> v_id) then
    raise exception 'Debe quedar al menos un dueño activo' using errcode = 'P0001';
  end if;
  if v_active then
    perform private.check_staff_assignment(v_role, v_branch);
  end if;

  update public.profiles
     set full_name = v_name, role = v_role, branch_id = v_branch, is_active = v_active
   where id = v_id
  returning * into v_new;

  if v_old.role <> v_new.role then
    v_changes := v_changes || jsonb_build_object('old_role', v_old.role, 'new_role', v_new.role);
    v_severity := 'warning';
  end if;
  if v_old.branch_id is distinct from v_new.branch_id then
    v_changes := v_changes || jsonb_build_object('branch_changed', true);
  end if;
  if v_old.is_active <> v_new.is_active then
    v_changes := v_changes || jsonb_build_object('is_active', v_new.is_active);
    v_severity := 'warning';
  end if;
  if coalesce((payload ->> 'pin_changed')::boolean, false) then
    v_changes := v_changes || jsonb_build_object('pin_changed', true);
  end if;
  if v_old.full_name <> v_new.full_name then
    v_changes := v_changes || jsonb_build_object('old_name', v_old.full_name);
  end if;

  if v_changes <> '{}'::jsonb then
    perform private.audit_as(p_actor, 'staff.updated', 'profile', v_id::text, v_new.branch_id, v_severity,
      v_changes || jsonb_build_object('name', v_new.full_name, 'username', v_new.username, 'role', v_new.role));
  end if;
  return v_new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Branch settings (owner). Which branch is the main one never changes here.
-- payload: { id, name, uses_waiters, takes_delivery, day_cutoff "HH:MM" }
-- -----------------------------------------------------------------------------
create or replace function public.update_branch(payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := (payload ->> 'id')::uuid;
  v_name text := trim(coalesce(payload ->> 'name', ''));
  v_cutoff time := (payload ->> 'day_cutoff')::time;
  v_waiters boolean := coalesce((payload ->> 'uses_waiters')::boolean, false);
  v_old public.branches;
begin
  perform private.require_staff(array['owner']::public.app_role[], null);
  select * into v_old from public.branches where id = v_id for update;
  if not found then
    raise exception 'La sede no existe' using errcode = 'P0002';
  end if;
  if length(v_name) < 2 or length(v_name) > 60 then
    raise exception 'El nombre de la sede debe tener entre 2 y 60 letras' using errcode = '22023';
  end if;
  if v_cutoff is null or v_cutoff > '08:00'::time then
    raise exception 'La hora de cierre del día debe estar entre las 00:00 y las 08:00' using errcode = '22023';
  end if;
  if not v_waiters and v_old.uses_waiters
     and exists (select 1 from public.profiles where role = 'waiter' and is_active and branch_id = v_id) then
    raise exception 'Primero desactiva o cambia de rol a los meseros de esta sede' using errcode = 'P0001';
  end if;

  update public.branches
     set name = v_name,
         uses_waiters = v_waiters,
         takes_delivery = coalesce((payload ->> 'takes_delivery')::boolean, false),
         day_cutoff = v_cutoff
   where id = v_id;

  perform private.audit('branch.updated', 'branch', v_id::text, v_id, 'info',
    jsonb_build_object('name', v_name, 'uses_waiters', v_waiters,
                       'takes_delivery', coalesce((payload ->> 'takes_delivery')::boolean, false),
                       'day_cutoff', to_char(v_cutoff, 'HH24:MI')));
end;
$$;

-- -----------------------------------------------------------------------------
-- Payment methods (owner): rename, reorder, turn on/off, add digital ones.
-- Cash can never be turned off (the drawer depends on it).
-- payload: { code?, name, is_active, sort_order }
-- -----------------------------------------------------------------------------
create or replace function public.save_payment_method(payload jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := nullif(payload ->> 'code', '');
  v_name text := trim(coalesce(payload ->> 'name', ''));
  v_active boolean := coalesce((payload ->> 'is_active')::boolean, true);
  v_sort smallint := coalesce((payload ->> 'sort_order')::smallint, 50);
  v_kind public.payment_kind;
begin
  perform private.require_staff(array['owner']::public.app_role[], null);
  if length(v_name) < 2 or length(v_name) > 30 then
    raise exception 'El nombre del medio de pago debe tener entre 2 y 30 letras' using errcode = '22023';
  end if;

  if v_code is null then
    -- New methods are always digital (Nequi, Bancolombia, Daviplata…).
    -- Codes are 2-20 lowercase letters or "_" (table check), e.g. "Banco Bogotá" -> banco_bogota.
    v_code := left(regexp_replace(lower(translate(v_name, 'ÁÉÍÓÚÑÜáéíóúñü', 'aeiounuaeiounu')), '[^a-z]+', '_', 'g'), 15);
    v_code := trim(both '_' from v_code);
    if length(v_code) < 2 or exists (select 1 from public.payment_methods where code = v_code) then
      v_code := left(coalesce(nullif(v_code, ''), 'pago'), 15) || '_'
                || translate(substr(md5(random()::text), 1, 4), '0123456789', 'ghijklmnop');
    end if;
    insert into public.payment_methods (code, name, kind, sort_order, is_active)
    values (v_code, v_name, 'digital', v_sort, v_active);
    perform private.audit('payment_method.created', 'payment_method', v_code, null, 'info',
                          jsonb_build_object('name', v_name));
    return v_code;
  end if;

  select kind into v_kind from public.payment_methods where code = v_code for update;
  if v_kind is null then
    raise exception 'El medio de pago no existe' using errcode = 'P0002';
  end if;
  if v_kind = 'cash' and not v_active then
    raise exception 'El efectivo no se puede desactivar' using errcode = 'P0001';
  end if;
  update public.payment_methods set name = v_name, is_active = v_active, sort_order = v_sort where code = v_code;
  perform private.audit('payment_method.updated', 'payment_method', v_code, null, 'info',
                        jsonb_build_object('name', v_name, 'is_active', v_active));
  return v_code;
end;
$$;

-- -----------------------------------------------------------------------------
-- Notification settings (owner). The chat id is found by the Worker.
-- payload: { telegram_chat_id, telegram_chat_title, notify_alerts, notify_low_stock,
--            notify_cash_close, notify_daily_summary }
-- -----------------------------------------------------------------------------
create or replace function public.update_notification_settings(payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['owner']::public.app_role[], null);
  if coalesce(payload ->> 'telegram_chat_id', '0000') !~ '^-?[0-9]{3,20}$' and payload ->> 'telegram_chat_id' <> '' then
    raise exception 'El chat de Telegram no es válido' using errcode = '22023';
  end if;
  update public.app_settings
     set telegram_chat_id = case when payload ? 'telegram_chat_id'
                                 then nullif(payload ->> 'telegram_chat_id', '') else telegram_chat_id end,
         telegram_chat_title = case when payload ? 'telegram_chat_title'
                                    then nullif(payload ->> 'telegram_chat_title', '') else telegram_chat_title end,
         notify_alerts = coalesce((payload ->> 'notify_alerts')::boolean, notify_alerts),
         notify_low_stock = coalesce((payload ->> 'notify_low_stock')::boolean, notify_low_stock),
         notify_cash_close = coalesce((payload ->> 'notify_cash_close')::boolean, notify_cash_close),
         notify_daily_summary = coalesce((payload ->> 'notify_daily_summary')::boolean, notify_daily_summary)
   where id;
  perform private.audit('settings.notifications', 'app_settings', null, null, 'info',
                        payload - 'telegram_chat_title');
end;
$$;

-- =============================================================================
-- Delivery (Worker cron, service role only)
-- =============================================================================

-- Pending notifications with what the message needs. Rows that failed 5
-- times stay 'failed' and are not retried.
create or replace function public.server_pending_notifications(p_limit integer default 30)
returns table (
  id bigint,
  kind text,
  branch_name text,
  payload jsonb,
  attempts smallint,
  actor_name text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_server();
  return query
  select o.id, o.kind, b.name,
         -- Low-stock alerts need the unit to say "2 kg" instead of "2000".
         case when o.kind = 'low_stock'
              then o.payload || jsonb_build_object('unit',
                     (select s.unit from public.supplies s where s.id = (o.payload ->> 'supply_id')::uuid))
              else o.payload end,
         o.attempts,
         (select p.full_name from public.profiles p
           where p.id = coalesce(nullif(o.payload ->> 'actor_id', ''), nullif(o.payload ->> 'closed_by', ''))::uuid),
         o.created_at
    from public.notification_outbox o
    left join public.branches b on b.id = o.branch_id
   where o.status = 'pending'
   order by o.created_at
   limit least(greatest(p_limit, 1), 100);
end;
$$;

create or replace function public.server_mark_notification(p_id bigint, p_ok boolean, p_error text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_server();
  update public.notification_outbox
     set status = case when p_ok then 'sent'
                       when attempts + 1 >= 5 then 'failed'
                       else 'pending' end::public.notification_status,
         attempts = attempts + 1,
         sent_at = case when p_ok then now() else sent_at end,
         last_error = case when p_ok then null else left(p_error, 300) end
   where id = p_id;
end;
$$;

-- Settings the Worker needs to decide what to send and where.
create or replace function public.server_notification_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_server();
  return (select jsonb_build_object(
            'business_name', business_name, 'timezone', timezone,
            'telegram_chat_id', telegram_chat_id, 'notify_alerts', notify_alerts,
            'notify_low_stock', notify_low_stock, 'notify_cash_close', notify_cash_close,
            'notify_daily_summary', notify_daily_summary)
          from public.app_settings where id);
end;
$$;

-- Morning job (5:30 a.m., after the business day closed at 5:00): creates the
-- fixed expenses due today and queues the summary of the day that just ended,
-- so late sales after midnight are included. Idempotent per date.
create or replace function public.server_daily_job(p_date date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_date date := coalesce(p_date, (now() at time zone (select timezone from public.app_settings where id))::date - 1);
  v_generated integer;
  v_branches jsonb;
  v_alerts integer;
begin
  perform private.require_server();
  v_generated := public.generate_recurring_expenses(null);

  if exists (select 1 from public.notification_outbox
              where kind = 'daily_summary' and payload ->> 'date' = v_date::text) then
    return jsonb_build_object('recurring_created', v_generated, 'summary', 'already queued');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('name', b.name) || private.report_totals(b.id, v_date, v_date)
                            order by b.is_main desc), '[]'::jsonb)
    into v_branches
    from public.branches b where b.is_active;

  select count(*) into v_alerts
    from public.audit_log
   where severity <> 'info'
     and (created_at at time zone (select timezone from public.app_settings where id))::date = v_date;

  insert into public.notification_outbox (kind, payload)
  values ('daily_summary', jsonb_build_object('date', v_date, 'branches', v_branches, 'alerts', v_alerts,
                                              'open_sessions', (select count(*) from public.cash_sessions
                                                                 where status = 'open')));
  return jsonb_build_object('recurring_created', v_generated, 'summary', 'queued');
end;
$$;

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------
do $$
declare
  fn text;
begin
  -- Signed-in owners (each function checks the role).
  foreach fn in array array[
    'public.update_branch(jsonb)',
    'public.save_payment_method(jsonb)',
    'public.update_notification_settings(jsonb)'
  ]
  loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;

  -- Server only (Worker with the secret key).
  foreach fn in array array[
    'public.server_validate_new_staff(jsonb)',
    'public.server_staff_created(uuid, uuid)',
    'public.server_update_staff(uuid, jsonb)',
    'public.server_pending_notifications(integer)',
    'public.server_mark_notification(bigint, boolean, text)',
    'public.server_notification_settings()',
    'public.server_daily_job(date)'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;

  foreach fn in array array[
    'private.require_server()',
    'private.audit_as(uuid, text, text, text, uuid, public.audit_severity, jsonb)',
    'private.check_staff_assignment(public.app_role, uuid)'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
  end loop;
end;
$$;
