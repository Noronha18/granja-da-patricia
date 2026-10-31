-- Monetary totals are authoritative; the rounded unit cost is informational only.
-- All internal callers lock vehicle -> route -> customer IDs -> stock keys.
-- No generic vehicle writes: only the route lifecycle may transfer/consume its load.
create table public.stock_balances (
 balance_key text primary key,
 location text not null check(location in('farm','vehicle')),
 route_id uuid unique references public.route_runs(id),
 vehicle_id uuid references public.vehicles(id),
 eggs integer not null default 0 check(eggs>=0),
 total_cost_cents bigint default 0 check(total_cost_cents between 0 and 9007199254740991),
 unit_cost_cents numeric(20,8) generated always as (case when eggs>0 then total_cost_cents::numeric/eggs else 0 end) stored,
 check((location='farm' and balance_key='farm' and route_id is null and vehicle_id is null) or
 (location='vehicle' and balance_key=route_id::text and route_id is not null and vehicle_id is not null)),
 check(eggs<>0 or total_cost_cents=0)
);
-- A physical vehicle cannot carry two active loads, even if statuses are inconsistent.
create unique index one_load_per_vehicle on public.stock_balances(vehicle_id) where location='vehicle' and eggs>0;
insert into public.stock_balances(balance_key,location) values('farm','farm');
create table public.stock_events (
 id uuid primary key default gen_random_uuid(),
 kind text not null check(kind in('opening','purchase','loss','adjustment','load','return','sale','cost_regularization')),
 location text not null check(location in('farm','vehicle')),
 route_id uuid references public.route_runs(id),
 direction text not null check(direction in('in','out','cost')),
 eggs integer not null check(eggs>=0),
 cost_cents bigint check(cost_cents between 0 and 9007199254740991),
 unit_cost_cents numeric(20,8) generated always as (case when eggs>0 then cost_cents::numeric/eggs else null end) stored,
 actor_id uuid not null references auth.users(id),
 effective_at timestamptz not null,
 created_at timestamptz not null default clock_timestamp(),
 reason text check(length(trim(reason)) between 1 and 1000),
 source_event_id uuid,
 reversal_of uuid references public.stock_events(id),
 check((location='farm') or route_id is not null),
 check((kind='cost_regularization' and direction='cost' and eggs=0) or (kind<>'cost_regularization' and direction<>'cost' and eggs>0)),
 unique(kind,location,source_event_id)
);
create index stock_events_location_time on public.stock_events(location,effective_at);
create index stock_events_route on public.stock_events(route_id);
create table public.expenses (
 id uuid primary key default gen_random_uuid(),
 category text not null check(category in('purchase','fuel','employee','maintenance','other')),
 description text not null check(length(trim(description)) between 1 and 1000),
 amount_cents bigint not null check(amount_cents between 0 and 9007199254740991),
 paid_at timestamptz not null,
 created_at timestamptz not null default clock_timestamp(),
 actor_id uuid not null references auth.users(id),
 stock_event_id uuid unique references public.stock_events(id),
 reversal_of uuid unique references public.expenses(id),
 check((category='purchase')=(stock_event_id is not null))
);
do $$declare tab text;begin
 foreach tab in array array['stock_balances','stock_events','expenses'] loop
  execute format('alter table public.%I enable row level security',tab);
  execute format('revoke all on public.%I from public,anon,authenticated',tab);
  execute format('grant select on public.%I to authenticated',tab);
  execute format('grant all on public.%I to service_role',tab);
  execute format('create policy owner_read on public.%I for select to authenticated using ((select role from public.profiles where id=(select auth.uid()))=''owner'')',tab);
 end loop;
end $$;

-- Caller holds the appropriate route/vehicle locks before entering this helper.
-- The total, rather than a rounded unit average, ensures the last egg consumes the remainder.
create function private.consume_stock(p_route_id uuid,p_kind text,p_eggs integer,p_source_event_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare b public.stock_balances; prior public.stock_events; cost bigint; event_id uuid;key text:=coalesce(p_route_id::text,'farm');
begin
 if private.current_role() is null or p_source_event_id is null or p_kind is null or p_kind not in('sale','loss') or p_eggs is null or p_eggs<=0 then raise exception 'INVALID_INPUT' using errcode='22023';end if;
 select * into b from public.stock_balances where balance_key=key for update;
 if not found then raise exception 'INSUFFICIENT_STOCK' using errcode='22023';end if;
 select * into prior from public.stock_events where kind=p_kind and location=b.location and source_event_id=p_source_event_id;
 if found then
  if prior.route_id is distinct from p_route_id or prior.eggs<>p_eggs then raise exception 'Request conflict' using errcode='22023';end if;
  return prior.id;
 end if;
 if b.eggs<p_eggs then raise exception 'INSUFFICIENT_STOCK' using errcode='22023';end if;
 cost:=case when b.eggs=p_eggs then b.total_cost_cents else round(b.total_cost_cents::numeric*p_eggs/b.eggs)::bigint end;
 update public.stock_balances set eggs=eggs-p_eggs,total_cost_cents=case when eggs=p_eggs then 0 else total_cost_cents-cost end where balance_key=key;
 insert into public.stock_events(kind,location,route_id,direction,eggs,cost_cents,actor_id,effective_at,source_event_id)
 values(p_kind,b.location,p_route_id,'out',p_eggs,cost,auth.uid(),clock_timestamp(),p_source_event_id) returning id into event_id;
 return event_id;
end $$;

create function private.transfer_stock(p_route_id uuid,p_direction text,p_eggs integer,p_source_event_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare run public.route_runs; vehicle uuid; src public.stock_balances; dst public.stock_balances; prior public.stock_events;
 source_key text;dest_key text;cost bigint;event_id uuid;
begin
 if private.current_role() is null or p_direction is null or p_direction not in('load','return') or p_eggs is null or p_eggs<=0 or p_source_event_id is null then raise exception 'INVALID_INPUT' using errcode='22023';end if;
 select vehicle_id into vehicle from public.route_runs where id=p_route_id;
 if vehicle is null then raise exception 'VEHICLE_REQUIRED' using errcode='22023';end if;
 perform 1 from public.vehicles where id=vehicle for update;
 select * into run from public.route_runs where id=p_route_id for update;
 if run.vehicle_id is distinct from vehicle then raise exception 'VERSION_CONFLICT' using errcode='PT409';end if;
 insert into public.stock_balances(balance_key,location,route_id,vehicle_id) values(p_route_id::text,'vehicle',p_route_id,vehicle) on conflict do nothing;
 -- Every stock operation uses deterministic key order. A purchase needs farm only,
 -- so purchase vs load never introduces a vehicle-after-farm lock inversion.
 perform 1 from public.stock_balances where balance_key in('farm',p_route_id::text) order by balance_key for update;
 source_key:=case when p_direction='load' then 'farm' else p_route_id::text end;
 dest_key:=case when p_direction='load' then p_route_id::text else 'farm' end;
 select * into src from public.stock_balances where balance_key=source_key;
 select * into dst from public.stock_balances where balance_key=dest_key;
 select * into prior from public.stock_events where kind=p_direction and direction='out' and source_event_id=p_source_event_id;
 if found then
  if prior.route_id is distinct from p_route_id or prior.eggs<>p_eggs then raise exception 'Request conflict' using errcode='22023';end if;
  return prior.id;
 end if;
 if p_direction='load' and exists(select from public.stock_balances where vehicle_id=vehicle and route_id<>p_route_id and eggs>0) then raise exception 'VEHICLE_ALREADY_LOADED' using errcode='PT409';end if;
 if src.eggs<p_eggs then raise exception 'INSUFFICIENT_STOCK' using errcode='22023';end if;
 cost:=case when src.eggs=p_eggs then src.total_cost_cents else round(src.total_cost_cents::numeric*p_eggs/src.eggs)::bigint end;
 if dst.eggs::bigint+p_eggs>2147483647 or coalesce(dst.total_cost_cents,0)::numeric+coalesce(cost,0)>9007199254740991 then raise exception 'AMOUNT_OUT_OF_RANGE' using errcode='22003';end if;
 update public.stock_balances set eggs=eggs-p_eggs,total_cost_cents=case when eggs=p_eggs then 0 else total_cost_cents-cost end where balance_key=source_key;
 update public.stock_balances set eggs=eggs+p_eggs,total_cost_cents=total_cost_cents+cost where balance_key=dest_key;
 insert into public.stock_events(kind,location,route_id,direction,eggs,cost_cents,actor_id,effective_at,source_event_id)
 values(p_direction,src.location,p_route_id,'out',p_eggs,cost,auth.uid(),clock_timestamp(),p_source_event_id) returning id into event_id;
 insert into public.stock_events(kind,location,route_id,direction,eggs,cost_cents,actor_id,effective_at,source_event_id)
 values(p_direction,dst.location,p_route_id,'in',p_eggs,cost,auth.uid(),clock_timestamp(),p_source_event_id);
 return event_id;
end $$;

create function public.record_stock_event(p_event jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare replay jsonb;answer jsonb;b public.stock_balances;kind text;dir text;n integer;cost bigint;effective timestamptz;why text;event_id uuid;
begin
 if private.current_role() is distinct from 'owner' then raise exception 'FORBIDDEN' using errcode='42501';end if;
 replay:=private.reserve_preparation_request(p_request_id,'record_stock_event',p_event);
 if(replay->>'found')::boolean then return replay->'result';end if;
 kind:=p_event->>'kind';why:=nullif(trim(p_event->>'reason'),'');
 if jsonb_typeof(p_event) is distinct from 'object' or kind is null or kind not in('opening','purchase','loss','adjustment') or p_event->>'location' is distinct from 'farm'
 or jsonb_typeof(p_event->'eggs') is distinct from 'number' or coalesce(p_event->>'eggs','')!~'^[0-9]+$'
 or p_event ? 'routeId' or (kind<>'adjustment' and p_event ? 'direction') then raise exception 'INVALID_INPUT' using errcode='22023';end if;
 if(p_event->>'eggs')::numeric not between 1 and 2147483647 then raise exception 'AMOUNT_OUT_OF_RANGE' using errcode='22003';end if;
 n:=(p_event->>'eggs')::integer;
 dir:=case when kind='adjustment' then p_event->>'direction' when kind='loss' then 'out' else 'in' end;
 if dir is null or dir not in('in','out') then raise exception 'INVALID_INPUT' using errcode='22023';end if;
 if kind in('loss','adjustment') and why is null then raise exception 'REASON_REQUIRED' using errcode='22023';end if;
 if length(why)>1000 then raise exception 'INVALID_INPUT' using errcode='22023';end if;
 if p_event->>'effectiveAt' is null then raise exception 'INVALID_INPUT' using errcode='22023';end if;
 begin effective:=(p_event->>'effectiveAt')::timestamptz;exception when others then raise exception 'INVALID_INPUT' using errcode='22023';end;
 if not isfinite(effective) then raise exception 'INVALID_INPUT' using errcode='22023';end if;
 if dir='in' and p_event->>'costCents' is not null then
  if jsonb_typeof(p_event->'costCents') is distinct from 'number' or (p_event->>'costCents')!~'^[0-9]+$' then raise exception 'INVALID_INPUT' using errcode='22023';end if;
  if (p_event->>'costCents')::numeric>9007199254740991 or (p_event->>'costCents')::numeric/n>=1000000000000 then raise exception 'AMOUNT_OUT_OF_RANGE' using errcode='22003';end if;
  cost:=(p_event->>'costCents')::bigint;
 elsif dir='out' and p_event ? 'costCents' then raise exception 'INVALID_INPUT' using errcode='22023';end if;
 if kind='purchase' and cost is null then raise exception 'PURCHASE_COST_REQUIRED' using errcode='22023';end if;
 select * into b from public.stock_balances where balance_key='farm' for update;
 -- An opening is append-only and available once, before any subsequent movement.
 -- Corrections then use a current adjustment with an explicit reason.
 if kind='opening' and exists(select from public.stock_events where location='farm') then raise exception 'OPENING_LOCKED' using errcode='PT409';end if;
 if exists(select from public.stock_events where location='farm' and effective_at>effective) then raise exception 'BACKDATED_STOCK' using errcode='PT409';end if;
 if dir='out' then
  if n>b.eggs then raise exception 'INSUFFICIENT_STOCK' using errcode='22023';end if;
  cost:=case when n=b.eggs then b.total_cost_cents else round(b.total_cost_cents::numeric*n/b.eggs)::bigint end;
  update public.stock_balances set eggs=eggs-n,total_cost_cents=case when eggs=n then 0 else total_cost_cents-cost end where balance_key='farm';
 else
  if b.eggs::bigint+n>2147483647 or coalesce(b.total_cost_cents,0)::numeric+coalesce(cost,0)>9007199254740991 then raise exception 'AMOUNT_OUT_OF_RANGE' using errcode='22003';end if;
  update public.stock_balances set eggs=eggs+n,total_cost_cents=total_cost_cents+cost where balance_key='farm';
 end if;
 insert into public.stock_events(kind,location,direction,eggs,cost_cents,actor_id,effective_at,reason)
 values(kind,'farm',dir,n,cost,auth.uid(),effective,why) returning id into event_id;
 if kind='purchase' then
  insert into public.expenses(category,description,amount_cents,paid_at,actor_id,stock_event_id) values('purchase','Compra de ovos',cost,effective,auth.uid(),event_id);
 end if;
 answer:=jsonb_build_object('eventId',event_id,'eggs',n,'costCents',cost);perform private.complete_request(p_request_id,answer);return answer;
end $$;

create function public.set_remaining_stock_cost(p_location text,p_total_cost_cents bigint,p_reason text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare replay jsonb;answer jsonb;b public.stock_balances;key text;vehicle uuid;event_id uuid;
begin
 if private.current_role() is distinct from 'owner' then raise exception 'FORBIDDEN' using errcode='42501';end if;
 replay:=private.reserve_preparation_request(p_request_id,'set_remaining_stock_cost',jsonb_build_object('location',p_location,'cost',p_total_cost_cents,'reason',p_reason));
 if(replay->>'found')::boolean then return replay->'result';end if;
 if p_location is null or p_location not in('farm','vehicle') or p_total_cost_cents is null or p_total_cost_cents not between 0 and 9007199254740991 then raise exception 'INVALID_INPUT' using errcode='22023';end if;
 if nullif(trim(p_reason),'') is null then raise exception 'REASON_REQUIRED' using errcode='22023';end if;
 if length(p_reason)>1000 then raise exception 'INVALID_INPUT' using errcode='22023';end if;
 key:='farm';
 if p_location='vehicle' then
  -- One physical vehicle is supported in this version. Ambiguous selections fail.
  if(select count(*) from public.stock_balances where location='vehicle' and eggs>0)<>1 then raise exception 'STOCK_UNAVAILABLE' using errcode='PT409';end if;
  select balance_key,vehicle_id into key,vehicle from public.stock_balances where location='vehicle' and eggs>0;
  perform 1 from public.vehicles where id=vehicle for update;
  perform 1 from public.route_runs where id=key::uuid for update;
 end if;
 select * into b from public.stock_balances where balance_key=key for update;
 if not found or b.eggs<=0 or b.total_cost_cents is not null then raise exception 'COST_ALREADY_KNOWN_OR_EMPTY' using errcode='PT409';end if;
 if p_total_cost_cents::numeric/b.eggs>=1000000000000 then raise exception 'AMOUNT_OUT_OF_RANGE' using errcode='22003';end if;
 update public.stock_balances set total_cost_cents=p_total_cost_cents where balance_key=key;
 insert into public.stock_events(kind,location,route_id,direction,eggs,cost_cents,actor_id,effective_at,reason)
 values('cost_regularization',b.location,b.route_id,'cost',0,p_total_cost_cents,auth.uid(),clock_timestamp(),trim(p_reason)) returning id into event_id;
 answer:=jsonb_build_object('eventId',event_id);perform private.complete_request(p_request_id,answer);return answer;
end $$;

create function public.get_my_stock() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if private.current_role() is distinct from 'driver' then raise exception 'FORBIDDEN' using errcode='42501';end if;
 return jsonb_build_object('eggs',coalesce((select sum(b.eggs) from public.stock_balances b join public.route_runs r on r.id=b.route_id where r.driver_id=auth.uid()),0));
end $$;
revoke all on all functions in schema private from public,anon,authenticated;
revoke all on function public.record_stock_event(jsonb,uuid),public.set_remaining_stock_cost(text,bigint,text,uuid),public.get_my_stock() from public,anon;
grant execute on function public.record_stock_event(jsonb,uuid),public.set_remaining_stock_cost(text,bigint,text,uuid),public.get_my_stock() to authenticated;

-- Closing an uncertain request serializes with an in-flight save. A late save
-- sees the tombstone and cannot create a second business event.
create function public.reconcile_stock_request(p_request_id uuid,p_operation text default 'record_stock_event')
returns jsonb language plpgsql security definer set search_path='' as $$
declare existing private.request_events;
begin
 if private.current_role() is distinct from 'owner' then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_request_id is null or p_operation is null or p_operation not in('record_stock_event','set_remaining_stock_cost') then raise exception 'INVALID_INPUT' using errcode='22023';end if;
 insert into private.request_events(request_id,actor_id,operation,payload_hash,result)
 values(p_request_id,auth.uid(),p_operation,'closed','{"closed":true}') on conflict do nothing;
 select * into existing from private.request_events where request_id=p_request_id for update;
 if existing.actor_id<>auth.uid() or existing.operation<>p_operation then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if existing.result='{"closed":true}'::jsonb then return '{"status":"closed"}'::jsonb;end if;
 if existing.result is null then raise exception 'REQUEST_UNFINISHED' using errcode='55000';end if;
 return jsonb_build_object('status','saved','result',existing.result);
end $$;
revoke all on function public.reconcile_stock_request(uuid,text) from public,anon;
grant execute on function public.reconcile_stock_request(uuid,text) to authenticated;
