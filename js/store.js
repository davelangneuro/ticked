// App state: kept in localStorage so the app works offline, and synced to
// Supabase (if configured in config.js and signed in).
import { CONFIG } from '../config.js';
import { normalizeSettings, nextOccurrence, dayKey } from './core.js';

const K = { tasks: 'ticked.tasks', settings: 'ticked.settings', dirty: 'ticked.dirty', meta: 'ticked.meta' };

const load = (k, fallback) => {
  try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
};
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

const state = {
  tasks: new Map(Object.entries(load(K.tasks, {}))),
  settings: normalizeSettings(load(K.settings, null)),
  dirty: new Set(load(K.dirty, [])),
  settingsDirty: false,
  meta: load(K.meta, { lastPull: null }),
  user: null,
  sync: CONFIG.supabaseUrl ? 'signed-out' : 'local', // local | signed-out | syncing | synced | offline | error
  syncError: null,
};
state.settingsDirty = !!state.meta.settingsDirty;

export const deviceTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

const listeners = new Set();
export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
let emitQueued = false;
function emit() {
  if (emitQueued) return;
  emitQueued = true;
  queueMicrotask(() => { emitQueued = false; listeners.forEach((fn) => fn()); });
}

function persist() {
  save(K.tasks, Object.fromEntries(state.tasks));
  save(K.dirty, [...state.dirty]);
  save(K.settings, state.settings);
  save(K.meta, { ...state.meta, settingsDirty: state.settingsDirty });
}

// ---------- reads ----------

export const getSettings = () => state.settings;
export const getUser = () => state.user;
export const getSyncState = () => ({ status: state.sync, error: state.syncError });
export const allTasks = () => [...state.tasks.values()].filter((t) => !t.deleted);
export const getTask = (id) => state.tasks.get(id);
export const tz = () => state.settings.timezone || deviceTz();

// ---------- writes ----------

const uid = () => (crypto.randomUUID ? crypto.randomUUID() :
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  }));

function put(task) {
  task.updatedAt = Date.now();
  state.tasks.set(task.id, task);
  state.dirty.add(task.id);
  persist();
  emit();
  scheduleFlush();
  return task;
}

export function createTask(fields) {
  const now = new Date().toISOString();
  return put({
    id: uid(), title: '', notes: '', priority: 3, list: state.settings.lists[0]?.id || null,
    dueDate: null, dueTime: null, recurrence: null, subtasks: [],
    createdAt: now, completedAt: null, deleted: false,
    ...fields,
  });
}

export function updateTask(id, patch) {
  const t = state.tasks.get(id);
  if (!t) return null;
  return put({ ...t, ...patch });
}

export function deleteTask(id) {
  const t = state.tasks.get(id);
  if (t) put({ ...t, deleted: true });
}

export function restoreTask(id) {
  const t = state.tasks.get(id);
  if (t) put({ ...t, deleted: false });
}

/** Mark done. Recurring tasks spawn their next occurrence. */
export function completeTask(id) {
  const t = state.tasks.get(id);
  if (!t || t.completedAt) return;
  let spawnedId = null;
  const next = nextOccurrence(t, dayKey(new Date(), tz()));
  if (next) {
    const n = createTask({
      title: t.title, notes: t.notes, priority: t.priority, list: t.list,
      dueDate: next, dueTime: t.dueTime, recurrence: t.recurrence,
      subtasks: (t.subtasks || []).map((s) => ({ ...s, done: false })),
    });
    spawnedId = n.id;
  }
  put({ ...t, completedAt: new Date().toISOString(), spawnedId });
}

export function uncompleteTask(id) {
  const t = state.tasks.get(id);
  if (!t) return;
  if (t.spawnedId) {
    const s = state.tasks.get(t.spawnedId);
    if (s && !s.completedAt) put({ ...s, deleted: true });
  }
  put({ ...t, completedAt: null, spawnedId: null });
}

export function updateSettings(mutator) {
  const s = structuredClone(state.settings);
  mutator(s);
  s.updatedAt = Date.now();
  state.settings = normalizeSettings(s);
  state.settingsDirty = true;
  persist();
  emit();
  scheduleFlush();
}

export function exportData() {
  return { app: 'ticked', version: 1, exportedAt: new Date().toISOString(), settings: state.settings, tasks: [...state.tasks.values()] };
}

export function importData(data) {
  if (!data || !Array.isArray(data.tasks)) throw new Error('Not a Ticked backup file');
  for (const t of data.tasks) {
    const cur = state.tasks.get(t.id);
    if (!cur || (t.updatedAt || 0) > (cur.updatedAt || 0)) {
      state.tasks.set(t.id, t);
      state.dirty.add(t.id);
    }
  }
  if (data.settings) {
    state.settings = normalizeSettings({ ...data.settings, updatedAt: Date.now() });
    state.settingsDirty = true;
  }
  persist();
  emit();
  scheduleFlush();
}

// Keep the server's timezone in step with the device (used for reminders).
// Untouched default settings are not marked as changed, so a new device
// never overwrites the settings already saved in the account.
function syncTimezone() {
  if (state.settings.timezone === deviceTz()) return;
  if (!state.settings.updatedAt) state.settings.timezone = deviceTz();
  else updateSettings((s) => { s.timezone = deviceTz(); });
}

// ---------- sync ----------

let sb = null;
let channel = null;
let flushTimer = null;
let flushing = false;

function setSync(status, error = null) {
  state.sync = status;
  state.syncError = error;
  emit();
}

export const supabase = () => sb;

export async function initSync() {
  if (!CONFIG.supabaseUrl || !CONFIG.supabaseAnonKey) return;
  try {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm');
    sb = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'ticked.auth' },
    });
  } catch (e) {
    setSync('offline', 'Could not load sync library');
    return;
  }
  sb.auth.onAuthStateChange((_event, session) => {
    const prev = state.user?.id;
    state.user = session?.user || null;
    if (!state.user) {
      stopRealtime();
      setSync('signed-out');
    } else if (state.user.id !== prev) {
      startRealtime();
      syncNow();
    }
  });
  const { data } = await sb.auth.getSession();
  state.user = data.session?.user || null;
  if (state.user) { startRealtime(); syncNow(); } else setSync('signed-out');

  window.addEventListener('online', () => syncNow());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncNow(); });
  setInterval(() => { if (!document.hidden) syncNow(); }, 60000);
}

export async function signIn(email, password) {
  markAllForUpload();
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signUp(email, password) {
  markAllForUpload();
  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

// Anything created while signed out should go up to the account.
function markAllForUpload() {
  for (const id of state.tasks.keys()) state.dirty.add(id);
  state.meta.lastPull = null;
  persist();
}

export async function signOut() {
  await sb.auth.signOut();
}

function scheduleFlush() {
  if (!sb || !state.user) return;
  clearTimeout(flushTimer);
  flushTimer = setTimeout(syncNow, 600);
}

function mergeRemoteTask(row) {
  if (!row?.data) return false;
  const remote = { ...row.data, id: row.id, deleted: !!row.deleted };
  const local = state.tasks.get(row.id);
  if (local && (local.updatedAt || 0) >= (remote.updatedAt || 0)) return false;
  state.tasks.set(row.id, remote);
  state.dirty.delete(row.id);
  return true;
}

function mergeRemoteSettings(row) {
  if (!row?.data) return false;
  if ((row.data.updatedAt || 0) <= (state.settings.updatedAt || 0)) return false;
  state.settings = normalizeSettings(row.data);
  state.settingsDirty = false;
  syncTimezone();
  return true;
}

export async function syncNow() {
  if (!sb || !state.user || flushing) return;
  if (!navigator.onLine) { setSync('offline'); return; }
  flushing = true;
  setSync('syncing');
  const userId = state.user.id;
  try {
    // push local changes
    const ids = [...state.dirty];
    if (ids.length) {
      const rows = ids.map((id) => state.tasks.get(id)).filter(Boolean).map((t) => ({
        id: t.id, user_id: userId, data: t, deleted: !!t.deleted, updated_at: new Date(t.updatedAt || Date.now()).toISOString(),
      }));
      for (let i = 0; i < rows.length; i += 200) {
        const { error } = await sb.from('tasks').upsert(rows.slice(i, i + 200));
        if (error) throw error;
      }
      ids.forEach((id) => state.dirty.delete(id));
    }
    if (state.settingsDirty) {
      const { error } = await sb.from('settings').upsert({ user_id: userId, data: state.settings, updated_at: new Date().toISOString() });
      if (error) throw error;
      state.settingsDirty = false;
    }

    // pull remote changes (server_updated_at is set by the database, so clock skew can't hide rows)
    let q = sb.from('tasks').select('id,data,deleted,server_updated_at').order('server_updated_at', { ascending: true }).limit(1000);
    if (state.meta.lastPull) q = q.gt('server_updated_at', state.meta.lastPull);
    const { data: rows, error } = await q;
    if (error) throw error;
    for (const r of rows) mergeRemoteTask(r);
    if (rows.length) state.meta.lastPull = rows[rows.length - 1].server_updated_at;

    const { data: srow, error: serr } = await sb.from('settings').select('data').eq('user_id', userId).maybeSingle();
    if (serr) throw serr;
    mergeRemoteSettings(srow);

    persist();
    setSync('synced');
    if (rows.length === 1000) { flushing = false; return syncNow(); }
  } catch (e) {
    console.warn('sync failed', e);
    setSync(navigator.onLine ? 'error' : 'offline', e.message || String(e));
  } finally {
    flushing = false;
  }
}

function startRealtime() {
  stopRealtime();
  const filter = `user_id=eq.${state.user.id}`;
  channel = sb.channel('ticked-' + state.user.id)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter }, (p) => {
      if (mergeRemoteTask(p.new)) { persist(); emit(); }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'settings', filter }, (p) => {
      if (mergeRemoteSettings(p.new)) { persist(); emit(); }
    })
    .subscribe();
}

function stopRealtime() {
  if (channel) sb.removeChannel(channel);
  channel = null;
}

// ---------- push subscriptions ----------

const b64ToBytes = (b64) => {
  const s = (b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
};

export const pushAvailable = () => !!(sb && CONFIG.vapidPublicKey && 'PushManager' in window && 'serviceWorker' in navigator);

export async function getPushSubscription() {
  if (!('serviceWorker' in navigator)) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

/** Ask permission (must be called from a tap/click) and register this device for push. */
export async function enablePush() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications were not allowed');
  if (!pushAvailable() || !state.user) return 'local';
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(CONFIG.vapidPublicKey) });
  const json = sub.toJSON();
  const { error } = await sb.from('push_subscriptions').upsert({
    user_id: state.user.id, endpoint: json.endpoint, subscription: json, device: navigator.userAgent.slice(0, 200),
  }, { onConflict: 'endpoint' });
  if (error) throw error;
  return 'push';
}

export async function disablePush() {
  const sub = await getPushSubscription();
  if (!sub) return;
  if (sb && state.user) await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  await sub.unsubscribe();
}

syncTimezone();

export async function sendTestPush() {
  const { data, error } = await sb.functions.invoke('send-reminders', { body: { test: true } });
  if (error) throw error;
  return data;
}
