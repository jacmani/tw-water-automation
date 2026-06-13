-- Migration 003: alert_log table
-- Run in Supabase SQL editor after deploying the email alert feature

create table if not exists alert_log (
  id          uuid primary key default gen_random_uuid(),
  alert_type  text not null,                 -- 'spike' | 'weekly' | 'monthly'
  sheet_date  date,                          -- relevant sheet date (null for aggregate reports)
  tower       text,                          -- tower name (null for community-wide reports)
  recipients  text[]    not null default '{}',
  subject     text,
  sent_at     timestamptz not null default now(),
  status      text not null default 'sent',  -- 'sent' | 'error'
  details     jsonb not null default '{}'   -- resend_id, error, sandbox flag
);

-- Index for the /alerts admin page (sorted by sent_at desc)
create index if not exists alert_log_sent_at_idx on alert_log (sent_at desc);

-- RLS: allow anon SELECT (alert log is not sensitive — committee members can verify sends)
alter table alert_log enable row level security;

create policy "anon_select_alert_log" on alert_log
  for select using (true);

create policy "service_insert_alert_log" on alert_log
  for insert with check (true);
