# Setting up Ticked

Ticked is a web app you install on each device ("Add to Home Screen" on iPhone,
"Install app" in Edge/Chrome on Windows). The free services it uses:

| What | Service | Why |
|---|---|---|
| Hosting the app | **GitHub Pages** (free) | iPhone needs an `https://` address to install it and get notifications |
| Sync + notifications | **Supabase** (free tier) | Database shared by your devices + a small function that sends reminders |

The whole setup takes about 20 minutes and only has to be done once.

> Without steps 1–6 the app still works, but only on one device and with
> notifications only while it's open.

---

## 1. Create the Supabase project

1. Sign up at <https://supabase.com> and click **New project** (any name, e.g. `ticked`; pick a region near you; save the database password somewhere).
2. When it's ready, open **Project Settings → API** (or "API Keys") and copy:
   - the **Project URL** (`https://xxxx.supabase.co`)
   - the **anon / publishable** key. This key is meant to be public.

## 2. Create the tables

**SQL Editor → New query**, paste all of [`supabase/schema.sql`](supabase/schema.sql), then click **Run**.

## 3. Sign-in settings

**Authentication → Sign In / Providers → Email**:
- Turn **Confirm email** off, so you can sign in straight away. Or leave it on and click the link in the email.
- After you've created your own account (step 7), you can turn off **Allow new users to sign up** so nobody else can use your project.

## 4. Make the notification keys

Open [`tools/vapid.html`](tools/vapid.html) in your browser and click **Generate keys**. Keep the tab open, because you'll need all three values.

## 5. Deploy the reminder function

1. **Edge Functions → Deploy a new function → Via Editor**.
2. Name it exactly `send-reminders`.
3. Replace the example code with [`supabase/functions/send-reminders/index.ts`](supabase/functions/send-reminders/index.ts).
4. Add a second file named `core.js` and paste [`supabase/functions/send-reminders/core.js`](supabase/functions/send-reminders/core.js) into it.
5. Deploy it. Then open the function's **Details / Settings** and turn **Verify JWT** OFF (the function checks access itself).
6. **Edge Functions → Secrets**, add:

   | Name | Value |
   |---|---|
   | `VAPID_PUBLIC_KEY` | public key from step 4 |
   | `VAPID_PRIVATE_KEY` | private key from step 4 |
   | `VAPID_SUBJECT` | `mailto:` + your email, e.g. `mailto:you@example.com` |
   | `CRON_SECRET` | the cron secret from step 4 |

7. Open [`supabase/cron.sql`](supabase/cron.sql), replace `YOUR-PROJECT-REF` (the `xxxx` in your project URL) and `YOUR-CRON-SECRET`, and run it in the **SQL Editor**. The function now checks for due reminders every minute.

## 6. Put your keys in the app

Edit [`config.js`](config.js):

```js
export const CONFIG = {
  supabaseUrl: 'https://xxxx.supabase.co',
  supabaseAnonKey: 'eyJ... or sb_publishable_...',
  vapidPublicKey: 'BN...',   // the PUBLIC key only — never the private one
};
```

## 7. Host it on GitHub Pages

1. Create a free account at <https://github.com>, then **New repository** (e.g. `ticked`). It can be public; nothing secret is in these files.
2. **Add file → Upload files**, then drag in everything from this folder **except** `.claude`. Commit.
3. **Settings → Pages → Source: Deploy from a branch → `main` / root → Save**.
4. After about a minute your app is at `https://<your-username>.github.io/ticked/`.
5. In Supabase, **Authentication → URL Configuration → Site URL**: set it to that address.

(Alternative: drag the folder onto <https://app.netlify.com/drop>.)

## 8. Install on each device

**Work PC and home PC (Edge or Chrome)**
1. Open your app address and click the **Install** icon in the address bar (or **⋯ → Apps → Install Ticked**).
2. In Ticked, go to **Settings → Sync account**, create your account (first device) or sign in (other devices).
3. Click **Turn on notifications**, then **Send test**.

**iPhone (iOS 16.4 or newer)**
1. Open the address in **Safari**, tap **Share → Add to Home Screen**.
2. Open Ticked **from the home screen icon**. Notifications only work there, not in Safari.
3. **Settings → Sync account → Sign in**, then **Turn on notifications → Allow**, then **Send test**.
4. If notifications don't show up, check iPhone **Settings → Notifications → Ticked** and any Focus mode.

---

## Updating the app later

After changing files, bump the version in `sw.js` (`const CACHE = 'ticked-v2'`) and upload again.
Devices pick up the new version the next time the app is opened.

## Troubleshooting

- **"Sync error"**: open Settings to see the message. Usually the wrong URL/key in `config.js`, or `schema.sql` wasn't run.
- **Test push fails**: check the function's **Logs** in Supabase. Usually a missing secret or **Verify JWT** still on.
- **Reminders never arrive but the test works**: check the cron job ran (`select * from cron.job_run_details order by start_time desc limit 5;`).
- **Work PC blocks installing apps**: just pin the browser tab. Push still works while the browser is running.
