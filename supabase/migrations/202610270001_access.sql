create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'driver'))
);
alter table public.profiles enable row level security;
revoke all on public.profiles from public, anon, authenticated;
grant select on public.profiles to authenticated;
grant all on public.profiles to service_role;
create policy own_profile on public.profiles for select to authenticated using (id = (select auth.uid()));

create function private.current_role() returns text
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = auth.uid()
$$;

create table private.request_events (
  request_id uuid primary key,
  actor_id uuid not null references auth.users(id),
  operation text not null check (length(operation) between 1 and 100),
  payload_hash text not null,
  result jsonb
);
alter table private.request_events enable row level security;
revoke all on private.request_events from public, anon, authenticated;

-- Called only inside an authorized transaction function. The unique insert waits for
-- concurrent transactions; rollback removes the reservation together with its effects.
create function private.reserve_request(p_request_id uuid, p_operation text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  existing private.request_events;
  actor uuid := auth.uid();
  fingerprint text;
begin
  if actor is null or private.current_role() is null then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if p_request_id is null or p_payload is null or p_operation is null or length(p_operation) not between 1 and 100 then
    raise exception 'Invalid request' using errcode = '22023';
  end if;
  -- jsonb sorts object keys and removes insignificant whitespace before hashing.
  fingerprint := encode(extensions.digest(p_payload::text, 'sha256'), 'hex');
  insert into private.request_events(request_id,actor_id,operation,payload_hash)
    values (p_request_id,actor,p_operation,fingerprint) on conflict do nothing;
  if found then return jsonb_build_object('found',false); end if;
  select * into existing from private.request_events where request_id=p_request_id for update;
  if existing.actor_id <> actor then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if existing.operation <> p_operation or existing.payload_hash <> fingerprint then
    raise exception 'Request conflict' using errcode = '22023';
  end if;
  if existing.result is null then
    raise exception 'Request unfinished' using errcode = '22023';
  end if;
  return jsonb_build_object('found',true,'result',existing.result);
end $$;

create function private.complete_request(p_request_id uuid, p_result jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or private.current_role() is null then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if p_result is null then raise exception 'Result required' using errcode = '22023'; end if;
  update private.request_events set result=p_result
    where request_id=p_request_id and actor_id=auth.uid() and result is null;
  if not found then raise exception 'Request unavailable' using errcode = '22023'; end if;
end $$;

create function public.get_request_result(p_request_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((
    select jsonb_build_object('found',true,'result',result)
    from private.request_events
    where request_id=p_request_id and actor_id=auth.uid()
      and private.current_role() is not null and result is not null
  ),jsonb_build_object('found',false))
$$;
revoke all on all functions in schema private from public, anon, authenticated;
revoke all on function public.get_request_result(uuid) from public, anon, authenticated;
grant execute on function public.get_request_result(uuid) to authenticated;
-- Future objects must be granted explicitly; never inherit public execution.
alter default privileges in schema private revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from public;
