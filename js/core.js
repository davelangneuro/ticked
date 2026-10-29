// Shared logic: used by the app (js/core.js) AND the reminder server function
// (supabase/functions/send-reminders/core.js is a copy — keep them in sync).
// No DOM or browser APIs in here.

export const PRIORITY_COLORS = { 1: '#e5484d', 2: '#f08c2e', 3: '#3e7bfa', 4: '#8b8d98' };

export const DEFAULT_SETTINGS = {
  updatedAt: 0,
  timezone: null,
  theme: 'auto',
  confetti: true,
  sound: true,
  dailyGoal: 5,
  allDayTime: '09:00', // when date-only tasks count as "due" for reminders
  autoFocus: false,
  workHours: { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' },
  lists: [
    { id: 'work', name: 'Work', icon: '💼', color: '#3e7bfa', active: 'work', notifyOnlyActive: true },
    { id: 'home', name: 'Home', icon: '🏡', color: '#30a46c', active: 'offwork', notifyOnlyActive: false },
  ],
  priorities: {
    1: { name: 'Urgent', notify: { enabled: true, before: [1440, 60, 0], repeat: 60, digest: true, breakQuiet: true } },
    2: { name: 'High', notify: { enabled: true, before: [60, 0], repeat: 180, digest: true, breakQuiet: false } },
    3: { name: 'Medium', notify: { enabled: true, before: [0], repeat: 0, digest: true, breakQuiet: false } },
    4: { name: 'Low', notify: { enabled: false, before: [], repeat: 0, digest: false, breakQuiet: false } },
  },
  digest: { enabled: true, time: '08:00', days: [1, 2, 3, 4, 5, 6, 0] },
  quiet: { enabled: true, start: '22:00', end: '07:00', weekends: false },
};

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

export function mergeDefaults(defaults, value) {
  if (!isObj(defaults)) return value === undefined ? defaults : value;
  const out = { ...defaults };
  if (!isObj(value)) return out;
  for (const k of Object.keys(value)) {
    out[k] = k in defaults ? mergeDefaults(defaults[k], value[k]) : value[k];
  }
  return out;
}

export const normalizeSettings = (s) => mergeDefaults(DEFAULT_SETTINGS, s);

// ---------- time zone helpers ----------

const fmtCache = new Map();
function partsFormatter(tz) {
  if (!fmtCache.has(tz)) {
    fmtCache.set(tz, new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
    }));
  }
  return fmtCache.get(tz);
}
const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Wall-clock parts of `date` in time zone `tz`. */
export function tzParts(date, tz) {
  const p = {};
  for (const { type, value } of partsFormatter(tz).formatToParts(date)) p[type] = value;
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second, wd: WD[p.weekday] };
}

const pad = (n) => String(n).padStart(2, '0');
export const keyFromYMD = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

export function dayKey(date, tz) {
  const p = tzParts(date, tz);
  return keyFromYMD(p.y, p.mo, p.d);
}

export function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return { y, m, d };
}

export function addDaysKey(key, n) {
  const { y, m, d } = parseKey(key);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return keyFromYMD(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function weekdayOfKey(key) {
  const { y, m, d } = parseKey(key);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function diffDaysKey(a, b) {
  const A = parseKey(a), B = parseKey(b);
  return Math.round((Date.UTC(A.y, A.m - 1, A.d) - Date.UTC(B.y, B.m - 1, B.d)) / 86400000);
}

export const toMin = (hhmm) => {
  const [h, m] = String(hhmm || '0:0').split(':').map(Number);
  return h * 60 + (m || 0);
};

/** The instant at which wall time `key` + `hhmm` happens in `tz`. */
export function zonedToDate(key, hhmm, tz) {
  const { y, m, d } = parseKey(key);
  const mins = toMin(hhmm);
  const target = Date.UTC(y, m - 1, d, Math.floor(mins / 60), mins % 60);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const p = tzParts(new Date(guess), tz);
    const asUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi);
    const diff = target - asUtc;
    if (diff === 0) break;
    guess += diff;
  }
  return new Date(guess);
}

/** True if minute-of-day `now` falls in [start, end), wrapping past midnight. */
export function inRange(now, start, end) {
  if (start === end) return false;
  return start < end ? now >= start && now < end : now >= start || now < end;
}

export function isWorkTime(settings, date, tz) {
  const p = tzParts(date, tz);
  const wh = settings.workHours;
  return wh.days.includes(p.wd) && inRange(p.h * 60 + p.mi, toMin(wh.start), toMin(wh.end));
}

export function listIsActive(list, settings, date, tz) {
  if (!list || list.active === 'always') return true;
  const work = isWorkTime(settings, date, tz);
  return list.active === 'work' ? work : !work;
}

export function inQuietHours(settings, date, tz) {
  const q = settings.quiet;
  if (!q.enabled) return false;
  const p = tzParts(date, tz);
  if (q.weekends && (p.wd === 0 || p.wd === 6)) return true;
  return inRange(p.h * 60 + p.mi, toMin(q.start), toMin(q.end));
}

// ---------- tasks ----------

/** Moment a task is due (date-only tasks use settings.allDayTime). */
export function dueMoment(task, settings, tz) {
  if (!task.dueDate) return null;
  return zonedToDate(task.dueDate, task.dueTime || settings.allDayTime, tz);
}

/** Moment from which a task counts as overdue. */
export function overdueMoment(task, settings, tz) {
  if (!task.dueDate) return null;
  if (task.dueTime) return zonedToDate(task.dueDate, task.dueTime, tz);
  return zonedToDate(addDaysKey(task.dueDate, 1), '00:00', tz);
}

export function isOverdue(task, now, settings, tz) {
  if (task.completedAt || !task.dueDate) return false;
  return overdueMoment(task, settings, tz) <= now;
}

function addMonthsKey(key, n) {
  const { y, m, d } = parseKey(key);
  const total = (m - 1) + n;
  const ny = y + Math.floor(total / 12), nm = ((total % 12) + 12) % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return keyFromYMD(ny, nm + 1, Math.min(d, last));
}

function stepRecurrence(key, rec) {
  const n = Math.max(1, rec.interval || 1);
  switch (rec.freq) {
    case 'day': return addDaysKey(key, n);
    case 'weekday': {
      let k = addDaysKey(key, 1);
      while ([0, 6].includes(weekdayOfKey(k))) k = addDaysKey(k, 1);
      return k;
    }
    case 'week': return addDaysKey(key, 7 * n);
    case 'month': return addMonthsKey(key, n);
    case 'year': return addMonthsKey(key, 12 * n);
    default: return null;
  }
}

/** Next due date for a recurring task, never earlier than tomorrow. */
export function nextOccurrence(task, todayKey) {
  if (!task.recurrence) return null;
  let k = task.dueDate || todayKey;
  let guard = 0;
  do {
    k = stepRecurrence(k, task.recurrence);
    if (!k) return null;
  } while (diffDaysKey(k, todayKey) < 1 && ++guard < 5000);
  return k;
}

export function describeRecurrence(rec) {
  if (!rec) return '';
  const n = rec.interval || 1;
  const unit = { day: 'day', week: 'week', month: 'month', year: 'year' }[rec.freq];
  if (rec.freq === 'weekday') return 'Every weekday';
  if (n === 1) return { day: 'Daily', week: 'Weekly', month: 'Monthly', year: 'Yearly' }[rec.freq];
  return `Every ${n} ${unit}s`;
}

export function humanizeMinutes(m) {
  m = Math.round(Math.abs(m));
  if (m < 1) return 'now';
  if (m < 60) return `${m} min`;
  if (m < 1440) {
    const h = Math.round(m / 60);
    return `${h} hour${h > 1 ? 's' : ''}`;
  }
  const d = Math.round(m / 1440);
  if (d < 7 || d % 7) return `${d} day${d > 1 ? 's' : ''}`;
  return `${d / 7} week${d > 7 ? 's' : ''}`;
}

// ---------- reminders ----------

const DOTS = { 1: '🔴', 2: '🟠', 3: '🔵', 4: '⚪' };
const MAX_LATE_MIN = 12 * 60; // don't send "before" reminders more than 12 h late

/**
 * Work out which notifications should go out right now.
 * `sent` is a Set of keys already sent (persisted by the caller).
 * Returns { items: [{key, title, body, tag, taskId}], logKeys: [...] }.
 * Items that are blocked (quiet hours, list inactive) are not logged, so they
 * go out later once allowed.
 */
export function computeNotifications(tasks, rawSettings, now, sent) {
  const settings = normalizeSettings(rawSettings);
  const tz = settings.timezone || 'UTC';
  const quiet = inQuietHours(settings, now, tz);
  const lists = Object.fromEntries(settings.lists.map((l) => [l.id, l]));
  const items = [];
  const logKeys = [];
  const nowMs = now.getTime();

  const open = tasks.filter((t) => !t.completedAt && !t.deleted);

  for (const t of open) {
    if (!t.dueDate) continue;
    const pr = settings.priorities[t.priority] || settings.priorities[3];
    const cfg = pr.notify;
    if (!cfg.enabled) continue;
    const list = lists[t.list];
    if (list && list.notifyOnlyActive && !listIsActive(list, settings, now, tz)) continue;
    if (quiet && !cfg.breakQuiet) continue;

    const occ = `${t.id}@${t.dueDate}T${t.dueTime || ''}`;
    const due = dueMoment(t, settings, tz).getTime();
    const overdueAt = overdueMoment(t, settings, tz).getTime();
    const listName = list ? `${list.icon || ''} ${list.name}`.trim() : '';
    const head = `${DOTS[t.priority] || ''} ${pr.name}`.trim();

    // "remind before" — only the most recent applicable one fires.
    const offsets = [...(cfg.before || [])].sort((a, b) => a - b);
    const pending = offsets.filter((o) => {
      const at = due - o * 60000;
      return at <= nowMs && nowMs - at < MAX_LATE_MIN * 60000 && !sent.has(`b${o}:${occ}`);
    });
    if (pending.length && nowMs < overdueAt + MAX_LATE_MIN * 60000) {
      const minsLeft = (due - nowMs) / 60000;
      let when;
      if (!t.dueTime && minsLeft <= 0 && nowMs < overdueAt) when = 'Due today';
      else if (minsLeft > 1) when = `Due in ${humanizeMinutes(minsLeft)}`;
      else if (minsLeft > -2) when = 'Due now';
      else when = `Overdue by ${humanizeMinutes(-minsLeft)}`;
      items.push({ key: `b:${occ}`, taskId: t.id, tag: t.id, title: `${head} · ${when}`, body: [t.title, listName].filter(Boolean).join('\n') });
      for (const o of offsets) {
        if (due - o * 60000 <= nowMs) logKeys.push(`b${o}:${occ}`);
      }
      continue;
    }

    // "repeat until done" — one per interval once overdue.
    if (cfg.repeat > 0 && nowMs >= overdueAt) {
      const slot = Math.floor((nowMs - overdueAt) / (cfg.repeat * 60000));
      const key = `r${slot}:${occ}`;
      if (slot >= 1 || !offsets.includes(0) || t.dueTime == null) {
        if (!sent.has(key)) {
          const late = (nowMs - overdueAt) / 60000;
          items.push({ key, taskId: t.id, tag: t.id, title: `${head} · Overdue${late >= 1 ? ` by ${humanizeMinutes(late)}` : ''}`, body: [t.title, listName].filter(Boolean).join('\n') });
          logKeys.push(key);
        }
      }
    }
  }

  // Daily summary
  const dg = settings.digest;
  const p = tzParts(now, tz);
  const today = keyFromYMD(p.y, p.mo, p.d);
  const digestKey = `digest:${today}`;
  if (dg.enabled && dg.days.includes(p.wd) && !sent.has(digestKey) && !quiet) {
    const nowMin = p.h * 60 + p.mi;
    const at = toMin(dg.time);
    if (nowMin >= at && nowMin - at < MAX_LATE_MIN) {
      const relevant = open.filter((t) => {
        const pr = settings.priorities[t.priority] || settings.priorities[3];
        return pr.notify.digest && t.dueDate && t.dueDate <= today;
      });
      if (relevant.length) {
        relevant.sort((a, b) => a.priority - b.priority);
        const overdue = relevant.filter((t) => t.dueDate < today).length;
        const title = `☀️ Today: ${relevant.length} task${relevant.length > 1 ? 's' : ''}${overdue ? ` (${overdue} overdue)` : ''}`;
        const body = relevant.slice(0, 5).map((t) => `${DOTS[t.priority] || '•'} ${t.title}`).join('\n') +
          (relevant.length > 5 ? `\n+${relevant.length - 5} more` : '');
        items.push({ key: digestKey, tag: 'digest', title, body });
      }
      logKeys.push(digestKey);
    }
  }

  // Too many at once? Bundle them into one.
  if (items.length > 3) {
    const digest = items.find((i) => i.tag === 'digest');
    const rest = items.filter((i) => i !== digest);
    const bundled = {
      key: 'bundle', tag: 'bundle',
      title: `🔔 ${rest.length} reminders`,
      body: rest.slice(0, 6).map((i) => `• ${i.body.split('\n')[0]}`).join('\n') + (rest.length > 6 ? `\n+${rest.length - 6} more` : ''),
    };
    return { items: digest ? [digest, bundled] : [bundled], logKeys };
  }
  return { items, logKeys };
}
