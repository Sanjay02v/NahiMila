-- Relational product storage. Old demo_workspaces is retained only as historical data.
-- Normal merchant clients have owner-scoped reads and no direct consequential writes.
create extension if not exists pgcrypto with schema extensions;
create extension if not exists postgis with schema extensions;
create table public.nml_shops (
 id text primary key, user_id uuid unique not null references auth.users(id),
 value jsonb not null, location extensions.geography(Point,4326),
 check (value->>'user_id'=user_id::text), check (value->>'id'=id),
 check (jsonb_typeof(value)='object'), check ((value->>'cash_cap_paise')::bigint>=0)
);
create index nml_shop_geo on public.nml_shops using gist(location);
create table public.nml_products(id text primary key,value jsonb not null);
create table public.nml_suppliers(id text primary key,value jsonb not null);
create table public.nml_requests(
 id text primary key,shop_id text not null references public.nml_shops(id),
 product_id text not null references public.nml_products(id),value jsonb not null,detail jsonb,
 submission_key text,created_at timestamptz not null,
 unique(id,shop_id),unique(shop_id,submission_key),
 check(value->>'merchant_id'=shop_id),check(value->>'product_id'=product_id),check ((value->>'quantity')::int>0),
 check ((value->>'max_retail_price_paise')::bigint>=0)
);
create index nml_requests_shop_date on public.nml_requests(shop_id,created_at desc);
create index nml_requests_product_date on public.nml_requests(product_id,created_at desc);
create table public.nml_offers(
 id text primary key,request_id text not null references public.nml_requests(id),
 shop_id text not null references public.nml_shops(id),token_hash text unique not null,
 value jsonb not null,unique(id,request_id,shop_id),
 foreign key(request_id,shop_id) references public.nml_requests(id,shop_id),
 check(value->>'pickup_merchant_id'=shop_id),check ((value->>'proposed_price_paise')::bigint>0)
);
create table public.nml_reservations(
 id text primary key,offer_id text not null references public.nml_offers(id),
 request_id text not null references public.nml_requests(id),shop_id text not null references public.nml_shops(id),
 status text not null,value jsonb not null,unique(id,shop_id),
 foreign key(offer_id,request_id,shop_id) references public.nml_offers(id,request_id,shop_id),
 check(status in ('ACTIVE','COMMITTED','FULFILLED','CANCELLED','NO_SHOW')),
 check(value->>'merchant_id'=shop_id),check ((value->>'quantity')::int>0),
 check ((value->>'confirmed_price_paise')::bigint>0)
);
create unique index nml_one_live_reservation on public.nml_reservations(offer_id) where status in ('ACTIVE','COMMITTED','FULFILLED','NO_SHOW');
create index nml_reservation_shop on public.nml_reservations(shop_id,status);
create table public.nml_quotes(id text primary key,supplier_id text not null references public.nml_suppliers(id),value jsonb not null,check ((value->>'moq')::int>0),check ((value->>'unit_cost_paise')::bigint>0));
create table public.nml_approvals(id text primary key,shop_id text not null references public.nml_shops(id),quote_id text not null references public.nml_quotes(id),value jsonb not null);
create unique index nml_approval_version on public.nml_approvals(shop_id,quote_id,((value->>'quote_version')::int));
create table public.nml_orders(id text primary key,quote_id text unique not null references public.nml_quotes(id),value jsonb not null);
create table public.nml_order_shares(order_id text not null references public.nml_orders(id),shop_id text not null references public.nml_shops(id),value jsonb not null,primary key(order_id,shop_id));
create table public.nml_order_reservations(order_id text not null references public.nml_orders(id),reservation_id text unique not null references public.nml_reservations(id),primary key(order_id,reservation_id));
create table public.nml_pickups(id text primary key,shop_id text not null references public.nml_shops(id),reservation_id text unique not null references public.nml_reservations(id),value jsonb not null,foreign key(reservation_id,shop_id) references public.nml_reservations(id,shop_id),check(value->>'merchant_id'=shop_id),check ((value->>'total_collected_paise')::bigint>=0));
create table public.nml_audit(id text primary key,value jsonb not null);
create table public.nml_runtime(id boolean primary key default true check(id),revision bigint not null default 0,metadata jsonb not null default '{"receipts":[],"submissions":{}}');
insert into public.nml_runtime(id) values(true);
-- Every table is closed by default. Merchant writes go through validated Next.js services.
do $$ declare tab text; begin
 foreach tab in array array['nml_shops','nml_products','nml_suppliers','nml_requests','nml_offers','nml_reservations','nml_quotes','nml_approvals','nml_orders','nml_order_shares','nml_order_reservations','nml_pickups','nml_audit','nml_runtime'] loop
 execute format('alter table public.%I enable row level security',tab);
 execute format('revoke all on public.%I from anon, authenticated',tab);
 execute format('grant all on public.%I to service_role',tab);
 end loop;
end $$;
grant select on public.nml_shops,public.nml_requests,public.nml_offers,public.nml_reservations,public.nml_approvals,public.nml_order_shares,public.nml_pickups to authenticated;
create policy own_shop on public.nml_shops for select to authenticated using(user_id=auth.uid());
create policy own_requests on public.nml_requests for select to authenticated using(exists(select 1 from public.nml_shops s where s.id=shop_id and s.user_id=auth.uid()));
create policy own_offers on public.nml_offers for select to authenticated using(exists(select 1 from public.nml_shops s where s.id=shop_id and s.user_id=auth.uid()));
create policy own_reservations on public.nml_reservations for select to authenticated using(exists(select 1 from public.nml_shops s where s.id=shop_id and s.user_id=auth.uid()));
create policy own_approvals on public.nml_approvals for select to authenticated using(exists(select 1 from public.nml_shops s where s.id=shop_id and s.user_id=auth.uid()));
create policy own_shares on public.nml_order_shares for select to authenticated using(exists(select 1 from public.nml_shops s where s.id=shop_id and s.user_id=auth.uid()));
create policy own_pickups on public.nml_pickups for select to authenticated using(exists(select 1 from public.nml_shops s where s.id=shop_id and s.user_id=auth.uid()));
-- Internal coordinator reads all rows, but endpoints expose explicit owner/capability DTOs only.
-- Service-only RPCs cannot be called by merchant/customer JWTs.
create function public.load_nahimila_network() returns jsonb language plpgsql security invoker set search_path=public as $$
declare result jsonb; rev bigint; meta jsonb; begin
 select revision,metadata into rev,meta from public.nml_runtime where id=true;
 select jsonb_build_object('revision',rev,'shops',coalesce((select jsonb_agg(value order by id) from public.nml_shops),'[]'),
 'details',coalesce((select jsonb_object_agg(id,detail) from public.nml_requests where detail is not null),'{}'),
 'receipts',meta->'receipts','submissions',meta->'submissions',
 'state',jsonb_build_object(
 'merchants',coalesce((select jsonb_agg(value order by id) from public.nml_shops),'[]'),
 'products',coalesce((select jsonb_agg(value order by id) from public.nml_products),'[]'),
 'suppliers',coalesce((select jsonb_agg(value order by id) from public.nml_suppliers),'[]'),
 'quotes',coalesce((select jsonb_agg(value order by id) from public.nml_quotes),'[]'),
 'requests',coalesce((select jsonb_agg(value order by id) from public.nml_requests),'[]'),
 'offers',coalesce((select jsonb_agg(value order by id) from public.nml_offers),'[]'),
 'reservations',coalesce((select jsonb_agg(value order by id) from public.nml_reservations),'[]'),
 'orders',coalesce((select jsonb_agg(value order by id) from public.nml_orders),'[]'),
 'pickups',coalesce((select jsonb_agg(value order by id) from public.nml_pickups),'[]'),
 'auditEvents',coalesce((select jsonb_agg(value order by id) from public.nml_audit),'[]'),
 'approvalsByQuote',coalesce((select jsonb_object_agg(quote_id,a) from (select quote_id,jsonb_agg(value) a from public.nml_approvals group by quote_id) x),'{}')
 )) into result;return result;end $$;
create function public.save_nahimila_network(expected_revision bigint,network jsonb) returns boolean language plpgsql security invoker set search_path=public,extensions as $$
declare x jsonb; a jsonb; key text; begin
 -- Revision compare-and-swap serializes the final deterministic server recheck and writes.
 perform 1 from public.nml_runtime where id=true and revision=expected_revision for update;
 if not found then return false;end if;
 for x in select * from jsonb_array_elements(network->'shops') loop
 insert into public.nml_shops(id,user_id,value,location) values(x->>'id',(x->>'user_id')::uuid,x,
 case when x->>'latitude' is not null and x->>'longitude' is not null then extensions.st_setsrid(extensions.st_makepoint((x->>'longitude')::float,(x->>'latitude')::float),4326)::extensions.geography end)
 on conflict(id) do update set value=excluded.value,location=excluded.location;
 end loop;
 for x in select * from jsonb_array_elements(network->'state'->'products') loop insert into public.nml_products values(x->>'id',x) on conflict(id) do update set value=excluded.value;end loop;
 for x in select * from jsonb_array_elements(network->'state'->'suppliers') loop insert into public.nml_suppliers values(x->>'id',x) on conflict(id) do update set value=excluded.value;end loop;
 for x in select * from jsonb_array_elements(network->'state'->'requests') loop
 insert into public.nml_requests values(x->>'id',x->>'merchant_id',x->>'product_id',x,network->'details'->(x->>'id'),network->'details'->(x->>'id')->>'submission_key',(x->>'created_at')::timestamptz) on conflict(id) do update set value=excluded.value,detail=excluded.detail;
 end loop;
 for x in select * from jsonb_array_elements(network->'state'->'offers') loop insert into public.nml_offers values(x->>'id',x->>'request_id',x->>'pickup_merchant_id',encode(extensions.digest(x->>'request_token','sha256'),'hex'),x) on conflict(id) do update set value=excluded.value;end loop;
 for x in select * from jsonb_array_elements(network->'state'->'reservations') loop insert into public.nml_reservations values(x->>'id',x->>'offer_id',x->>'request_id',x->>'merchant_id',x->>'status',x) on conflict(id) do update set status=excluded.status,value=excluded.value;end loop;
 for x in select * from jsonb_array_elements(network->'state'->'quotes') loop insert into public.nml_quotes values(x->>'id',x->>'supplier_id',x) on conflict(id) do update set value=excluded.value;end loop;
 for key,a in select * from jsonb_each(network->'state'->'approvalsByQuote') loop
 for x in select * from jsonb_array_elements(a) loop insert into public.nml_approvals values(x->>'id',x->>'merchant_id',key,x) on conflict(id) do update set value=excluded.value;end loop;end loop;
 for x in select * from jsonb_array_elements(network->'state'->'orders') loop
 insert into public.nml_orders values(x->>'id',x->>'quote_id',x) on conflict(id) do nothing;
 for a in select * from jsonb_array_elements(x->'merchant_allocations') loop insert into public.nml_order_shares values(x->>'id',a->>'merchant_id',a) on conflict(order_id,shop_id) do nothing;end loop;
 for a in select * from jsonb_array_elements(x->'selected_reservation_ids') loop insert into public.nml_order_reservations values(x->>'id',a#>>'{}') on conflict(order_id,reservation_id) do nothing;end loop;
 end loop;
 for x in select * from jsonb_array_elements(network->'state'->'pickups') loop insert into public.nml_pickups values(x->>'id',x->>'merchant_id',x->>'reservation_id',x) on conflict(id) do nothing;end loop;
 for x in select * from jsonb_array_elements(network->'state'->'auditEvents') loop insert into public.nml_audit values(x->>'id',x) on conflict(id) do nothing;end loop;
 update public.nml_runtime set revision=expected_revision+1,metadata=jsonb_build_object('receipts',network->'receipts','submissions',network->'submissions') where id=true;return true;
end $$;
revoke all on function public.load_nahimila_network() from public,anon,authenticated;
revoke all on function public.save_nahimila_network(bigint,jsonb) from public,anon,authenticated;
grant execute on function public.load_nahimila_network(),public.save_nahimila_network(bigint,jsonb) to service_role;
