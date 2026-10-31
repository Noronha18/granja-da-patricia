-- Customer books are append-only. Reversals take effect now; originals remain
-- visible at older effective/knowledge cuts. All callers lock the customer row.
create table public.sales (
 id uuid primary key default gen_random_uuid(), customer_id uuid not null references public.customers(id),
 order_id uuid references public.weekly_orders(id), stop_id uuid references public.route_stops(id),
 amount_cents bigint not null check(amount_cents between 0 and 9007199254740991),
 eggs integer not null check(eggs>=0), cost_cents bigint check(cost_cents between 0 and 9007199254740991),
 items jsonb not null default '[]'::jsonb check(jsonb_typeof(items)='array'),
 effective_at timestamptz not null, created_at timestamptz not null default clock_timestamp(),
 due_at timestamptz, actor_id uuid not null references auth.users(id),
 reversal_of uuid unique references public.sales(id), replacement_of uuid references public.sales(id),
 reason text check(length(trim(reason)) between 1 and 1000)
);
create unique index original_sale_per_stop on public.sales(stop_id) where reversal_of is null and replacement_of is null;
create table public.payments (
 id uuid primary key default gen_random_uuid(), customer_id uuid not null references public.customers(id),
 amount_cents bigint not null check(amount_cents between 1 and 9007199254740991),
 received_at timestamptz not null, created_at timestamptz not null default clock_timestamp(),
 method text not null check(method in('pix','cash','transfer','other')),
 actor_id uuid not null references auth.users(id), reversal_of uuid unique references public.payments(id),
 replacement_of uuid unique references public.payments(id), reason text check(length(trim(reason)) between 1 and 1000)
);
create table public.customer_openings (
 id uuid primary key default gen_random_uuid(), customer_id uuid not null references public.customers(id),
 signed_cents bigint not null check(signed_cents between -9007199254740991 and 9007199254740991),
 as_of date not null, effective_at timestamptz not null,
 created_at timestamptz not null default clock_timestamp(), actor_id uuid not null references auth.users(id),
 reason text not null check(length(trim(reason)) between 1 and 1000), reversal_of uuid unique references public.customer_openings(id)
);
create table public.payment_allocations (
 id uuid primary key default gen_random_uuid(), customer_id uuid not null references public.customers(id),
 payment_id uuid references public.payments(id), credit_opening_id uuid references public.customer_openings(id),
 sale_id uuid references public.sales(id), debt_opening_id uuid references public.customer_openings(id),
 amount_cents bigint not null check(amount_cents between 1 and 9007199254740991),
 effective_at timestamptz not null default clock_timestamp(), created_at timestamptz not null default clock_timestamp(),
 actor_id uuid not null references auth.users(id), reversal_of uuid unique references public.payment_allocations(id),
 check(num_nonnulls(payment_id,credit_opening_id)=1), check(num_nonnulls(sale_id,debt_opening_id)=1)
);
create index payments_customer on public.payments(customer_id,received_at,created_at,id);
create index sales_customer on public.sales(customer_id,effective_at,created_at,id);
create index allocations_customer on public.payment_allocations(customer_id);
create index openings_customer on public.customer_openings(customer_id);
do $$declare tab text;begin
 foreach tab in array array['sales','payments','customer_openings','payment_allocations'] loop
  execute format('alter table public.%I enable row level security',tab);
  execute format('revoke all on public.%I from public,anon,authenticated',tab);
  execute format('grant select on public.%I to authenticated',tab);
  execute format('grant all on public.%I to service_role',tab);
  execute format('create policy owner_read on public.%I for select to authenticated using ((select role from public.profiles where id=(select auth.uid()))=''owner'')',tab);
 end loop;
end $$;

-- Defensive cross-client integrity also applies to administrator fixtures.
create function private.check_customer_book() returns trigger language plpgsql set search_path='' as $$
declare ref uuid;begin
 if tg_table_name='payment_allocations' then
  if new.payment_id is not null then select customer_id into ref from public.payments where id=new.payment_id;
  else select customer_id into ref from public.customer_openings where id=new.credit_opening_id and signed_cents<0;end if;
  if ref is distinct from new.customer_id then raise exception 'CUSTOMER_MISMATCH' using errcode='23514';end if;
  if new.sale_id is not null then select customer_id into ref from public.sales where id=new.sale_id;
  else select customer_id into ref from public.customer_openings where id=new.debt_opening_id and signed_cents>0;end if;
  if ref is distinct from new.customer_id then raise exception 'CUSTOMER_MISMATCH' using errcode='23514';end if;
 end if;
 return new;
end $$;
create trigger allocation_customer before insert on public.payment_allocations for each row execute function private.check_customer_book();

-- Current outstanding origins. Historical reports use event sums with both cuts,
-- never these current-only projections or a mutable reversed flag.
create view private.customer_debits as
 select s.id,s.customer_id,'sale'::text kind,s.amount_cents-coalesce((select sum(case when a.reversal_of is null then a.amount_cents else -a.amount_cents end) from public.payment_allocations a where a.sale_id=s.id),0) remaining,s.effective_at,s.created_at
 from public.sales s where s.reversal_of is null and not exists(select from public.sales r where r.reversal_of=s.id)
 union all
 select o.id,o.customer_id,'opening',o.signed_cents-coalesce((select sum(case when a.reversal_of is null then a.amount_cents else -a.amount_cents end) from public.payment_allocations a where a.debt_opening_id=o.id),0),o.effective_at,o.created_at
 from public.customer_openings o where o.signed_cents>0 and o.reversal_of is null and not exists(select from public.customer_openings r where r.reversal_of=o.id);
create view private.customer_credits as
 select p.id,p.customer_id,'payment'::text kind,p.amount_cents-coalesce((select sum(case when a.reversal_of is null then a.amount_cents else -a.amount_cents end) from public.payment_allocations a where a.payment_id=p.id),0) remaining,p.received_at effective_at,p.created_at
 from public.payments p where p.reversal_of is null and not exists(select from public.payments r where r.reversal_of=p.id)
 union all
 select o.id,o.customer_id,'opening',-o.signed_cents-coalesce((select sum(case when a.reversal_of is null then a.amount_cents else -a.amount_cents end) from public.payment_allocations a where a.credit_opening_id=o.id),0),o.effective_at,o.created_at
 from public.customer_openings o where o.signed_cents<0 and o.reversal_of is null and not exists(select from public.customer_openings r where r.reversal_of=o.id);

create function private.customer_balance(p_customer_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare debt numeric;credit numeric;begin
 select coalesce(sum(remaining),0) into debt from private.customer_debits where customer_id=p_customer_id;
 select coalesce(sum(remaining),0) into credit from private.customer_credits where customer_id=p_customer_id;
 if debt not between 0 and 9007199254740991 or credit not between 0 and 9007199254740991 then raise exception 'AMOUNT_OUT_OF_RANGE' using errcode='22003';end if;
 return jsonb_build_object('openCents',debt::bigint,'creditCents',credit::bigint);
end $$;

create function private.apply_customer_credit(p_customer_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare debt record;credit record;left_cents numeric;part bigint;begin
 -- Customer is the account lock, acquired after any vehicle/route locks and
 -- before stock. Taking it here also protects internal callers from omission.
 perform 1 from public.customers where id=p_customer_id for update;
 if not found then raise exception 'CUSTOMER_NOT_FOUND' using errcode='22023';end if;
 for debt in select * from private.customer_debits where customer_id=p_customer_id and remaining>0 order by effective_at,created_at,id loop
  left_cents:=debt.remaining;
  for credit in select * from private.customer_credits where customer_id=p_customer_id and remaining>0 order by effective_at,created_at,id loop
   exit when left_cents=0;
   part:=least(left_cents,credit.remaining)::bigint;
   insert into public.payment_allocations(customer_id,payment_id,credit_opening_id,sale_id,debt_opening_id,amount_cents,actor_id)
   values(p_customer_id,case when credit.kind='payment' then credit.id end,case when credit.kind='opening' then credit.id end,case when debt.kind='sale' then debt.id end,case when debt.kind='opening' then debt.id end,part,auth.uid());
   left_cents:=left_cents-part;
  end loop;
 end loop;
 perform private.customer_balance(p_customer_id);
end $$;

create function public.record_payment(p_customer_id uuid,p_amount_cents bigint,p_received_at timestamptz,p_method text,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare cached jsonb;answer jsonb;payment uuid;begin
 if private.current_role() is distinct from 'owner' then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_amount_cents>9007199254740991 then raise exception 'AMOUNT_OUT_OF_RANGE' using errcode='22003';end if;
 if p_customer_id is null or p_amount_cents is null or p_amount_cents<=0 or p_received_at is null or not isfinite(p_received_at) or p_method is null or p_method not in('pix','cash','transfer','other') then raise exception 'INVALID_INPUT' using errcode='22023';end if;
 cached:=private.reserve_preparation_request(p_request_id,'record_payment',jsonb_build_object('customerId',p_customer_id,'amountCents',p_amount_cents,'receivedAt',p_received_at,'method',p_method));
 if (cached->>'found')::boolean then return cached->'result';end if;
 perform 1 from public.customers where id=p_customer_id for update;
 if not found then raise exception 'CUSTOMER_NOT_FOUND' using errcode='22023';end if;
 insert into public.payments(customer_id,amount_cents,received_at,method,actor_id) values(p_customer_id,p_amount_cents,p_received_at,p_method,auth.uid()) returning id into payment;
 perform private.apply_customer_credit(p_customer_id);
 answer:=private.customer_balance(p_customer_id)||jsonb_build_object('paymentId',payment);
 perform private.complete_request(p_request_id,answer);return answer;
end $$;

create function public.set_opening_balance(p_customer_id uuid,p_signed_cents bigint,p_as_of date,p_reason text,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare cached jsonb;answer jsonb;opening uuid;had_opening boolean;begin
 if private.current_role() is distinct from 'owner' then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_signed_cents not between -9007199254740991 and 9007199254740991 then raise exception 'AMOUNT_OUT_OF_RANGE' using errcode='22003';end if;
 if p_customer_id is null or p_signed_cents is null or p_as_of is null or not isfinite(p_as_of) or p_reason is null or length(trim(p_reason)) not between 1 and 1000 then raise exception 'INVALID_INPUT' using errcode='22023';end if;
 cached:=private.reserve_preparation_request(p_request_id,'set_opening_balance',jsonb_build_object('customerId',p_customer_id,'signedCents',p_signed_cents,'asOf',p_as_of,'reason',p_reason));
 if (cached->>'found')::boolean then return cached->'result';end if;
 perform 1 from public.customers where id=p_customer_id for update;
 if not found then raise exception 'CUSTOMER_NOT_FOUND' using errcode='22023';end if;
 if exists(select from public.sales where customer_id=p_customer_id) or exists(select from public.payments where customer_id=p_customer_id) or exists(select from public.payment_allocations where customer_id=p_customer_id) then raise exception 'OPENING_LOCKED' using errcode='PT409';end if;
 had_opening:=exists(select from public.customer_openings where customer_id=p_customer_id);
 insert into public.customer_openings(customer_id,signed_cents,as_of,effective_at,actor_id,reason,reversal_of)
 select customer_id,signed_cents,as_of,clock_timestamp(),auth.uid(),trim(p_reason),id from public.customer_openings o where customer_id=p_customer_id and reversal_of is null and not exists(select from public.customer_openings r where r.reversal_of=o.id);
 insert into public.customer_openings(customer_id,signed_cents,as_of,effective_at,actor_id,reason) values(p_customer_id,p_signed_cents,p_as_of,case when had_opening then clock_timestamp() else p_as_of::timestamp at time zone 'America/Recife' end,auth.uid(),trim(p_reason)) returning id into opening;
 perform private.apply_customer_credit(p_customer_id);
 answer:=jsonb_build_object('eventId',opening);perform private.complete_request(p_request_id,answer);return answer;
end $$;

create function public.correct_payment(p_payment_id uuid,p_replacement jsonb,p_reason text,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare cached jsonb;answer jsonb;original public.payments;customer uuid;reversal uuid;replacement uuid;amount bigint;moment timestamptz:=clock_timestamp();begin
 if private.current_role() is distinct from 'owner' then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_payment_id is null or p_reason is null or length(trim(p_reason)) not between 1 and 1000 or (p_replacement is not null and (jsonb_typeof(p_replacement)<>'object' or p_replacement->>'amountCents' is null or p_replacement->>'amountCents'!~'^[0-9]+$' or p_replacement->>'method' is null or p_replacement->>'method' not in('pix','cash','transfer','other') or (p_replacement-'amountCents'-'method')<>'{}'::jsonb)) then raise exception 'INVALID_INPUT' using errcode='22023';end if;
 if p_replacement is not null then
  if (p_replacement->>'amountCents')::numeric>9007199254740991 then raise exception 'AMOUNT_OUT_OF_RANGE' using errcode='22003';end if;
  amount:=(p_replacement->>'amountCents')::bigint;if amount<=0 then raise exception 'INVALID_INPUT' using errcode='22023';end if;
 end if;
 cached:=private.reserve_preparation_request(p_request_id,'correct_payment',jsonb_build_object('paymentId',p_payment_id,'replacement',p_replacement,'reason',p_reason));
 if (cached->>'found')::boolean then return cached->'result';end if;
 select customer_id into customer from public.payments where id=p_payment_id;
 if not found then raise exception 'PAYMENT_NOT_FOUND' using errcode='22023';end if;
 perform 1 from public.customers where id=customer for update;
 select * into original from public.payments where id=p_payment_id;
 if original.reversal_of is not null or exists(select from public.payments where reversal_of=p_payment_id) then raise exception 'PAYMENT_ALREADY_CORRECTED' using errcode='PT409';end if;
 insert into public.payments(customer_id,amount_cents,received_at,method,actor_id,reversal_of,reason) values(customer,original.amount_cents,moment,original.method,auth.uid(),original.id,trim(p_reason)) returning id into reversal;
 insert into public.payment_allocations(customer_id,payment_id,credit_opening_id,sale_id,debt_opening_id,amount_cents,actor_id,reversal_of,effective_at)
 select customer_id,payment_id,credit_opening_id,sale_id,debt_opening_id,amount_cents,auth.uid(),id,moment from public.payment_allocations a where payment_id=p_payment_id and reversal_of is null and not exists(select from public.payment_allocations r where r.reversal_of=a.id);
 if p_replacement is not null then
  insert into public.payments(customer_id,amount_cents,received_at,method,actor_id,replacement_of,reason) values(customer,amount,moment,p_replacement->>'method',auth.uid(),original.id,trim(p_reason)) returning id into replacement;
 end if;
 perform private.apply_customer_credit(customer);
 answer:=jsonb_build_object('reversalId',reversal,'replacementId',replacement);perform private.complete_request(p_request_id,answer);return answer;
end $$;

create function public.get_customer_account(p_customer_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if private.current_role() is distinct from 'owner' then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if not exists(select from public.customers where id=p_customer_id) then raise exception 'CUSTOMER_NOT_FOUND' using errcode='22023';end if;
 return private.customer_balance(p_customer_id)||jsonb_build_object('customerId',p_customer_id,
 'payments',coalesce((select jsonb_agg(jsonb_build_object('id',id,'amountCents',amount_cents,'receivedAt',received_at,'createdAt',created_at,'method',method,'reversalOf',reversal_of,'replacementOf',replacement_of,'reason',reason) order by created_at,id) from public.payments where customer_id=p_customer_id),'[]'::jsonb),
 'sales',coalesce((select jsonb_agg(jsonb_build_object('id',id,'amountCents',amount_cents,'eggs',eggs,'effectiveAt',effective_at,'createdAt',created_at,'dueAt',due_at,'reversalOf',reversal_of,'replacementOf',replacement_of,'remainingCents',coalesce((select remaining from private.customer_debits where id=s.id and kind='sale'),0)) order by effective_at,created_at,id) from public.sales s where customer_id=p_customer_id),'[]'::jsonb),
 'openings',coalesce((select jsonb_agg(jsonb_build_object('id',id,'signedCents',signed_cents,'asOf',as_of,'effectiveAt',effective_at,'createdAt',created_at,'reason',reason,'reversalOf',reversal_of) order by created_at,id) from public.customer_openings where customer_id=p_customer_id),'[]'::jsonb));
end $$;
create function public.get_customer_balances() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;begin
 if private.current_role() is distinct from 'owner' then raise exception 'FORBIDDEN' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object('customerId',id,'name',name,'active',active)||private.customer_balance(id) order by name,id),'[]'::jsonb) into result from public.customers;return result;
end $$;
create function public.reconcile_payment_request(p_request_id uuid,p_operation text) returns jsonb language plpgsql security definer set search_path='' as $$
declare existing private.request_events;begin
 if private.current_role() is distinct from 'owner' then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_request_id is null or p_operation is null or p_operation not in('record_payment','set_opening_balance','correct_payment') then raise exception 'INVALID_INPUT' using errcode='22023';end if;
 insert into private.request_events(request_id,actor_id,operation,payload_hash,result) values(p_request_id,auth.uid(),p_operation,'closed','{"closed":true}') on conflict do nothing;
 select * into existing from private.request_events where request_id=p_request_id for update;
 if existing.actor_id<>auth.uid() or existing.operation<>p_operation then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if existing.result='{"closed":true}'::jsonb then return '{"status":"closed"}'::jsonb;end if;
 if existing.result is null then raise exception 'REQUEST_UNFINISHED' using errcode='55000';end if;
 return jsonb_build_object('status','saved','result',existing.result);
end $$;
revoke all on function public.record_payment(uuid,bigint,timestamptz,text,uuid),public.set_opening_balance(uuid,bigint,date,text,uuid),public.correct_payment(uuid,jsonb,text,uuid),public.get_customer_account(uuid),public.get_customer_balances(),public.reconcile_payment_request(uuid,text) from public,anon;
grant execute on function public.record_payment(uuid,bigint,timestamptz,text,uuid),public.set_opening_balance(uuid,bigint,date,text,uuid),public.correct_payment(uuid,jsonb,text,uuid),public.get_customer_account(uuid),public.get_customer_balances(),public.reconcile_payment_request(uuid,text) to authenticated;

-- Storage must be enabled before applying this section. The bucket enforces
-- declared type/size; the authenticated Worker additionally checks actual bytes.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('payment-receipts','payment-receipts',false,5000000,array['image/jpeg','image/png','application/pdf']);
create table public.payment_receipts (
 id uuid primary key, payment_id uuid not null references public.payments(id), object_path text not null unique,
 mime_type text not null check(mime_type in('image/jpeg','image/png','application/pdf')),
 size_bytes bigint not null check(size_bytes between 1 and 5000000), sha256 text not null check(sha256~'^[0-9a-f]{64}$'),
 actor_id uuid not null references auth.users(id), created_at timestamptz not null default clock_timestamp(),
 status text not null default 'pending' check(status in('pending','ready','removed')),
 check(object_path=payment_id::text||'/'||id::text||case mime_type when 'image/jpeg' then '.jpg' when 'image/png' then '.png' else '.pdf' end)
);
create index receipts_payment on public.payment_receipts(payment_id,status);
create table private.receipt_cleanup_tombstones(object_path text primary key,created_at timestamptz not null default clock_timestamp());
alter table public.payment_receipts enable row level security;
alter table private.receipt_cleanup_tombstones enable row level security;
revoke all on public.payment_receipts,private.receipt_cleanup_tombstones from public,anon,authenticated;
grant select on public.payment_receipts to authenticated;
grant all on public.payment_receipts to service_role;
create policy owner_ready_read on public.payment_receipts for select to authenticated using (status='ready' and (select role from public.profiles where id=(select auth.uid()))='owner');
-- No INSERT/UPDATE/DELETE policy for browser users: validation cannot be bypassed
-- by talking to Storage directly. Only the server's service role uploads bytes.
create policy owner_receipt_download on storage.objects for select to authenticated using (
 bucket_id='payment-receipts' and (select role from public.profiles where id=(select auth.uid()))='owner'
 and exists(select from public.payment_receipts where object_path=name and status='ready')
);
create function public.reserve_payment_receipt(p_id uuid,p_payment_id uuid,p_path text,p_mime text,p_size bigint,p_sha256 text,p_actor_id uuid) returns text language plpgsql security definer set search_path='' as $$
declare existing public.payment_receipts;begin
 if p_id is null or p_payment_id is null or p_path is null or p_mime is null or p_mime not in('image/jpeg','image/png','application/pdf') or p_size is null or p_size not between 1 and 5000000 or p_sha256 is null or p_sha256!~'^[0-9a-f]{64}$'
 or p_path is distinct from (p_payment_id::text||'/'||p_id::text||case p_mime when 'image/jpeg' then '.jpg' when 'image/png' then '.png' else '.pdf' end)
 or not exists(select from public.profiles where id=p_actor_id and role='owner') or not exists(select from public.payments where id=p_payment_id and reversal_of is null) then raise exception 'INVALID_RECEIPT' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_path,0));
 if exists(select from private.receipt_cleanup_tombstones where object_path=p_path) then return 'removed';end if;
 insert into public.payment_receipts(id,payment_id,object_path,mime_type,size_bytes,sha256,actor_id) values(p_id,p_payment_id,p_path,p_mime,p_size,p_sha256,p_actor_id) on conflict(id) do nothing;
 select * into existing from public.payment_receipts where id=p_id for update;
 if existing.payment_id<>p_payment_id or existing.object_path<>p_path or existing.mime_type<>p_mime or existing.size_bytes<>p_size or existing.sha256<>p_sha256 or existing.actor_id<>p_actor_id then return 'conflict';end if;
 return existing.status;
end $$;
create function public.complete_payment_receipt(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare receipt public.payment_receipts;path text;begin
 select object_path into path from public.payment_receipts where id=p_id;
 if not found then raise exception 'INVALID_RECEIPT' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(path,0));
 select * into receipt from public.payment_receipts where id=p_id for update;
 if receipt.status='removed' or exists(select from private.receipt_cleanup_tombstones where object_path=path) then raise exception 'RECEIPT_REMOVED' using errcode='PT409';end if;
 if not exists(select from storage.objects where bucket_id='payment-receipts' and name=path and metadata->>'mimetype'=receipt.mime_type and (metadata->>'size')::bigint=receipt.size_bytes) then raise exception 'OBJECT_NOT_FOUND' using errcode='22023';end if;
 update public.payment_receipts set status='ready' where id=p_id;
end $$;
create function public.get_payment_receipt_orphans() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(o.name order by o.name),'[]'::jsonb) from storage.objects o
 where bucket_id='payment-receipts' and not exists(select from public.payment_receipts r where r.object_path=o.name and r.status='ready')
$$;
create function public.mark_receipt_orphan_removed(p_path text) returns boolean language plpgsql security definer set search_path='' as $$
declare state text;begin
 if p_path is null or p_path!~'^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|pdf)$' then raise exception 'INVALID_RECEIPT' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_path,0));
 select status into state from public.payment_receipts where object_path=p_path for update;
 if state='ready' then return false;end if;
 insert into private.receipt_cleanup_tombstones(object_path) values(p_path) on conflict do nothing;
 update public.payment_receipts set status='removed' where object_path=p_path;
 return true;
end $$;
revoke all on function public.reserve_payment_receipt(uuid,uuid,text,text,bigint,text,uuid),public.complete_payment_receipt(uuid),public.get_payment_receipt_orphans(),public.mark_receipt_orphan_removed(text) from public,anon,authenticated;
grant execute on function public.reserve_payment_receipt(uuid,uuid,text,text,bigint,text,uuid),public.complete_payment_receipt(uuid),public.get_payment_receipt_orphans(),public.mark_receipt_orphan_removed(text) to service_role;
