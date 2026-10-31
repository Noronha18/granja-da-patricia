create table public.customer_sources(source text not null check(length(trim(source)) between 1 and 100),source_id text not null check(length(trim(source_id)) between 1 and 160),customer_id uuid not null references public.customers(id) on delete cascade,primary key(source,source_id));
create table public.customer_import_batches(id uuid primary key,actor_id uuid not null references auth.users(id),source text not null,payload_hash text not null,expected jsonb not null,result jsonb,created_at timestamptz not null default now());
create table public.operational_locations(id uuid primary key,name text not null check(length(trim(name)) between 1 and 160),address text check(length(address)<=500),confirmed boolean not null default false,constraint location_confirmation check(not confirmed or coalesce(length(trim(address)),0)>0));
create table public.operational_settings(singleton boolean primary key default true check(singleton),version integer not null default 1 check(version>0),driver_id uuid references public.profiles(id),vehicle_id uuid references public.vehicles(id));
insert into public.operational_settings(singleton)values(true);
alter table public.route_templates add column origin_location_id uuid references public.operational_locations(id),add column destination_location_id uuid references public.operational_locations(id);
alter table public.route_template_stops add column location_id uuid references public.operational_locations(id),add constraint template_stop_kind unique(template_id,kind);

do $$declare tab text;begin
 foreach tab in array array['customer_sources','customer_import_batches','operational_locations','operational_settings']loop
  execute format('alter table public.%I enable row level security',tab);
  execute format('revoke all on public.%I from public,anon,authenticated',tab);
  execute format('grant all on public.%I to service_role',tab);
  if tab<>'customer_import_batches' then
   execute format('grant select on public.%I to authenticated',tab);
   execute format('create policy owner_read on public.%I for select to authenticated using ((select role from public.profiles where id=(select auth.uid()))=''owner'')',tab);
  end if;
 end loop;
end $$;

create function private.validate_customer_import(p_source text,p_rows jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare row_data jsonb;
begin
 if p_source is null or length(trim(p_source)) not between 1 and 100 or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)=0 then raise exception 'INVALID_INPUT' using errcode='22023';end if;
 for row_data in select value from jsonb_array_elements(p_rows)loop
  if jsonb_typeof(row_data) is distinct from 'object' then raise exception 'INVALID_INPUT' using errcode='22023';end if;
  if exists(select from jsonb_object_keys(row_data)key where key<>all(array['sourceId','name','phone','address','weekday','position','eggsPerTray','trays']))
  or jsonb_typeof(row_data->'sourceId') is distinct from 'string' or length(trim(row_data->>'sourceId')) not between 1 and 160
  or jsonb_typeof(row_data->'name') is distinct from 'string' or length(trim(row_data->>'name')) not between 1 and 160
  or jsonb_typeof(row_data->'address') is distinct from 'string' or length(trim(row_data->>'address')) not between 1 and 500
  or(row_data?'phone' and jsonb_typeof(row_data->'phone')not in('string','null'))or length(row_data->>'phone')>40
  or jsonb_typeof(row_data->'weekday') is distinct from 'number' or coalesce(row_data->>'weekday','')!~'^[2-5]$'
  or jsonb_typeof(row_data->'position') is distinct from 'number' or coalesce(row_data->>'position','')!~'^[0-9]+$'
  or jsonb_typeof(row_data->'trays') is distinct from 'number' or coalesce(row_data->>'trays','')!~'^[0-9]+$'
  or jsonb_typeof(row_data->'eggsPerTray') is distinct from 'number' or coalesce(row_data->>'eggsPerTray','')not in('15','20','30')then raise exception 'INVALID_INPUT' using errcode='22023';end if;
  if(row_data->>'position')::numeric not between 1 and 2147483647 or(row_data->>'trays')::numeric not between 1 and 2147483647 then raise exception 'INVALID_INPUT' using errcode='22023';end if;
 end loop;
 if exists(select from jsonb_array_elements(p_rows)r group by trim(r->>'sourceId') having count(distinct jsonb_build_object('name',trim(r->>'name'),'address',trim(r->>'address'),'phone',nullif(trim(r->>'phone'),''),'weekday',r->'weekday','position',r->'position'))>1 or count(*)<>count(distinct r->>'eggsPerTray'))
 or exists(select from jsonb_array_elements(p_rows)r left join public.products p on p.eggs_per_tray=(r->>'eggsPerTray')::integer where p.id is null)
 or exists(select from jsonb_array_elements(p_rows)r join public.products p on p.eggs_per_tray=(r->>'eggsPerTray')::integer left join public.customer_sources m on m.source=trim(p_source)and m.source_id=trim(r->>'sourceId')left join public.customer_prices cp on cp.customer_id=m.customer_id and cp.product_id=p.id group by trim(r->>'sourceId')having sum((r->>'trays')::numeric*coalesce(cp.price_cents,p.default_price_cents))>9007199254740991)
 then raise exception 'INVALID_INPUT' using errcode='22023';end if;
end $$;
revoke all on function private.validate_customer_import(text,jsonb)from public,anon,authenticated;

create function public.prepare_customer_import(p_batch_id uuid,p_source text,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare batch public.customer_import_batches;fingerprint text;expected jsonb;created integer;updated integer;groups jsonb;
begin
 if private.current_role() is distinct from 'owner'then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_batch_id is null then raise exception 'INVALID_INPUT' using errcode='22023';end if;
 perform private.validate_customer_import(p_source,p_rows);fingerprint:=encode(extensions.digest(p_rows::text,'sha256'),'hex');
 select jsonb_object_agg(s.source_id,jsonb_build_object('customerId',m.customer_id,'version',coalesce(c.version,0)))into expected from(select distinct trim(r->>'sourceId')source_id from jsonb_array_elements(p_rows)r)s left join public.customer_sources m on m.source=trim(p_source)and m.source_id=s.source_id left join public.customers c on c.id=m.customer_id;
 insert into public.customer_import_batches(id,actor_id,source,payload_hash,expected)values(p_batch_id,auth.uid(),trim(p_source),fingerprint,expected)on conflict do nothing;
 select * into batch from public.customer_import_batches where id=p_batch_id for update;
 if batch.actor_id<>auth.uid()then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if batch.source<>trim(p_source)or batch.payload_hash<>fingerprint then raise exception 'BATCH_CONFLICT' using errcode='PT409';end if;
 select count(*)filter(where(value->>'version')::integer=0),count(*)filter(where(value->>'version')::integer>0),jsonb_agg(jsonb_build_object('sourceId',key,'action',case when(value->>'version')::integer=0 then 'create'else 'update'end)order by key)into created,updated,groups from jsonb_each(batch.expected);
 return jsonb_build_object('created',created,'updated',updated,'rejected',0,'groups',groups);
end $$;

create function public.commit_customer_import(p_batch_id uuid,p_rows jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare replay jsonb;batch public.customer_import_batches;fingerprint text;v_source_id text;current_id uuid;expected_id uuid;current_version integer;details jsonb;created integer:=0;updated integer:=0;answer jsonb;
begin
 if private.current_role() is distinct from 'owner'then raise exception 'FORBIDDEN' using errcode='42501';end if;
 replay:=private.reserve_preparation_request(p_request_id,'commit_customer_import',jsonb_build_object('batch',p_batch_id,'rows',p_rows));if(replay->>'found')::boolean then return replay->'result';end if;
 select * into batch from public.customer_import_batches where id=p_batch_id for update;
 if not found then raise exception 'INVALID_INPUT' using errcode='22023';end if;
 if batch.actor_id<>auth.uid()then raise exception 'FORBIDDEN' using errcode='42501';end if;
 fingerprint:=encode(extensions.digest(p_rows::text,'sha256'),'hex');if batch.payload_hash is distinct from fingerprint then raise exception 'BATCH_CONFLICT' using errcode='PT409';end if;
 if batch.result is not null then perform private.complete_request(p_request_id,batch.result);return batch.result;end if;
 perform private.validate_customer_import(batch.source,p_rows);
 -- Reserve absent mappings as well as existing ones without creating customer rows before confirmation.
 for v_source_id in select key from jsonb_each(batch.expected)order by key loop
  perform pg_advisory_xact_lock(hashtextextended(batch.source||chr(31)||v_source_id,0));
 end loop;
 perform c.id from public.customers c join jsonb_each(batch.expected)e on c.id=(e.value->>'customerId')::uuid order by c.id for update of c;
 for v_source_id in select key from jsonb_each(batch.expected)order by key loop
  select m.customer_id,c.version into current_id,current_version from public.customer_sources m join public.customers c on c.id=m.customer_id where m.source=batch.source and m.source_id=v_source_id;
  expected_id:=(batch.expected->v_source_id->>'customerId')::uuid;
  if current_id is distinct from expected_id or(current_id is not null and current_version<>(batch.expected->v_source_id->>'version')::integer)then raise exception 'VERSION_CONFLICT' using errcode='PT409';end if;
 end loop;
 for v_source_id in select key from jsonb_each(batch.expected)order by key loop
  select value into details from jsonb_array_elements(p_rows)where trim(value->>'sourceId')=v_source_id limit 1;
  current_id:=(batch.expected->v_source_id->>'customerId')::uuid;
  if current_id is null then
   insert into public.customers(name,address,phone,weekday,position)values(trim(details->>'name'),trim(details->>'address'),nullif(trim(details->>'phone'),''),(details->>'weekday')::integer,(details->>'position')::integer)returning id into current_id;
   insert into public.customer_sources values(batch.source,v_source_id,current_id);created:=created+1;
  else
   update public.customers set name=trim(details->>'name'),address=trim(details->>'address'),phone=nullif(trim(details->>'phone'),''),weekday=(details->>'weekday')::integer,position=(details->>'position')::integer,version=version+1 where id=current_id;updated:=updated+1;
  end if;
  delete from public.standing_order_items where customer_id=current_id;
  insert into public.standing_order_items(customer_id,product_id,trays)select current_id,p.id,(r->>'trays')::integer from jsonb_array_elements(p_rows)r join public.products p on p.eggs_per_tray=(r->>'eggsPerTray')::integer where trim(r->>'sourceId')=v_source_id;
 end loop;
 answer:=jsonb_build_object('created',created,'updated',updated,'rejected',0);update public.customer_import_batches set result=answer where id=p_batch_id;perform private.complete_request(p_request_id,answer);return answer;
end $$;

create function public.get_operational_settings()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare settings public.operational_settings;
begin
 if private.current_role() is distinct from 'owner'then raise exception 'FORBIDDEN' using errcode='42501';end if;
 select * into settings from public.operational_settings where singleton;
 return jsonb_build_object('version',settings.version,'driverId',settings.driver_id,'vehicle',(select jsonb_build_object('id',id,'name',name)from public.vehicles where id=settings.vehicle_id),'locations',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'address',address,'confirmed',confirmed)order by name,id)from public.operational_locations),'[]'::jsonb),'days',(select jsonb_agg(jsonb_build_object('weekday',t.weekday,'name',t.name,'originId',t.origin_location_id,'destinationId',t.destination_location_id,'pickupId',(select location_id from public.route_template_stops where template_id=t.id and kind='pickup'),'listPickupId',(select location_id from public.route_template_stops where template_id=t.id and kind='list_pickup'),'listReturnId',(select location_id from public.route_template_stops where template_id=t.id and kind='list_return'))order by t.weekday)from public.route_templates t));
end $$;

create function public.save_operational_settings(p_expected_version integer,p_settings jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare replay jsonb;settings public.operational_settings;location jsonb;day jsonb;field text;driver uuid;vehicle uuid;template uuid;v_kind text;v_location_id uuid;label text;v_address text;answer jsonb;
begin
 if private.current_role() is distinct from 'owner'then raise exception 'FORBIDDEN' using errcode='42501';end if;
 replay:=private.reserve_preparation_request(p_request_id,'save_operational_settings',jsonb_build_object('version',p_expected_version,'settings',p_settings));if(replay->>'found')::boolean then return replay->'result';end if;
 select * into settings from public.operational_settings where singleton for update;
 if settings.version is distinct from p_expected_version then raise exception 'VERSION_CONFLICT' using errcode='PT409';end if;
 if jsonb_typeof(p_settings)is distinct from 'object'or jsonb_typeof(p_settings->'locations')is distinct from 'array'or jsonb_typeof(p_settings->'days')is distinct from 'array'or jsonb_array_length(p_settings->'days')<>5 then raise exception 'INVALID_INPUT' using errcode='22023';end if;
 if(p_settings->>'driverId'is not null and coalesce(p_settings->>'driverId','')!~*'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$')then raise exception 'INVALID_INPUT' using errcode='22023';end if;
 driver:=(p_settings->>'driverId')::uuid;if driver is not null and not exists(select from public.profiles where id=driver and role='driver')then raise exception 'INVALID_INPUT' using errcode='22023';end if;
 if p_settings->>'vehicle'is not null then
  if jsonb_typeof(p_settings->'vehicle')is distinct from 'object'or coalesce(p_settings#>>'{vehicle,id}','')!~*'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'or jsonb_typeof(p_settings#>'{vehicle,name}')is distinct from 'string'or length(trim(p_settings#>>'{vehicle,name}'))not between 1 and 160 then raise exception 'INVALID_INPUT' using errcode='22023';end if;
  vehicle:=(p_settings#>>'{vehicle,id}')::uuid;insert into public.vehicles(id,name)values(vehicle,trim(p_settings#>>'{vehicle,name}'))on conflict(id)do update set name=excluded.name;
 end if;
 for location in select value from jsonb_array_elements(p_settings->'locations')loop
  if jsonb_typeof(location)is distinct from 'object'or coalesce(location->>'id','')!~*'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'or jsonb_typeof(location->'name')is distinct from 'string'or length(trim(location->>'name'))not between 1 and 160 or(location?'address'and jsonb_typeof(location->'address')not in('string','null'))or length(location->>'address')>500 or jsonb_typeof(location->'confirmed')is distinct from 'boolean'then raise exception 'INVALID_INPUT' using errcode='22023';end if;
  if(location->>'confirmed')::boolean and coalesce(length(trim(location->>'address')),0)=0 then raise exception 'INVALID_INPUT' using errcode='22023';end if;
  insert into public.operational_locations(id,name,address,confirmed)values((location->>'id')::uuid,trim(location->>'name'),nullif(trim(location->>'address'),''),(location->>'confirmed')::boolean)on conflict(id)do update set name=excluded.name,address=excluded.address,confirmed=excluded.confirmed;
 end loop;
 if(select count(distinct value->>'id')from jsonb_array_elements(p_settings->'locations'))<>jsonb_array_length(p_settings->'locations')then raise exception 'INVALID_INPUT' using errcode='22023';end if;
 for day in select value from jsonb_array_elements(p_settings->'days')loop
  if jsonb_typeof(day)is distinct from 'object'or jsonb_typeof(day->'weekday')is distinct from 'number'or coalesce(day->>'weekday','')!~'^[1-5]$'then raise exception 'INVALID_INPUT' using errcode='22023';end if;
  foreach field in array array['originId','destinationId','pickupId','listPickupId','listReturnId']loop
   if day->>field is not null and(coalesce(day->>field,'')!~*'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'or not exists(select from public.operational_locations where id=(day->>field)::uuid))then raise exception 'INVALID_INPUT' using errcode='22023';end if;
  end loop;
  select id into template from public.route_templates where weekday=(day->>'weekday')::integer;
  update public.route_templates set driver_id=driver,vehicle_id=vehicle,origin_location_id=(day->>'originId')::uuid,destination_location_id=(day->>'destinationId')::uuid where id=template;
  if(day->>'weekday')::integer in(2,3)then
   if day->>'destinationId'is null then delete from public.route_template_stops where template_id=template and kind='arrival';
   else insert into public.route_template_stops(template_id,kind,position,name)values(template,'arrival',4,'Chegada')on conflict(template_id,kind)do nothing;end if;
  end if;
  for v_kind in select s.kind from public.route_template_stops s where s.template_id=template loop
   field:=case v_kind when 'departure'then 'originId'when 'arrival'then 'destinationId'when 'pickup'then 'pickupId'when 'list_pickup'then 'listPickupId'else 'listReturnId'end;
   v_location_id:=(day->>field)::uuid;label:=case v_kind when 'departure'then 'Saída'when 'arrival'then 'Chegada'when 'pickup'then 'Coleta'when 'list_pickup'then 'Retirar lista'else 'Devolver lista'end;v_address:=null;
   if v_location_id is not null then select label||' — '||l.name,case when l.confirmed then l.address else null end into label,v_address from public.operational_locations l where l.id=v_location_id;end if;
   update public.route_template_stops set name=label,address=v_address,location_id=v_location_id where template_id=template and route_template_stops.kind=v_kind;
  end loop;
 end loop;
 if(select count(distinct value->>'weekday')from jsonb_array_elements(p_settings->'days'))<>5 then raise exception 'INVALID_INPUT' using errcode='22023';end if;
 update public.operational_settings set driver_id=driver,vehicle_id=vehicle,version=version+1 where singleton returning * into settings;
 answer:=jsonb_build_object('version',settings.version);perform private.complete_request(p_request_id,answer);return answer;
end $$;

-- Keep the existing generation contract while serializing configuration snapshots
-- with settings changes. The core still takes the route row locks and one data snapshot.
alter function public.generate_week(date,uuid)set schema private;
alter function private.generate_week(date,uuid)rename to generate_week_core;
revoke all on function private.generate_week_core(date,uuid)from public,anon,authenticated;
create function public.generate_week(p_week_start date,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if private.current_role()is distinct from 'owner'then raise exception 'FORBIDDEN' using errcode='42501';end if;
 perform 1 from public.operational_settings where singleton for share;
 return private.generate_week_core(p_week_start,p_request_id);
end $$;

create function public.reconcile_configuration_request(p_request_id uuid,p_operation text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare existing private.request_events;
begin
 if private.current_role()is distinct from 'owner'then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_request_id is null or p_operation is null or p_operation not in('commit_customer_import','save_operational_settings')then raise exception 'INVALID_INPUT' using errcode='22023';end if;
 insert into private.request_events(request_id,actor_id,operation,payload_hash,result)values(p_request_id,auth.uid(),p_operation,'closed','{"closed":true}')on conflict do nothing;
 select * into existing from private.request_events where request_id=p_request_id for update;
 if existing.actor_id<>auth.uid()or existing.operation<>p_operation then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if existing.result='{"closed":true}'::jsonb then return '{"status":"closed"}'::jsonb;end if;
 if existing.result is null then raise exception 'REQUEST_UNFINISHED' using errcode='55000';end if;
 return jsonb_build_object('status','saved','result',existing.result);
end $$;
revoke all on function public.prepare_customer_import(uuid,text,jsonb),public.commit_customer_import(uuid,jsonb,uuid),public.get_operational_settings(),public.save_operational_settings(integer,jsonb,uuid),public.generate_week(date,uuid),public.reconcile_configuration_request(uuid,text)from public,anon;
grant execute on function public.prepare_customer_import(uuid,text,jsonb),public.commit_customer_import(uuid,jsonb,uuid),public.get_operational_settings(),public.save_operational_settings(integer,jsonb,uuid),public.generate_week(date,uuid),public.reconcile_configuration_request(uuid,text)to authenticated;
