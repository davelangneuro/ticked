// Supabase Edge Function: sends push notifications.
//  - Called every minute by pg_cron (header x-cron-secret) → works out due reminders for every user.
//  - Called from the app with {"test": true} and the user's login token → sends a test push.
// Secrets needed: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, CRON_SECRET.
// Deploy with "Verify JWT" turned OFF (this function checks auth itself).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import webpush from 'npm:web-push@3.6.7';
import { computeNotifications } from './core.js';

const env = (k: string) => Deno.env.get(k) ?? '';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

webpush.setVapidDetails(env('VAPID_SUBJECT') || 'mailto:admin@example.com', env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'));
const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

type Sub = { id: string; user_id: string; endpoint: string; subscription: webpush.PushSubscription };
type Payload = { title: string; body: string; tag?: string; taskId?: string };

async function sendAll(subs: Sub[], payloads: Payload[]) {
  let ok = 0;
  for (const sub of subs) {
    for (const p of payloads) {
      try {
        await webpush.sendNotification(sub.subscription, JSON.stringify(p), { TTL: 6 * 3600, urgency: 'high' });
        ok++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) {
          await admin.from('push_subscriptions').delete().eq('id', sub.id); // device unsubscribed
          break;
        }
        console.error('push failed', code, (e as Error).message);
      }
    }
  }
  return ok;
}

// PostgREST returns at most 1000 rows per request, so page through.
async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>) {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const body = await req.json().catch(() => ({}));

  if (body.test) {
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data } = await admin.auth.getUser(token);
    if (!data?.user) return json({ error: 'Not signed in' }, 401);
    const { data: subs } = await admin.from('push_subscriptions').select('*').eq('user_id', data.user.id);
    if (!subs?.length) return json({ error: 'No devices registered for push' }, 400);
    const sent = await sendAll(subs as Sub[], [{ title: '🔔 Ticked test', body: 'Push notifications are working.', tag: 'test' }]);
    return json({ ok: true, devices: subs.length, sent });
  }

  const secret = env('CRON_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) return json({ error: 'Unauthorized' }, 401);

  const now = new Date();
  const subs = await fetchAll<Sub>((a, b) => admin.from('push_subscriptions').select('*').range(a, b));
  const byUser = new Map<string, Sub[]>();
  for (const s of subs) byUser.set(s.user_id, [...(byUser.get(s.user_id) ?? []), s]);

  let total = 0;
  for (const [userId, userSubs] of byUser) {
    try {
      const since = new Date(now.getTime() - 14 * 86400000).toISOString();
      const [{ data: srow }, tasks, logs] = await Promise.all([
        admin.from('settings').select('data').eq('user_id', userId).maybeSingle(),
        fetchAll<{ data: Record<string, unknown> }>((a, b) => admin.from('tasks').select('data')
          .eq('user_id', userId).eq('deleted', false).is('data->>completedAt', null).range(a, b)),
        fetchAll<{ key: string }>((a, b) => admin.from('notification_log').select('key')
          .eq('user_id', userId).gte('sent_at', since).range(a, b)),
      ]);
      if (!srow?.data) continue;
      const { items, logKeys } = computeNotifications(
        tasks.map((t) => t.data).filter((t) => !t.completedAt && !t.deleted),
        srow.data, now, new Set(logs.map((l) => l.key)),
      );
      if (logKeys.length) {
        await admin.from('notification_log').upsert(
          logKeys.map((key: string) => ({ user_id: userId, key })), { onConflict: 'user_id,key', ignoreDuplicates: true },
        );
      }
      if (items.length) {
        total += await sendAll(userSubs, items.map((i: Payload & { key: string }) => ({ title: i.title, body: i.body, tag: i.tag, taskId: i.taskId })));
      }
    } catch (e) {
      console.error('user failed', userId, e);
    }
  }

  // tidy up old log rows now and then
  if (now.getUTCMinutes() === 7) {
    await admin.from('notification_log').delete().lt('sent_at', new Date(now.getTime() - 14 * 86400000).toISOString());
  }
  return json({ ok: true, users: byUser.size, sent: total });
});
