-- Minimal vehicle identity; operational configuration follows in Task 4.
create table public.vehicles(id uuid primary key default gen_random_uuid(),name text not null check(length(trim(name)) between 1 and 160));
create table public.route_templates(
 id uuid primary key default gen_random_uuid(),weekday integer not null unique check(weekday between 1 and 5),name text not null,
 driver_id uuid references public.profiles(id),vehicle_id uuid references public.vehicles(id)
);
-- Customer weekday/position remains the source of the customer portion of the template.
create table public.route_template_stops(
 id uuid primary key default gen_random_uuid(),template_id uuid not null references public.route_templates(id),
 kind text not null check(kind in('departure','pickup','list_pickup','list_return','arrival')),
 position integer not null check(position>0),name text not null,address text,phone text,
 unique(template_id,position)
);
create table public.route_runs(
 id uuid primary key default gen_random_uuid(),template_id uuid not null references public.route_templates(id),
 service_date date not null unique,driver_id uuid references public.profiles(id),vehicle_id uuid references public.vehicles(id),
 status text not null default 'draft' check(status in('draft','ready','in_progress','awaiting_reconciliation','closed','cancelled')),
 version integer not null default 1 check(version>0),initial_odometer_km numeric(12,1) check(initial_odometer_km>=0),
 unique(driver_id,service_date)
);
create table public.weekly_orders(
 id uuid primary key default gen_random_uuid(),customer_id uuid not null references public.customers(id),route_id uuid not null references public.route_runs(id),
 delivery_date date not null,customer_name text not null,customer_address text not null,customer_phone text,
 status text not null default 'planned' check(status in('planned','suspended','delivered','not_delivered')),
 version integer not null default 1 check(version>0),unique(customer_id,delivery_date)
);
create table public.weekly_order_items(
 order_id uuid not null references public.weekly_orders(id) on delete cascade,product_id uuid not null references public.products(id),
 eggs_per_tray integer not null check(eggs_per_tray>0),trays integer not null check(trays>0),price_cents integer not null check(price_cents>=0),
 primary key(order_id,product_id)
);
create table public.route_stops(
 id uuid primary key default gen_random_uuid(),route_id uuid not null references public.route_runs(id),order_id uuid unique references public.weekly_orders(id),
 kind text not null check(kind in('departure','pickup','customer','list_pickup','list_return','arrival')),
 position integer not null check(position>0),name text not null,address text,phone text,
 status text not null default 'pending' check(status in('pending','delivered','not_delivered','completed')),
 check((kind='customer')=(order_id is not null)),constraint route_stop_position unique(route_id,position) deferrable initially deferred
);
create index weekly_orders_route on public.weekly_orders(route_id);
create index route_stops_route on public.route_stops(route_id);

do $$declare tab text;begin
 foreach tab in array array['vehicles','route_templates','route_template_stops','route_runs','route_stops','weekly_orders','weekly_order_items'] loop
  execute format('alter table public.%I enable row level security',tab);
  execute format('revoke all on public.%I from public,anon,authenticated',tab);
  execute format('grant select on public.%I to authenticated',tab);
  execute format('grant all on public.%I to service_role',tab);
  execute format('create policy owner_read on public.%I for select to authenticated using ((select role from public.profiles where id=(select auth.uid()))=''owner'')',tab);
 end loop;
end $$;

-- Addresses remain pending. No real locations or unconfirmed Tue/Wed return are invented.
insert into public.route_templates(id,weekday,name)
select ('50000000-0000-0000-0000-'||lpad(day::text,12,'0'))::uuid,day,
 (array['Segunda — coleta','Terça — entregas','Quarta — entregas','Quinta — entregas','Sexta — entregas'])[day] from generate_series(1,5) day;
insert into public.route_template_stops(template_id,kind,position,name)
select t.id,s.kind,s.position,s.name from public.route_templates t cross join (values
 ('departure',1,'Saída da granja'),('pickup',2,'Coleta'),('arrival',3,'Chegada à granja')
) s(kind,position,name) where t.weekday=1;
insert into public.route_template_stops(template_id,kind,position,name)
select t.id,s.kind,s.position,s.name from public.route_templates t cross join(values
 ('departure',1,'Saída da granja'),('list_pickup',2,'Retirar lista'),('list_return',3,'Devolver lista'),('arrival',4,'Chegada à granja')
) s(kind,position,name) where t.weekday between 2 and 5 and (s.kind<>'arrival' or t.weekday in(4,5));

create function private.reserve_preparation_request(p_request_id uuid,p_operation text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 return private.reserve_request(p_request_id,p_operation,p_payload);
exception when sqlstate '22023' then
 if exists(select from private.request_events where request_id=p_request_id and actor_id=auth.uid() and operation=p_operation and result='{"closed":true}'::jsonb) then raise exception 'REQUEST_CLOSED' using errcode='55000'; end if;
 raise;
end $$;
revoke all on function private.reserve_preparation_request(uuid,text,jsonb) from public,anon,authenticated;

create function public.reconcile_preparation_request(p_request_id uuid,p_operation text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare existing private.request_events;
begin
 if private.current_role() is distinct from 'owner' then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_request_id is null or p_operation is null or p_operation not in('generate_week','save_weekly_order','save_route_run') then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
 insert into private.request_events(request_id,actor_id,operation,payload_hash,result) values(p_request_id,auth.uid(),p_operation,'closed','{"closed":true}') on conflict do nothing;
 select * into existing from private.request_events where request_id=p_request_id for update;
 if existing.actor_id<>auth.uid() or existing.operation<>p_operation then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if existing.result='{"closed":true}'::jsonb then return '{"status":"closed"}'::jsonb; end if;
 if existing.result is null then raise exception 'REQUEST_UNFINISHED' using errcode='55000'; end if;
 return jsonb_build_object('status','saved','result',existing.result);
end $$;

create function public.generate_week(p_week_start date,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare replay jsonb;answer jsonb;template_row public.route_templates;run_row public.route_runs;new_id uuid;
 new_runs uuid[]:='{}';draft_runs uuid[]:='{}';created_orders integer;created_routes integer:=0;created_stops integer;
begin
 if private.current_role() is distinct from 'owner' then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 replay:=private.reserve_preparation_request(p_request_id,'generate_week',jsonb_build_object('week',p_week_start));
 if (replay->>'found')::boolean then return replay->'result'; end if;
 if p_week_start is null or extract(isodow from p_week_start)<>1 then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
 for template_row in select * from public.route_templates order by weekday loop
  new_id:=null;
  insert into public.route_runs(template_id,service_date,driver_id,vehicle_id) values(template_row.id,p_week_start+template_row.weekday-1,template_row.driver_id,template_row.vehicle_id) on conflict(service_date) do nothing returning id into new_id;
  if new_id is not null then new_runs:=array_append(new_runs,new_id);created_routes:=created_routes+1;end if;
  -- Shared with order editing, load confirmation and start. Always acquire in service-date order.
  select * into run_row from public.route_runs where service_date=p_week_start+template_row.weekday-1 for update;
  if run_row.status='draft' then draft_runs:=array_append(draft_runs,run_row.id);end if;
 end loop;
 -- A single statement snapshots customer fields, quantities, prices and positions
 -- together. Separate INSERT statements can mix versions under READ COMMITTED.
 with customer_snapshot as materialized(
  select c.*,coalesce((select jsonb_agg(jsonb_build_object('productId',p.id,'eggsPerTray',p.eggs_per_tray,'trays',i.trays,'priceCents',coalesce(cp.price_cents,p.default_price_cents)) order by p.id)
   from public.standing_order_items i join public.products p on p.id=i.product_id left join public.customer_prices cp on cp.customer_id=c.id and cp.product_id=p.id where i.customer_id=c.id),'[]'::jsonb)items
  from public.customers c where c.active
 ),inserted_orders as(
  insert into public.weekly_orders(customer_id,route_id,delivery_date,customer_name,customer_address,customer_phone)
  select c.id,r.id,r.service_date,c.name,c.address,c.phone from customer_snapshot c join public.route_runs r on r.service_date=p_week_start+c.weekday-1
  where r.id=any(draft_runs) and c.weekday<>1
  and not exists(select from public.weekly_orders existing where existing.customer_id=c.id and existing.delivery_date between p_week_start and p_week_start+4)
  on conflict(customer_id,delivery_date) do nothing returning *
 ),inserted_items as(
  insert into public.weekly_order_items(order_id,product_id,eggs_per_tray,trays,price_cents)
  select o.id,(i->>'productId')::uuid,(i->>'eggsPerTray')::integer,(i->>'trays')::integer,(i->>'priceCents')::integer
  from inserted_orders o join customer_snapshot c on c.id=o.customer_id cross join lateral jsonb_array_elements(c.items)i returning order_id
 ),customer_stops as(
  select o.route_id,o.id order_id,'customer'::text kind,1 phase,c.position,c.id tie,o.customer_name name,o.customer_address address,o.customer_phone phone
  from inserted_orders o join customer_snapshot c on c.id=o.customer_id
 ),initial_stops as(
  select r.id route_id,null::uuid order_id,s.kind,case when t.weekday=1 then 0 when s.kind in('list_return','arrival') then 2 else 0 end phase,s.position,s.id tie,s.name,s.address,s.phone
  from public.route_runs r join public.route_templates t on t.id=r.template_id join public.route_template_stops s on s.template_id=t.id where r.id=any(new_runs)
  union all select * from customer_stops where route_id=any(new_runs)
 ),positioned_stops as(
  select x.route_id,x.order_id,x.kind,row_number()over(partition by x.route_id order by x.phase,x.position,x.tie)::integer position,x.name,x.address,x.phone from initial_stops x
  union all
  -- Existing positions, overrides and suspension remain unchanged. New customers
  -- append deterministically; the owner reviews their position before loading.
  select x.route_id,x.order_id,x.kind,(coalesce((select max(s.position) from public.route_stops s where s.route_id=x.route_id),0)+row_number()over(partition by x.route_id order by x.position,x.tie))::integer,x.name,x.address,x.phone
  from customer_stops x where not(x.route_id=any(new_runs))
 ),inserted_stops as(
  insert into public.route_stops(route_id,order_id,kind,position,name,address,phone)select route_id,order_id,kind,position,name,address,phone from positioned_stops returning id
 ),bumped_routes as(
  update public.route_runs set version=version+1 where id in(select route_id from inserted_orders) and not(id=any(new_runs)) returning id
 )select(select count(*)from inserted_orders),(select count(*)from inserted_stops)into created_orders,created_stops;
 answer:=jsonb_build_object('createdOrders',created_orders,'createdRoutes',created_routes);perform private.complete_request(p_request_id,answer);return answer;
end $$;

create function public.save_weekly_order(p_order_id uuid,p_expected_version integer,p_items jsonb,p_suspended boolean,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare replay jsonb;answer jsonb;order_row public.weekly_orders;run_row public.route_runs;resolved jsonb;
begin
 if private.current_role() is distinct from 'owner' then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 replay:=private.reserve_preparation_request(p_request_id,'save_weekly_order',jsonb_build_object('id',p_order_id,'version',p_expected_version,'items',p_items,'suspended',p_suspended));
 if (replay->>'found')::boolean then return replay->'result'; end if;
 select * into order_row from public.weekly_orders where id=p_order_id;
 if not found then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
 select * into run_row from public.route_runs where id=order_row.route_id for update;
 select * into order_row from public.weekly_orders where id=p_order_id for update;
 if run_row.status<>'draft' then raise exception 'ROUTE_LOCKED' using errcode='PT409'; end if;
 if order_row.version is distinct from p_expected_version then raise exception 'VERSION_CONFLICT' using errcode='PT409'; end if;
 if p_suspended is null or jsonb_typeof(p_items) is distinct from 'array' then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
 if not p_suspended then
  if exists(select from jsonb_array_elements(p_items) i where jsonb_typeof(i) is distinct from 'object' or coalesce(i->>'productId','')!~*'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' or jsonb_typeof(i->'trays') is distinct from 'number' or coalesce(i->>'trays','')!~'^[0-9]+$') then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
  if exists(select from jsonb_array_elements(p_items) i where (i->>'trays')::numeric not between 1 and 2147483647)
  or exists(select from jsonb_array_elements(p_items) i group by i->>'productId' having count(*)>1)
  or exists(select from jsonb_array_elements(p_items) i left join public.products p on p.id=(i->>'productId')::uuid where p.id is null) then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
  -- Existing items keep the week's price and pack size. Newly added products use the current negotiated/default price once.
  select coalesce(jsonb_agg(jsonb_build_object('productId',p.id,'trays',(i->>'trays')::integer,'eggsPerTray',coalesce(old.eggs_per_tray,p.eggs_per_tray),'priceCents',coalesce(old.price_cents,cp.price_cents,p.default_price_cents))),'[]'::jsonb) into resolved
  from jsonb_array_elements(p_items) i join public.products p on p.id=(i->>'productId')::uuid left join public.weekly_order_items old on old.order_id=p_order_id and old.product_id=p.id left join public.customer_prices cp on cp.customer_id=order_row.customer_id and cp.product_id=p.id;
  if(select coalesce(sum((i->>'trays')::numeric*(i->>'eggsPerTray')::numeric),0)>9007199254740991 or coalesce(sum((i->>'trays')::numeric*(i->>'priceCents')::numeric),0)>9007199254740991 from jsonb_array_elements(resolved)i) then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
  delete from public.weekly_order_items where order_id=p_order_id;
  insert into public.weekly_order_items select p_order_id,(i->>'productId')::uuid,(i->>'eggsPerTray')::integer,(i->>'trays')::integer,(i->>'priceCents')::integer from jsonb_array_elements(resolved)i;
 end if;
 update public.weekly_orders set status=case when p_suspended then 'suspended' else 'planned' end,version=version+1 where id=p_order_id returning * into order_row;
 update public.route_runs set version=version+1 where id=order_row.route_id;
 answer:=jsonb_build_object('id',order_row.id,'version',order_row.version,'status',order_row.status);perform private.complete_request(p_request_id,answer);return answer;
end $$;

create function public.save_route_run(p_route_id uuid,p_expected_version integer,p_driver_id uuid,p_vehicle_id uuid,p_stop_ids uuid[],p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare replay jsonb;answer jsonb;run_row public.route_runs;
begin
 if private.current_role() is distinct from 'owner' then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 replay:=private.reserve_preparation_request(p_request_id,'save_route_run',jsonb_build_object('id',p_route_id,'version',p_expected_version,'driver',p_driver_id,'vehicle',p_vehicle_id,'stops',p_stop_ids));
 if (replay->>'found')::boolean then return replay->'result'; end if;
 select * into run_row from public.route_runs where id=p_route_id for update;
 if not found then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
 if run_row.status<>'draft' then raise exception 'ROUTE_LOCKED' using errcode='PT409'; end if;
 if run_row.version is distinct from p_expected_version then raise exception 'VERSION_CONFLICT' using errcode='PT409'; end if;
 if(p_driver_id is not null and not exists(select from public.profiles where id=p_driver_id and role='driver')) or(p_vehicle_id is not null and not exists(select from public.vehicles where id=p_vehicle_id))
 or p_stop_ids is null or cardinality(p_stop_ids)<>(select count(*) from public.route_stops where route_id=p_route_id)
 or(select count(distinct id) from unnest(p_stop_ids)id)<>cardinality(p_stop_ids)
 or exists(select from unnest(p_stop_ids)id where not exists(select from public.route_stops s where s.id=id and s.route_id=p_route_id)) then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
 update public.route_stops s set position=x.position from unnest(p_stop_ids) with ordinality x(id,position) where s.id=x.id;
 update public.route_runs set driver_id=p_driver_id,vehicle_id=p_vehicle_id,version=version+1 where id=p_route_id returning * into run_row;
 answer:=jsonb_build_object('id',run_row.id,'version',run_row.version,'status',run_row.status);perform private.complete_request(p_request_id,answer);return answer;
end $$;

create function public.get_driver_route(p_service_date date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare run_row public.route_runs;answer jsonb;
begin
 if private.current_role() is distinct from 'driver' then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into run_row from public.route_runs where service_date=p_service_date and driver_id=auth.uid() and status<>'cancelled';
 if not found then return '{"available":false}'::jsonb; end if;
 select jsonb_build_object('id',run_row.id,'status',run_row.status,'version',run_row.version,'initialOdometerKm',run_row.initial_odometer_km,'stops',coalesce(jsonb_agg(jsonb_build_object(
  'id',s.id,'kind',s.kind,'position',s.position,'customerName',s.name,'address',s.address,'phone',s.phone,'status',s.status,
  'items',coalesce((select jsonb_agg(jsonb_build_object('eggsPerTray',i.eggs_per_tray,'trays',i.trays) order by i.product_id) from public.weekly_order_items i where i.order_id=s.order_id),'[]'::jsonb)
 )order by s.position)filter(where s.id is not null),'[]'::jsonb)) into answer from public.route_stops s left join public.weekly_orders o on o.id=s.order_id where s.route_id=run_row.id and(o.id is null or o.status<>'suspended');
 return answer;
end $$;
revoke all on function public.generate_week(date,uuid),public.save_weekly_order(uuid,integer,jsonb,boolean,uuid),public.save_route_run(uuid,integer,uuid,uuid,uuid[],uuid),public.get_driver_route(date),public.reconcile_preparation_request(uuid,text) from public,anon;
grant execute on function public.generate_week(date,uuid),public.save_weekly_order(uuid,integer,jsonb,boolean,uuid),public.save_route_run(uuid,integer,uuid,uuid,uuid[],uuid),public.get_driver_route(date),public.reconcile_preparation_request(uuid,text) to authenticated;

create function public.get_route_options()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if private.current_role() is distinct from 'owner' then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return jsonb_build_object('drivers',coalesce((select jsonb_agg(jsonb_build_object('id',id) order by id) from public.profiles where role='driver'),'[]'::jsonb),'vehicles',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by name,id) from public.vehicles),'[]'::jsonb));
end $$;
revoke all on function public.get_route_options() from public,anon;
grant execute on function public.get_route_options() to authenticated;
