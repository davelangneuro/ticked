import * as store from './store.js';
import { CONFIG } from '../config.js';
import {
  dayKey, addDaysKey, diffDaysKey, weekdayOfKey, parseKey, keyFromYMD, isOverdue, listIsActive,
  describeRecurrence, computeNotifications,
} from './core.js';
import { burst, chime, confetti, flyTo } from './celebrate.js';
import { renderStats, completionIndex, TIERS, tierIndex, levelFor } from './stats.js';

// ---------- helpers ----------

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const S = () => store.getSettings();
const tz = () => store.tz();
const todayKey = () => dayKey(new Date(), tz());

const svg = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
const I = {
  tasks: svg('<path d="M9 6h11M9 12h11M9 18h11"/><path d="M3.5 6l1.2 1.2L7 5M3.5 12l1.2 1.2L7 11M3.5 18l1.2 1.2L7 17"/>'),
  calendar: svg('<rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
  stats: svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  settings: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  clock: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  repeat: svg('<path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/>'),
  note: svg('<path d="M5 4h14v16H5z"/><path d="M8.5 9h7M8.5 13h7M8.5 17h4"/>'),
  sub: svg('<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8.5 12l2.5 2.5 4.5-5"/>'),
  left: svg('<path d="M15 18l-6-6 6-6"/>'),
  right: svg('<path d="M9 18l6-6-6-6"/>'),
  x: svg('<path d="M18 6L6 18M6 6l12 12"/>'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  projects: svg('<path d="M3.5 7.5a2 2 0 0 1 2-2h3.8l2 2.5h7.2a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>'),
  edit: svg('<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>'),
};

const checkSvg = `<svg viewBox="0 0 26 26" aria-hidden="true"><circle class="c-ring" cx="13" cy="13" r="11"/><circle class="c-fill" cx="13" cy="13" r="12"/><path class="c-tick" d="M8.2 13.4l3.2 3.2 6.4-7"/></svg>`;

function fmtTime(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
function fmtKey(k, opts) {
  const { y, m, d } = parseKey(k);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, opts);
}
function dueLabel(t) {
  if (!t.dueDate) return null;
  const today = todayKey();
  const d = diffDaysKey(t.dueDate, today);
  let txt;
  if (d === 0) txt = 'Today';
  else if (d === 1) txt = 'Tomorrow';
  else if (d === -1) txt = 'Yesterday';
  else if (d > 1 && d < 7) txt = fmtKey(t.dueDate, { weekday: 'long' });
  else txt = fmtKey(t.dueDate, { weekday: 'short', day: 'numeric', month: 'short', ...(parseKey(t.dueDate).y !== parseKey(today).y ? { year: 'numeric' } : {}) });
  if (t.dueTime) txt += `, ${fmtTime(t.dueTime)}`;
  const cls = isOverdue(t, new Date(), S(), tz()) ? 'late' : d === 0 ? 'soon' : '';
  return { txt, cls };
}
const listById = (id) => S().lists.find((l) => l.id === id);
const prioName = (p) => S().priorities[p]?.name || '';

// ---------- UI state ----------

// per-device view preferences (grouping, folded project groups)
const prefs = (() => { try { return JSON.parse(localStorage.getItem('ticked.view') || '{}'); } catch { return {}; } })();
const savePrefs = () => {
  try { localStorage.setItem('ticked.view', JSON.stringify({ groupBy: ui.groupBy, collapsed: [...ui.collapsed] })); } catch {}
};

const ui = {
  route: 'tasks',
  list: null, // 'all' | 'now' | list id
  project: 'all', // 'all' | 'none' | project id
  groupBy: prefs.groupBy === 'project' ? 'project' : 'date',
  collapsed: new Set(prefs.collapsed || []), // folded project groups
  showDoneProjects: false,
  showDone: false,
  calMonth: null, // {y, m}
  calSel: null,
  statsRange: 30,
  animating: 0,
  renderPending: false,
  pushSub: false,
  authMsg: '',
};

const hasPush = () => ui.pushSub && !!store.getUser();
const APP_VERSION = 10; // keep in step with CACHE in sw.js

function currentRoute() {
  const r = location.hash.replace('#', '');
  return ['tasks', 'calendar', 'stats', 'settings'].includes(r) ? r : 'tasks';
}

const projects = () => S().projects || [];
const projectById = (id) => (id ? projects().find((p) => p.id === id) : null);

// ---------- shell ----------

const NAV = [
  ['tasks', 'Tasks', I.tasks], ['calendar', 'Calendar', I.calendar], ['stats', 'Stats', I.stats], ['settings', 'Settings', I.settings],
];

function renderShell() {
  const nav = NAV.map(([id, label, icon]) => `<a href="#${id}" class="${ui.route === id ? 'active' : ''}">${icon}<span>${label}</span></a>`).join('');
  $('#side-nav').innerHTML = nav;
  $('#tabbar').innerHTML = nav;

  const open = store.allTasks().filter((t) => !t.completedAt);
  const lists = S().lists.map((l) => {
    const n = open.filter((t) => t.list === l.id).length;
    const active = ui.route === 'tasks' && ui.list === l.id;
    return `<button data-action="pick-list" data-list="${esc(l.id)}" class="${active ? 'active' : ''}"><span>${esc(l.icon)}</span>${esc(l.name)}<span class="count">${n || ''}</span></button>`;
  }).join('');
  $('#side-lists').innerHTML = `<h4>Lists</h4><button data-action="pick-list" data-list="all" class="${ui.route === 'tasks' && ui.list === 'all' ? 'active' : ''}"><span>📋</span>All tasks<span class="count">${open.length || ''}</span></button>${lists}` +
    `<h4 class="side-sub">Projects</h4>` + projects().filter((p) => !p.done).map((p) => {
      const n = open.filter((t) => t.project === p.id).length;
      const active = ui.route === 'tasks' && ui.project === p.id;
      return `<button data-action="pick-project" data-project="${esc(p.id)}" class="${active ? 'active' : ''}"><i class="pdot" style="background:${esc(p.color)}"></i>${esc(p.name)}<span class="count">${n || ''}</span></button>`;
    }).join('') + `<button data-action="new-project"><span class="muted">＋</span>New project</button>`;

  const titles = { tasks: 'Tasks', calendar: 'History', stats: 'Statistics', settings: 'Settings' };
  $('#topbar').innerHTML = `<h1>${esc(titles[ui.route])}</h1>${syncPill()}`;
  $('#fab').style.display = ui.route === 'tasks' || ui.route === 'calendar' ? '' : 'none';
}

function syncPill() {
  const { status } = store.getSyncState();
  const label = { local: 'On this device', 'signed-out': 'Not signed in', syncing: 'Syncing…', synced: 'Synced', offline: 'Offline', error: 'Sync error' }[status];
  return `<a class="sync-pill ${status}" href="#settings" title="Sync status"><i></i>${label}</a>`;
}

// ---------- tasks view ----------

function quickAddForm(placeholder) {
  return `
    <form class="quickadd" id="quickadd" autocomplete="off">
      <div class="quickadd-row">
        <span class="plus">${I.plus.replace('<svg', '<svg width="20" height="20"')}</span>
        <input id="qa-input" placeholder="${esc(placeholder)}" aria-label="Add a task" enterkeyhint="done">
        <button class="btn primary small" type="submit">Add</button>
      </div>
      <div class="qa-preview" id="qa-preview"></div>
      <div class="qa-help">Shortcuts: <b>!1</b>–<b>!4</b> priority · <b>#work</b> list · <b>+project</b> · <b>today</b>, <b>tomorrow</b>, <b>fri</b> · <b>3pm</b> · <b>every week</b></div>
    </form>`;
}

function tasksShell() {
  return `
    <div class="badge-dock"><div class="done-badge t0" id="done-badge" role="status"><span class="db-icon" aria-hidden="true"></span><span class="db-text"><span class="db-num">0</span><span class="db-label">done today</span></span></div></div>
    <section class="hero"><div><h2 id="greet"></h2><p id="hero-date"></p></div></section>
    ${quickAddForm('Add a task…')}
    <div class="chips" id="list-chips"></div>
    <div class="chips" id="project-chips"></div>
    <div id="project-head"></div>
    <div id="task-sections"></div>`;
}

function taskRow(t, { showDate = true, hideProject = false } = {}) {
  const list = listById(t.list);
  const due = showDate ? dueLabel(t) : (t.dueTime ? { txt: fmtTime(t.dueTime), cls: isOverdue(t, new Date(), S(), tz()) ? 'late' : '' } : null);
  const subs = t.subtasks || [];
  const proj = projectById(t.project);
  const meta = [
    due && `<span class="${due.cls}">${I.clock}${esc(due.txt)}</span>`,
    proj && !hideProject && `<span class="proj-tag"><i class="pdot" style="background:${esc(proj.color)}"></i>${esc(proj.name)}</span>`,
    list && ui.list !== list.id && `<span><i class="ldot" style="background:${esc(list.color)}"></i>${esc(list.name)}</span>`,
    t.recurrence && `<span>${I.repeat}${esc(describeRecurrence(t.recurrence))}</span>`,
    subs.length && `<span>${I.sub}${subs.filter((s) => s.done).length}/${subs.length}</span>`,
    t.notes && `<span>${I.note}</span>`,
  ].filter(Boolean).join('');
  return `
    <div class="task p${t.priority || 3} ${t.completedAt ? 'done' : ''}" data-id="${t.id}">
      <button class="check" data-action="check" aria-label="${t.completedAt ? 'Mark not done' : 'Complete'}: ${esc(t.title)}">${checkSvg}</button>
      <div class="task-main" data-action="edit">
        <div class="task-title">${esc(t.title)}</div>
        ${meta ? `<div class="task-meta">${meta}</div>` : ''}
      </div>
      <span class="prio-tag">${esc(prioName(t.priority))}</span>
    </div>`;
}

function sortByPrio(a, b) {
  return (a.priority - b.priority) || (a.dueTime || '99').localeCompare(b.dueTime || '99') || a.createdAt.localeCompare(b.createdAt);
}

/** Does a task pass the current list and project filters? */
function matchesFilters(t, now = new Date()) {
  if (ui.list === 'now') {
    const l = listById(t.list);
    if (l && !listIsActive(l, S(), now, tz())) return false;
  } else if (ui.list !== 'all' && t.list !== ui.list) return false;
  if (ui.project === 'none') return !projectById(t.project);
  if (ui.project !== 'all') return t.project === ui.project;
  return true;
}

function visibleOpenTasks() {
  const now = new Date();
  return store.allTasks().filter((t) => !t.completedAt && matchesFilters(t, now));
}

function projectChips() {
  const shown = projects().filter((p) => !p.done || p.id === ui.project || ui.showDoneProjects);
  const finished = projects().filter((p) => p.done).length;
  return [
    `<div class="seg seg-sm" role="group" aria-label="Group tasks">
      <button class="${ui.groupBy === 'date' ? 'active' : ''}" data-action="group-by" data-v="date" aria-pressed="${ui.groupBy === 'date'}">By date</button>
      <button class="${ui.groupBy === 'project' ? 'active' : ''}" data-action="group-by" data-v="project" aria-pressed="${ui.groupBy === 'project'}">By project</button></div>`,
    projects().length ? `<button class="chip ${ui.project === 'all' ? 'active' : ''}" data-action="pick-project" data-project="all">All projects</button>` : '',
    ...shown.map((p) => `<button class="chip ${ui.project === p.id ? 'active' : ''} ${p.done ? 'is-done' : ''}" data-action="pick-project" data-project="${esc(p.id)}"><i class="pdot" style="background:${esc(p.color)}"></i>${esc(p.name)}</button>`),
    projects().length ? `<button class="chip ${ui.project === 'none' ? 'active' : ''}" data-action="pick-project" data-project="none">No project</button>` : '',
    finished ? `<button class="chip ghost" data-action="toggle-done-projects">${ui.showDoneProjects ? 'Hide completed' : `Completed (${finished})`}</button>` : '',
    `<button class="chip ghost" data-action="new-project">＋ Project</button>`,
  ].join('');
}

/** Header card shown when one project is selected: progress and actions. */
function projectHead(p) {
  const s = projectStats(p);
  const list = listById(p.list);
  return `<div class="proj-head card" style="--pc:${esc(p.color)}">
    <div class="proj-title"><i class="pdot big"></i><h2>${esc(p.name)}</h2>
      <button class="icon-btn" data-action="edit-project" data-project="${esc(p.id)}" aria-label="Edit project">${I.edit}</button></div>
    <div class="proj-sub">${list ? `${esc(list.icon)} ${esc(list.name)} · ` : ''}${s.done} of ${s.total} done${p.done ? ' · completed' : ''}</div>
    <div class="proj-bar big"><i style="width:${pct(s)}%"></i></div>
    <div class="row">
      <button class="btn small" data-action="assign-existing" data-project="${esc(p.id)}">${I.plus.replace('<svg', '<svg width="15" height="15"')} Add existing tasks</button>
      ${!p.done && s.total && !s.open ? `<button class="btn small" data-action="complete-project" data-project="${esc(p.id)}">Mark project complete</button>` : ''}
    </div>
  </div>`;
}

/** "By project" layout: one foldable group per project, then tasks without one. */
/** 0 = overdue, 1 = has a date, 2 = no date. */
function dueRank(t, now) {
  return isOverdue(t, now, S(), tz()) ? 0 : t.dueDate ? 1 : 2;
}

function projectGroupsHtml(tasks, pinned = []) {
  const now = new Date();
  const order = (a, b) => dueRank(a, now) - dueRank(b, now) || (a.dueDate || '').localeCompare(b.dueDate || '') || sortByPrio(a, b);
  const showEmpty = ui.list === 'all' && ui.project === 'all';
  const groups = projects()
    .filter((p) => (ui.project === 'all' || ui.project === p.id) && (!p.done || ui.project === p.id))
    .map((p) => ({ id: p.id, p, items: tasks.filter((t) => t.project === p.id) }))
    .filter((g) => g.items.length || showEmpty || ui.project === g.id);
  const loose = tasks.filter((t) => !projectById(t.project));
  if (loose.length) groups.push({ id: 'none', p: null, items: loose });

  return groups.map(({ id, p, items }) => {
    const folded = ui.collapsed.has(id);
    const s = p && projectStats(p);
    const body = folded ? '' : items.length
      ? `<div class="task-list">${items.sort(order).map((t) => taskRow(t, { hideProject: true })).join('')}</div>`
      : pinned.some((t) => t.project === id)
        ? `<div class="group-empty">Its urgent &amp; high tasks are pinned at the top</div>`
        : `<div class="group-empty">No open tasks · <button data-action="assign-existing" data-project="${esc(id)}">Add existing</button></div>`;
    return `<section class="section pgroup ${folded ? 'folded' : ''}" style="--pc:${p ? esc(p.color) : 'var(--ink-3)'}">
      <div class="group-head">
        <button class="group-toggle" data-action="toggle-group" data-group="${esc(id)}" aria-expanded="${!folded}">
          <span class="chev">${I.right}</span><i class="pdot"></i><h3>${p ? esc(p.name) : 'No project'}</h3><span class="n">${items.length}</span>
        </button>
        ${p ? `<span class="group-prog" title="${s.done} of ${s.total} done"><i style="width:${pct(s)}%"></i></span>
          <button class="icon-btn small" data-action="pick-project" data-project="${esc(id)}" aria-label="Open ${esc(p.name)}">${I.right}</button>` : ''}
      </div>
      ${body}
    </section>`;
  }).join('');
}

function updateTasks() {
  const now = new Date();
  const today = todayKey();
  const h = now.getHours();
  $('#greet').textContent = h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  $('#hero-date').textContent = now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  const doneToday = store.allTasks().filter((t) => t.completedAt && dayKey(new Date(t.completedAt), tz()) === today);
  setBadge(doneToday.length);

  // list chips
  const hasSchedules = S().lists.some((l) => l.active !== 'always');
  const chips = [
    `<button class="chip ${ui.list === 'all' ? 'active' : ''}" data-action="pick-list" data-list="all">All</button>`,
    hasSchedules ? `<button class="chip ${ui.list === 'now' ? 'active' : ''}" data-action="pick-list" data-list="now" title="Only lists that are active right now (based on your working hours)">⏱ Right now</button>` : '',
    ...S().lists.map((l) => `<button class="chip ${ui.list === l.id ? 'active' : ''}" data-action="pick-list" data-list="${esc(l.id)}"><i class="dot" style="background:${esc(l.color)}"></i>${esc(l.name)}</button>`),
  ];
  $('#list-chips').innerHTML = chips.join('');

  if (ui.project !== 'all' && ui.project !== 'none' && !projectById(ui.project)) ui.project = 'all'; // deleted elsewhere
  $('#project-chips').innerHTML = projectChips();
  const selected = projectById(ui.project);
  $('#project-head').innerHTML = selected ? projectHead(selected) : '';
  $('#qa-input').placeholder = selected ? `Add a task to ${selected.name}…` : 'Add a task…';

  const tasks = visibleOpenTasks();
  // Urgent & High sit in their own section above everything, in both layouts
  const pinned = S().pinPriority ? tasks.filter((t) => t.priority <= 2) : [];
  const rest = pinned.length ? tasks.filter((t) => t.priority > 2) : tasks;
  pinned.sort((a, b) => a.priority - b.priority || dueRank(a, now) - dueRank(b, now) || (a.dueDate || '').localeCompare(b.dueDate || '') || sortByPrio(a, b));
  const tomorrow = addDaysKey(today, 1);
  const groups = { overdue: [], today: [], tomorrow: [], upcoming: [], anytime: [] };
  for (const t of rest) {
    if (isOverdue(t, now, S(), tz())) groups.overdue.push(t);
    else if (!t.dueDate) groups.anytime.push(t);
    else if (t.dueDate <= today) groups.today.push(t);
    else if (t.dueDate === tomorrow) groups.tomorrow.push(t);
    else groups.upcoming.push(t);
  }
  groups.overdue.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || sortByPrio(a, b));
  groups.today.sort(sortByPrio);
  groups.tomorrow.sort(sortByPrio);
  groups.upcoming.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || sortByPrio(a, b));
  groups.anytime.sort(sortByPrio);

  const section = (key, title, items, opts) => items.length ? `
    <section class="section ${key}">
      <div class="section-head"><h3>${title}</h3><span class="n">${items.length}</span></div>
      <div class="task-list">${items.map((t) => taskRow(t, opts)).join('')}</div>
    </section>` : '';

  const hideProject = ui.project !== 'all';
  let html = section('pinned', 'Urgent &amp; high', pinned, { hideProject }) + (ui.groupBy === 'project' ? projectGroupsHtml(rest, pinned) :
    section('overdue', 'Overdue', groups.overdue, { hideProject }) +
    section('today', 'Today', groups.today, { showDate: false, hideProject }) +
    section('tomorrow', 'Tomorrow', groups.tomorrow, { showDate: false, hideProject }) +
    section('upcoming', 'Upcoming', groups.upcoming, { hideProject }) +
    section('anytime', 'Anytime', groups.anytime, { hideProject }));

  if (!tasks.length && ui.project !== 'all') {
    html = `<div class="empty"><h3>No open tasks here</h3><p>Add one above${selected ? ' or pull in existing ones with “Add existing tasks”' : ''}.</p></div>`;
  } else if (!html.trim()) {
    html = doneToday.length
      ? `<div class="empty"><div class="art">🌿</div><h3>All clear</h3><p>You finished ${doneToday.length} task${doneToday.length > 1 ? 's' : ''} today. Nice work.</p></div>`
      : `<div class="empty"><div class="art">✨</div><h3>Nothing here yet</h3><p>Add your first task above. Try “Send report fri 3pm !1 #work”.</p></div>`;
  }

  const doneHere = doneToday.filter((t) => matchesFilters(t))
    .sort((a, b) => b.completedAt.localeCompare(a.completedAt));
  if (doneHere.length) {
    html += `<section class="section donetoday">
      <div class="section-head"><h3>Done today</h3><span class="n">${doneHere.length}</span>
        <button data-action="toggle-done">${ui.showDone ? 'Hide' : 'Show'}</button></div>
      ${ui.showDone ? `<div class="task-list">${doneHere.map((t) => taskRow(t)).join('')}</div>` : ''}
    </section>`;
  }
  $('#task-sections').innerHTML = html;
}

// ---------- quick add parsing ----------

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function parseQuick(text) {
  let s = ` ${text} `;
  const out = { tags: [] };
  const take = (re, fn) => {
    const m = s.match(re);
    if (m) { if (fn(m) !== false) s = s.replace(m[0], ' '); }
  };
  const today = todayKey();
  const pr = S().priorities;

  take(/\s!([1-4])(?=\s)/, (m) => { out.priority = +m[1]; });
  if (!out.priority) {
    take(/\s!(\w+)(?=\s)/, (m) => {
      const p = Object.keys(pr).find((k) => pr[k].name.toLowerCase() === m[1].toLowerCase());
      if (!p) return false;
      out.priority = +p;
    });
  }
  take(/\s\+([^\s+]+)(?=\s)/, (m) => {
    const tok = m[1].toLowerCase();
    const compact = (x) => x.toLowerCase().replace(/\s+/g, '');
    const open = projects().filter((p) => !p.done);
    const p = open.find((x) => compact(x.name) === tok) || open.find((x) => compact(x.name).startsWith(tok));
    if (!p) return false;
    out.project = p.id;
  });
  take(/\s#([^\s#]+)(?=\s)/, (m) => {
    const l = S().lists.find((x) => x.name.toLowerCase() === m[1].toLowerCase() || x.id === m[1].toLowerCase());
    if (!l) return false;
    out.list = l.id;
  });
  take(/\s(every\s+weekday|every\s+day|daily|every\s+week|weekly|every\s+month|monthly|every\s+year|yearly)(?=\s)/i, (m) => {
    const w = m[1].toLowerCase();
    out.recurrence = { freq: w.includes('weekday') ? 'weekday' : /day|daily/.test(w) ? 'day' : /week/.test(w) ? 'week' : /month/.test(w) ? 'month' : 'year', interval: 1 };
  });
  take(/\s(today|tonight|tomorrow|tmrw|next week)(?=\s)/i, (m) => {
    const w = m[1].toLowerCase();
    out.dueDate = w === 'today' || w === 'tonight' ? today : w === 'next week' ? addDaysKey(today, 7) : addDaysKey(today, 1);
    if (w === 'tonight') out.dueTime = '20:00';
  });
  if (!out.dueDate) {
    take(/\s(?:on\s+)?(mon|tue|wed|thu|fri|sat|sun)[a-z]*(?=\s)/i, (m) => {
      const target = WEEKDAYS.indexOf(m[1].toLowerCase());
      let k = addDaysKey(today, 1);
      while (weekdayOfKey(k) !== target) k = addDaysKey(k, 1);
      out.dueDate = k;
    });
  }
  take(/\s(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)(?=\s)/i, (m) => {
    let h = +m[1] % 12; if (m[3].toLowerCase() === 'pm') h += 12;
    out.dueTime = `${String(h).padStart(2, '0')}:${m[2] || '00'}`;
  });
  if (!out.dueTime) {
    take(/\s(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)(?=\s)/, (m) => { out.dueTime = `${m[1].padStart(2, '0')}:${m[2]}`; });
  }
  if (out.dueTime && !out.dueDate) out.dueDate = today;
  if (out.recurrence && !out.dueDate) out.dueDate = today;
  out.title = s.replace(/\s+/g, ' ').trim();

  if (out.priority) out.tags.push(`● ${prioName(out.priority)}`);
  if (out.list) out.tags.push(`${listById(out.list).icon} ${listById(out.list).name}`);
  if (out.project) out.tags.push(`▸ ${projectById(out.project).name}`);
  if (out.dueDate) out.tags.push(`📅 ${dueLabel({ dueDate: out.dueDate, dueTime: out.dueTime }).txt}`);
  if (out.recurrence) out.tags.push(`↻ ${describeRecurrence(out.recurrence)}`);
  return out;
}

function defaultListForNew() {
  if (ui.list && ui.list !== 'all' && ui.list !== 'now') return ui.list;
  const now = new Date();
  const active = S().lists.find((l) => l.active !== 'always' && listIsActive(l, S(), now, tz()));
  return (active || S().lists[0])?.id || null;
}

// ---------- completing ----------

function doneTodayCount() {
  const today = todayKey();
  return store.allTasks().filter((t) => t.completedAt && dayKey(new Date(t.completedAt), tz()) === today).length;
}

/** The "done today" counter; its icon and colours level up as the day goes on. */
function setBadge(n, { animate = false } = {}) {
  const el = $('#done-badge');
  if (!el) return;
  const ti = tierIndex(n), tier = TIERS[ti];
  const prevTier = +(el.dataset.tier ?? ti);
  const num = $('.db-num', el), icon = $('.db-icon', el);
  if (num.textContent !== String(n)) num.textContent = n;
  if (icon.dataset.t !== String(ti)) {
    icon.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${tier.icon}</svg>`;
    icon.dataset.t = ti;
  }
  TIERS.forEach((_, i) => el.classList.toggle(`t${i}`, i === ti));
  el.dataset.tier = ti;
  el.title = `${n} done today · ${tier.label}`;
  if (!animate) return;
  el.classList.remove('pop');
  void el.offsetWidth; // restart the animation
  el.classList.add('pop');
  if (ti > prevTier) {
    icon.classList.remove('swap');
    void icon.offsetWidth;
    icon.classList.add('swap');
  }
  const plus = document.createElement('span');
  plus.className = 'plus-one';
  plus.textContent = '+1';
  el.appendChild(plus);
  setTimeout(() => plus.remove(), 1000);
  burst(icon, ti > prevTier ? 'var(--p2)' : 'var(--accent)');
}

function onCheck(id, btn) {
  const t = store.getTask(id);
  if (!t) return;
  const row = btn.closest('.task');
  if (t.completedAt) {
    store.uncompleteTask(id);
    toast('Moved back to your list');
    return;
  }
  if (row.classList.contains('completing')) return;
  row.classList.add('completing');
  ui.animating++;
  const color = getComputedStyle(row).getPropertyValue('--pc').trim();
  setTimeout(() => burst(btn, color), 140);
  const after = doneTodayCount() + 1;
  const tierUp = tierIndex(after) > tierIndex(after - 1);
  if (S().sound) chime(tierUp && after >= 5);
  if (navigator.vibrate) navigator.vibrate(12);
  // a little dot flies from the check circle into the counter, which then pops
  setTimeout(() => flyTo(btn, $('#done-badge .db-num'), color, () => setBadge(after, { animate: true })), 180);

  setTimeout(() => row.classList.add('leaving'), 640);
  setTimeout(() => {
    ui.animating--;
    store.completeTask(id);
    const openLeft = visibleOpenTasks().filter((x) => x.dueDate && x.dueDate <= todayKey()).length;
    if (tierUp) {
      const tier = TIERS[tierIndex(after)];
      if (after >= 5 && S().confetti) confetti();
      toast(`${tier.label}! ${after} done today`, 'Undo', () => store.uncompleteTask(id));
    } else if (openLeft === 0 && t.dueDate && t.dueDate <= todayKey()) {
      if (S().confetti) confetti();
      toast('🌿 Everything due today is done!', 'Undo', () => store.uncompleteTask(id));
    } else {
      toast(`Done: ${t.title.length > 34 ? t.title.slice(0, 32) + '…' : t.title}`, 'Undo', () => store.uncompleteTask(id));
    }
    if (ui.renderPending) render();
  }, 1000);
}

// ---------- toast ----------

function toast(msg, actionLabel, onAction) {
  const root = $('#toast-root');
  root.innerHTML = '';
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span>${esc(msg)}</span>${actionLabel ? `<button>${esc(actionLabel)}</button>` : ''}`;
  root.appendChild(el);
  const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 250); };
  if (actionLabel) $('button', el).onclick = () => { onAction(); close(); };
  setTimeout(close, actionLabel ? 5000 : 2600);
}

// ---------- editor sheet ----------

function openSheet(html, onMount) {
  const root = $('#sheet-root');
  root.innerHTML = `<div class="sheet-backdrop"><div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div></div>`;
  const back = $('.sheet-backdrop', root);
  back.addEventListener('mousedown', (e) => { if (e.target === back) closeSheet(); });
  onMount($('.sheet', root));
}
function closeSheet() {
  const back = $('.sheet-backdrop');
  if (!back) return;
  back.classList.add('closing');
  setTimeout(() => { $('#sheet-root').innerHTML = ''; if (ui.renderPending) render(); }, 190);
}

function openEditor(id, preset = {}) {
  const existing = id ? store.getTask(id) : null;
  const d = structuredClone(existing || {
    title: '', notes: '', priority: 3, list: defaultListForNew(), dueDate: null, dueTime: null, recurrence: null, subtasks: [], ...preset,
  });
  const today = todayKey();
  const nextMon = (() => { let k = addDaysKey(today, 1); while (weekdayOfKey(k) !== 1) k = addDaysKey(k, 1); return k; })();

  const body = () => `
    <input class="ed-title" id="ed-title" placeholder="What needs doing?" value="${esc(d.title)}" aria-label="Title">
    <textarea class="ed-notes" id="ed-notes" placeholder="Notes" rows="2">${esc(d.notes)}</textarea>
    <div class="field"><span class="field-label">Priority</span>
      <div class="prio-pick">${[1, 2, 3, 4].map((p) => `<button type="button" data-p="${p}" class="${d.priority === p ? 'active' : ''}" style="color:var(--p${p})"><i style="background:var(--p${p})"></i><span style="color:var(--ink)">${esc(prioName(p))}</span></button>`).join('')}</div>
    </div>
    <div class="field"><span class="field-label">List</span>
      <div class="chips" style="flex-wrap:wrap">${S().lists.map((l) => `<button type="button" class="chip ${d.list === l.id ? 'active' : ''}" data-l="${esc(l.id)}"><i class="dot" style="background:${esc(l.color)}"></i>${esc(l.name)}</button>`).join('')}</div>
    </div>
    ${projects().length ? `<div class="field"><span class="field-label">Project</span>
      <div class="chips" style="flex-wrap:wrap"><button type="button" class="chip ${!d.project ? 'active' : ''}" data-pj="">None</button>${projects().filter((p) => !p.done || p.id === d.project).map((p) => `<button type="button" class="chip ${d.project === p.id ? 'active' : ''}" data-pj="${esc(p.id)}"><i class="pdot" style="background:${esc(p.color)}"></i>${esc(p.name)}</button>`).join('')}</div>
    </div>` : ''}
    <div class="field"><span class="field-label">Due</span>
      <div class="row">
        <input type="date" id="ed-date" value="${d.dueDate || ''}" aria-label="Due date">
        <input type="time" id="ed-time" value="${d.dueTime || ''}" aria-label="Due time" ${d.dueDate ? '' : 'disabled'}>
      </div>
      <div class="row" style="margin-top:8px">
        <button type="button" class="btn small" data-date="${today}">Today</button>
        <button type="button" class="btn small" data-date="${addDaysKey(today, 1)}">Tomorrow</button>
        <button type="button" class="btn small" data-date="${nextMon}">Next Monday</button>
        ${d.dueDate ? '<button type="button" class="btn small" data-date="">No date</button>' : ''}
      </div>
    </div>
    <div class="field"><span class="field-label">Repeat</span>
      <div class="row">
        <select id="ed-freq" aria-label="Repeat">
          ${[['', 'Does not repeat'], ['day', 'Daily'], ['weekday', 'Every weekday'], ['week', 'Weekly'], ['month', 'Monthly'], ['year', 'Yearly']].map(([v, l]) => `<option value="${v}" ${(d.recurrence?.freq || '') === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
        ${d.recurrence && d.recurrence.freq !== 'weekday' ? `<span class="muted">every</span><input type="number" id="ed-int" min="1" max="99" value="${d.recurrence.interval || 1}" style="width:70px" aria-label="Interval"><span class="muted">${{ day: 'day(s)', week: 'week(s)', month: 'month(s)', year: 'year(s)' }[d.recurrence.freq]}</span>` : ''}
      </div>
    </div>
    <div class="field"><span class="field-label">Subtasks</span>
      <div class="subtasks">
        ${(d.subtasks || []).map((s, i) => `<div class="subtask ${s.done ? 'done' : ''}"><input type="checkbox" data-si="${i}" ${s.done ? 'checked' : ''} aria-label="Subtask done"><input type="text" data-st="${i}" value="${esc(s.title)}" aria-label="Subtask"><button type="button" class="icon-btn" data-sx="${i}" aria-label="Remove subtask">${I.x}</button></div>`).join('')}
        <div class="subtask"><span style="width:18px;color:var(--ink-3)">${I.plus.replace('<svg', '<svg width="18" height="18"')}</span><input type="text" id="ed-newsub" placeholder="Add a subtask" aria-label="New subtask"></div>
      </div>
    </div>
    <div class="sheet-actions">
      ${existing ? `<button type="button" class="icon-btn" id="ed-del" title="Delete" aria-label="Delete task">${I.trash}</button>` : ''}
      ${existing && !existing.completedAt ? '<button type="button" class="btn small" id="ed-done">Mark done</button>' : ''}
      <span class="spacer"></span>
      <button type="button" class="btn" id="ed-cancel">Cancel</button>
      <button type="button" class="btn primary" id="ed-save">${existing ? 'Save' : 'Add task'}</button>
    </div>`;

  // keep text fields in the draft before re-rendering the sheet
  const capture = (sheet) => {
    d.title = $('#ed-title', sheet).value;
    d.notes = $('#ed-notes', sheet).value;
    d.dueDate = $('#ed-date', sheet).value || null;
    d.dueTime = d.dueDate ? ($('#ed-time', sheet).value || null) : null;
    $$('[data-st]', sheet).forEach((el) => { d.subtasks[+el.dataset.st].title = el.value; });
    const ni = $('#ed-int', sheet);
    if (ni && d.recurrence) d.recurrence.interval = Math.max(1, +ni.value || 1);
  };

  openSheet(body(), (sheet) => {
    const rerender = (focusSel) => {
      capture(sheet);
      const keep = sheet.querySelector('.grab').outerHTML;
      sheet.innerHTML = keep + body();
      if (focusSel) $(focusSel, sheet)?.focus();
    };
    if (!existing) setTimeout(() => $('#ed-title', sheet).focus(), 60);

    sheet.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.p) { d.priority = +b.dataset.p; rerender(); }
      else if (b.dataset.l) { d.list = b.dataset.l; rerender(); }
      else if ('pj' in b.dataset) {
        capture(sheet);
        d.project = b.dataset.pj || null;
        const p = projectById(d.project);
        if (p?.list) d.list = p.list;
        rerender();
      }
      else if ('date' in b.dataset) { capture(sheet); d.dueDate = b.dataset.date || null; if (!d.dueDate) d.dueTime = null; sheet.querySelector('#ed-date').value = d.dueDate || ''; rerender(); }
      else if (b.dataset.sx) { capture(sheet); d.subtasks.splice(+b.dataset.sx, 1); rerender(); }
      else if (b.id === 'ed-cancel') closeSheet();
      else if (b.id === 'ed-del') {
        store.deleteTask(id); closeSheet();
        toast('Task deleted', 'Undo', () => store.restoreTask(id));
      } else if (b.id === 'ed-done') {
        capture(sheet); save(); store.completeTask(id); closeSheet();
        if (S().sound) chime();
        toast('Done ✓', 'Undo', () => store.uncompleteTask(id));
      } else if (b.id === 'ed-save') { capture(sheet); if (save()) closeSheet(); }
    });
    sheet.addEventListener('change', (e) => {
      if (e.target.id === 'ed-date') { rerender(); }
      else if (e.target.id === 'ed-freq') {
        capture(sheet);
        const f = e.target.value;
        d.recurrence = f ? { freq: f, interval: d.recurrence?.interval || 1 } : null;
        if (f && !d.dueDate) d.dueDate = today;
        rerender();
      } else if (e.target.dataset.si) { capture(sheet); d.subtasks[+e.target.dataset.si].done = e.target.checked; rerender(); }
    });
    sheet.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.id === 'ed-newsub') {
        e.preventDefault();
        const v = e.target.value.trim();
        if (v) { capture(sheet); d.subtasks.push({ id: Math.random().toString(36).slice(2, 9), title: v, done: false }); rerender('#ed-newsub'); }
      } else if (e.key === 'Enter' && e.target.id === 'ed-title') {
        e.preventDefault(); capture(sheet); if (save()) closeSheet();
      }
    });
  });

  function save() {
    const title = d.title.trim();
    if (!title) { $('#ed-title')?.focus(); return false; }
    const pending = $('#ed-newsub')?.value.trim();
    if (pending) d.subtasks.push({ id: Math.random().toString(36).slice(2, 9), title: pending, done: false });
    const fields = {
      title, notes: d.notes.trim(), priority: d.priority, list: d.list, dueDate: d.dueDate, dueTime: d.dueDate ? d.dueTime : null,
      recurrence: d.recurrence, subtasks: d.subtasks.filter((s) => s.title.trim()), project: d.project || null,
    };
    if (existing) store.updateTask(id, fields);
    else { store.createTask(fields); toast('Task added'); }
    return true;
  }
}

// ---------- projects ----------

function projectStats(p) {
  const tasks = store.allTasks().filter((t) => t.project === p.id);
  const open = tasks.filter((t) => !t.completedAt);
  const now = new Date();
  return {
    total: tasks.length,
    done: tasks.length - open.length,
    open: open.length,
    overdue: open.filter((t) => isOverdue(t, now, S(), tz())).length,
    next: open.filter((t) => t.dueDate).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0],
  };
}

const pct = (s) => (s.total ? Math.round((s.done / s.total) * 100) : 0);

/** Checklist of open tasks to pull into a project. */
function openAssignPicker(pid) {
  const p = projectById(pid);
  if (!p) return;
  const candidates = store.allTasks().filter((t) => !t.completedAt && t.project !== pid)
    .sort((a, b) => (a.dueDate || '9').localeCompare(b.dueDate || '9') || sortByPrio(a, b));
  const chosen = new Set();
  let q = '';
  const rows = () => {
    const found = candidates.filter((t) => t.title.toLowerCase().includes(q));
    if (!found.length) return `<p class="muted" style="padding:14px 4px">${candidates.length ? 'No matching tasks.' : 'All your open tasks are already in this project.'}</p>`;
    return found.map((t) => {
      const cur = projectById(t.project), due = dueLabel(t), list = listById(t.list);
      const meta = [due && esc(due.txt), cur && `in ${esc(cur.name)}`, list && esc(list.name)].filter(Boolean).join(' · ');
      return `<label class="pick-row p${t.priority || 3}"><input type="checkbox" data-pick="${t.id}" ${chosen.has(t.id) ? 'checked' : ''}>
        <span class="pick-main"><span class="pick-title">${esc(t.title)}</span>${meta ? `<span class="pick-meta">${meta}</span>` : ''}</span></label>`;
    }).join('');
  };
  openSheet(`
    <h3 class="sheet-title">Add tasks to <span style="color:${esc(p.color)}">${esc(p.name)}</span></h3>
    <input type="search" id="pick-q" placeholder="Search your tasks" aria-label="Search tasks" style="width:100%;margin-top:12px">
    <div class="pick-list" id="pick-list">${rows()}</div>
    <div class="sheet-actions"><span class="spacer"></span>
      <button type="button" class="btn" id="pick-cancel">Cancel</button>
      <button type="button" class="btn primary" id="pick-save" disabled>Add tasks</button></div>`, (sheet) => {
    const btn = $('#pick-save', sheet);
    const sync = () => {
      btn.disabled = !chosen.size;
      btn.textContent = chosen.size ? `Add ${chosen.size} task${chosen.size > 1 ? 's' : ''}` : 'Add tasks';
    };
    sheet.addEventListener('input', (e) => {
      if (e.target.id !== 'pick-q') return;
      q = e.target.value.trim().toLowerCase();
      $('#pick-list', sheet).innerHTML = rows();
    });
    sheet.addEventListener('change', (e) => {
      const id = e.target.dataset.pick;
      if (!id) return;
      if (e.target.checked) chosen.add(id); else chosen.delete(id);
      sync();
    });
    sheet.addEventListener('click', (e) => {
      if (e.target.id === 'pick-cancel') closeSheet();
      else if (e.target.id === 'pick-save') {
        chosen.forEach((id) => store.updateTask(id, { project: pid }));
        closeSheet();
        toast(`Added ${chosen.size} task${chosen.size > 1 ? 's' : ''} to ${p.name}`);
      }
    });
  });
}

function openProjectEditor(id) {
  const existing = projectById(id);
  const d = existing ? { ...existing } : { name: '', color: SWATCHES[projects().length % SWATCHES.length], list: null };
  const body = () => `
    <input class="ed-title" id="pj-name" placeholder="Project name" value="${esc(d.name)}" maxlength="40" aria-label="Project name">
    <div class="field"><span class="field-label">Colour</span>
      <div class="swatches">${SWATCHES.map((c) => `<button type="button" class="${d.color === c ? 'on' : ''}" style="background:${c}" data-c="${c}" aria-label="Colour ${c}"></button>`).join('')}</div>
    </div>
    <div class="field"><span class="field-label">List</span>
      <div class="chips" style="flex-wrap:wrap"><button type="button" class="chip ${!d.list ? 'active' : ''}" data-l="">Any list</button>${S().lists.map((l) => `<button type="button" class="chip ${d.list === l.id ? 'active' : ''}" data-l="${esc(l.id)}"><i class="dot" style="background:${esc(l.color)}"></i>${esc(l.name)}</button>`).join('')}</div>
      <p class="muted" style="font-size:12.5px;margin:6px 2px 0">New tasks in this project go to this list.</p>
    </div>
    <div class="sheet-actions">
      ${existing ? `<button type="button" class="icon-btn" id="pj-del" title="Delete project" aria-label="Delete project">${I.trash}</button>
        <button type="button" class="btn small" id="pj-done">${existing.done ? 'Reopen' : 'Mark complete'}</button>` : ''}
      <span class="spacer"></span>
      <button type="button" class="btn" id="pj-cancel">Cancel</button>
      <button type="button" class="btn primary" id="pj-save">${existing ? 'Save' : 'Create project'}</button>
    </div>`;

  openSheet(body(), (sheet) => {
    const rerender = () => {
      d.name = $('#pj-name', sheet).value;
      sheet.innerHTML = sheet.querySelector('.grab').outerHTML + body();
    };
    if (!existing) setTimeout(() => $('#pj-name', sheet).focus(), 60);

    const save = () => {
      d.name = $('#pj-name', sheet).value.trim();
      if (!d.name) { $('#pj-name', sheet).focus(); return; }
      if (existing) {
        store.updateSettings((s) => { Object.assign(s.projects.find((x) => x.id === id), { name: d.name, color: d.color, list: d.list }); });
        closeSheet();
        return;
      }
      const pid = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      store.updateSettings((s) => {
        s.projects = [...(s.projects || []), { id: pid, name: d.name, color: d.color, list: d.list, done: false, createdAt: new Date().toISOString() }];
      });
      ui.project = pid;
      closeSheet();
      if (ui.route !== 'tasks') location.hash = 'tasks';
    };

    sheet.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.c) { d.color = b.dataset.c; rerender(); }
      else if ('l' in b.dataset) { d.list = b.dataset.l || null; rerender(); }
      else if (b.id === 'pj-cancel') closeSheet();
      else if (b.id === 'pj-save') save();
      else if (b.id === 'pj-done') {
        store.updateSettings((s) => { const p = s.projects.find((x) => x.id === id); p.done = !p.done; });
        closeSheet();
        if (existing.done) toast('Project reopened');
        else {
          if (S().confetti) confetti();
          toast(`Project “${existing.name}” completed`);
        }
      } else if (b.id === 'pj-del') {
        const n = store.allTasks().filter((t) => t.project === id).length;
        if (!confirm(`Delete the project “${existing.name}”?${n ? ` Its ${n} task${n > 1 ? 's' : ''} stay in your lists, just without a project.` : ''}`)) return;
        store.allTasks().filter((t) => t.project === id).forEach((t) => store.updateTask(t.id, { project: null }));
        store.updateSettings((s) => { s.projects = s.projects.filter((x) => x.id !== id); });
        if (ui.project === id) ui.project = 'all';
        closeSheet();
      }
    });
    sheet.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.id === 'pj-name') { e.preventDefault(); save(); }
    });
  });
}

// ---------- calendar ----------

function calendarShell() {
  return `
    <div class="cal-head">
      <h2 id="cal-title"></h2>
      <button class="btn small" data-action="cal-today">Today</button>
      <button class="icon-btn" data-action="cal-prev" aria-label="Previous month">${I.left}</button>
      <button class="icon-btn" data-action="cal-next" aria-label="Next month">${I.right}</button>
    </div>
    <div class="cal card" id="cal"></div>
    <div class="day-detail" id="day-detail"></div>`;
}

function updateCalendar() {
  const today = todayKey();
  if (!ui.calMonth) { const p = parseKey(today); ui.calMonth = { y: p.y, m: p.m }; }
  if (!ui.calSel) ui.calSel = today;
  const { y, m } = ui.calMonth;
  $('#cal-title').textContent = new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  const tasks = store.allTasks();
  const byDay = completionIndex(tasks, tz());
  const dueByDay = new Map();
  for (const t of tasks) if (t.dueDate && !t.completedAt) dueByDay.set(t.dueDate, (dueByDay.get(t.dueDate) || 0) + 1);

  const first = keyFromYMD(y, m, 1);
  let start = addDaysKey(first, -((weekdayOfKey(first) + 6) % 7));
  let cells = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((w) => `<div class="cal-wd">${w}</div>`).join('');
  for (let i = 0; i < 42; i++) {
    const k = addDaysKey(start, i);
    const p = parseKey(k);
    if (i >= 35 && p.m !== m) break;
    const n = byDay.get(k)?.total || 0;
    const lvl = levelFor(n);
    const cls = ['cal-day', p.m !== m && 'out', lvl && `l${lvl}`, k === today && 'today', k === ui.calSel && 'sel'].filter(Boolean).join(' ');
    const label = `${fmtKey(k, { weekday: 'long', day: 'numeric', month: 'long' })}: ${n} done${dueByDay.get(k) ? `, ${dueByDay.get(k)} due` : ''}`;
    cells += `<button class="${cls}" data-action="cal-pick" data-key="${k}" aria-label="${esc(label)}">${p.d}${n ? `<span class="cnt">${n}✓</span>` : ''}${dueByDay.get(k) ? '<i class="due-dot"></i>' : ''}</button>`;
  }
  $('#cal').innerHTML = `<div class="cal-grid">${cells}</div>
    <div class="cal-legend"><span style="margin-right:auto"><i class="due-dot" style="position:static;display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--ink-3);vertical-align:middle"></i> tasks due</span>Less <i style="background:var(--heat-0)"></i><i style="background:var(--heat-1)"></i><i style="background:var(--heat-2)"></i><i style="background:var(--heat-3)"></i><i style="background:var(--heat-4)"></i> More done</div>`;

  // day detail
  const k = ui.calSel;
  const done = (byDay.get(k)?.tasks || []).slice().sort((a, b) => a.completedAt.localeCompare(b.completedAt));
  const due = tasks.filter((t) => !t.completedAt && t.dueDate === k).sort(sortByPrio);
  const created = tasks.filter((t) => dayKey(new Date(t.createdAt), tz()) === k).length;
  const urgent = done.filter((t) => t.priority === 1).length;
  const rel = k === today ? 'Today' : k === addDaysKey(today, -1) ? 'Yesterday' : k === addDaysKey(today, 1) ? 'Tomorrow' : '';
  const summary = [
    `${done.length} completed`,
    urgent && `${urgent} ${prioName(1).toLowerCase()}`,
    created && `${created} added`,
  ].filter(Boolean).join(' · ');

  const doneRows = done.map((t) => {
    const time = new Date(t.completedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return taskRow(t).replace('<div class="task-main"', `<span class="time">${time}</span><div class="task-main"`);
  }).join('');

  $('#day-detail').innerHTML = `
    <h3>${rel ? `${rel}, ` : ''}${esc(fmtKey(k, { weekday: rel ? undefined : 'long', day: 'numeric', month: 'long', year: parseKey(k).y !== parseKey(today).y ? 'numeric' : undefined }))}</h3>
    <div class="day-summary">${summary}</div>
    ${done.length ? `<div class="task-list history-list">${doneRows}</div>` : `<div class="empty" style="padding:22px 0"><p>${k > today ? 'Nothing done yet — this day is still ahead.' : 'Nothing was ticked off this day.'}</p></div>`}
    ${due.length ? `<section class="section"><div class="section-head"><h3>${k < today ? 'Was due — still open' : 'Due this day'}</h3><span class="n">${due.length}</span></div><div class="task-list">${due.map((t) => taskRow(t, { showDate: false })).join('')}</div></section>` : ''}`;
}

// ---------- stats ----------

function statsShell() {
  return `<div class="stats-head"><h2>Your progress</h2><div class="seg" id="stats-range"></div></div><div id="stats-body"></div>`;
}
function updateStats() {
  $('#stats-range').innerHTML = [[7, '7 days'], [30, '30 days'], [90, '90 days'], [365, '12 months']]
    .map(([v, l]) => `<button data-action="stats-range" data-v="${v}" class="${ui.statsRange === v ? 'active' : ''}">${l}</button>`).join('');
  $('#stats-body').innerHTML = renderStats(store.allTasks(), S(), tz(), ui.statsRange);
}

// ---------- settings ----------

const BEFORE_OPTS = [[0, 'At due time'], [5, '5 min'], [15, '15 min'], [30, '30 min'], [60, '1 hour'], [180, '3 hours'], [1440, '1 day'], [2880, '2 days'], [10080, '1 week']];
const REPEAT_OPTS = [[0, 'Never'], [15, 'Every 15 min'], [30, 'Every 30 min'], [60, 'Every hour'], [120, 'Every 2 hours'], [240, 'Every 4 hours'], [1440, 'Once a day']];
const DAYS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']];
const SWATCHES = ['#3e7bfa', '#30a46c', '#e5484d', '#ef8a2c', '#8e4ec6', '#d6409f', '#12a594', '#8b8d98'];

const sw = (path, on) => `<label class="switch"><input type="checkbox" data-set="${path}" data-kind="bool" ${on ? 'checked' : ''}><span></span></label>`;
const pills = (path, opts, arr) => `<div class="pills">${opts.map(([v, l]) => `<button class="pill ${arr.includes(v) ? 'on' : ''}" data-action="toggle-arr" data-path="${path}" data-v="${v}" aria-pressed="${arr.includes(v)}">${l}</button>`).join('')}</div>`;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function settingsShell() { return '<div class="settings" id="settings-body"></div>'; }

function accountSection() {
  if (!CONFIG.supabaseUrl) {
    return `<div class="set-group"><h3>Sync</h3><div class="set-card"><div class="set-row"><div class="notice warn" style="width:100%">
      Sync isn't set up yet, so your tasks only live on this device. Follow <b>SETUP.md</b> (about 15 minutes, free) to sync your work PC, home PC and iPhone and get push notifications.</div></div></div></div>`;
  }
  const user = store.getUser();
  const { status, error } = store.getSyncState();
  if (!user) {
    return `<div class="set-group"><h3>Sync account</h3><p class="hint">Sign in with the same account on every device.</p><div class="set-card"><div class="set-row">
      <form class="auth-form" id="auth-form">
        <input type="email" name="email" placeholder="Email" autocomplete="username" required>
        <input type="password" name="password" placeholder="Password (min. 6 characters)" autocomplete="current-password" required minlength="6">
        <div class="row"><button class="btn primary" type="submit" data-mode="in">Sign in</button><button class="btn" type="submit" data-mode="up">Create account</button></div>
        ${ui.authMsg ? `<div class="notice">${esc(ui.authMsg)}</div>` : ''}
      </form></div></div></div>`;
  }
  return `<div class="set-group"><h3>Sync account</h3><div class="set-card">
    <div class="set-row"><div class="lbl"><b>${esc(user.email)}</b><small>${status === 'synced' ? '<span class="status-ok">● Synced</span> — changes appear on your other devices within seconds' : status === 'error' ? `<span class="status-bad">Sync error:</span> ${esc(error)}` : esc(status)}</small></div>
      <button class="btn small" data-action="sync-now">Sync now</button><button class="btn small danger" data-action="sign-out">Sign out</button></div>
  </div></div>`;
}

function notifySection(s) {
  const supported = 'Notification' in window;
  const perm = supported ? Notification.permission : 'unsupported';
  let status;
  if (isIOS() && !isStandalone()) {
    status = `<div class="notice warn">On iPhone, notifications only work from the home-screen app: tap <b>Share</b> → <b>Add to Home Screen</b>, open Ticked from there, then come back here.</div>`;
  } else if (!supported) {
    status = `<div class="notice warn">This browser doesn't support notifications.</div>`;
  } else if (perm === 'denied') {
    status = `<div class="notice warn">Notifications are blocked for this site. Allow them in your browser/phone settings, then reload.</div>`;
  } else if (perm !== 'granted' || (store.pushAvailable() && store.getUser() && !hasPush())) {
    status = `<div class="lbl"><b>This device</b><small>Not receiving notifications yet</small></div><button class="btn primary small" data-action="enable-push">Turn on notifications</button>`;
  } else {
    const mode = hasPush() ? 'Push notifications on — arrive even when the app is closed.' : 'On while the app is open (sign in to sync to get push notifications when it\'s closed).';
    status = `<div class="lbl"><b>This device</b><small><span class="status-ok">● On.</span> ${mode}</small></div><button class="btn small" data-action="test-notify">Send test</button>${hasPush() ? '<button class="btn small" data-action="disable-push">Turn off</button>' : ''}`;
  }

  const prioCards = [1, 2, 3, 4].map((p) => {
    const pr = s.priorities[p], n = pr.notify;
    return `<div class="set-card prio-card ${n.enabled ? '' : 'off'}" style="--pc:var(--p${p})">
      <div class="set-row"><div class="head" style="flex:1"><i style="width:10px;height:10px;border-radius:50%;background:var(--p${p})"></i>
        <input value="${esc(pr.name)}" data-set="priorities.${p}.name" data-kind="str" aria-label="Priority name" maxlength="16"></div>${sw(`priorities.${p}.notify.enabled`, n.enabled)}</div>
      <div class="body">
        <div class="set-row stack"><div class="lbl"><b>Remind me before it's due</b><small>Pick as many as you like</small></div>${pills(`priorities.${p}.notify.before`, BEFORE_OPTS, n.before)}</div>
        <div class="set-row"><div class="lbl"><b>Keep reminding while overdue</b><small>Repeats until you tick it off</small></div>
          <select data-set="priorities.${p}.notify.repeat" data-kind="num">${REPEAT_OPTS.map(([v, l]) => `<option value="${v}" ${n.repeat === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="set-row"><div class="lbl"><b>Include in daily summary</b></div>${sw(`priorities.${p}.notify.digest`, n.digest)}</div>
        <div class="set-row"><div class="lbl"><b>Break through quiet hours</b><small>For things that really can't wait</small></div>${sw(`priorities.${p}.notify.breakQuiet`, n.breakQuiet)}</div>
      </div></div>`;
  }).join('');

  return `
    <div class="set-group"><h3>Notifications</h3><div class="set-card"><div class="set-row">${status}</div></div></div>
    <div class="set-group"><h3>Per priority</h3><p class="hint">Tasks without a due date only show up in the daily summary.</p><div class="prio-cards">${prioCards}</div></div>
    <div class="set-group"><h3>Deadline escalation</h3><p class="hint">Tasks turn Urgent automatically as their deadline gets close. Moving the deadline later puts the old priority back.</p><div class="set-card">
      <div class="set-row"><div class="lbl"><b>Make tasks urgent near their deadline</b></div>${sw('escalate.enabled', s.escalate.enabled)}</div>
      <div class="set-row"><div class="lbl"><b>When the deadline is</b></div>
        <select data-set="escalate.days" data-kind="num">${[[0, 'Today'], [1, 'Tomorrow or sooner'], [2, 'Within 2 days'], [3, 'Within 3 days'], [7, 'Within a week']].map(([v, l]) => `<option value="${v}" ${s.escalate.days === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="set-row"><div class="lbl"><b>Notify me when a task becomes urgent</b><small>Waits until quiet hours are over</small></div>${sw('escalate.notify', s.escalate.notify)}</div>
    </div></div>
    <div class="set-group"><h3>Daily summary</h3><div class="set-card">
      <div class="set-row"><div class="lbl"><b>Morning summary</b><small>What's due today and overdue</small></div>${sw('digest.enabled', s.digest.enabled)}</div>
      <div class="set-row"><div class="lbl"><b>Time</b></div><input type="time" value="${s.digest.time}" data-set="digest.time" data-kind="str"></div>
      <div class="set-row stack"><div class="lbl"><b>Days</b></div>${pills('digest.days', DAYS, s.digest.days)}</div>
    </div></div>
    <div class="set-group"><h3>Quiet hours</h3><div class="set-card">
      <div class="set-row"><div class="lbl"><b>Quiet hours</b><small>Reminders wait until quiet hours end</small></div>${sw('quiet.enabled', s.quiet.enabled)}</div>
      <div class="set-row"><div class="lbl"><b>From</b></div><input type="time" value="${s.quiet.start}" data-set="quiet.start" data-kind="str"></div>
      <div class="set-row"><div class="lbl"><b>Until</b></div><input type="time" value="${s.quiet.end}" data-set="quiet.end" data-kind="str"></div>
      <div class="set-row"><div class="lbl"><b>Quiet all weekend</b></div>${sw('quiet.weekends', s.quiet.weekends)}</div>
      <div class="set-row"><div class="lbl"><b>Date-only tasks are due at</b><small>Used for reminders when a task has a date but no time</small></div><input type="time" value="${s.allDayTime}" data-set="allDayTime" data-kind="str"></div>
    </div></div>`;
}

function listsSection(s) {
  const lists = s.lists.map((l, i) => `
    <div class="set-row stack">
      <div class="list-edit">
        <input class="emoji" value="${esc(l.icon)}" data-list="${i}" data-field="icon" aria-label="Icon" maxlength="4">
        <input class="name" value="${esc(l.name)}" data-list="${i}" data-field="name" aria-label="List name" maxlength="24">
        ${s.lists.length > 1 ? `<button class="icon-btn" data-action="del-list" data-i="${i}" aria-label="Delete list ${esc(l.name)}">${I.trash}</button>` : ''}
      </div>
      <div class="swatches">${SWATCHES.map((c) => `<button class="${l.color === c ? 'on' : ''}" style="background:${c}" data-action="list-color" data-i="${i}" data-c="${c}" aria-label="Colour ${c}"></button>`).join('')}</div>
      <div class="row"><span class="muted" style="font-size:13px">Active</span>
        <select data-list="${i}" data-field="active" aria-label="When this list is active">
          ${[['always', 'Always'], ['work', 'During working hours'], ['offwork', 'Outside working hours']].map(([v, t]) => `<option value="${v}" ${l.active === v ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
        ${l.active !== 'always' ? `<label class="row" style="gap:8px;font-size:13.5px"><span class="switch" style="transform:scale(.85)"><input type="checkbox" data-list="${i}" data-field="notifyOnlyActive" ${l.notifyOnlyActive ? 'checked' : ''}><span></span></span>Only notify while active</label>` : ''}
      </div>
    </div>`).join('');
  return `
    <div class="set-group"><h3>Working hours</h3><p class="hint">Lists can switch on and off with these hours: work reminders stay quiet in the evening, home ones during the day.</p><div class="set-card">
      <div class="set-row stack"><div class="lbl"><b>Work days</b></div>${pills('workHours.days', DAYS, s.workHours.days)}</div>
      <div class="set-row"><div class="lbl"><b>Start</b></div><input type="time" value="${s.workHours.start}" data-set="workHours.start" data-kind="str"></div>
      <div class="set-row"><div class="lbl"><b>End</b></div><input type="time" value="${s.workHours.end}" data-set="workHours.end" data-kind="str"></div>
      <div class="set-row"><div class="lbl"><b>Open on “Right now”</b><small>Start the app showing only lists active at this moment</small></div>${sw('autoFocus', s.autoFocus)}</div>
    </div></div>
    <div class="set-group"><h3>Lists</h3><div class="set-card">${lists}
      <div class="set-row"><button class="btn small" data-action="add-list">${I.plus.replace('<svg', '<svg width="16" height="16"')} Add list</button></div>
    </div></div>`;
}

function updateSettingsView() {
  const s = S();
  $('#settings-body').innerHTML = `
    <h2 class="page">Settings</h2>
    ${accountSection()}
    ${notifySection(s)}
    ${listsSection(s)}
    <div class="set-group"><h3>Look &amp; feel</h3><div class="set-card">
      <div class="set-row"><div class="lbl"><b>Theme</b></div><select data-set="theme" data-kind="str">${[['auto', 'Match system'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => `<option value="${v}" ${s.theme === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="set-row"><div class="lbl"><b>Keep urgent &amp; high on top</b><small>Pinned above everything, whether sorted by date or by project</small></div>${sw('pinPriority', s.pinPriority)}</div>
      <div class="set-row"><div class="lbl"><b>Confetti</b><small>When you reach a new level or clear the day</small></div>${sw('confetti', s.confetti)}</div>
      <div class="set-row"><div class="lbl"><b>Sounds</b><small>A soft chime when you tick something off</small></div>${sw('sound', s.sound)}</div>
    </div></div>
    <div class="set-group"><h3>Your data</h3><div class="set-card">
      <div class="set-row"><div class="lbl"><b>Backup</b><small>Download everything as a file, or restore one</small></div>
        <button class="btn small" data-action="export">Export</button>
        <label class="btn small">Import<input type="file" accept="application/json,.json" id="import-file" hidden></label></div>
    </div></div>
    <p class="muted" style="text-align:center;font-size:12.5px;margin:28px 0 8px">Ticked v${APP_VERSION} · time zone ${esc(tz())}</p>`;
}

function setPath(obj, path, val) {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
  o[keys[keys.length - 1]] = val;
}
function getPath(obj, path) { return path.split('.').reduce((o, k) => o[k], obj); }

// ---------- render loop ----------

const VIEWS = {
  tasks: [tasksShell, updateTasks],
  calendar: [calendarShell, updateCalendar],
  stats: [statsShell, updateStats],
  settings: [settingsShell, updateSettingsView],
};
let shellRoute = null;

function render() {
  // never re-render under a running check animation, an open sheet or a focused text field
  const active = document.activeElement;
  const typing = active && $('#view').contains(active) && active.matches('input:not([type=checkbox]):not([type=file]), textarea, select') && active.id !== 'qa-input';
  if (ui.animating > 0 || $('.sheet-backdrop') || typing) { ui.renderPending = true; renderShell(); return; }
  ui.renderPending = false;

  applyTheme();
  renderShell();
  const [shell, update] = VIEWS[ui.route];
  if (shellRoute !== ui.route) {
    $('#view').innerHTML = shell();
    shellRoute = ui.route;
    $('.main').scrollTo(0, 0);
  }
  update();
}

function applyTheme() {
  const t = S().theme;
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = t;
}

// ---------- events ----------

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action;
  const id = el.closest('[data-id]')?.dataset.id;

  switch (a) {
    case 'check': onCheck(id, el); break;
    case 'edit': openEditor(id); break;
    case 'pick-list':
      ui.list = el.dataset.list;
      if (ui.route !== 'tasks') location.hash = 'tasks'; else render();
      break;
    case 'toggle-done': ui.showDone = !ui.showDone; render(); break;
    case 'cal-prev': case 'cal-next': {
      const d = a === 'cal-prev' ? -1 : 1;
      let { y, m } = ui.calMonth; m += d;
      if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; }
      ui.calMonth = { y, m }; render(); break;
    }
    case 'cal-today': ui.calMonth = null; ui.calSel = null; render(); break;
    case 'cal-pick': {
      ui.calSel = el.dataset.key;
      const p = parseKey(ui.calSel);
      ui.calMonth = { y: p.y, m: p.m };
      render();
      if (innerWidth < 900) $('#day-detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
      break;
    }
    case 'stats-range': ui.statsRange = +el.dataset.v; render(); break;
    case 'new-project': openProjectEditor(null); break;
    case 'edit-project': openProjectEditor(el.dataset.project); break;
    case 'toggle-done-projects': ui.showDoneProjects = !ui.showDoneProjects; render(); break;
    case 'pick-project': {
      const v = el.dataset.project;
      ui.project = ui.project === v && v !== 'all' ? 'all' : v; // tap the active chip again to clear it
      if (ui.route !== 'tasks') location.hash = 'tasks'; else render();
      break;
    }
    case 'group-by': ui.groupBy = el.dataset.v; savePrefs(); render(); break;
    case 'toggle-group': {
      const g = el.dataset.group;
      if (ui.collapsed.has(g)) ui.collapsed.delete(g); else ui.collapsed.add(g);
      savePrefs();
      render();
      break;
    }
    case 'assign-existing': openAssignPicker(el.dataset.project); break;
    case 'complete-project': {
      const p = projectById(el.dataset.project);
      store.updateSettings((s) => { s.projects.find((x) => x.id === p.id).done = true; });
      if (S().confetti) confetti();
      toast(`Project “${p.name}” completed`);
      break;
    }
    case 'toggle-arr': {
      const path = el.dataset.path, v = +el.dataset.v;
      store.updateSettings((s) => {
        const arr = getPath(s, path);
        const i = arr.indexOf(v);
        if (i >= 0) arr.splice(i, 1); else arr.push(v);
        arr.sort((x, y) => x - y);
      });
      break;
    }
    case 'add-list':
      store.updateSettings((s) => s.lists.push({ id: 'l' + Date.now().toString(36), name: 'New list', icon: '📁', color: SWATCHES[s.lists.length % SWATCHES.length], active: 'always', notifyOnlyActive: false }));
      break;
    case 'del-list': {
      const i = +el.dataset.i;
      const l = S().lists[i];
      const n = store.allTasks().filter((t) => t.list === l.id && !t.completedAt).length;
      if (!confirm(`Delete the list “${l.name}”?${n ? ` Its ${n} open task${n > 1 ? 's' : ''} will move to “${S().lists[i === 0 ? 1 : 0].name}”.` : ''}`)) break;
      const target = S().lists[i === 0 ? 1 : 0].id;
      store.allTasks().filter((t) => t.list === l.id).forEach((t) => store.updateTask(t.id, { list: target }));
      store.updateSettings((s) => s.lists.splice(i, 1));
      if (ui.list === l.id) ui.list = 'all';
      break;
    }
    case 'list-color': store.updateSettings((s) => { s.lists[+el.dataset.i].color = el.dataset.c; }); break;
    case 'enable-push':
      try {
        const mode = await store.enablePush();
        ui.pushSub = mode === 'push';
        toast(mode === 'push' ? 'Notifications on for this device' : 'Notifications on (while the app is open)');
      } catch (err) { toast(err.message || 'Could not turn on notifications'); }
      render();
      break;
    case 'disable-push': await store.disablePush(); ui.pushSub = false; toast('Push notifications off for this device'); render(); break;
    case 'test-notify':
      try {
        if (hasPush()) { await store.sendTestPush(); toast('Test sent — it should arrive in a few seconds'); }
        else { await showLocalNotification({ title: '🔔 Ticked test', body: 'Notifications are working.', tag: 'test' }); }
      } catch (err) { toast('Test failed: ' + (err.message || err)); }
      break;
    case 'sync-now': store.syncNow(); break;
    case 'sign-out': if (confirm('Sign out on this device? Your tasks stay in your account.')) { await store.disablePush().catch(() => {}); ui.pushSub = false; await store.signOut(); } break;
    case 'export': {
      const blob = new Blob([JSON.stringify(store.exportData(), null, 2)], { type: 'application/json' });
      const a2 = document.createElement('a');
      a2.href = URL.createObjectURL(blob);
      a2.download = `ticked-backup-${todayKey()}.json`;
      a2.click();
      setTimeout(() => URL.revokeObjectURL(a2.href), 1000);
      break;
    }
  }
});

document.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.dataset.set) {
    const kind = el.dataset.kind;
    let v = kind === 'bool' ? el.checked : kind === 'num' ? Number(el.value) : el.value;
    if (kind === 'str' && el.type === 'time' && !v) return;
    if (el.dataset.set.endsWith('.name') && !String(v).trim()) return render();
    store.updateSettings((s) => setPath(s, el.dataset.set, v));
  } else if (el.dataset.list !== undefined && el.dataset.field) {
    const i = +el.dataset.list, f = el.dataset.field;
    const v = el.type === 'checkbox' ? el.checked : el.value.trim();
    if (f === 'name' && !v) return render();
    store.updateSettings((s) => { s.lists[i][f] = v; });
  } else if (el.id === 'import-file' && el.files[0]) {
    try {
      store.importData(JSON.parse(await el.files[0].text()));
      toast('Backup restored');
    } catch (err) { toast(err.message || 'Could not read that file'); }
    el.value = '';
  }
});

document.addEventListener('focusout', () => { setTimeout(() => { if (ui.renderPending) render(); }, 0); });

document.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  if (form.id === 'quickadd') {
    const input = $('#qa-input');
    const p = parseQuick(input.value);
    if (!p.title) return;
    // on a project page, new tasks belong to that project unless +another is typed
    const proj = projectById(p.project) || projectById(ui.project);
    store.createTask({
      title: p.title, priority: p.priority || 3, list: p.list || proj?.list || defaultListForNew(),
      dueDate: p.dueDate || null, dueTime: p.dueTime || null, recurrence: p.recurrence || null, project: proj?.id || null,
    });
    input.value = '';
    $('#qa-preview').innerHTML = '';
  } else if (form.id === 'auth-form') {
    const mode = e.submitter?.dataset.mode || 'in';
    const email = form.email.value.trim(), password = form.password.value;
    ui.authMsg = '';
    try {
      if (mode === 'up') {
        const res = await store.signUp(email, password);
        if (!res.session) ui.authMsg = 'Account created. Check your email to confirm it, then sign in here.';
      } else await store.signIn(email, password);
    } catch (err) { ui.authMsg = err.message || 'Something went wrong'; }
    render();
  }
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'qa-input') {
    const v = e.target.value;
    $('#qa-preview').innerHTML = v.trim() ? parseQuick(v).tags.map((t) => `<span class="qa-tag">${esc(t)}</span>`).join('') : '';
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('.sheet-backdrop')) { closeSheet(); return; }
  const typing = e.target.matches('input, textarea, select, [contenteditable]');
  if (!typing && !e.ctrlKey && !e.metaKey && (e.key === 'n' || e.key === '/') && ui.route === 'tasks') {
    e.preventDefault();
    $('#qa-input')?.focus();
  }
});

$('#fab').addEventListener('click', () => {
  let preset = ui.route === 'calendar' && ui.calSel >= todayKey() ? { dueDate: ui.calSel } : {};
  const proj = ui.route === 'tasks' && projectById(ui.project);
  if (proj) preset = { project: proj.id, ...(proj.list ? { list: proj.list } : {}) };
  openEditor(null, preset);
});

// chart tooltips
const tip = $('#tooltip');
document.addEventListener('pointerover', (e) => {
  const el = e.target.closest('[data-tip]');
  if (!el) { tip.classList.remove('show'); return; }
  tip.innerHTML = el.dataset.tip;
  tip.classList.add('show');
});
document.addEventListener('pointermove', (e) => {
  if (!tip.classList.contains('show')) return;
  const w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = `${Math.min(innerWidth - w - 8, Math.max(8, e.clientX - w / 2))}px`;
  tip.style.top = `${Math.max(8, e.clientY - h - 14)}px`;
});

window.addEventListener('hashchange', () => { ui.route = currentRoute(); render(); });
if (location.hash.startsWith('#project')) history.replaceState(null, '', '#tasks');

// Pin the counter to the top once it would scroll out of view.
function pinBadge() {
  const dock = $('.badge-dock'), badge = $('#done-badge');
  if (!dock || !badge) return;
  const pinTop = parseFloat(getComputedStyle($('.main')).paddingTop) + 6; // includes the iPhone notch inset
  const d = dock.getBoundingClientRect();
  const pin = d.top + 8 < pinTop; // 8px = the counter's top margin in the strip
  badge.classList.toggle('pinned', pin);
  badge.style.top = pin ? `${pinTop}px` : '';
  badge.style.right = pin ? `${innerWidth - d.right}px` : '';
}
let pinQueued = false;
const queuePin = () => {
  if (pinQueued) return;
  pinQueued = true;
  requestAnimationFrame(() => { pinQueued = false; pinBadge(); });
};
$('.main').addEventListener('scroll', queuePin, { passive: true });
window.addEventListener('resize', queuePin);

// ---------- in-app reminders (when this device has no server push) ----------

const SENT_KEY = 'ticked.sent';

async function showLocalNotification({ title, body, tag }) {
  if (!('Notification' in window)) throw new Error('Notifications not supported');
  if (Notification.permission !== 'granted') {
    const p = await Notification.requestPermission();
    if (p !== 'granted') throw new Error('Notifications were not allowed');
  }
  const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
  const opts = { body, tag, icon: 'icons/icon-192.png', badge: 'icons/badge-72.png', data: { url: './' } };
  if (reg) await reg.showNotification(title, opts);
  else new Notification(title, opts);
}

function reminderTick() {
  if (!('Notification' in window) || Notification.permission !== 'granted' || hasPush()) return;
  let sent = {};
  try { sent = JSON.parse(localStorage.getItem(SENT_KEY) || '{}'); } catch {}
  const cutoff = Date.now() - 40 * 86400000;
  for (const k of Object.keys(sent)) if (sent[k] < cutoff) delete sent[k];
  const { items, logKeys } = computeNotifications(store.allTasks(), { ...S(), timezone: tz() }, new Date(), new Set(Object.keys(sent)));
  logKeys.forEach((k) => { sent[k] = Date.now(); });
  try { localStorage.setItem(SENT_KEY, JSON.stringify(sent)); } catch {}
  items.forEach((n) => showLocalNotification(n).catch(() => {}));
}

// ---------- boot ----------

// Tasks whose deadline is close become Urgent; if the deadline moves away again
// (or escalation is switched off) they get their old priority back.
function runEscalation() {
  const esc = S().escalate;
  const today = todayKey();
  for (const t of store.allTasks()) {
    if (t.completedAt || !t.dueDate) continue;
    const daysLeft = diffDaysKey(t.dueDate, today);
    const near = esc.enabled && daysLeft <= esc.days;
    // only upcoming deadlines escalate; tasks that were already overdue keep their priority
    if (near && daysLeft >= 0 && !t.escalated && t.priority > 1) {
      store.updateTask(t.id, { priority: 1, escalated: true, escalatedFrom: t.priority });
    } else if (!near && t.escalated) {
      store.updateTask(t.id, { escalated: false, escalatedFrom: null, ...(t.priority === 1 ? { priority: t.escalatedFrom || 3 } : {}) });
    }
  }
}
let escTimer = null;
const queueEscalation = () => { clearTimeout(escTimer); escTimer = setTimeout(runEscalation, 1500); };

store.subscribe(render);
store.subscribe(queueEscalation);
ui.route = currentRoute();
ui.list = S().autoFocus && S().lists.some((l) => l.active !== 'always') ? 'now' : 'all';
render();
store.initSync();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then(async () => {
    ui.pushSub = !!(await store.getPushSubscription());
    render();
  }).catch(() => {});
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'open-task' && e.data.taskId) { location.hash = 'tasks'; openEditor(e.data.taskId); }
  });
}
setInterval(reminderTick, 30000);
setTimeout(reminderTick, 3000);
// refresh relative labels ("Today", overdue) every minute and at midnight
setInterval(() => { if (!document.hidden) render(); runEscalation(); }, 60000);
queueEscalation();
