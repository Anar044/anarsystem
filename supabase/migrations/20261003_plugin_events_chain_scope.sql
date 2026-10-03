-- Smart Horeca CHAIN hardening: plugin events are read through the scoped
-- Cloudflare API only. Direct browser SELECT would bypass restaurant scope.

alter table public.plugin_events enable row level security;

drop policy if exists "authenticated users can read plugin events"
  on public.plugin_events;

revoke select on table public.plugin_events from authenticated;
revoke select on table public.plugin_events from anon;
