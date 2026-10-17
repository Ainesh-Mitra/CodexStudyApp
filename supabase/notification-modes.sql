-- Run in the existing project. Additive migration: preserves schedules and devices.
alter table public.notification_settings
 add column if not exists mode text not null default 'interval'
 check (mode in ('never','interval','before_task'));
alter table public.notification_settings
 add column if not exists interval_hours integer not null default 1
 check (interval_hours between 1 and 24);
alter table public.notification_settings
 add column if not exists interval_anchor timestamptz not null default date_trunc('minute',now());
