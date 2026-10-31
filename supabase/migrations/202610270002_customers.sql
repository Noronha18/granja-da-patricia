create table public.products (
 id uuid primary key default gen_random_uuid(),
 name text not null check (length(trim(name)) between 1 and 160),
 eggs_per_tray integer not null unique check (eggs_per_tray > 0),
 default_price_cents integer not null check (default_price_cents >= 0)
);
create table public.customers (
 id uuid primary key default gen_random_uuid(),
 name text not null check (length(trim(name)) between 1 and 160),
 address text not null check (length(trim(address)) between 1 and 500),
 phone text check (length(phone) <= 40),
 active boolean not null default true,
 weekday integer not null check (weekday between 2 and 5),
 position integer not null check (position > 0),
 version integer not null default 1 check (version > 0)
);
create table public.customer_prices (
 customer_id uuid not null references public.customers(id) on delete cascade,
 product_id uuid not null references public.products(id),
 price_cents integer not null check (price_cents >= 0),
 primary key(customer_id,product_id)
);
create table public.standing_order_items (
 customer_id uuid not null references public.customers(id) on delete cascade,
 product_id uuid not null references public.products(id),
 trays integer not null check (trays > 0),
 primary key(customer_id,product_id)
);
alter table public.products enable row level security;
alter table public.customers enable row level security;
alter table public.customer_prices enable row level security;
alter table public.standing_order_items enable row level security;
revoke all on public.products,public.customers,public.customer_prices,public.standing_order_items from public,anon,authenticated;
grant select on public.products,public.customers,public.customer_prices,public.standing_order_items to authenticated;
grant insert on public.products to authenticated;
grant all on public.products,public.customers,public.customer_prices,public.standing_order_items to service_role;
create policy owner_read on public.products for select to authenticated using ((select role from public.profiles where id=(select auth.uid()))='owner');
create policy owner_insert on public.products for insert to authenticated with check ((select role from public.profiles where id=(select auth.uid()))='owner');
create policy owner_read on public.customers for select to authenticated using ((select role from public.profiles where id=(select auth.uid()))='owner');
create policy owner_read on public.customer_prices for select to authenticated using ((select role from public.profiles where id=(select auth.uid()))='owner');
create policy owner_read on public.standing_order_items for select to authenticated using ((select role from public.profiles where id=(select auth.uid()))='owner');

create function public.save_customer(p_customer_id uuid,p_expected_version integer,p_details jsonb,p_items jsonb,p_prices jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare replay jsonb; answer jsonb; current_version integer;
begin
 if private.current_role() is distinct from 'owner' then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 begin
  replay:=private.reserve_request(p_request_id,'save_customer',jsonb_build_object('id',p_customer_id,'version',p_expected_version,'details',p_details,'items',p_items,'prices',p_prices));
 exception when sqlstate '22023' then
  if exists(select from private.request_events where request_id=p_request_id and actor_id=auth.uid() and operation='save_customer' and result='{"closed":true}'::jsonb) then
   raise exception 'REQUEST_CLOSED' using errcode='55000';
  end if;
  raise;
 end;
 if (replay->>'found')::boolean then return replay->'result'; end if;
 if p_customer_id is null or p_expected_version is null or p_expected_version<0
 or jsonb_typeof(p_details) is distinct from 'object' or jsonb_typeof(p_items) is distinct from 'array' or jsonb_typeof(p_prices) is distinct from 'array' then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
 if jsonb_typeof(p_details->'name') is distinct from 'string' or length(trim(p_details->>'name')) not between 1 and 160
 or jsonb_typeof(p_details->'address') is distinct from 'string' or length(trim(p_details->>'address')) not between 1 and 500
 or (p_details ? 'phone' and jsonb_typeof(p_details->'phone') not in ('null','string')) or length(p_details->>'phone')>40
 or jsonb_typeof(p_details->'active') is distinct from 'boolean'
 or coalesce(p_details->>'weekday','') !~ '^[2-5]$' or coalesce(p_details->>'position','') !~ '^[0-9]+$'
 or (p_details->>'position')::numeric not between 1 and 2147483647 then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
 if exists(select from jsonb_array_elements(p_items) i where jsonb_typeof(i) is distinct from 'object' or jsonb_typeof(i->'productId') is distinct from 'string' or coalesce(i->>'productId','') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' or jsonb_typeof(i->'trays') is distinct from 'number' or coalesce(i->>'trays','') !~ '^[0-9]+$')
 or exists(select from jsonb_array_elements(p_prices) i where jsonb_typeof(i) is distinct from 'object' or jsonb_typeof(i->'productId') is distinct from 'string' or coalesce(i->>'productId','') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' or jsonb_typeof(i->'priceCents') is distinct from 'number' or coalesce(i->>'priceCents','') !~ '^[0-9]+$') then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
 if exists(select from jsonb_array_elements(p_items) i where (i->>'trays')::numeric not between 1 and 2147483647)
 or exists(select from jsonb_array_elements(p_prices) i where (i->>'priceCents')::numeric not between 0 and 2147483647)
 or exists(select from jsonb_array_elements(p_items) i left join public.products p on p.id=(i->>'productId')::uuid where p.id is null)
 or exists(select from jsonb_array_elements(p_prices) i left join public.products p on p.id=(i->>'productId')::uuid where p.id is null)
 or exists(select from jsonb_array_elements(p_items) i group by i->>'productId' having count(*)>1)
 or exists(select from jsonb_array_elements(p_prices) i group by i->>'productId' having count(*)>1) then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
 if (select coalesce(sum((i->>'trays')::numeric*p.eggs_per_tray),0)>9007199254740991 or coalesce(sum((i->>'trays')::numeric*coalesce((price->>'priceCents')::numeric,p.default_price_cents)),0)>9007199254740991 from jsonb_array_elements(p_items) i join public.products p on p.id=(i->>'productId')::uuid left join jsonb_array_elements(p_prices) price on price->>'productId'=i->>'productId') then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
 -- Business conflicts must not use 40001: PostgREST retries serialization errors.
 if p_expected_version=0 then
  insert into public.customers(id,name,address,phone,active,weekday,position) values(p_customer_id,trim(p_details->>'name'),trim(p_details->>'address'),nullif(trim(p_details->>'phone'),''),(p_details->>'active')::boolean,(p_details->>'weekday')::integer,(p_details->>'position')::integer) on conflict do nothing;
  if not found then raise exception 'VERSION_CONFLICT' using errcode='PT409'; end if;
  current_version:=1;
 else
  update public.customers set name=trim(p_details->>'name'),address=trim(p_details->>'address'),phone=nullif(trim(p_details->>'phone'),''),active=(p_details->>'active')::boolean,weekday=(p_details->>'weekday')::integer,position=(p_details->>'position')::integer,version=version+1 where id=p_customer_id and version=p_expected_version returning version into current_version;
  if not found then raise exception 'VERSION_CONFLICT' using errcode='PT409'; end if;
 end if;
 delete from public.standing_order_items where customer_id=p_customer_id;
 delete from public.customer_prices where customer_id=p_customer_id;
 insert into public.standing_order_items select p_customer_id,(i->>'productId')::uuid,(i->>'trays')::integer from jsonb_array_elements(p_items) i;
 insert into public.customer_prices select p_customer_id,(i->>'productId')::uuid,(i->>'priceCents')::integer from jsonb_array_elements(p_prices) i;
 answer:=jsonb_build_object('id',p_customer_id,'version',current_version);
 perform private.complete_request(p_request_id,answer);
 return answer;
end $$;
revoke all on function public.save_customer(uuid,integer,jsonb,jsonb,jsonb,uuid) from public,anon;
grant execute on function public.save_customer(uuid,integer,jsonb,jsonb,jsonb,uuid) to authenticated;

-- Unique request_id serializes reconciliation with a save already in flight. A
-- tombstone also rejects a delayed save that has not reached PostgreSQL yet.
create function public.reconcile_customer_request(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare existing private.request_events;
begin
 if private.current_role() is distinct from 'owner' then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_request_id is null then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
 insert into private.request_events(request_id,actor_id,operation,payload_hash,result)
 values(p_request_id,auth.uid(),'save_customer','closed','{"closed":true}') on conflict do nothing;
 select * into existing from private.request_events where request_id=p_request_id for update;
 if existing.actor_id<>auth.uid() or existing.operation<>'save_customer' then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if existing.result='{"closed":true}'::jsonb then return '{"status":"closed"}'::jsonb; end if;
 if existing.result is null then raise exception 'REQUEST_UNFINISHED' using errcode='55000'; end if;
 return jsonb_build_object('status','saved','result',existing.result);
end $$;
revoke all on function public.reconcile_customer_request(uuid) from public,anon;
grant execute on function public.reconcile_customer_request(uuid) to authenticated;
