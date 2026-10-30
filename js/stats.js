// Statistics view: tiles + hand-rolled SVG charts.
import { dayKey, addDaysKey, diffDaysKey, weekdayOfKey, parseKey, overdueMoment } from './core.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PR = [1, 2, 3, 4];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function niceMax(v) {
  if (v <= 4) return 4;
  const step = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * step >= v) return m * step;
  return 10 * step;
}

function roundedTop(x, y, w, h, r) {
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

const fmtKey = (k, opts) => {
  const { y, m, d } = parseKey(k);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, opts);
};

/** Count completions per day key (and per priority). */
// Levels for the "done today" counter; calendar and heatmap shading use the same steps.
export const TIERS = [
  // icon: line-art paths on a 24×24 grid (sprout, sparkle, bolt, flame, rocket, trophy)
  { min: 0, label: 'Ready to go', icon: '<path d="M12 20v-7"/><path d="M12 13c0-3.6-2.4-6-6.5-6 0 3.6 2.4 6 6.5 6z"/><path d="M12 15c0-3.2 2.2-5.6 6-5.6 0 3.2-2.2 5.6-6 5.6z"/><path d="M8.5 20h7"/>' },
  { min: 1, label: 'Warming up', icon: '<path d="M11 3.5l1.7 4.8 4.8 1.7-4.8 1.7L11 16.5l-1.7-4.8L4.5 10l4.8-1.7z"/><path d="M18 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>' },
  { min: 3, label: 'On a roll', icon: '<path d="M13.5 2.5L5 13.5h6.5l-1 8 8.5-11H12.5z"/>' },
  { min: 5, label: 'On fire', icon: '<path d="M12 21.5c-3.8 0-6.5-2.7-6.5-6.3 0-3.4 2.3-5.4 3.7-7.6.4 1.9 1.4 3 2.5 3.5-.2-3.5 1.4-6.3 3.6-8.6.4 3.3 2.2 5 3.5 7 .9 1.3 1.2 2.7 1.2 4.3 0 4.6-3.2 7.7-8 7.7z"/><path d="M12 21.5c-1.6 0-2.7-1.1-2.7-2.7 0-1.8 1.4-2.9 2.4-4.4 1 1.5 3 2.5 3 4.5 0 1.5-1.1 2.6-2.7 2.6z"/>' },
  { min: 8, label: 'Unstoppable', icon: '<path d="M12 15.5l-3.5-3.5c1.9-5.2 5.6-8.6 12-9.5-.9 6.4-4.3 10.1-9.5 12z"/><path d="M8.5 12H4.5l2.6-3.2c.6-.7 1.4-1 2.3-1h2.2"/><path d="M12 15.5v4l3.2-2.6c.7-.6 1-1.4 1-2.3v-2.2"/><path d="M6.8 16.7c-1.6.6-2.3 2.3-2.3 3.8 1.5 0 3.2-.7 3.8-2.3"/><circle cx="15.2" cy="8.8" r="1.4"/>' },
  { min: 12, label: 'Legendary', icon: '<path d="M8 21h8M12 16.5V21"/><path d="M7 3.5h10V9a5 5 0 0 1-10 0z"/><path d="M7 5.5H4.8a2.3 2.3 0 0 0 0 4.6H7.4M17 5.5h2.2a2.3 2.3 0 0 1 0 4.6h-2.6"/>' },
];
export const tierIndex = (n) => TIERS.reduce((best, t, i) => (n >= t.min ? i : best), 0);
export const levelFor = (n) => Math.min(4, tierIndex(n));

export function completionIndex(tasks, tz) {
  const byDay = new Map();
  for (const t of tasks) {
    if (!t.completedAt) continue;
    const k = dayKey(new Date(t.completedAt), tz);
    let e = byDay.get(k);
    if (!e) byDay.set(k, (e = { total: 0, 1: 0, 2: 0, 3: 0, 4: 0, tasks: [] }));
    e.total++;
    e[t.priority || 3]++;
    e.tasks.push(t);
  }
  return byDay;
}

export function streaks(byDay, today) {
  let current = 0;
  let k = byDay.has(today) ? today : addDaysKey(today, -1); // today not done yet doesn't break the streak
  while (byDay.has(k)) { current++; k = addDaysKey(k, -1); }
  const keys = [...byDay.keys()].sort();
  let best = 0, run = 0, prev = null;
  for (const key of keys) {
    run = prev && diffDaysKey(key, prev) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = key;
  }
  return { current, best };
}

function bucketize(byDay, today, range) {
  const buckets = [];
  if (range <= 30) {
    for (let i = range - 1; i >= 0; i--) {
      const k = addDaysKey(today, -i);
      const e = byDay.get(k) || {};
      buckets.push({
        label: range === 7 ? WD[weekdayOfKey(k)] : String(parseKey(k).d),
        tip: fmtKey(k, { weekday: 'short', day: 'numeric', month: 'short' }),
        showLabel: range === 7 || i % 5 === 0,
        v: PR.map((p) => e[p] || 0),
      });
    }
  } else if (range <= 90) {
    // weeks starting Monday
    let start = addDaysKey(today, -((weekdayOfKey(today) + 6) % 7));
    const weeks = 13;
    start = addDaysKey(start, -7 * (weeks - 1));
    for (let w = 0; w < weeks; w++) {
      const ws = addDaysKey(start, w * 7);
      const v = [0, 0, 0, 0];
      for (let d = 0; d < 7; d++) {
        const e = byDay.get(addDaysKey(ws, d));
        if (e) PR.forEach((p, i) => (v[i] += e[p]));
      }
      buckets.push({ label: fmtKey(ws, { day: 'numeric', month: 'short' }), tip: `Week of ${fmtKey(ws, { day: 'numeric', month: 'short' })}`, showLabel: w % 3 === 0, v });
    }
  } else {
    const { y, m } = parseKey(today);
    for (let i = 11; i >= 0; i--) {
      const mm = ((m - 1 - i) % 12 + 12) % 12, yy = y + Math.floor((m - 1 - i) / 12);
      const v = [0, 0, 0, 0];
      for (const [k, e] of byDay) {
        const p = parseKey(k);
        if (p.y === yy && p.m === mm + 1) PR.forEach((pp, j) => (v[j] += e[pp]));
      }
      buckets.push({ label: MONTHS[mm], tip: `${MONTHS[mm]} ${yy}`, showLabel: true, v });
    }
  }
  return buckets;
}

function stackedBars(buckets, settings) {
  const W = 640, H = 200, L = 30, B = 22, T = 8;
  const max = niceMax(Math.max(1, ...buckets.map((b) => b.v.reduce((a, c) => a + c, 0))));
  const n = buckets.length;
  const slot = (W - L) / n;
  const bw = Math.max(4, Math.min(28, slot * 0.62));
  const y = (v) => T + (H - T - B) * (1 - v / max);
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Tasks completed over time">`;
  const ticks = max % 4 === 0 ? 4 : 2; // keep tick labels whole numbers
  for (let i = 0; i <= ticks; i++) {
    const v = (max / ticks) * i;
    svg += `<line class="grid-line" x1="${L}" x2="${W}" y1="${y(v)}" y2="${y(v)}"/>`;
    svg += `<text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${Number.isInteger(v) ? v : v.toFixed(1)}</text>`;
  }
  buckets.forEach((b, i) => {
    const x = L + slot * i + (slot - bw) / 2;
    let acc = 0;
    const total = b.v.reduce((a, c) => a + c, 0);
    let g = '<g>';
    const segs = PR.map((p, j) => ({ p, v: b.v[j] })).filter((s) => s.v > 0);
    segs.forEach((s, si) => {
      const y0 = y(acc), y1 = y(acc + s.v);
      acc += s.v;
      const gap = si > 0 ? 2 : 0;
      const h = Math.max(0, y0 - y1 - gap);
      const top = si === segs.length - 1;
      g += top
        ? `<path class="m" d="${roundedTop(x, y1, bw, h, 4)}" fill="var(--p${s.p})"/>`
        : `<rect class="m" x="${x}" y="${y1}" width="${bw}" height="${h}" fill="var(--p${s.p})"/>`;
    });
    g += '</g>';
    const tip = `<b>${esc(b.tip)}</b><br>${total} done` + segs.map((s) => `<br>${esc(settings.priorities[s.p].name)}: ${s.v}`).join('');
    svg += `<g class="col">${g}<rect class="hit" x="${L + slot * i}" y="${T}" width="${slot}" height="${H - T - B}" data-tip="${esc(tip)}"/></g>`;
    if (b.showLabel) svg += `<text x="${x + bw / 2}" y="${H - 5}" text-anchor="middle">${esc(b.label)}</text>`;
  });
  svg += `<line x1="${L}" x2="${W}" y1="${y(0)}" y2="${y(0)}" stroke="var(--ink-3)" stroke-width="1"/>`;
  return svg + '</svg>';
}

function columns(values, labels, tips) {
  const W = 640, H = 150, L = 30, B = 22, T = 8;
  const max = niceMax(Math.max(1, ...values));
  const n = values.length, slot = (W - L) / n, bw = Math.min(40, slot * 0.55);
  const y = (v) => T + (H - T - B) * (1 - v / max);
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Completed by weekday">`;
  for (let i = 0; i <= 2; i++) {
    const v = (max / 2) * i;
    svg += `<line class="grid-line" x1="${L}" x2="${W}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${Number.isInteger(v) ? v : v.toFixed(1)}</text>`;
  }
  values.forEach((v, i) => {
    const x = L + slot * i + (slot - bw) / 2;
    const h = y(0) - y(v);
    svg += `<g class="col">${v > 0 ? `<path class="m" d="${roundedTop(x, y(v), bw, h, 4)}" fill="var(--accent)"/>` : ''}` +
      `<rect class="hit" x="${L + slot * i}" y="${T}" width="${slot}" height="${H - T - B}" data-tip="${esc(tips[i])}"/></g>` +
      `<text x="${x + bw / 2}" y="${H - 5}" text-anchor="middle">${labels[i]}</text>`;
  });
  return svg + '</svg>';
}

function hbars(rows) {
  const max = Math.max(1, ...rows.map((r) => r.v));
  return rows.map((r) => `<div class="hbar"><span class="lbl">${r.label}</span><div class="track"><div class="bar" style="width:${(r.v / max) * 100}%;background:${r.color}"></div></div><span class="val">${r.v}</span></div>`).join('');
}

function heatmap(byDay, today) {
  const weeks = 26;
  const mondayThisWeek = addDaysKey(today, -((weekdayOfKey(today) + 6) % 7));
  const start = addDaysKey(mondayThisWeek, -7 * (weeks - 1));
  let cells = '';
  for (let i = 0; i < weeks * 7; i++) {
    const k = addDaysKey(start, i);
    if (k > today) { cells += '<i class="blank"></i>'; continue; }
    const n = byDay.get(k)?.total || 0;
    const lvl = levelFor(n);
    cells += `<i class="l${lvl}" data-tip="${esc(`<b>${fmtKey(k, { weekday: 'short', day: 'numeric', month: 'short' })}</b><br>${n} done`)}"></i>`;
  }
  return `<div class="heat">${cells}</div>`;
}

export function renderStats(tasks, settings, tz, range) {
  const now = new Date();
  const today = dayKey(now, tz);
  const byDay = completionIndex(tasks, tz);
  const from = addDaysKey(today, -(range - 1));
  const prevFrom = addDaysKey(from, -range);
  const done = tasks.filter((t) => t.completedAt);
  const inRange = done.filter((t) => { const k = dayKey(new Date(t.completedAt), tz); return k >= from && k <= today; });
  const prevCount = done.filter((t) => { const k = dayKey(new Date(t.completedAt), tz); return k >= prevFrom && k < from; }).length;
  const { current, best } = streaks(byDay, today);
  let bestDay = 0;
  for (let i = 0; i < range; i++) bestDay = Math.max(bestDay, byDay.get(addDaysKey(today, -i))?.total || 0);

  const withDue = inRange.filter((t) => t.dueDate);
  const onTime = withDue.filter((t) => new Date(t.completedAt) < overdueMoment(t, settings, tz)).length;
  const onTimePct = withDue.length ? Math.round((onTime / withDue.length) * 100) : null;

  const change = prevCount ? Math.round(((inRange.length - prevCount) / prevCount) * 100) : null;
  const rangeLabel = { 7: 'last 7 days', 30: 'last 30 days', 90: 'last 90 days', 365: 'last 12 months' }[range];

  const tiles = `
    <div class="tiles">
      <div class="tile card"><div class="k">Completed</div><div class="v">${inRange.length}</div>
        <div class="s ${change > 0 ? 'up' : change < 0 ? 'down' : ''}">${change === null ? rangeLabel : `${change > 0 ? '▲' : change < 0 ? '▼' : ''} ${Math.abs(change)}% vs previous`}</div></div>
      <div class="tile card"><div class="k">Per day</div><div class="v">${(inRange.length / range).toFixed(1)}</div><div class="s">best day ${bestDay}</div></div>
      <div class="tile card"><div class="k">Streak</div><div class="v">${current}<span style="font-size:15px;font-weight:600"> day${current === 1 ? '' : 's'}</span></div><div class="s">best ${best}</div></div>
      <div class="tile card"><div class="k">On time</div><div class="v">${onTimePct === null ? '–' : onTimePct + '%'}</div><div class="s">${withDue.length ? `${onTime} of ${withDue.length} with a due date` : 'no due dates yet'}</div></div>
    </div>`;

  const buckets = bucketize(byDay, today, range);
  const legend = `<div class="legend">${PR.map((p) => `<span><i style="background:var(--p${p})"></i>${esc(settings.priorities[p].name)}</span>`).join('')}</div>`;
  const table = `<details class="table-view"><summary>Show as table</summary><table><tr><th>Period</th>${PR.map((p) => `<th>${esc(settings.priorities[p].name)}</th>`).join('')}<th>Total</th></tr>` +
    buckets.map((b) => `<tr><td>${esc(b.tip)}</td>${b.v.map((v) => `<td>${v}</td>`).join('')}<td>${b.v.reduce((a, c) => a + c, 0)}</td></tr>`).join('') + '</table></details>';

  // weekday averages over the range (Mon first)
  const wdCounts = [0, 0, 0, 0, 0, 0, 0], wdDays = [0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < range; i++) {
    const k = addDaysKey(today, -i);
    const wd = (weekdayOfKey(k) + 6) % 7;
    wdDays[wd]++;
    wdCounts[wd] += byDay.get(k)?.total || 0;
  }
  const wdAvg = wdCounts.map((c, i) => (wdDays[i] ? c / wdDays[i] : 0));
  const wdLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const bestWd = wdAvg.indexOf(Math.max(...wdAvg));

  const prioRows = PR.map((p) => ({ label: esc(settings.priorities[p].name), v: inRange.filter((t) => (t.priority || 3) === p).length, color: `var(--p${p})` }));
  const listRows = settings.lists.map((l) => ({ label: `${esc(l.icon || '')} ${esc(l.name)}`, v: inRange.filter((t) => t.list === l.id).length, color: l.color }));
  const noList = inRange.filter((t) => !settings.lists.some((l) => l.id === t.list)).length;
  if (noList) listRows.push({ label: 'Other', v: noList, color: 'var(--ink-3)' });
  const projRows = (settings.projects || [])
    .map((p) => ({ label: esc(p.name), v: inRange.filter((t) => t.project === p.id).length, color: esc(p.color) }))
    .filter((r) => r.v).sort((a, b) => b.v - a.v).slice(0, 8);

  return `
    ${tiles}
    <div class="chart-card card">
      <h3>Completed ${range === 365 ? 'per month' : range === 90 ? 'per week' : 'per day'}</h3>
      <div class="sub">${rangeLabel}, by priority</div>
      ${legend}
      ${stackedBars(buckets, settings)}
      ${table}
    </div>
    <div class="two-col">
      <div class="chart-card card"><h3>By priority</h3><div class="sub">${rangeLabel}</div>${hbars(prioRows)}</div>
      <div class="chart-card card"><h3>By list</h3><div class="sub">${rangeLabel}</div>${hbars(listRows)}</div>
    </div>
    ${projRows.length ? `<div class="chart-card card"><h3>By project</h3><div class="sub">${rangeLabel}</div>${hbars(projRows)}</div>` : ''}
    <div class="chart-card card">
      <h3>Your best day: ${wdAvg[bestWd] > 0 ? ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][bestWd] : '–'}</h3>
      <div class="sub">Average tasks completed per weekday, ${rangeLabel}</div>
      ${columns(wdAvg, wdLabels, wdAvg.map((v, i) => `<b>${wdLabels[i]}</b><br>${v.toFixed(1)} per day on average`))}
    </div>
    <div class="chart-card card">
      <h3>Last 6 months</h3>
      <div class="sub">Each square is a day; stronger colour means more done</div>
      ${heatmap(byDay, today)}
      <div class="cal-legend">Less <i style="background:var(--heat-0)"></i><i style="background:var(--heat-1)"></i><i style="background:var(--heat-2)"></i><i style="background:var(--heat-3)"></i><i style="background:var(--heat-4)"></i> More</div>
    </div>`;
}
