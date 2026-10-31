-- Lifecycle writes serialize vehicle -> route -> customer IDs -> stock keys.
-- Financial and physical corrections are current events; no historical recosting.
alter table public.route_runs
 add column load_eggs integer not null default 0 check(load_eggs>=0),
 add column final_odometer_km integer check(final_odometer_km>=0),
 add column declared_return_eggs integer check(declared_return_eggs>=0),
 add column declared_loss_eggs integer check(declared_loss_eggs>=0),
 add column declared_loss_reason text,
 add column reconciled_return_eggs integer check(reconciled_return_eggs>=0),
 add column reconciled_loss_eggs integer check(reconciled_loss_eggs>=0),
 add column reconciliation_reason text,
 add column started_at timestamptz, add column submitted_at timestamptz, add column closed_at timestamptz;
alter table public.route_stops add column reason text, add column confirmed_at timestamptz;
create table public.delivery_corrections(
 id uuid primary key default gen_random_uuid(), stop_id uuid references public.route_stops(id),
 route_id uuid not null references public.route_runs(id), kind text not null check(kind in('price','delivery','reopen','cancel')),
 previous_result text, actual_result text, goods_location text check(goods_location in('farm','vehicle')),
 original_sale_id uuid references public.sales(id), replacement_sale_id uuid references public.sales(id),
 stock_event_id uuid references public.stock_events(id),
 reason text not null check(length(trim(reason)) between 1 and 1000),
 actor_id uuid not null references auth.users(id), effective_at timestamptz not null default clock_timestamp(),
 created_at timestamptz not null default clock_timestamp()
);
alter table public.delivery_corrections enable row level security;
revoke all on public.delivery_corrections from public,anon,authenticated;
grant select on public.delivery_corrections to authenticated;
grant all on public.delivery_corrections to service_role;
create policy owner_read on public.delivery_corrections for select to authenticated using ((select role from public.profiles where id=(select auth.uid()))='owner');

create function private.lock_operating_route(p_route_id uuid,p_owner_only boolean default false)
returns public.route_runs language plpgsql security definer set search_path='' as $$
declare r public.route_runs;v uuid;actor_role text:=private.current_role();begin
 if actor_role is null or (p_owner_only and actor_role<>'owner') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 select vehicle_id into v from public.route_runs where id=p_route_id;
 if not found then raise exception 'ROUTE_NOT_FOUND' using errcode='22023';end if;
 if v is not null then perform 1 from public.vehicles where id=v for update;end if;
 select * into r from public.route_runs where id=p_route_id for update;
 if r.vehicle_id is distinct from v then raise exception 'VERSION_CONFLICT' using errcode='PT409';end if;
 if actor_role<>'owner' and r.driver_id is distinct from auth.uid() then raise exception 'FORBIDDEN' using errcode='42501';end if;
 return r;
end $$;
create function private.route_result(p_route_id uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('routeId',id,'status',status,'version',version) from public.route_runs where id=p_route_id;
$$;
create function private.require_reason(p_reason text) returns void language plpgsql set search_path='' as $$begin
 if nullif(trim(p_reason),'') is null then raise exception 'REASON_REQUIRED' using errcode='22023';end if;
 if length(p_reason)>1000 then raise exception 'INVALID_INPUT' using errcode='22023';end if;
end $$;

-- One implementation shares state/lock validation across the small lifecycle RPCs.
create function private.change_route(p_action text,p_route_id uuid,p_expected_version integer,p_odometer integer,p_return integer,p_loss integer,p_reason text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.route_runs; replay jsonb;answer jsonb;n numeric;b public.stock_balances;e uuid;why text:=nullif(trim(p_reason),'');owner_only boolean;
begin
 owner_only:=p_action in('confirm_route_load','reopen_preparation','cancel_route','reconcile_route');
 if private.current_role() is null or (owner_only and private.current_role()<>'owner') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 replay:=private.reserve_preparation_request(p_request_id,p_action,jsonb_build_object('route',p_route_id,'version',p_expected_version,'odometer',p_odometer,'return',p_return,'loss',p_loss,'reason',p_reason));
 if(replay->>'found')::boolean then return replay->'result';end if;
 r:=private.lock_operating_route(p_route_id,owner_only);
 if p_action<>'submit_route_return' and r.version is distinct from p_expected_version then raise exception 'VERSION_CONFLICT' using errcode='PT409';end if;
 if p_action in('confirm_route_load','start_route') then
  if r.vehicle_id is null or r.driver_id is null then raise exception 'ASSIGNMENT_REQUIRED' using errcode='22023';end if;
  if not exists(select from public.profiles where id=r.driver_id and role='driver') then raise exception 'ASSIGNMENT_REQUIRED' using errcode='22023';end if;
  if exists(select from public.route_runs where id<>r.id and vehicle_id=r.vehicle_id and status in('ready','in_progress','awaiting_reconciliation'))
   or exists(select from public.stock_balances where vehicle_id=r.vehicle_id and route_id<>r.id and eggs>0) then raise exception 'VEHICLE_BUSY' using errcode='PT409';end if;
 end if;
 if p_action='confirm_route_load' then
  if r.status<>'draft' then raise exception 'ROUTE_LOCKED' using errcode='PT409';end if;
  select coalesce(sum(i.eggs_per_tray::numeric*i.trays),0) into n from public.weekly_orders o join public.weekly_order_items i on i.order_id=o.id where o.route_id=r.id and o.status='planned';
  if n>2147483647 then raise exception 'AMOUNT_OUT_OF_RANGE' using errcode='22003';end if;
  if exists(select from public.weekly_orders o where o.route_id=r.id and o.status='planned' and not exists(select from public.weekly_order_items i where i.order_id=o.id)) then raise exception 'EMPTY_ORDER' using errcode='22023';end if;
  if n>0 then perform private.transfer_stock(r.id,'load',n::integer,p_request_id);end if;
  update public.route_runs set status='ready',load_eggs=n::integer,version=version+1 where id=r.id;
 elsif p_action in('reopen_preparation','cancel_route') then
  perform private.require_reason(p_reason);
  if (p_action='reopen_preparation' and r.status<>'ready') or (p_action='cancel_route' and r.status not in('draft','ready')) then raise exception 'ROUTE_LOCKED' using errcode='PT409';end if;
  select * into b from public.stock_balances where route_id=r.id;
  if coalesce(b.eggs,0)>0 then e:=private.transfer_stock(r.id,'return',b.eggs,p_request_id);end if;
  insert into public.delivery_corrections(route_id,kind,stock_event_id,reason,actor_id) values(r.id,case when p_action='cancel_route' then 'cancel' else 'reopen' end,e,why,auth.uid());
  if p_action='cancel_route' then update public.weekly_orders set status='suspended',version=version+1 where route_id=r.id;end if;
  update public.route_runs set status=case when p_action='cancel_route' then 'cancelled' else 'draft' end,load_eggs=0,version=version+1 where id=r.id;
 elsif p_action='start_route' then
  if r.status<>'ready' and not(r.status='draft' and not exists(select from public.weekly_orders where route_id=r.id and status='planned')) then raise exception 'LOAD_REQUIRED' using errcode='PT409';end if;
  if p_odometer is null or p_odometer<0 then raise exception 'INVALID_ODOMETER' using errcode='22023';end if;
  update public.route_runs set status='in_progress',initial_odometer_km=p_odometer,started_at=clock_timestamp(),version=version+1 where id=r.id;
 elsif p_action='submit_route_return' then
  if r.status<>'in_progress' then raise exception 'ROUTE_LOCKED' using errcode='PT409';end if;
  if p_odometer is null or p_odometer<r.initial_odometer_km then raise exception 'INVALID_ODOMETER' using errcode='22023';end if;
  if p_return is null or p_loss is null or p_return<0 or p_loss<0 then raise exception 'INVALID_INPUT' using errcode='22023';end if;
  if p_loss>0 then perform private.require_reason(p_reason);end if;
  if exists(select from public.route_stops s join public.weekly_orders o on o.id=s.order_id where s.route_id=r.id and s.status='pending' and o.status<>'suspended') then raise exception 'PENDING_DELIVERIES' using errcode='PT409';end if;
  update public.route_runs set status='awaiting_reconciliation',final_odometer_km=p_odometer,declared_return_eggs=p_return,declared_loss_eggs=p_loss,declared_loss_reason=why,submitted_at=clock_timestamp(),version=version+1 where id=r.id;
 elsif p_action='reconcile_route' then
  if r.status<>'awaiting_reconciliation' then raise exception 'ROUTE_LOCKED' using errcode='PT409';end if;
  if p_return is null or p_loss is null or p_return<0 or p_loss<0 then raise exception 'INVALID_INPUT' using errcode='22023';end if;
  if p_loss>0 or p_return is distinct from r.declared_return_eggs or p_loss is distinct from r.declared_loss_eggs then perform private.require_reason(p_reason);end if;
  select * into b from public.stock_balances where route_id=r.id;
  if coalesce(b.eggs,0)::bigint<>p_return::bigint+p_loss then raise exception 'STOCK_MISMATCH' using errcode='PT409';end if;
  -- Lock both stock keys before either helper, preserving the shared order.
  perform 1 from public.stock_balances where balance_key in('farm',r.id::text) order by balance_key for update;
  if p_loss>0 then
   e:=private.consume_stock(r.id,'loss',p_loss,p_request_id);
   update public.stock_events set reason=why where id=e;
  end if;
  if p_return>0 then perform private.transfer_stock(r.id,'return',p_return,p_request_id);end if;
  update public.route_runs set status='closed',reconciled_return_eggs=p_return,reconciled_loss_eggs=p_loss,reconciliation_reason=why,closed_at=clock_timestamp(),version=version+1 where id=r.id;
 else raise exception 'INVALID_INPUT' using errcode='22023';end if;
 answer:=private.route_result(r.id);perform private.complete_request(p_request_id,answer);return answer;
end $$;
create function public.confirm_route_load(p_route_id uuid,p_expected_version integer,p_request_id uuid) returns jsonb language sql security definer set search_path='' as $$select private.change_route('confirm_route_load',p_route_id,p_expected_version,null,null,null,null,p_request_id)$$;
create function public.reopen_preparation(p_route_id uuid,p_expected_version integer,p_reason text,p_request_id uuid) returns jsonb language sql security definer set search_path='' as $$select private.change_route('reopen_preparation',p_route_id,p_expected_version,null,null,null,p_reason,p_request_id)$$;
create function public.cancel_route(p_route_id uuid,p_expected_version integer,p_reason text,p_request_id uuid) returns jsonb language sql security definer set search_path='' as $$select private.change_route('cancel_route',p_route_id,p_expected_version,null,null,null,p_reason,p_request_id)$$;
create function public.start_route(p_route_id uuid,p_expected_version integer,p_odometer integer,p_request_id uuid) returns jsonb language sql security definer set search_path='' as $$select private.change_route('start_route',p_route_id,p_expected_version,p_odometer,null,null,null,p_request_id)$$;
create function public.submit_route_return(p_route_id uuid,p_odometer integer,p_return_eggs integer,p_loss_eggs integer,p_loss_reason text,p_request_id uuid) returns jsonb language sql security definer set search_path='' as $$select private.change_route('submit_route_return',p_route_id,null,p_odometer,p_return_eggs,p_loss_eggs,p_loss_reason,p_request_id)$$;
create function public.reconcile_route(p_route_id uuid,p_expected_version integer,p_return_eggs integer,p_loss_eggs integer,p_reason text,p_request_id uuid) returns jsonb language sql security definer set search_path='' as $$select private.change_route('reconcile_route',p_route_id,p_expected_version,null,p_return_eggs,p_loss_eggs,p_reason,p_request_id)$$;

create function private.deliver_stop(p_stop_id uuid,p_result text,p_reason text,p_replacement_of uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare s public.route_stops;o public.weekly_orders;items jsonb;n numeric;amount numeric;sale_id uuid;event_id uuid;cost bigint;
begin
 select * into s from public.route_stops where id=p_stop_id;
 select * into o from public.weekly_orders where id=s.order_id for update;
 if o.status='suspended' then raise exception 'ORDER_SUSPENDED' using errcode='PT409';end if;
 if p_result='delivered' then
  select coalesce(jsonb_agg(jsonb_build_object('productId',product_id,'eggsPerTray',eggs_per_tray,'trays',trays,'priceCents',price_cents) order by product_id),'[]'),sum(eggs_per_tray::numeric*trays),sum(price_cents::numeric*trays) into items,n,amount from public.weekly_order_items where order_id=o.id;
  if n is null then raise exception 'EMPTY_ORDER' using errcode='22023';end if;
  if n>2147483647 or amount>9007199254740991 then raise exception 'AMOUNT_OUT_OF_RANGE' using errcode='22003';end if;
  perform 1 from public.customers where id=o.customer_id for update;
  sale_id:=gen_random_uuid();event_id:=private.consume_stock(s.route_id,'sale',n::integer,sale_id);
  select cost_cents into cost from public.stock_events where id=event_id;
  insert into public.sales(id,customer_id,order_id,stop_id,amount_cents,eggs,cost_cents,items,effective_at,actor_id,replacement_of,reason)
  values(sale_id,o.customer_id,o.id,s.id,amount::bigint,n::integer,cost,items,clock_timestamp(),auth.uid(),p_replacement_of,p_reason);
  perform private.apply_customer_credit(o.customer_id);
 end if;
 update public.weekly_orders set status=p_result,version=version+1 where id=o.id;
 update public.route_stops set status=p_result,reason=nullif(trim(p_reason),''),confirmed_at=clock_timestamp() where id=s.id;
 update public.route_runs set version=version+1 where id=s.route_id;
 return sale_id;
end $$;
create function public.record_delivery(p_stop_id uuid,p_result text,p_reason text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.route_stops;r public.route_runs;replay jsonb;answer jsonb;sale_id uuid;
begin
 if private.current_role() is null then raise exception 'FORBIDDEN' using errcode='42501';end if;
 replay:=private.reserve_preparation_request(p_request_id,'record_delivery',jsonb_build_object('stop',p_stop_id,'result',p_result,'reason',p_reason));
 if(replay->>'found')::boolean then return replay->'result';end if;
 select * into s from public.route_stops where id=p_stop_id;
 if not found or s.kind<>'customer' then raise exception 'CUSTOMER_STOP_REQUIRED' using errcode='22023';end if;
 r:=private.lock_operating_route(s.route_id);
 select * into s from public.route_stops where id=p_stop_id for update;
 if p_result is null or p_result not in('delivered','not_delivered') then raise exception 'INVALID_INPUT' using errcode='22023';end if;
 if p_result='not_delivered' then perform private.require_reason(p_reason);end if;
 if s.status<>'pending' then
  if s.status<>p_result then raise exception 'STOP_ALREADY_RESOLVED' using errcode='PT409';end if;
  select id into sale_id from public.sales a where stop_id=s.id and reversal_of is null and not exists(select from public.sales x where x.reversal_of=a.id);
 else
  if r.status<>'in_progress' then raise exception 'ROUTE_LOCKED' using errcode='PT409';end if;
  sale_id:=private.deliver_stop(s.id,p_result,p_reason);
 end if;
 answer:=jsonb_build_object('stopId',s.id,'status',p_result,'saleId',sale_id);perform private.complete_request(p_request_id,answer);return answer;
end $$;
create function public.record_operational_stop(p_stop_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.route_stops;r public.route_runs;replay jsonb;answer jsonb;begin
 if private.current_role() is null then raise exception 'FORBIDDEN' using errcode='42501';end if;
 replay:=private.reserve_preparation_request(p_request_id,'record_operational_stop',jsonb_build_object('stop',p_stop_id));if(replay->>'found')::boolean then return replay->'result';end if;
 select * into s from public.route_stops where id=p_stop_id;
 if not found or s.kind='customer' then raise exception 'OPERATIONAL_STOP_REQUIRED' using errcode='22023';end if;
 r:=private.lock_operating_route(s.route_id);
 if r.status<>'in_progress' then raise exception 'ROUTE_LOCKED' using errcode='PT409';end if;
 update public.route_stops set status='completed',confirmed_at=clock_timestamp() where id=s.id;
 update public.route_runs set version=version+1 where id=r.id;
 answer:=jsonb_build_object('stopId',s.id,'status','completed');perform private.complete_request(p_request_id,answer);return answer;
end $$;

-- Caller holds the account lock. Counter-allocations restore exactly the credit
-- consumed by this sale; the caller reapplies FIFO after its replacement exists.
create function private.reverse_sale(p_sale_id uuid,p_reason text) returns uuid language plpgsql security definer set search_path='' as $$
declare a public.sales;rev uuid;moment timestamptz:=clock_timestamp();begin
 select * into a from public.sales where id=p_sale_id for update;
 if not found or a.reversal_of is not null or exists(select from public.sales where reversal_of=a.id) then raise exception 'SALE_ALREADY_CORRECTED' using errcode='PT409';end if;
 insert into public.sales(customer_id,order_id,stop_id,amount_cents,eggs,cost_cents,items,effective_at,due_at,actor_id,reversal_of,reason)
 values(a.customer_id,a.order_id,a.stop_id,a.amount_cents,a.eggs,a.cost_cents,a.items,moment,a.due_at,auth.uid(),a.id,p_reason) returning id into rev;
 insert into public.payment_allocations(customer_id,payment_id,credit_opening_id,sale_id,debt_opening_id,amount_cents,effective_at,actor_id,reversal_of)
 select customer_id,payment_id,credit_opening_id,sale_id,debt_opening_id,amount_cents,moment,auth.uid(),id from public.payment_allocations x
 where sale_id=a.id and reversal_of is null and not exists(select from public.payment_allocations y where y.reversal_of=x.id);
 return rev;
end $$;
create function public.correct_sale_price(p_sale_id uuid,p_prices jsonb,p_reason text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.sales;r public.route_runs;replay jsonb;answer jsonb;items jsonb;amount numeric;rev uuid;replacement uuid;correction uuid;
begin
 if private.current_role() is distinct from 'owner' then raise exception 'FORBIDDEN' using errcode='42501';end if;
 replay:=private.reserve_preparation_request(p_request_id,'correct_sale_price',jsonb_build_object('sale',p_sale_id,'prices',p_prices,'reason',p_reason));if(replay->>'found')::boolean then return replay->'result';end if;
 perform private.require_reason(p_reason);
 select * into a from public.sales where id=p_sale_id;
 if not found or a.stop_id is null then raise exception 'SALE_NOT_FOUND' using errcode='22023';end if;
 r:=private.lock_operating_route((select route_id from public.route_stops where id=a.stop_id),true);
 perform 1 from public.customers where id=a.customer_id for update;
 if jsonb_typeof(p_prices) is distinct from 'array' or jsonb_array_length(p_prices)<>jsonb_array_length(a.items) then raise exception 'INVALID_INPUT' using errcode='22023';end if;
 if exists(select from jsonb_array_elements(p_prices) p where jsonb_typeof(p) is distinct from 'object' or jsonb_typeof(p->'priceCents') is distinct from 'number' or coalesce(p->>'priceCents','')!~'^[0-9]+$' or not exists(select from jsonb_array_elements(a.items)i where i->>'productId'=p->>'productId'))
  or exists(select from jsonb_array_elements(p_prices)p group by p->>'productId' having count(*)>1) then raise exception 'INVALID_INPUT' using errcode='22023';end if;
 if exists(select from jsonb_array_elements(p_prices)p where (p->>'priceCents')::numeric>2147483647) then raise exception 'AMOUNT_OUT_OF_RANGE' using errcode='22003';end if;
 select jsonb_agg(i||jsonb_build_object('priceCents',(p->>'priceCents')::bigint) order by i->>'productId'),sum((i->>'trays')::numeric*(p->>'priceCents')::numeric) into items,amount
 from jsonb_array_elements(a.items)i join jsonb_array_elements(p_prices)p on i->>'productId'=p->>'productId';
 if amount is null or amount>9007199254740991 then raise exception 'AMOUNT_OUT_OF_RANGE' using errcode='22003';end if;
 rev:=private.reverse_sale(a.id,trim(p_reason));
 insert into public.sales(customer_id,order_id,stop_id,amount_cents,eggs,cost_cents,items,effective_at,due_at,actor_id,replacement_of,reason)
 values(a.customer_id,a.order_id,a.stop_id,amount::bigint,a.eggs,a.cost_cents,items,clock_timestamp(),a.due_at,auth.uid(),a.id,trim(p_reason)) returning id into replacement;
 insert into public.delivery_corrections(route_id,stop_id,kind,original_sale_id,replacement_sale_id,reason,actor_id)
 values(r.id,a.stop_id,'price',a.id,replacement,trim(p_reason),auth.uid()) returning id into correction;
 perform private.apply_customer_credit(a.customer_id);
 answer:=jsonb_build_object('adjustmentId',correction);perform private.complete_request(p_request_id,answer);return answer;
end $$;

create function public.correct_delivery_record(p_stop_id uuid,p_actual_result text,p_goods_location text,p_reason text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.route_stops;r public.route_runs;a public.sales;replay jsonb;answer jsonb;rev uuid;replacement uuid;correction uuid:=gen_random_uuid();event_id uuid;key text;b public.stock_balances;original_event uuid;
begin
 if private.current_role() is distinct from 'owner' then raise exception 'FORBIDDEN' using errcode='42501';end if;
 replay:=private.reserve_preparation_request(p_request_id,'correct_delivery_record',jsonb_build_object('stop',p_stop_id,'result',p_actual_result,'location',p_goods_location,'reason',p_reason));if(replay->>'found')::boolean then return replay->'result';end if;
 perform private.require_reason(p_reason);
 select * into s from public.route_stops where id=p_stop_id;
 if not found or s.kind<>'customer' then raise exception 'CUSTOMER_STOP_REQUIRED' using errcode='22023';end if;
 r:=private.lock_operating_route(s.route_id,true);
 select * into s from public.route_stops where id=p_stop_id for update;
 if p_actual_result is null or p_actual_result not in('delivered','not_delivered') or s.status not in('delivered','not_delivered') or s.status=p_actual_result then raise exception 'INVALID_INPUT' using errcode='22023';end if;
 if r.status not in('in_progress','awaiting_reconciliation','closed') then raise exception 'ROUTE_LOCKED' using errcode='PT409';end if;
 if p_goods_location is null or p_goods_location not in('farm','vehicle') then raise exception 'GOODS_LOCATION_REQUIRED' using errcode='22023';end if;
 perform 1 from public.customers where id=(select customer_id from public.weekly_orders where id=s.order_id) for update;
 if p_actual_result='not_delivered' then
  if r.status='closed' and p_goods_location<>'farm' then raise exception 'PHYSICAL_ADJUSTMENT_REQUIRED' using errcode='PT409';end if;
  select * into a from public.sales x where stop_id=s.id and reversal_of is null and not exists(select from public.sales y where y.reversal_of=x.id);
  if not found then raise exception 'SALE_NOT_FOUND' using errcode='22023';end if;
  key:=case when p_goods_location='farm' then 'farm' else r.id::text end;
  select * into b from public.stock_balances where balance_key=key for update;
  if not found then raise exception 'PHYSICAL_ADJUSTMENT_REQUIRED' using errcode='PT409';end if;
  if b.eggs::bigint+a.eggs>2147483647 or coalesce(b.total_cost_cents,0)::numeric+coalesce(a.cost_cents,0)>9007199254740991 then raise exception 'AMOUNT_OUT_OF_RANGE' using errcode='22003';end if;
  -- Empty stock has known zero cost. Mixing any unknown source stays unknown.
  update public.stock_balances set eggs=eggs+a.eggs,total_cost_cents=total_cost_cents+a.cost_cents where balance_key=key;
  select x.id into original_event from public.stock_events x join public.sales sale on sale.id=x.source_event_id where x.kind='sale' and sale.stop_id=s.id order by x.created_at desc,x.id desc limit 1;
  insert into public.stock_events(kind,location,route_id,direction,eggs,cost_cents,actor_id,effective_at,reason,source_event_id,reversal_of)
  values('adjustment',p_goods_location,r.id,'in',a.eggs,a.cost_cents,auth.uid(),clock_timestamp(),trim(p_reason),correction,original_event) returning id into event_id;
  rev:=private.reverse_sale(a.id,trim(p_reason));
  perform private.apply_customer_credit(a.customer_id);
  update public.weekly_orders set status='not_delivered',version=version+1 where id=s.order_id;
  update public.route_stops set status='not_delivered',reason=trim(p_reason),confirmed_at=clock_timestamp() where id=s.id;
  update public.route_runs set version=version+1 where id=r.id;
 else
  if r.status<>'in_progress' or p_goods_location<>'vehicle' then raise exception 'PHYSICAL_ADJUSTMENT_REQUIRED' using errcode='PT409';end if;
  select id into rev from public.sales where stop_id=s.id and reversal_of is null and replacement_of is null;
  replacement:=private.deliver_stop(s.id,'delivered',trim(p_reason),rev);
 end if;
 insert into public.delivery_corrections(id,route_id,stop_id,kind,previous_result,actual_result,goods_location,original_sale_id,replacement_sale_id,stock_event_id,reason,actor_id)
 values(correction,r.id,s.id,'delivery',s.status,p_actual_result,p_goods_location,a.id,replacement,event_id,trim(p_reason),auth.uid());
 answer:=jsonb_build_object('correctionId',correction);perform private.complete_request(p_request_id,answer);return answer;
end $$;

create function public.reconcile_route_request(p_request_id uuid,p_operation text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare existing private.request_events;begin
 if private.current_role() is null then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_request_id is null or p_operation is null or p_operation not in('confirm_route_load','reopen_preparation','cancel_route','start_route','record_delivery','record_operational_stop','submit_route_return','reconcile_route','correct_sale_price','correct_delivery_record') then raise exception 'INVALID_INPUT' using errcode='22023';end if;
 if private.current_role()<>'owner' and p_operation in('confirm_route_load','reopen_preparation','cancel_route','reconcile_route','correct_sale_price','correct_delivery_record') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 insert into private.request_events(request_id,actor_id,operation,payload_hash,result) values(p_request_id,auth.uid(),p_operation,'closed','{"closed":true}') on conflict do nothing;
 select * into existing from private.request_events where request_id=p_request_id for update;
 if existing.actor_id<>auth.uid() or existing.operation<>p_operation then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if existing.result='{"closed":true}'::jsonb then return '{"status":"closed"}'::jsonb;end if;
 if existing.result is null then raise exception 'REQUEST_UNFINISHED' using errcode='55000';end if;
 return jsonb_build_object('status','saved','result',existing.result);
end $$;

create or replace function public.get_driver_route(p_service_date date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r public.route_runs;answer jsonb;begin
 if private.current_role() is distinct from 'driver' then raise exception 'FORBIDDEN' using errcode='42501';end if;
 select * into r from public.route_runs where service_date=p_service_date and driver_id=auth.uid() and status<>'cancelled';
 if not found then return '{"available":false}';end if;
 select jsonb_build_object('id',r.id,'status',r.status,'version',r.version,'initialOdometerKm',r.initial_odometer_km,'finalOdometerKm',r.final_odometer_km,
 'loadEggs',r.load_eggs,'vehicleEggs',coalesce((select eggs from public.stock_balances where route_id=r.id),0),'declaredReturnEggs',r.declared_return_eggs,'declaredLossEggs',r.declared_loss_eggs,
 'lastConfirmedAt',(select max(confirmed_at) from public.route_stops where route_id=r.id),
 'stops',coalesce(jsonb_agg(jsonb_build_object('id',s.id,'kind',s.kind,'position',s.position,'customerName',s.name,'address',s.address,'phone',s.phone,'status',s.status,'reason',s.reason,
 'items',coalesce((select jsonb_agg(jsonb_build_object('eggsPerTray',i.eggs_per_tray,'trays',i.trays) order by i.product_id) from public.weekly_order_items i where i.order_id=s.order_id),'[]'::jsonb)) order by s.position) filter(where s.id is not null),'[]'::jsonb)) into answer
 from public.route_stops s left join public.weekly_orders o on o.id=s.order_id where s.route_id=r.id and(o.id is null or o.status<>'suspended');
 return answer;
end $$;
revoke all on all functions in schema private from public,anon,authenticated;
do $$declare f regprocedure;begin
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('confirm_route_load','reopen_preparation','cancel_route','start_route','record_delivery','record_operational_stop','submit_route_return','reconcile_route','correct_sale_price','correct_delivery_record','reconcile_route_request') loop
  execute format('revoke all on function %s from public,anon',f);
  execute format('grant execute on function %s to authenticated',f);
 end loop;
end $$;
