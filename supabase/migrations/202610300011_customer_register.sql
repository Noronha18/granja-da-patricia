-- Contact records in review cannot generate operational deliveries.
alter table public.customers add column notes text not null default '' check(length(notes)<=10000);
alter table public.customers add column review_pending boolean not null default false;
alter table public.customers add column source_details jsonb not null default '{}'::jsonb check(jsonb_typeof(source_details)='object');
alter table public.customers alter column weekday drop not null;
alter table public.customers add constraint customers_pending_day check(weekday is not null or (review_pending and not active));
alter table public.customers add constraint customers_review_before_activation check(not active or not review_pending);

create or replace function public.save_customer(p_customer_id uuid,p_expected_version integer,p_details jsonb,p_items jsonb,p_prices jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare replay jsonb; answer jsonb; current_version integer; next_notes text; next_review boolean;
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
 or (p_details->>'weekday' is not null and coalesce(p_details->>'weekday','') !~ '^[2-5]$') or coalesce(p_details->>'position','') !~ '^[0-9]+$'
 or (p_details->>'position')::numeric not between 1 and 2147483647 then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
 if (p_details ? 'notes' and jsonb_typeof(p_details->'notes') is distinct from 'string')
 or (p_details ? 'reviewPending' and jsonb_typeof(p_details->'reviewPending') is distinct from 'boolean') then raise exception 'INVALID_INPUT' using errcode='22023';end if;
 select coalesce(p_details->>'notes',c.notes,''),coalesce((p_details->>'reviewPending')::boolean,c.review_pending,false) into next_notes,next_review from (select 1) seed left join public.customers c on c.id=p_customer_id;
 if length(next_notes)>10000 or ((p_details->>'active')::boolean and next_review)
 or ((p_details->>'weekday') is null and ((p_details->>'active')::boolean or not next_review or jsonb_array_length(p_items)>0)) then raise exception 'INVALID_INPUT' using errcode='22023';end if;
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
  insert into public.customers(id,name,address,phone,active,weekday,position,notes,review_pending) values(p_customer_id,trim(p_details->>'name'),trim(p_details->>'address'),nullif(trim(p_details->>'phone'),''),(p_details->>'active')::boolean,(p_details->>'weekday')::integer,(p_details->>'position')::integer,next_notes,next_review) on conflict do nothing;
  if not found then raise exception 'VERSION_CONFLICT' using errcode='PT409'; end if;
  current_version:=1;
 else
  update public.customers set name=trim(p_details->>'name'),address=trim(p_details->>'address'),phone=nullif(trim(p_details->>'phone'),''),active=(p_details->>'active')::boolean,weekday=(p_details->>'weekday')::integer,position=(p_details->>'position')::integer,notes=next_notes,review_pending=next_review,version=version+1 where id=p_customer_id and version=p_expected_version returning version into current_version;
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
