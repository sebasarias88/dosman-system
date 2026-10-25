-- =============================================================================
-- 16 · Help assistant: a daily question limit per person. Only the count is
--      stored, never what was asked.
-- =============================================================================

create table if not exists public.assistant_usage (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  questions integer not null default 0 check (questions >= 0),
  primary key (profile_id, day)
);

-- No policies: nobody reads or writes it directly, only the function below.
alter table public.assistant_usage enable row level security;
revoke all on public.assistant_usage from anon, authenticated;

-- Counts one question and returns how many are left today. The free AI quota
-- is shared by the whole business, so one person can't use it all up.
create or replace function public.assistant_take_quota()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit constant integer := 40;
  v_user uuid := (select auth.uid());
  v_used integer;
begin
  if not private.is_staff() then
    raise exception 'No tienes permiso para hacer esto' using errcode = '42501';
  end if;

  insert into public.assistant_usage (profile_id, day, questions)
  values (v_user, private.local_today(), 1)
  on conflict (profile_id, day) do update set questions = public.assistant_usage.questions + 1
  returning questions into v_used;

  if v_used > v_limit then
    raise exception 'Ya hiciste % preguntas hoy. Mañana puedes seguir preguntando', v_limit using errcode = 'P0001';
  end if;

  -- Old counters are not useful: keep only the last 30 days.
  delete from public.assistant_usage where day < private.local_today() - 30;
  return v_limit - v_used;
end;
$$;

revoke all on function public.assistant_take_quota() from public, anon;
grant execute on function public.assistant_take_quota() to authenticated;
