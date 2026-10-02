-- Preserve project/model quota counters under the existing revision lock.
-- Existing RPC permissions are retained by CREATE OR REPLACE. No customer records are changed.
begin;
create or replace function public.load_nahimila_network() returns jsonb language plpgsql security invoker set search_path=public as $$
declare result jsonb; rev bigint; meta jsonb; begin
 select revision,metadata into rev,meta from public.nml_runtime where id=true;
 select jsonb_build_object('revision',rev,'shops',coalesce((select jsonb_agg(value order by id) from public.nml_shops),'[]'),
 'details',coalesce((select jsonb_object_agg(id,detail) from public.nml_requests where detail is not null),'{}'),
 'receipts',meta->'receipts','submissions',meta->'submissions',
 'gemini_usage',coalesce(meta->'gemini_usage','{}'::jsonb),
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
create or replace function public.save_nahimila_network(expected_revision bigint,network jsonb) returns boolean language plpgsql security invoker set search_path=public,extensions as $$
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
 update public.nml_runtime set revision=expected_revision+1,metadata=metadata || jsonb_build_object('receipts',network->'receipts','submissions',network->'submissions','gemini_usage',coalesce(network->'gemini_usage','{}'::jsonb)) where id=true;return true;
end $$;
commit;
