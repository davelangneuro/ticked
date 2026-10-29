-- Runs the reminder function every minute.
-- Replace YOUR-PROJECT-REF and YOUR-CRON-SECRET, then run in the SQL Editor.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('ticked-reminders')
where exists (select 1 from cron.job where jobname = 'ticked-reminders');

select cron.schedule(
  'ticked-reminders',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'YOUR-CRON-SECRET'),
    body := '{}'::jsonb
  );
  $$
);
