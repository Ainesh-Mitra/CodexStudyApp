-- Run once in the Supabase SQL editor. No service key belongs in browser code.
create table if not exists public.planners (
 user_id uuid primary key references auth.users on delete cascade,
 data jsonb not null check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 500000),
 revision integer not null default 1,
 updated_at timestamptz not null default now()
);
create table if not exists public.notification_settings (
 user_id uuid primary key references auth.users on delete cascade,
 enabled boolean not null default false,
 timezone text not null default 'UTC',
 start_hour integer not null default 0 check(start_hour between 0 and 23),
 end_hour integer not null default 23 check(end_hour between 0 and 23)
);
create table if not exists public.push_subscriptions (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users on delete cascade,
 endpoint text not null check(length(endpoint) < 2048 and endpoint like 'https://%'),
 subscription jsonb not null check(octet_length(subscription::text) < 8192),
 created_at timestamptz not null default now(),
 unique(user_id, endpoint)
);
-- Claims are backend-only, to deduplicate retries and bound test notifications.
create table if not exists public.push_deliveries (
 user_id uuid not null references auth.users on delete cascade,
 slot text not null,
 created_at timestamptz not null default now(),
 primary key(user_id, slot)
);
alter table public.planners enable row level security;
alter table public.notification_settings enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.push_deliveries enable row level security;
drop policy if exists own_plan on public.planners;
create policy own_plan on public.planners for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists own_settings on public.notification_settings;
create policy own_settings on public.notification_settings for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists own_devices on public.push_subscriptions;
create policy own_devices on public.push_subscriptions for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
revoke all on public.planners, public.notification_settings, public.push_subscriptions, public.push_deliveries from anon;
grant select,insert,update,delete on public.planners,public.notification_settings,public.push_subscriptions to authenticated;
revoke all on public.push_deliveries from authenticated;
-- Atomic compare-and-swap. A stale device cannot silently overwrite a newer save.
create or replace function public.save_planner(payload jsonb, expected_revision integer)
returns integer language plpgsql security invoker set search_path = '' as $$
declare new_revision integer;
begin
 if auth.uid() is null then raise exception 'not_authenticated'; end if;
 if expected_revision = 0 then
  insert into public.planners(user_id,data,revision) values(auth.uid(),payload,1)
  on conflict(user_id) do nothing returning revision into new_revision;
 else
  update public.planners set data=payload,revision=revision+1,updated_at=now()
  where user_id=auth.uid() and revision=expected_revision returning revision into new_revision;
 end if;
 if new_revision is null then raise exception 'revision_conflict'; end if;
 return new_revision;
end;
$$;
revoke all on function public.save_planner(jsonb,integer) from public,anon;
grant execute on function public.save_planner(jsonb,integer) to authenticated;
-- Backend-only permissions. Does not change public or user access, or delete data.
grant usage on schema public to service_role;
grant select on public.planners, public.notification_settings to service_role;
grant select, delete on public.push_subscriptions to service_role;
grant select, insert, delete on public.push_deliveries to service_role;
