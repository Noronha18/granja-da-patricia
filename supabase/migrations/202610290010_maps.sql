create table private.maps_usage(day date primary key,requests integer not null,last_at timestamptz not null);
revoke all on private.maps_usage from public,anon,authenticated;
create function public.get_route_distance_context(p_route_id uuid,p_expected_version integer,p_reserve boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare run public.route_runs; addresses jsonb; first_kind text; last_kind text; usage private.maps_usage; today date:=(clock_timestamp() at time zone 'UTC')::date;
begin
 if private.current_role() is distinct from 'owner' then raise exception 'FORBIDDEN' using errcode='42501';end if;
 select * into run from public.route_runs where id=p_route_id for share;
 if not found or run.version is distinct from p_expected_version then raise exception 'VERSION_CONFLICT' using errcode='PT409';end if;
 if run.status not in('draft','ready') then raise exception 'ROUTE_LOCKED' using errcode='PT409';end if;
 select jsonb_agg(s.address order by s.position),(array_agg(s.kind order by s.position))[1],(array_agg(s.kind order by s.position desc))[1]
 into addresses,first_kind,last_kind from public.route_stops s left join public.weekly_orders o on o.id=s.order_id
 where s.route_id=run.id and (o.id is null or o.status<>'suspended');
 if addresses is null or jsonb_array_length(addresses) not between 2 and 30 or first_kind<>'departure' or last_kind<>'arrival'
 or exists(select from jsonb_array_elements_text(addresses) a where a is null or length(trim(a)) not between 1 and 500)
 then raise exception 'INCOMPLETE_ROUTE' using errcode='22023';end if;
 if p_reserve is true then
  -- Application-wide bound, atomic across Workers. Failures consume a reservation too.
  insert into private.maps_usage values(today,0,'epoch') on conflict do nothing;
  select * into usage from private.maps_usage where day=today for update;
  if usage.requests>=20 or usage.last_at>clock_timestamp()-interval '1 minute' then raise exception 'MAPS_LIMIT' using errcode='PT429';end if;
  update private.maps_usage set requests=requests+1,last_at=clock_timestamp() where day=today;
 end if;
 return jsonb_build_object('version',run.version,'addresses',addresses);
end $$;
revoke all on function public.get_route_distance_context(uuid,integer,boolean) from public,anon;
grant execute on function public.get_route_distance_context(uuid,integer,boolean) to authenticated;
