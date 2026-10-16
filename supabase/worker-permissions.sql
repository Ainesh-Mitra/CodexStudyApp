-- Backend-only permissions. Does not change public or user access, or delete data.
grant usage on schema public to service_role;
grant select on public.planners, public.notification_settings to service_role;
grant select, delete on public.push_subscriptions to service_role;
grant select, insert, delete on public.push_deliveries to service_role;
