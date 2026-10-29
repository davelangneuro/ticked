// The satisfying bits: particle burst on the check, a soft chime, and
// full-screen confetti when you hit your daily goal.

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

let audio = null;
function ctx() {
  if (!audio) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audio = new AC();
  }
  if (audio.state === 'suspended') audio.resume();
  return audio;
}

function tone(ac, freq, start, dur, gain, type = 'sine') {
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, start);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g).connect(ac.destination);
  o.start(start);
  o.stop(start + dur + 0.02);
}

/** A soft two-note "pop-ding". `big` plays a short rising arpeggio. */
export function chime(big = false) {
  const ac = ctx();
  if (!ac) return;
  const t = ac.currentTime + 0.01;
  if (big) {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(ac, f, t + i * 0.085, 0.5, 0.11, 'triangle'));
  } else {
    tone(ac, 880, t, 0.18, 0.09, 'triangle');
    tone(ac, 1318.5, t + 0.07, 0.42, 0.08, 'sine');
  }
}

/** Little dots flying out of the check circle + an expanding ring. */
export function burst(el, color) {
  if (reduced()) return;
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;

  const ring = document.createElement('div');
  ring.className = 'ripple';
  ring.style.cssText = `left:${cx - 13}px;top:${cy - 13}px;border-color:${color}`;
  document.body.appendChild(ring);
  ring.animate([{ transform: 'scale(1)', opacity: 0.7 }, { transform: 'scale(2.6)', opacity: 0 }], { duration: 520, easing: 'cubic-bezier(.2,.8,.2,1)' })
    .onfinish = () => ring.remove();
  setTimeout(() => ring.remove(), 900); // in case the animation never finishes (hidden tab)

  const n = 12;
  for (let i = 0; i < n; i++) {
    const p = document.createElement('div');
    p.className = 'burst';
    const size = 4 + Math.random() * 4;
    p.style.cssText = `left:${cx - size / 2}px;top:${cy - size / 2}px;width:${size}px;height:${size}px;background:${i % 3 === 0 ? 'var(--accent)' : color}`;
    if (i % 4 === 1) p.style.borderRadius = '2px';
    document.body.appendChild(p);
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
    const d = 22 + Math.random() * 20;
    p.animate([
      { transform: 'translate(0,0) scale(1)', opacity: 1 },
      { transform: `translate(${Math.cos(a) * d}px, ${Math.sin(a) * d}px) scale(.2)`, opacity: 0 },
    ], { duration: 520 + Math.random() * 200, easing: 'cubic-bezier(.1,.8,.3,1)', delay: 60, fill: 'forwards' }).onfinish = () => p.remove();
    setTimeout(() => p.remove(), 1000);
  }
}

/** Full-screen confetti rain (goal reached / all done). */
export function confetti() {
  if (reduced()) return;
  const canvas = document.getElementById('confetti');
  const c = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  c.scale(dpr, dpr);
  const css = getComputedStyle(document.documentElement);
  const colors = ['--p1', '--p2', '--p3', '--accent', '--ok'].map((v) => css.getPropertyValue(v).trim());
  const parts = Array.from({ length: 140 }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * 120,
    y: innerHeight * 0.35,
    vx: (Math.random() - 0.5) * 16,
    vy: -Math.random() * 14 - 6,
    w: 6 + Math.random() * 6, h: 4 + Math.random() * 4,
    r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.4,
    color: colors[Math.floor(Math.random() * colors.length)],
  }));
  const start = performance.now();
  function frame(now) {
    const t = now - start;
    c.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) {
      p.vy += 0.38; p.vx *= 0.99; p.vy *= 0.99;
      p.x += p.vx; p.y += p.vy; p.r += p.vr;
      c.save();
      c.globalAlpha = Math.max(0, 1 - t / 2400);
      c.translate(p.x, p.y);
      c.rotate(p.r);
      c.fillStyle = p.color;
      c.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2)));
      c.restore();
    }
    if (t < 2400) requestAnimationFrame(frame);
    else c.clearRect(0, 0, innerWidth, innerHeight);
  }
  requestAnimationFrame(frame);
}

/** A glowing dot that arcs from one element to another, then calls `done`. */
export function flyTo(fromEl, toEl, color, done) {
  const target = toEl?.getBoundingClientRect();
  if (reduced() || !target || target.bottom < 0 || target.top > innerHeight) { done(); return; }
  const r = fromEl.getBoundingClientRect();
  const x0 = r.left + r.width / 2 - 6, y0 = r.top + r.height / 2 - 6;
  const dx = target.left + target.width / 2 - 6 - x0, dy = target.top + target.height / 2 - 6 - y0;
  const dot = document.createElement('div');
  dot.className = 'fly-dot';
  dot.style.cssText = `left:${x0}px;top:${y0}px;background:${color};color:${color}`;
  document.body.appendChild(dot);
  let finished = false;
  const finish = () => { if (finished) return; finished = true; dot.remove(); done(); };
  dot.animate([
    { transform: 'translate(0,0) scale(.6)' },
    { transform: `translate(${dx * 0.3}px, ${dy * 0.5 - 70}px) scale(1.3)`, offset: 0.45 },
    { transform: `translate(${dx}px, ${dy}px) scale(.5)` },
  ], { duration: 620, easing: 'cubic-bezier(.45,0,.25,1)', fill: 'forwards' }).onfinish = finish;
  setTimeout(finish, 800);
}
