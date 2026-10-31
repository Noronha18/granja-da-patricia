create table public.fuel_events(
 id uuid primary key default gen_random_uuid(), vehicle_id uuid not null references public.vehicles(id),
 occurred_at timestamptz not null check(isfinite(occurred_at)), odometer_km bigint not null check(odometer_km between 0 and 9007199254740991),
 litres numeric not null check(litres>0 and litres<=1000000 and scale(litres)<=3), total_cents bigint not null check(total_cents between 1 and 9007199254740991),
 fuel_type text not null check(fuel_type in('gasoline','ethanol','diesel','diesel_s10','cng')),
 full_tank boolean not null, note text not null default '' check(length(note)<=1000),
 actor_id uuid not null references auth.users(id), created_at timestamptz not null default clock_timestamp(),
 reversal_of uuid unique references public.fuel_events(id), replacement_of uuid unique references public.fuel_events(id)
);
alter table public.expenses add column fuel_event_id uuid unique references public.fuel_events(id);
alter table public.expenses add constraint fuel_link check((category='fuel')=(fuel_event_id is not null));
alter table public.fuel_events enable row level security;
revoke all on public.fuel_events from public,anon,authenticated;
grant select on public.fuel_events to authenticated;
grant all on public.fuel_events to service_role;
create policy fuel_read on public.fuel_events for select to authenticated using(actor_id=(select auth.uid()) or (select role from public.profiles where id=(select auth.uid()))='owner');

create function private.insert_fuel(p_event jsonb,p_replacement uuid default null,p_moment timestamptz default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare vehicle uuid; moment timestamptz;odo numeric;litres numeric;amount numeric;fuel uuid;expense uuid;
begin
 if jsonb_typeof(p_event) is distinct from 'object' or jsonb_typeof(p_event->'odometerKm') is distinct from 'number' or jsonb_typeof(p_event->'litres') is distinct from 'number' or jsonb_typeof(p_event->'totalCents') is distinct from 'number' or jsonb_typeof(p_event->'fullTank') is distinct from 'boolean' or coalesce(p_event->>'fuelType','') not in('gasoline','ethanol','diesel','diesel_s10','cng') or length(coalesce(p_event->>'note',''))>1000 then raise exception 'INVALID_INPUT' using errcode='22023';end if;
 begin
 vehicle:=(p_event->>'vehicleId')::uuid;moment:=(p_event->>'occurredAt')::timestamptz;
 odo:=(p_event->>'odometerKm')::numeric;litres:=(p_event->>'litres')::numeric;amount:=(p_event->>'totalCents')::numeric;
 exception when others then raise exception 'INVALID_INPUT' using errcode='22023';end;
 if moment is null or not isfinite(moment) or odo<0 or odo<>trunc(odo) or odo>9007199254740991 or amount<=0 or amount<>trunc(amount) or amount>9007199254740991 or litres<=0 or litres>1000000 or scale(litres)>3 then raise exception 'INVALID_INPUT' using errcode='22023';end if;
 perform 1 from public.vehicles where id=vehicle for update;
 if not found then raise exception 'VEHICLE_NOT_FOUND' using errcode='22023';end if;
 if exists(select from public.fuel_events e where e.vehicle_id=vehicle and e.reversal_of is null and not exists(select from public.fuel_events r where r.reversal_of=e.id) and ((e.occurred_at<moment and e.odometer_km>odo) or (e.occurred_at>moment and e.odometer_km<odo) or(e.occurred_at=moment and e.odometer_km<>odo))) then raise exception 'ODOMETER_ORDER' using errcode='22023';end if;
 insert into public.fuel_events(vehicle_id,occurred_at,odometer_km,litres,total_cents,fuel_type,full_tank,note,actor_id,replacement_of) values(vehicle,moment,odo,litres,amount,p_event->>'fuelType',(p_event->>'fullTank')::boolean,coalesce(p_event->>'note',''),auth.uid(),p_replacement) returning id into fuel;
 insert into public.expenses(category,description,amount_cents,paid_at,actor_id,fuel_event_id) values('fuel','Abastecimento',amount,coalesce(p_moment,moment),auth.uid(),fuel) returning id into expense;
 return jsonb_build_object('fuelId',fuel,'expenseId',expense);
end $$;
create function public.record_fuel(p_event jsonb,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare cached jsonb;answer jsonb;
begin
 if private.current_role() is null then raise exception 'FORBIDDEN' using errcode='42501';end if;
 cached:=private.reserve_preparation_request(p_request_id,'record_fuel',p_event);if(cached->>'found')::boolean then return cached->'result';end if;
 answer:=private.insert_fuel(p_event);perform private.complete_request(p_request_id,answer);return answer;
end $$;
create function public.correct_fuel(p_fuel_id uuid,p_replacement jsonb,p_reason text,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare cached jsonb;answer jsonb;original public.fuel_events;old_expense public.expenses;reversal uuid;new_event jsonb;moment timestamptz:=clock_timestamp();
begin
 if private.current_role() is distinct from 'owner' then raise exception 'FORBIDDEN' using errcode='42501';end if;
 cached:=private.reserve_preparation_request(p_request_id,'correct_fuel',jsonb_build_object('fuelId',p_fuel_id,'replacement',p_replacement,'reason',p_reason));if(cached->>'found')::boolean then return cached->'result';end if;
 if nullif(trim(p_reason),'') is null or length(p_reason)>1000 then raise exception 'REASON_REQUIRED' using errcode='22023';end if;
 select * into original from public.fuel_events where id=p_fuel_id;
 if not found then raise exception 'FUEL_NOT_FOUND' using errcode='22023';end if;
 -- Same vehicle lock as insertion serializes corrections and backdated records.
 perform 1 from public.vehicles where id=original.vehicle_id for update;
 if original.reversal_of is not null or exists(select from public.fuel_events where reversal_of=original.id) then raise exception 'FUEL_ALREADY_CORRECTED' using errcode='PT409';end if;
 if p_replacement is not null and p_replacement<>'null'::jsonb and p_replacement->>'vehicleId' is distinct from original.vehicle_id::text then raise exception 'FUEL_VEHICLE_MISMATCH' using errcode='22023';end if;
 insert into public.fuel_events(vehicle_id,occurred_at,odometer_km,litres,total_cents,fuel_type,full_tank,note,actor_id,reversal_of) values(original.vehicle_id,moment,original.odometer_km,original.litres,original.total_cents,original.fuel_type,original.full_tank,trim(p_reason),auth.uid(),original.id) returning id into reversal;
 select * into strict old_expense from public.expenses where fuel_event_id=original.id;
 insert into public.expenses(category,description,amount_cents,paid_at,actor_id,fuel_event_id,reversal_of) values('fuel',trim(p_reason),original.total_cents,moment,auth.uid(),reversal,old_expense.id);
 if p_replacement is not null and p_replacement<>'null'::jsonb then new_event:=private.insert_fuel(jsonb_build_object('occurredAt',original.occurred_at)||p_replacement,original.id,moment);end if;
 answer:=jsonb_build_object('reversalId',reversal,'replacementId',new_event->'fuelId','expenseId',new_event->'expenseId');perform private.complete_request(p_request_id,answer);return answer;
end $$;
revoke all on function private.insert_fuel(jsonb,uuid,timestamptz) from public,anon,authenticated;
revoke all on function public.record_fuel(jsonb,uuid),public.correct_fuel(uuid,jsonb,text,uuid) from public,anon;
grant execute on function public.record_fuel(jsonb,uuid),public.correct_fuel(uuid,jsonb,text,uuid) to authenticated;

create function public.get_fuel_history() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if private.current_role() is null then raise exception 'FORBIDDEN' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'vehicleId',e.vehicle_id,'vehicleName',v.name,'occurredAt',e.occurred_at,'odometerKm',e.odometer_km,'litres',e.litres,'totalCents',e.total_cents,'fuelType',e.fuel_type,'fullTank',e.full_tank,'note',e.note,'reversed',exists(select from public.fuel_events r where r.reversal_of=e.id)) order by e.occurred_at,e.id) from public.fuel_events e join public.vehicles v on v.id=e.vehicle_id where e.reversal_of is null and (e.actor_id=auth.uid() or private.current_role()='owner')),'[]'::jsonb);
end $$;
create function public.reconcile_fuel_request(p_request_id uuid,p_operation text default 'record_fuel') returns jsonb language plpgsql security definer set search_path='' as $$
declare existing private.request_events;
begin
 if private.current_role() is null or (p_operation='correct_fuel' and private.current_role()<>'owner') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_request_id is null or p_operation is null or p_operation not in('record_fuel','correct_fuel') then raise exception 'INVALID_INPUT' using errcode='22023';end if;
 insert into private.request_events(request_id,actor_id,operation,payload_hash,result) values(p_request_id,auth.uid(),p_operation,'closed','{"closed":true}') on conflict do nothing;
 select * into existing from private.request_events where request_id=p_request_id for update;
 if existing.actor_id<>auth.uid() or existing.operation<>p_operation then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if existing.result='{"closed":true}'::jsonb then return '{"status":"closed"}'::jsonb;end if;
 if existing.result is null then raise exception 'REQUEST_UNFINISHED' using errcode='55000';end if;
 return jsonb_build_object('status','saved','result',existing.result);
end $$;
revoke all on function public.get_fuel_history(),public.reconcile_fuel_request(uuid,text) from public,anon;
grant execute on function public.get_fuel_history(),public.reconcile_fuel_request(uuid,text) to authenticated;
create function public.get_fuel_vehicles() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if private.current_role() is null then raise exception 'FORBIDDEN' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by name,id) from public.vehicles),'[]'::jsonb);
end $$;
revoke all on function public.get_fuel_vehicles() from public,anon;
grant execute on function public.get_fuel_vehicles() to authenticated;
