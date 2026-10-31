-- Immutable books, Recife effective intervals, and independent knowledge cuts.
create function private.report_money(p_amount numeric) returns bigint language plpgsql immutable set search_path='' as $$
begin
 if p_amount is not null and (p_amount<>trunc(p_amount) or abs(p_amount)>9007199254740991) then raise exception 'AMOUNT_OUT_OF_RANGE' using errcode='22003';end if;
 return p_amount::bigint;
end $$;

create function private.report_customer_balances(p_to date,p_as_of timestamptz) returns table(customer_id uuid,amount numeric)
language sql stable security definer set search_path='' as $$
with entries as (
 select customer_id,case when reversal_of is null then amount_cents::numeric else -amount_cents::numeric end amount from public.sales where effective_at<((p_to+1)::timestamp at time zone 'America/Recife') and effective_at<=p_as_of and created_at<=p_as_of
 union all select customer_id,case when reversal_of is null then signed_cents::numeric else -signed_cents::numeric end from public.customer_openings where effective_at<((p_to+1)::timestamp at time zone 'America/Recife') and effective_at<=p_as_of and created_at<=p_as_of
 union all select customer_id,case when reversal_of is null then -amount_cents::numeric else amount_cents::numeric end from public.payments where received_at<((p_to+1)::timestamp at time zone 'America/Recife') and received_at<=p_as_of and created_at<=p_as_of
 ), balances as (select customer_id,sum(amount) amount from entries group by customer_id) select customer_id,amount from balances
$$;
create function public.get_customer_positions(p_to date,p_as_of timestamptz default now(),p_search text default '',p_offset integer default 0,p_limit integer default 50) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare answer jsonb;
begin
 if private.current_role() is distinct from 'owner' then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_to is null or not isfinite(p_to) or p_as_of is null or not isfinite(p_as_of) or p_offset is null or p_offset<0 or p_limit is null or p_limit not between 1 and 100 or p_search is null or length(p_search)>160 then raise exception 'INVALID_INPUT' using errcode='22023';end if;
 with balances as (select b.*,c.name from private.report_customer_balances(p_to,p_as_of) b join public.customers c on c.id=b.customer_id where b.amount<>0 and (p_search='' or position(lower(p_search) in lower(c.name))>0)),
 page as (select * from balances order by name,customer_id offset p_offset limit p_limit)
 select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('customerId',customer_id,'name',name,'openCents',private.report_money(greatest(amount,0)),'creditCents',private.report_money(greatest(-amount,0))) order by name,customer_id) from page),'[]'::jsonb),'total',(select count(*) from balances),'generatedAt',p_as_of,'throughDate',p_to) into answer;
 return answer;
end $$;

create function public.financial_summary(p_from date,p_to date,p_as_of timestamptz default now()) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare lo timestamptz;hi timestamptz; sales numeric;received numeric;expenses numeric;operating numeric;cogs numeric;losses numeric;complete boolean;debt numeric;credit numeric;late bigint;
begin
 if private.current_role() is distinct from 'owner' then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_from is null or p_to is null or p_from>p_to or not isfinite(p_from) or not isfinite(p_to) or p_as_of is null or not isfinite(p_as_of) then raise exception 'INVALID_INPUT' using errcode='22023';end if;
 lo:=p_from::timestamp at time zone 'America/Recife';hi:=(p_to+1)::timestamp at time zone 'America/Recife';
 select coalesce(sum(case when reversal_of is null then amount_cents else -amount_cents end),0),coalesce(sum(case when reversal_of is null then cost_cents else -cost_cents end),0),coalesce(bool_and(cost_cents is not null),true)
 into sales,cogs,complete from public.sales where effective_at>=lo and effective_at<hi and effective_at<=p_as_of and created_at<=p_as_of;
 select coalesce(sum(case when reversal_of is null then amount_cents else -amount_cents end),0) into received from public.payments where received_at>=lo and received_at<hi and received_at<=p_as_of and created_at<=p_as_of;
 select coalesce(sum(case when reversal_of is null then amount_cents else -amount_cents end),0),coalesce(sum(case when category<>'purchase' then case when reversal_of is null then amount_cents else -amount_cents end else 0 end),0)
 into expenses,operating from public.expenses where paid_at>=lo and paid_at<hi and paid_at<=p_as_of and created_at<=p_as_of;
 select coalesce(sum(case when reversal_of is null then cost_cents else -cost_cents end),0),complete and coalesce(bool_and(cost_cents is not null),true)
 into losses,complete from public.stock_events where kind='loss' and effective_at>=lo and effective_at<hi and effective_at<=p_as_of and created_at<=p_as_of;
 -- Allocations explain settlement by origin, never historical account position.
 select coalesce(sum(greatest(amount,0)),0),coalesce(sum(greatest(-amount,0)),0)
 into debt,credit from private.report_customer_balances(p_to,p_as_of);
 -- Count business entries once: linked purchase/fuel expenses are the cash entry;
 -- stock losses are separate entries. Stock sale costs are already in sales.
 select count(*) into late from (
 select effective_at,created_at from public.sales
 union all select received_at,created_at from public.payments
 union all select paid_at,created_at from public.expenses
 union all select effective_at,created_at from public.customer_openings
 union all select effective_at,created_at from public.stock_events where kind='loss'
 ) e where effective_at>=lo and effective_at<hi and effective_at<=p_as_of and created_at<=p_as_of and (created_at at time zone 'America/Recife')::date>(effective_at at time zone 'America/Recife')::date;
 perform private.report_money(cogs);perform private.report_money(losses);
 return jsonb_build_object('salesCents',private.report_money(sales),'receivedCents',private.report_money(received),'paidExpensesCents',private.report_money(expenses),'cashChangeCents',private.report_money(received-expenses),'receivablesCents',private.report_money(debt),'customerCreditCents',private.report_money(credit),'cogsCents',case when complete then private.report_money(cogs) else null end,'lossesCents',case when complete then private.report_money(losses) else null end,'operatingExpensesCents',private.report_money(operating),'managementResultCents',case when complete then private.report_money(sales-cogs-losses-operating) else null end,'costComplete',complete,'generatedAt',p_as_of,'lateEntriesCount',late);
end $$;

create function public.dashboard_summary(p_date date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare route public.route_runs;info jsonb;delivered bigint;pending bigint;failed bigint;total bigint;
begin
 if private.current_role() is distinct from 'owner' then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_date is null or not isfinite(p_date) then raise exception 'INVALID_INPUT' using errcode='22023';end if;
 select * into route from public.route_runs where service_date=p_date;
 if found then
 select jsonb_build_object('id',route.id,'status',route.status,'serviceDate',route.service_date,'name',t.name,'lastConfirmedAt',(select max(confirmed_at) from public.route_stops where route_id=route.id),'nextStop',(select jsonb_build_object('name',name,'kind',kind,'status',status) from public.route_stops where route_id=route.id and status='pending' order by position,id limit 1)) into info from public.route_templates t where t.id=route.template_id;
 end if;
 select count(*) filter(where status='delivered'),count(*) filter(where status='pending'),count(*) filter(where status='not_delivered'),count(*) into delivered,pending,failed,total from public.route_stops where route_id=route.id and kind='customer';
 return jsonb_build_object('route',info,'delivered',delivered,'pending',pending,'notDelivered',failed,'total',total,'operationalCompleted',(select count(*) from public.route_stops where route_id=route.id and kind<>'customer' and status='completed'),'operationalTotal',(select count(*) from public.route_stops where route_id=route.id and kind<>'customer'),'pendingReconciliations',(select count(*) from public.route_runs where status='awaiting_reconciliation'),'farmEggs',coalesce((select eggs from public.stock_balances where balance_key='farm'),0),'vehicleEggs',coalesce((select sum(eggs) from public.stock_balances where location='vehicle'),0));
end $$;

create function private.manual_expense(p_event jsonb,p_moment timestamptz default null) returns uuid language plpgsql security definer set search_path='' as $$
declare amount numeric;paid timestamptz;expense uuid;
begin
 if jsonb_typeof(p_event) is distinct from 'object' or p_event->>'category' is null or p_event->>'category' not in('employee','maintenance','other') or nullif(trim(p_event->>'description'),'') is null or length(trim(p_event->>'description'))>1000 or jsonb_typeof(p_event->'amountCents') is distinct from 'number' or coalesce(p_event->>'amountCents','')!~'^[0-9]+$' or p_event ? 'stockEventId' or p_event ? 'fuelEventId' then raise exception 'INVALID_INPUT' using errcode='22023';end if;
 amount:=(p_event->>'amountCents')::numeric;perform private.report_money(amount);
 if amount<=0 then raise exception 'INVALID_INPUT' using errcode='22023';end if;
 if p_moment is null then
 begin paid:=(p_event->>'paidAt')::timestamptz;exception when others then raise exception 'INVALID_INPUT' using errcode='22023';end;
 else paid:=p_moment;end if;
 if paid is null or not isfinite(paid) then raise exception 'INVALID_INPUT' using errcode='22023';end if;
 insert into public.expenses(category,description,amount_cents,paid_at,actor_id) values(p_event->>'category',trim(p_event->>'description'),amount::bigint,paid,auth.uid()) returning id into expense;
 return expense;
end $$;
create function public.record_expense(p_event jsonb,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare cached jsonb;answer jsonb;
begin
 if private.current_role() is distinct from 'owner' then raise exception 'FORBIDDEN' using errcode='42501';end if;
 cached:=private.reserve_preparation_request(p_request_id,'record_expense',p_event);
 if(cached->>'found')::boolean then return cached->'result';end if;
 answer:=jsonb_build_object('expenseId',private.manual_expense(p_event));perform private.complete_request(p_request_id,answer);return answer;
end $$;
create function public.correct_expense(p_expense_id uuid,p_replacement jsonb,p_reason text,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare cached jsonb;answer jsonb;original public.expenses;reversal uuid;replacement uuid;moment timestamptz:=clock_timestamp();
begin
 if private.current_role() is distinct from 'owner' then raise exception 'FORBIDDEN' using errcode='42501';end if;
 cached:=private.reserve_preparation_request(p_request_id,'correct_expense',jsonb_build_object('expenseId',p_expense_id,'replacement',p_replacement,'reason',p_reason));
 if(cached->>'found')::boolean then return cached->'result';end if;
 if nullif(trim(p_reason),'') is null then raise exception 'REASON_REQUIRED' using errcode='22023';end if;
 if length(p_reason)>1000 then raise exception 'INVALID_INPUT' using errcode='22023';end if;
 select * into original from public.expenses where id=p_expense_id for update;
 if not found then raise exception 'EXPENSE_NOT_FOUND' using errcode='22023';end if;
 if original.category not in('employee','maintenance','other') or original.stock_event_id is not null then raise exception 'LINKED_EXPENSE' using errcode='22023';end if;
 if original.reversal_of is not null or exists(select from public.expenses where reversal_of=p_expense_id) then raise exception 'EXPENSE_ALREADY_CORRECTED' using errcode='PT409';end if;
 insert into public.expenses(category,description,amount_cents,paid_at,actor_id,reversal_of) values(original.category,trim(p_reason),original.amount_cents,moment,auth.uid(),original.id) returning id into reversal;
 if p_replacement is not null and p_replacement<>'null'::jsonb then replacement:=private.manual_expense(p_replacement,moment);end if;
 answer:=jsonb_build_object('reversalId',reversal,'replacementId',replacement);perform private.complete_request(p_request_id,answer);return answer;
end $$;
revoke all on function private.report_money(numeric),private.manual_expense(jsonb,timestamptz) from public,anon,authenticated;
revoke all on function public.financial_summary(date,date,timestamptz),public.dashboard_summary(date),public.record_expense(jsonb,uuid),public.correct_expense(uuid,jsonb,text,uuid) from public,anon;
grant execute on function public.financial_summary(date,date,timestamptz),public.dashboard_summary(date),public.record_expense(jsonb,uuid),public.correct_expense(uuid,jsonb,text,uuid) to authenticated;

revoke all on function private.report_customer_balances(date,timestamptz) from public,anon,authenticated;
revoke all on function public.get_customer_positions(date,timestamptz,text,integer,integer) from public,anon;
grant execute on function public.get_customer_positions(date,timestamptz,text,integer,integer) to authenticated;

create function public.reconcile_expense_request(p_request_id uuid,p_operation text default 'record_expense')
returns jsonb language plpgsql security definer set search_path='' as $$
declare existing private.request_events;
begin
 if private.current_role() is distinct from 'owner' then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_request_id is null or p_operation is null or p_operation not in('record_expense','correct_expense') then raise exception 'INVALID_INPUT' using errcode='22023';end if;
 insert into private.request_events(request_id,actor_id,operation,payload_hash,result)
 values(p_request_id,auth.uid(),p_operation,'closed','{"closed":true}') on conflict do nothing;
 select * into existing from private.request_events where request_id=p_request_id for update;
 if existing.actor_id<>auth.uid() or existing.operation<>p_operation then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if existing.result='{"closed":true}'::jsonb then return '{"status":"closed"}'::jsonb;end if;
 if existing.result is null then raise exception 'REQUEST_UNFINISHED' using errcode='55000';end if;
 return jsonb_build_object('status','saved','result',existing.result);
end $$;
revoke all on function public.reconcile_expense_request(uuid,text) from public,anon;
grant execute on function public.reconcile_expense_request(uuid,text) to authenticated;
