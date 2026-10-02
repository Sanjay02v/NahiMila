-- Actual prototype persistence. Full synthetic workspace is stored atomically.
-- Apply this migration in Supabase SQL Editor. Server service-role key only.
create table if not exists public.demo_workspaces (
 id uuid primary key,
 revision bigint not null default 0,
 state jsonb not null,
 updated_at timestamptz not null default now()
);
alter table public.demo_workspaces enable row level security;
revoke all on public.demo_workspaces from anon, authenticated;
grant select, insert, update on public.demo_workspaces to service_role;
create or replace function public.save_demo_workspace(workspace_id uuid, expected_revision bigint, new_state jsonb)
returns boolean language plpgsql security invoker set search_path = public as $$
begin
 if expected_revision = -1 then
  insert into public.demo_workspaces(id, revision, state) values(workspace_id,0,new_state) on conflict do nothing;
  return found;
 end if;
 update public.demo_workspaces set state=new_state, revision=revision+1,updated_at=now()
 where id=workspace_id and revision=expected_revision;
 return found;
end $$;
revoke all on function public.save_demo_workspace(uuid,bigint,jsonb) from public, anon, authenticated;
grant execute on function public.save_demo_workspace(uuid,bigint,jsonb) to service_role;
