-- Atomic, service-only reset of the six fixed fictional accounts.
-- Real accounts/auth users and project quota counters are retained.
begin;
create or replace function public.reset_nahimila_demo(expected_revision bigint, network jsonb)
returns boolean language plpgsql security invoker set search_path=public as $$
declare
 demo text[] := array['m-sharma-001','m-gupta-002','m-lakshmi-003','m-neighbor-3','m-neighbor-4','m-neighbor-5'];
 orders_to_remove text[]; quotes_to_remove text[];
begin
 perform 1 from public.nml_runtime where id=true and revision=expected_revision for update;
 if not found then return false; end if;
 if (select count(*) from public.nml_shops where id=any(demo)) <> 6 then
  raise exception 'DEMO_NOT_CONFIGURED';
 end if;
 select coalesce(array_agg(distinct order_id),'{}') into orders_to_remove
 from public.nml_order_shares where shop_id=any(demo);
 select coalesce(array_agg(id),'{}') into quotes_to_remove
 from public.nml_quotes where value->>'created_by_shop'=any(demo);
 -- Refuse to erase a consequential record shared with a real merchant.
 if exists(select 1 from public.nml_order_shares s join public.nml_orders o on o.id=s.order_id
 where (s.order_id=any(orders_to_remove) or o.quote_id=any(quotes_to_remove)) and not s.shop_id=any(demo)) then
  raise exception 'DEMO_RESET_BLOCKED';
 end if;
 delete from public.nml_order_reservations where order_id=any(orders_to_remove);
 delete from public.nml_order_shares where order_id=any(orders_to_remove);
 delete from public.nml_pickups where shop_id=any(demo);
 delete from public.nml_orders where id=any(orders_to_remove);
 delete from public.nml_approvals where shop_id=any(demo) or quote_id=any(quotes_to_remove);
 delete from public.nml_reservations where shop_id=any(demo);
 delete from public.nml_offers where shop_id=any(demo);
 delete from public.nml_requests where shop_id=any(demo);
 delete from public.nml_quotes where id=any(quotes_to_remove);
 -- Remove only unused catalog entries that the reset no longer contains.
 delete from public.nml_products p where not exists(select 1 from jsonb_array_elements(network->'state'->'products') x where x->>'id'=p.id)
 and not exists(select 1 from public.nml_requests r where r.product_id=p.id)
 and not exists(select 1 from public.nml_quotes q where q.value->>'sku'=p.value->>'sku');
 delete from public.nml_suppliers s where not exists(select 1 from jsonb_array_elements(network->'state'->'suppliers') x where x->>'id'=s.id)
 and not exists(select 1 from public.nml_quotes q where q.supplier_id=s.id);
 -- Server reset retains every non-demo audit event in the supplied network.
 delete from public.nml_audit a where not exists(select 1 from jsonb_array_elements(network->'state'->'auditEvents') x where x->>'id'=a.id);
 -- Existing writer rechecks the same locked revision and restores fresh rows.
 return public.save_nahimila_network(expected_revision,network);
end $$;
revoke all on function public.reset_nahimila_demo(bigint,jsonb) from public,anon,authenticated;
grant execute on function public.reset_nahimila_demo(bigint,jsonb) to service_role;
commit;
