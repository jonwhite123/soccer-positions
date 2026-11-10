/* ==================================================================
   Where Should I Be? — POV mode: the pitch through your own eyes.

   A plain 2D canvas with our own perspective maths. No 3D engine, no
   libraries, nothing to build, so it runs from the file or GitHub Pages.

   The game keeps doing all the thinking (questions, scoring, the answer
   box). This file only draws what the game describes, from YOUR eyes,
   and hands taps back to it. index.html talks to it through window.POV:

     POV.mount(el)          put the view inside the pitch box (once)
     POV.start(cfg)         a new moment: who's where, the ball, which one is you
     POV.beats(beats, walk) play the game's beats (the lead-up, a pass…)
     POV.ask(mode, onPick)  'place' | 'aim' | 'shot' | null: what a tap means
     POV.runTo / shoot / lookUp / lockLook / moveAll / set
     POV.reveal(cfg)        the answer, seen from a step behind you
     POV.stop()             leave POV (another screen, or POV switched off)

   Same pitch coordinates as the game, in yards: x 0–40 across (the Left
   Wing's side is x = 0), y 0–60 up the pitch, their goal line at y = 60.
   z is height. The camera sits at your eye height; yaw 0 faces their
   goal, positive yaw turns right; positive pitch looks down.
   ================================================================== */
(() => {
'use strict';
const DEG = Math.PI / 180, EYE = 1.3, NEAR = 0.1, SLOW = 1.5;
const PITCH_MIN = -4 * DEG, PITCH_MAX = 52 * DEG;
const BLUE = new Set(['GK', 'LD', 'RD', 'CM', 'LW', 'RW', 'ST']);
const reduceMotion = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const lerpAng = (a, b, t) => a + wrap(b - a) * t;
const bearing = (from, to) => Math.atan2(to[0] - from[0], to[1] - from[1]);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const keeperOf = id => id === 'K' || id === 'wGK';

let host = null, layer = null, cv = null, ctx = null;
const ui = {};
let W = 0, H = 0, DPR = 1, F0 = 600, F = 600, CX = 0, CY = 0, bs = null, NOW = 0;
const cam = { x: 20, y: 30, z: EYE, yaw: 0, pitch: 7 * DEG, zoom: 1 };
const camPos = () => [cam.x, cam.y];

const S = {
  on: false, token: 0, raf: 0,
  pos: {}, prev: {}, face: {}, faceFix: {}, spd: {}, ph: {}, kick: {},
  ball: [20, 30, 0], prevBall: [20, 30], ballRoll: 0,
  you: null, look: null, lookCap: 22, lockLook: false, busy: false,
  mode: null, onPick: null, mark: null, shotInfo: null,
  reveal: null, camOff: null, hidden: new Set(), team: null, restrict: null,
  looked: false, hits: [], boxes: {}, turn: 0, tilt: 0, runPath: null, introP: null,
  directionAt: null, directionOrigin: null,
};

/* ---------------- setting up ---------------- */
function mount(el) {
  if (host === el) return;
  host = el;
  injectCSS();
  layer = document.createElement('div');
  layer.className = 'pov-layer';
  layer.hidden = true;
  layer.innerHTML = `
    <canvas class="pov-cv" aria-label="What you can see on the pitch. Drag to look around, then tap."></canvas>
    <div class="pov-compass" aria-hidden="true"></div>
    <div class="pov-attack" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 2 L21 13 H15.5 V22 H8.5 V13 H3 Z"/></svg><span>We attack</span></div>
    <button class="pov-look pov-l" type="button" aria-label="Look left">◀</button>
    <button class="pov-look pov-r" type="button" aria-label="Look right">▶</button>
    <div class="pov-hint" aria-hidden="true"></div>
    <div class="pov-banner" aria-hidden="true"></div>
    <div class="pov-chip" hidden>⚽ Ball at your feet</div>
    <div class="pov-key" hidden></div>
    <button class="pov-mapbtn" type="button" hidden>🗺️ Map</button>`;
  host.appendChild(layer);
  cv = layer.querySelector('.pov-cv');
  ctx = cv.getContext('2d');
  for (const k of ['compass', 'hint', 'banner', 'chip', 'key']) ui[k] = layer.querySelector('.pov-' + k);
  ui.map = layer.querySelector('.pov-mapbtn');
  ui.l = layer.querySelector('.pov-l');
  ui.r = layer.querySelector('.pov-r');
  ui.attack = layer.querySelector('.pov-attack svg');
  ui.marks = [
    { k: 'their', label: '⚽ Their goal', at: () => [20, 60] },
    { k: 'our', label: '🛡️ Our goal', at: () => [20, 0] },
    { k: 'ball', label: '⚽', at: () => S.ball },
  ];
  for (const m of ui.marks) { m.el = document.createElement('span'); m.el.className = 'mk'; ui.compass.appendChild(m.el); }
  if (window.ResizeObserver) new ResizeObserver(resize).observe(layer);
  else addEventListener('resize', resize);
  bindInput();
  ui.map.addEventListener('click', () => setMap(!host.classList.contains('pov-map')));
}

function resize() {
  if (!layer) return;
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = layer.clientWidth; H = layer.clientHeight;
  if (!W || !H) return;
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  const asp = W / H;
  const hfov = (asp >= 1.25 ? 80 : asp >= 0.95 ? 72 : 62) * DEG;
  F0 = (W / 2) / Math.tan(hfov / 2);
  CX = W / 2; CY = H * 0.54;
}

/* A new moment. cfg:
     pos     { id: [x, y] } everyone (blue roles GK…ST; theirs are anything else,
             their keeper is 'K' or 'wGK')
     ball    [x, y]
     you     which blue role is you
     hidden  ids not to draw yet (hard mode)
     fill    true: add whoever's missing, so a 7-a-side pitch is full when you turn round
     restrict 'ourGK' | 'theirGK': the build-out line that's in force */
function start(cfg) {
  ++S.token; tweens.length = 0;
  S.pos = {};
  for (const id in cfg.pos) S.pos[id] = cfg.pos[id].slice(0, 2);
  S.ball = [cfg.ball[0], cfg.ball[1], 0];
  if (cfg.fill) fillIn();
  S.you = cfg.you;
  S.hidden = new Set(cfg.hidden || []);
  S.restrict = cfg.restrict || null;
  S.prev = {}; S.spd = {}; S.kick = {}; S.face = {}; S.faceFix = {};
  for (const id in S.pos) { S.prev[id] = S.pos[id].slice(); S.face[id] = bearing(S.pos[id], S.ball); S.ph[id] = Math.random() * 6; }
  S.prevBall = S.ball.slice(0, 2);
  S.mode = null; S.onPick = null; S.mark = null; S.reveal = null; S.camOff = null; S.team = null; S.shotInfo = null;
  S.look = 'ball'; S.lookCap = 22; S.lockLook = false; S.busy = false; S.looked = false; S.turn = 0; S.tilt = 0;
  S.directionAt = null; S.directionOrigin = null;
  const me = S.pos[S.you];
  cam.x = me[0]; cam.y = me[1]; cam.zoom = 1;
  cam.yaw = bearing(me, S.ball);
  cam.pitch = ballPitch();
  setMap(false);
  ui.key.hidden = true; ui.map.hidden = true; ui.chip.hidden = true;
  hideBanner(); hideHint();
  layer.hidden = false;
  host.classList.add('pov-on');
  S.on = true;
  resize();
  if (!S.raf) { lastT = performance.now(); S.raf = requestAnimationFrame(frame); }
  // Their goal out of sight and a long way off (often the case for the Center Mid and
  // defenders)? Look that way first, so you know which way we're going, then turn to the
  // ball. In or near their box the goal is right there, so we skip it. The lead-up waits for it.
  const goalHidden = Math.abs(wrap(bearing(me, [20, 60]) - cam.yaw)) > 35 * DEG;
  S.introP = cfg.intro !== false && goalHidden && dist(me, [20, 60]) > 25 ? intro() : null;
  setLookButtons();
}
async function intro() {
  const tok = S.token, toBall = cam.yaw, p0 = cam.pitch, toGoal = bearing(camPos(), [20, 60]);
  S.busy = true; S.look = null;
  cam.yaw = toGoal; cam.pitch = 6 * DEG;
  banner('⚽ We attack this way!', 1400, true); // low down, so their goal on the horizon stays in view
  await wait(1400);
  await tween(700, t => { cam.yaw = lerpAng(toGoal, toBall, ease(t)); cam.pitch = lerp(6 * DEG, p0, ease(t)); });
  if (tok !== S.token) return;
  S.busy = false; S.introP = null; S.look = 'ball'; setLookButtons();
}
function stop() {
  if (!layer) return;
  ++S.token; tweens.length = 0;
  S.on = false;
  layer.hidden = true;
  host.classList.remove('pov-on', 'pov-map');
  hideBanner(); hideHint();
  if (S.raf) { cancelAnimationFrame(S.raf); S.raf = 0; }
}
// The attacking scenes only list the players near the ball. Add the rest
// (our keeper and defenders, their other players) so it's 7 a side.
function fillIn() {
  const by = S.ball[1], defY = clamp(by - 22, 22, 34);
  const blue = { GK: [20, 7], LD: [13, defY], RD: [27, defY + 0.6] };
  for (const id in blue) if (!S.pos[id]) S.pos[id] = blue[id];
  const theirs = Object.keys(S.pos).filter(id => !BLUE.has(id) && !keeperOf(id));
  const spots = [[14.5, 31], [25.5, 32], [20, 27], [8, 33], [32, 33.5], [20, 35]];
  let n = 1;
  for (const sp of spots) {
    if (theirs.length >= 6) break;
    if (Object.values(S.pos).some(p => dist(p, sp) < 3)) continue;
    const id = 'x' + n++;
    S.pos[id] = sp.slice();
    theirs.push(id);
  }
}

/* ---------------- projection ---------------- */
function setBasis() {
  F = F0 * cam.zoom;
  const sy = Math.sin(cam.yaw), cy = Math.cos(cam.yaw), sp = Math.sin(cam.pitch), cp = Math.cos(cam.pitch);
  bs = { fx: sy * cp, fy: cy * cp, fz: -sp, rx: cy, ry: -sy, ux: sy * sp, uy: cy * sp, uz: cp };
}
function toCam(x, y, z) {
  const dx = x - cam.x, dy = y - cam.y, dz = z - cam.z;
  return [dx * bs.rx + dy * bs.ry, dx * bs.ux + dy * bs.uy + dz * bs.uz, dx * bs.fx + dy * bs.fy + dz * bs.fz];
}
const scr = c => [CX + F * c[0] / c[2], CY - F * c[1] / c[2], c[2]];
function proj(x, y, z = 0) { const c = toCam(x, y, z); return c[2] < NEAR ? null : scr(c); }
function rayDir(sx, sy) {
  const a = (sx - CX) / F, b = -(sy - CY) / F;
  return [bs.fx + a * bs.rx + b * bs.ux, bs.fy + a * bs.ry + b * bs.uy, bs.fz + b * bs.uz];
}
// Where a screen point lands on the grass (null for sky).
function groundAt(sx, sy) {
  const d = rayDir(sx, sy);
  if (d[2] > -0.004) return null;
  const t = -cam.z / d[2];
  return t > 160 ? null : [cam.x + d[0] * t, cam.y + d[1] * t];
}
// Where a screen point lands on the plane of their goal: [across from the left post, height].
function goalPlaneAt(sx, sy) {
  const d = rayDir(sx, sy);
  if (d[1] <= 0.01) return null;
  const t = (60 - cam.y) / d[1], x = cam.x + d[0] * t, z = cam.z + d[2] * t;
  return x < 11 || x > 29 || z < -1 || z > 5 ? null : [x - 17, Math.max(0, z)];
}
function clipNear(pts) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], ain = a[2] >= NEAR, bin = b[2] >= NEAR;
    if (ain) out.push(a);
    if (ain !== bin) { const t = (NEAR - a[2]) / (b[2] - a[2]); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, NEAR]); }
  }
  return out;
}
function addWorld(pts) {
  const c = clipNear(pts.map(p => toCam(p[0], p[1], p[2] || 0)));
  if (c.length < 3) return false;
  c.forEach((q, i) => { const s = scr(q); if (i) ctx.lineTo(s[0], s[1]); else ctx.moveTo(s[0], s[1]); });
  ctx.closePath();
  return true;
}
function fillWorld(pts, style) { ctx.beginPath(); if (addWorld(pts)) { ctx.fillStyle = style; ctx.fill(); } }
function strokeWorld(pts, style, w) { ctx.beginPath(); if (addWorld(pts)) { ctx.strokeStyle = style; ctx.lineWidth = w; ctx.stroke(); } }
function seg3(a, b) {
  let A = toCam(a[0], a[1], a[2] || 0), B = toCam(b[0], b[1], b[2] || 0);
  if (A[2] < NEAR && B[2] < NEAR) return null;
  const toNear = (p, q) => { const t = (NEAR - p[2]) / (q[2] - p[2]); return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, NEAR]; };
  if (A[2] < NEAR) A = toNear(A, B); else if (B[2] < NEAR) B = toNear(B, A);
  return [scr(A), scr(B)];
}
function strokeSeg(a, b, style, w) {
  const s = seg3(a, b); if (!s) return;
  ctx.strokeStyle = style; ctx.lineWidth = w;
  ctx.beginPath(); ctx.moveTo(s[0][0], s[0][1]); ctx.lineTo(s[1][0], s[1][1]); ctx.stroke();
}
const circlePts = (cx, cy, r, n = 28, z = 0) => Array.from({ length: n }, (_, i) => [cx + r * Math.cos(i / n * 2 * Math.PI), cy + r * Math.sin(i / n * 2 * Math.PI), z]);
function quadLine(x1, y1, x2, y2, w) {
  const L = Math.hypot(x2 - x1, y2 - y1) || 1, nx = -(y2 - y1) / L * w / 2, ny = (x2 - x1) / L * w / 2;
  return [[x1 + nx, y1 + ny], [x2 + nx, y2 + ny], [x2 - nx, y2 - ny], [x1 - nx, y1 - ny]];
}
const rectPts = (x1, y1, x2, y2) => [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];

/* ---------------- the pitch and around it ---------------- */
const LINES = [];
const rectL = (x1, y1, x2, y2) => LINES.push([x1, y1, x2, y1], [x2, y1, x2, y2], [x2, y2, x1, y2], [x1, y2, x1, y1]);
rectL(0, 0, 40, 60); LINES.push([0, 30, 40, 30]);
rectL(8, 0, 32, 12); rectL(8, 48, 32, 60); rectL(14, 0, 26, 4); rectL(14, 56, 26, 60);
for (let i = 0; i < 40; i++) {
  const a1 = i / 40 * 2 * Math.PI, a2 = (i + 1) / 40 * 2 * Math.PI;
  LINES.push([20 + 6 * Math.cos(a1), 30 + 6 * Math.sin(a1), 20 + 6 * Math.cos(a2), 30 + 6 * Math.sin(a2)]);
}
const BUILD_OUT = { own: 21, opp: 39 };
const DASHES = [];
for (const y of [BUILD_OUT.own, BUILD_OUT.opp]) for (let x = 0; x < 40; x += 1.6) DASHES.push([x, y, Math.min(x + 0.9, 40), y]);
const SPOTS = [[20, 30], [20, 8], [20, 52]];
const TREES = [];
{
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 9; i++) TREES.push([-9 - rnd() * 9, -10 + i * 10 + rnd() * 4, 0.8 + rnd() * 0.5]);
  for (let i = 0; i < 9; i++) TREES.push([49 + rnd() * 9, -10 + i * 10 + rnd() * 4, 0.8 + rnd() * 0.5]);
  for (let i = 0; i < 6; i++) TREES.push([-6 + i * 10 + rnd() * 3, 71 + rnd() * 6, 0.8 + rnd() * 0.5]);
  for (let i = 0; i < 6; i++) TREES.push([-6 + i * 10 + rnd() * 3, -11 - rnd() * 6, 0.8 + rnd() * 0.5]);
}
const CLOUDS = [[-0.5, 0.2, 0.1], [0.45, 0.27, 0.14], [1.5, 0.18, 0.1], [2.5, 0.24, 0.12], [-2.1, 0.21, 0.13], [3.3, 0.17, 0.09], [-1.2, 0.3, 0.08]];

function drawSkyAndScenery(hy) {
  const g = ctx.createLinearGradient(0, Math.min(hy, H) - H * 0.9, 0, hy);
  g.addColorStop(0, '#4fa6ec'); g.addColorStop(1, '#d6edff');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, Math.max(0, Math.min(H, hy + 2)));
  const R = 2000, half = Math.atan((W / 2) / F) + 0.12;
  const far = (b, e) => proj(cam.x + R * Math.sin(b) * Math.cos(e), cam.y + R * Math.cos(b) * Math.cos(e), cam.z + R * Math.sin(e));
  for (const [b, e, w] of CLOUDS) {
    const p = far(b, e); if (!p) continue;
    const r = w * F;
    ctx.fillStyle = 'rgba(255,255,255,.88)';
    ctx.beginPath();
    for (const [ox, oy, k] of [[0, 0, 0.55], [-0.6, 0.12, 0.38], [0.6, 0.14, 0.4], [-0.25, -0.18, 0.4], [0.3, -0.12, 0.36]]) {
      ctx.moveTo(p[0] + ox * r + k * r, p[1] + oy * r);
      ctx.ellipse(p[0] + ox * r, p[1] + oy * r, k * r, k * r * 0.62, 0, 0, 2 * Math.PI);
    }
    ctx.fill();
  }
  const ridge = (fn, color, step) => {
    ctx.beginPath(); let started = false;
    for (let a = -half; a <= half + 1e-9; a += step) {
      const b = cam.yaw + a, p = far(b, fn(b)); if (!p) continue;
      if (started) ctx.lineTo(p[0], p[1]); else { ctx.moveTo(p[0], p[1]); started = true; }
    }
    if (!started) return;
    ctx.lineTo(W + 60, hy + 3); ctx.lineTo(-60, hy + 3); ctx.closePath();
    ctx.fillStyle = color; ctx.fill();
  };
  ridge(b => 0.03 + 0.016 * Math.sin(b * 3 + 1) + 0.011 * Math.sin(b * 7 + 2) + 0.005 * Math.sin(b * 13), '#9cc3b4', 0.02);
  ridge(b => 0.014 + 0.009 * Math.pow(Math.abs(Math.sin(b * 31)), 0.6) + 0.006 * Math.pow(Math.abs(Math.sin(b * 53 + 1)), 0.7) + 0.004 * Math.sin(b * 5), '#3f7d4c', 0.006);
}
function drawGround(hy) {
  if (hy < H) { ctx.fillStyle = '#2c8443'; ctx.fillRect(0, Math.max(0, hy - 1), W, H); }
  for (let i = 0; i < 12; i++) fillWorld(rectPts(0, i * 5, 40, (i + 1) * 5), i % 2 ? '#2f9149' : '#36a052');
  // The build-out line that's in force, and the side you can't go into yet.
  if (S.restrict === 'theirGK') fillWorld(rectPts(0, BUILD_OUT.opp, 40, 60), 'rgba(59,130,246,.2)');
  else if (S.restrict === 'ourGK') fillWorld(rectPts(0, 0, 40, BUILD_OUT.own), 'rgba(255,255,255,.16)');
  for (const l of LINES) {
    fillWorld(quadLine(l[0], l[1], l[2], l[3], 0.13), 'rgba(255,255,255,.92)');
    strokeSeg([l[0], l[1], 0], [l[2], l[3], 0], 'rgba(255,255,255,.5)', 1);
  }
  for (const l of DASHES) {
    const hot = (S.restrict === 'theirGK' && l[1] === BUILD_OUT.opp) || (S.restrict === 'ourGK' && l[1] === BUILD_OUT.own);
    fillWorld(quadLine(l[0], l[1], l[2], l[3], hot ? 0.2 : 0.11), hot ? 'rgba(253,224,71,.95)' : 'rgba(255,255,255,.5)');
  }
  for (const [x, y] of SPOTS) fillWorld(circlePts(x, y, 0.22, 12), '#fff');
  if (hy < H) {
    const hh = Math.max(30, H * 0.07), g = ctx.createLinearGradient(0, hy, 0, hy + hh);
    g.addColorStop(0, 'rgba(214,237,255,.65)'); g.addColorStop(1, 'rgba(214,237,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, hy, W, hh);
  }
}
function drawGoal(gy, dir, hits) {
  const x1 = 17, x2 = 23, h = 2, d = 1.5 * dir, hb = 1.2, by = gy + d;
  const net = 'rgba(255,255,255,.14)';
  fillWorld([[x1, by, 0], [x2, by, 0], [x2, by, hb], [x1, by, hb]], net);
  fillWorld([[x1, gy, h], [x2, gy, h], [x2, by, hb], [x1, by, hb]], net);
  fillWorld([[x1, gy, 0], [x1, gy, h], [x1, by, hb], [x1, by, 0]], net);
  fillWorld([[x2, gy, 0], [x2, gy, h], [x2, by, hb], [x2, by, 0]], net);
  const mesh = 'rgba(255,255,255,.42)';
  for (let x = x1; x <= x2 + 1e-6; x += 0.5) { strokeSeg([x, by, 0], [x, by, hb], mesh, 1); strokeSeg([x, gy, h], [x, by, hb], mesh, 1); }
  for (let z = 0.3; z < hb; z += 0.3) strokeSeg([x1, by, z], [x2, by, z], mesh, 1);
  for (let k = 0.25; k < 1; k += 0.25) {
    const yy = gy + d * k, zz = lerp(h, hb, k);
    strokeSeg([x1, yy, zz], [x2, yy, zz], mesh, 1);
    strokeSeg([x1, yy, 0], [x1, yy, zz], mesh, 1); strokeSeg([x2, yy, 0], [x2, yy, zz], mesh, 1);
  }
  // On their goal: the best places to aim, once the answer is shown.
  if (dir > 0 && S.reveal && S.reveal.goalZones) {
    for (const [a, b] of S.reveal.goalZones) {
      const pts = [[17 + a, gy + 0.02, 0], [17 + b, gy + 0.02, 0], [17 + b, gy + 0.02, 0.9], [17 + a, gy + 0.02, 0.9]];
      fillWorld(pts, 'rgba(74,222,128,.45)'); strokeWorld(pts, '#4ade80', 2);
    }
  }
  const post = (a, b) => {
    const s = seg3(a, b); if (!s) return;
    const w = Math.max(2, 0.12 * F / Math.max(NEAR, (s[0][2] + s[1][2]) / 2));
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(71,85,105,.8)'; ctx.lineWidth = w + 1.5; ctx.beginPath(); ctx.moveTo(s[0][0], s[0][1]); ctx.lineTo(s[1][0], s[1][1]); ctx.stroke();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(s[0][0], s[0][1]); ctx.lineTo(s[1][0], s[1][1]); ctx.stroke();
  };
  post([x1, gy, 0], [x1, gy, h]); post([x2, gy, 0], [x2, gy, h]); post([x1, gy, h], [x2, gy, h]);
  if (hits) {
    const c = [[x1, gy, 0], [x2, gy, 0], [x1, gy, h], [x2, gy, h]].map(p => proj(...p)).filter(Boolean);
    if (c.length === 4) S.hits.push({ kind: 'goal', x0: Math.min(...c.map(p => p[0])), x1: Math.max(...c.map(p => p[0])), y0: Math.min(...c.map(p => p[1])), y1: Math.max(...c.map(p => p[1])), d: c[0][2] });
  }
}
function drawFlag(x, y) {
  const s = seg3([x, y, 0], [x, y, 1.5]); if (!s) return;
  const d = (s[0][2] + s[1][2]) / 2;
  ctx.lineCap = 'round'; ctx.strokeStyle = '#f8fafc'; ctx.lineWidth = Math.max(1, 0.05 * F / d);
  ctx.beginPath(); ctx.moveTo(s[0][0], s[0][1]); ctx.lineTo(s[1][0], s[1][1]); ctx.stroke();
  const ox = x < 20 ? -0.5 : 0.5, oy = y < 30 ? -0.25 : 0.25;
  ctx.beginPath(); if (addWorld([[x, y, 1.5], [x + ox, y + oy, 1.35], [x, y, 1.18]])) { ctx.fillStyle = '#facc15'; ctx.fill(); }
}
function drawTree(t) {
  const [x, y, k] = t, base = proj(x, y, 0); if (!base) return;
  const s = F / base[2], top = proj(x, y, 3.2 * k); if (!top) return;
  ctx.lineCap = 'butt'; ctx.strokeStyle = '#6b4a2b'; ctx.lineWidth = Math.max(1, 0.45 * k * s);
  ctx.beginPath(); ctx.moveTo(base[0], base[1]); ctx.lineTo(top[0], top[1]); ctx.stroke();
  const r = 1.9 * k * s;
  ctx.fillStyle = '#2f6b3a';
  ctx.beginPath(); ctx.arc(top[0], top[1], r, 0, 2 * Math.PI); ctx.arc(top[0] - r * 0.6, top[1] + r * 0.35, r * 0.7, 0, 2 * Math.PI); ctx.arc(top[0] + r * 0.6, top[1] + r * 0.3, r * 0.72, 0, 2 * Math.PI); ctx.fill();
  ctx.fillStyle = 'rgba(120,180,90,.35)'; ctx.beginPath(); ctx.arc(top[0] - r * 0.25, top[1] - r * 0.3, r * 0.5, 0, 2 * Math.PI); ctx.fill();
}

/* ---------------- the players ----------------
   Each player is a little 3D skeleton (hips, knees, feet, shoulders,
   elbows, hands, head) posed for running, standing ready, kicking or
   keeping, turned to face where they're going, then projected joint by
   joint. A runner crossing in front of you is seen side-on in full
   stride; one running at you is seen face-on. */
const KITS = {
  blue: { shirt: '#2563eb', shorts: '#1e3a8a', socks: '#2563eb', edge: 'rgba(15,23,42,.55)' },
  white: { shirt: '#f8fafc', shorts: '#1f2937', socks: '#e5e7eb', edge: 'rgba(15,23,42,.5)' },
  theirGK: { shirt: '#f97316', shorts: '#1f2937', socks: '#f97316', gloves: '#fde047', edge: 'rgba(124,45,18,.65)' },
  ourGK: { shirt: '#16a34a', shorts: '#14532d', socks: '#16a34a', gloves: '#fde047', edge: 'rgba(20,83,45,.65)' },
};
const SKINS = ['#f2c9a0', '#e0ac69', '#c68642', '#8d5524', '#f6d5b8', '#a8714a', '#d9a066'];
const HAIRS = ['#2b1b0e', '#5b3a1e', '#c99a3b', '#151515', '#7a4a22', '#3b2412', '#e0c068'];
const LOOKS = {};
function lookOf(id) {
  if (LOOKS[id]) return LOOKS[id];
  let h = 7; for (const c of id + 'kid') h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (LOOKS[id] = {
    kit: keeperOf(id) ? KITS.theirGK : id === 'GK' ? KITS.ourGK : BLUE.has(id) ? KITS.blue : KITS.white,
    skin: SKINS[h % SKINS.length], hair: HAIRS[(h >> 5) % HAIRS.length], long: ((h >> 9) % 3) === 0,
    gk: keeperOf(id) || id === 'GK', h: 1 + ((h >> 12) % 7 - 3) * 0.015,
  });
}
function pose(id) {
  const L = lookOf(id), spd = S.spd[id] || 0, ph = S.ph[id] || 0, gk = L.gk;
  const run = clamp((spd - 0.5) / 2.5, 0, 1), amp = lerp(0.45, 1, clamp(spd / 5.5, 0, 1));
  const kk = S.kick[id], kt = kk ? (NOW - kk.t0) / 420 : 2, kicking = kt >= 0 && kt < 1;
  const lean = kicking ? 0.12 : lerp(gk ? 0.2 : 0.1, 0.26, run);
  const hipZ = 0.72, T = 0.36, SH = 0.35, J = {};
  for (const sd of [-1, 1]) {
    const p = ph + (sd > 0 ? Math.PI : 0);
    let th = lerp(gk ? 0.3 : 0.14, 0.6 * amp * Math.sin(p), run);
    let kn = lerp(gk ? 0.62 : 0.3, 0.22 + 0.95 * amp * (0.5 + 0.5 * Math.cos(p)), run);
    let wide = lerp(gk ? 0.21 : 0.12, 0.08, run);
    if (kicking) {
      if (sd === kk.side) { // wind up, then swing through
        th = kt < 0.45 ? lerp(0.1, -0.55, kt / 0.45) : lerp(-0.55, 1.05, (kt - 0.45) / 0.55);
        kn = kt < 0.45 ? lerp(0.3, 1.3, kt / 0.45) : lerp(1.3, 0.1, (kt - 0.45) / 0.55); wide = 0.1;
      } else { th = -0.12; kn = 0.35; wide = 0.12; }
    }
    const hip = [0, sd * 0.085, hipZ];
    const knee = [hip[0] + T * Math.sin(th), sd * (0.085 + wide) / 2, hipZ - T * Math.cos(th)];
    const b = th - kn;
    const ankle = [knee[0] + SH * Math.sin(b), sd * wide, knee[2] - SH * Math.cos(b)];
    const toe = [ankle[0] + 0.12, sd * wide, ankle[2] - 0.03];
    J['hip' + sd] = hip; J['knee' + sd] = knee; J['ank' + sd] = ankle; J['toe' + sd] = toe;
  }
  const minZ = Math.min(J['ank-1'][2] - 0.045, J['ank1'][2] - 0.045, J['toe-1'][2], J['toe1'][2]);
  const pel = [0, 0, hipZ + 0.03];
  const chest = [Math.sin(lean) * 0.37, 0, pel[2] + Math.cos(lean) * 0.37];
  J.pel = pel; J.chest = chest;
  J.head = [chest[0] + Math.sin(lean) * 0.22, 0, chest[2] + Math.cos(lean) * 0.22];
  for (const sd of [-1, 1]) {
    const p = ph + (sd > 0 ? Math.PI : 0);
    let c = lerp(gk ? 0.6 : 0.1, -0.75 * amp * Math.sin(p), run);
    let ab = lerp(gk ? 0.75 : 0.2, 0.12, run), flex = lerp(gk ? 0.85 : 0.35, 1.35, run);
    if (kicking) { c = sd === kk.side ? -0.35 : 0.5; ab = 0.65; flex = 0.5; }
    const sh = [chest[0], sd * 0.16, chest[2] - 0.03];
    const elb = [sh[0] + 0.23 * Math.sin(c) * Math.cos(ab), sh[1] + sd * 0.23 * Math.sin(ab), sh[2] - 0.23 * Math.cos(c) * Math.cos(ab)];
    const d = c + flex, a2 = ab * 0.5;
    const hand = [elb[0] + 0.21 * Math.sin(d) * Math.cos(a2), elb[1] + sd * 0.21 * Math.sin(a2), elb[2] - 0.21 * Math.cos(d) * Math.cos(a2)];
    J['sh' + sd] = sh; J['elb' + sd] = elb; J['hand' + sd] = hand;
  }
  const lift = -minZ, k = L.h;
  for (const j in J) { J[j][2] = (J[j][2] + lift) * k; J[j][0] *= k; J[j][1] *= k; }
  return J;
}
function drawPlayer(id) {
  const p = S.pos[id], h = S.face[id] || 0, L = lookOf(id), K = L.kit;
  const sh = Math.sin(h), ch = Math.cos(h), P = {};
  const J = pose(id);
  for (const j in J) {
    const q = J[j], c = toCam(p[0] + q[0] * sh + q[1] * ch, p[1] + q[0] * ch - q[1] * sh, q[2]);
    if (c[2] < 0.35) return null;
    P[j] = scr(c);
  }
  const parts = [];
  const cap = (a, b, wy, color, edge = K.edge) => {
    const d = (a[2] + b[2]) / 2, w = Math.max(1.2, wy * F / d);
    return () => {
      ctx.lineCap = 'round';
      ctx.strokeStyle = edge; ctx.lineWidth = w + 1.4; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      ctx.strokeStyle = color; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    };
  };
  const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  for (const sd of [-1, 1]) {
    const hip = P['hip' + sd], knee = P['knee' + sd], ank = P['ank' + sd], toe = P['toe' + sd], m = mix(hip, knee, 0.42);
    const leg = [cap(m, knee, 0.1, L.skin), cap(knee, ank, 0.092, K.socks), cap(ank, toe, 0.085, '#111827', 'rgba(0,0,0,.6)'), cap(hip, m, 0.14, K.shorts)];
    parts.push({ d: (hip[2] + ank[2]) / 2, fn: () => leg.forEach(f => f()) });
    const s = P['sh' + sd], e = P['elb' + sd], hd = P['hand' + sd], sm = mix(s, e, 0.45);
    const arm = [cap(sm, e, 0.072, L.skin), cap(e, hd, 0.066, L.skin), cap(s, sm, 0.1, K.shirt)];
    if (K.gloves) arm.push(() => { ctx.fillStyle = K.gloves; ctx.strokeStyle = K.edge; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(hd[0], hd[1], Math.max(1.5, 0.065 * F / hd[2]), 0, 2 * Math.PI); ctx.fill(); ctx.stroke(); });
    parts.push({ d: (s[2] + hd[2]) / 2, fn: () => arm.forEach(f => f()) });
  }
  // Torso: wider seen front-on than side-on.
  const toC = [cam.x - p[0], cam.y - p[1]], tl = Math.hypot(toC[0], toC[1]) || 1;
  const facing = (sh * toC[0] + ch * toC[1]) / tl;
  const tw = 0.2 + 0.1 * Math.abs(facing);
  const pel = P.pel, chest = P.chest, head = P.head, td = (pel[2] + chest[2]) / 2;
  const shorts = cap(mix(pel, chest, -0.12), mix(pel, chest, 0.2), tw + 0.03, K.shorts);
  const shirt = cap(mix(pel, chest, 0.22), mix(pel, chest, 0.92), tw, K.shirt);
  parts.push({ d: td, fn: () => { shorts(); shirt(); } });
  // Head: hair on top and at the back, skin on the face side. No faces: just which way they look.
  parts.push({ d: td - 0.001, fn: () => {
    const r = Math.max(1.6, 0.145 * F / head[2]);
    const fp = proj(p[0] + (J.head[0] + 0.12) * sh, p[1] + (J.head[0] + 0.12) * ch, J.head[2]);
    let ox = 0, oy = 0;
    if (fp) { const u = 0.12 * F / head[2]; ox = clamp((fp[0] - head[0]) / u, -1, 1) * r * 0.32; oy = clamp((fp[1] - head[1]) / u, -1, 1) * r * 0.1; }
    const hairC = () => { ctx.fillStyle = L.hair; ctx.beginPath(); ctx.arc(head[0] - ox * 0.6, head[1] - r * 0.08, r * 1.02, 0, 2 * Math.PI); ctx.fill(); };
    const skinC = () => { ctx.fillStyle = L.skin; ctx.beginPath(); ctx.arc(head[0] + ox, head[1] + r * 0.1 + oy, r * 0.86, 0, 2 * Math.PI); ctx.fill(); };
    ctx.strokeStyle = K.edge; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(head[0], head[1], r * 1.04, 0, 2 * Math.PI); ctx.stroke();
    if (facing > -0.2) { hairC(); skinC(); } else { skinC(); hairC(); }
    if (L.long && facing < 0.3) { ctx.fillStyle = L.hair; ctx.beginPath(); ctx.ellipse(head[0] - ox * 0.8, head[1] + r * 0.9, r * 0.32, r * 0.55, 0, 0, 2 * Math.PI); ctx.fill(); }
  } });
  parts.sort((a, b) => b.d - a.d).forEach(x => x.fn());
  const xs = Object.values(P).map(q => q[0]), ys = Object.values(P).map(q => q[1]);
  const box = { id, x0: Math.min(...xs) - 6, x1: Math.max(...xs) + 6, y0: Math.min(...ys) - 0.2 * F / td, y1: Math.max(...ys) + 4, d: td, top: head[1] - 0.17 * F / head[2] };
  if (BLUE.has(id) && id !== S.you) S.hits.push({ kind: 'mate', ...box });
  return box;
}
function shadow(x, y, r, a) { fillWorld(circlePts(x, y, r, 14).map(q => [q[0], q[1] + 0.05, 0]), `rgba(0,0,0,${a})`); }
function drawBall() {
  const [x, y, z] = S.ball, R = 0.13, c = proj(x, y, z + R); if (!c) return;
  const r = Math.max(1.8, R * F / c[2]);
  ctx.fillStyle = '#fff'; ctx.strokeStyle = 'rgba(15,23,42,.75)'; ctx.lineWidth = Math.max(0.8, r * 0.1);
  ctx.beginPath(); ctx.arc(c[0], c[1], r, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
  if (r > 4) {
    ctx.save(); ctx.beginPath(); ctx.arc(c[0], c[1], r, 0, 2 * Math.PI); ctx.clip();
    ctx.fillStyle = '#1f2937';
    const a = S.ballRoll;
    ctx.beginPath(); ctx.arc(c[0] + Math.cos(a) * r * 0.18, c[1] + Math.sin(a * 0.7) * r * 0.12, r * 0.3, 0, 2 * Math.PI); ctx.fill();
    for (let i = 0; i < 5; i++) { const b = a + i * 1.2566; ctx.beginPath(); ctx.arc(c[0] + Math.cos(b) * r * 0.92, c[1] + Math.sin(b) * r * 0.92, r * 0.24, 0, 2 * Math.PI); ctx.fill(); }
    ctx.restore();
  }
}

/* ---------------- markings on the grass ---------------- */
function ring(x, y, r1, r2, color) {
  ctx.beginPath();
  const a = addWorld(circlePts(x, y, r2, 32)), b = addWorld(circlePts(x, y, r1, 32).reverse());
  if (a || b) { ctx.fillStyle = color; ctx.fill('evenodd'); }
}
function groundArrow(a, b, color, w = 0.34) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy); if (L < 0.6) return;
  const ux = dx / L, uy = dy / L, hl = Math.min(1.2, L * 0.4), e = [b[0] - ux * hl, b[1] - uy * hl], nx = -uy, ny = ux;
  fillWorld([[a[0] + nx * w / 2, a[1] + ny * w / 2], [e[0] + nx * w / 2, e[1] + ny * w / 2], [e[0] - nx * w / 2, e[1] - ny * w / 2], [a[0] - nx * w / 2, a[1] - ny * w / 2]], color);
  fillWorld([[e[0] + nx * w * 1.7, e[1] + ny * w * 1.7], [b[0], b[1]], [e[0] - nx * w * 1.7, e[1] - ny * w * 1.7]], color);
}
// Brief training arrows, painted on the grass around your starting spot.
// They stay fixed on the pitch as you turn, and always point toward their goal.
function drawAttackDirection() {
  if (S.directionAt == null || !S.directionOrigin || S.reveal) return;
  const alpha = 0.9 * clamp((3000 - (NOW - S.directionAt)) / 900, 0, 1);
  if (!alpha) return;
  const [x, y] = S.directionOrigin;
  const radius = clamp((60 - y) * 0.45, 1.25, 4.5);
  for (let i = 0; i < 8; i++) {
    const a = [x + Math.sin(i * Math.PI / 4) * radius, y + Math.cos(i * Math.PI / 4) * radius];
    const d = dist(a, [20, 60]);
    if (a[0] < 1 || a[0] > 39 || a[1] < 1 || a[1] > 59.5 || d < 1) continue;
    const len = Math.min(2.8, d - 0.3);
    const b = [a[0] + (20 - a[0]) / d * len, a[1] + (60 - a[1]) / d * len];
    groundArrow(a, b, `rgba(120,53,15,${alpha * 0.8})`, 0.72);
    groundArrow(a, b, `rgba(253,224,71,${alpha})`, 0.48);
  }
}
function dots(a, b, color) {
  const L = dist(a, b);
  for (let d = 0.9; d < L - 0.6; d += 0.75) { const t = d / L; fillWorld(circlePts(lerp(a[0], b[0], t), lerp(a[1], b[1], t), 0.1, 8), color); }
}
function roundRect(x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function tag(x, y, text, bg, fg, fs) {
  ctx.font = `700 ${fs}px Fredoka, ui-rounded, system-ui, sans-serif`;
  const w = ctx.measureText(text).width + fs * 0.9, hh = fs * 1.45;
  ctx.fillStyle = bg; roundRect(x - w / 2, y - hh, w, hh, hh / 2); ctx.fill();
  ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, x, y - hh / 2 + 1);
}
function tag3d(x, y, z, text, bg, fg = '#fff') {
  const p = proj(x, y, z); if (!p) return;
  tag(p[0], p[1], text, bg, fg, clamp(0.5 * F / p[2], 12, 17));
}
function drawScoringGoalSign() {
  const p = proj(20, 60, 3.2), base = proj(20, 60, 0), bar = proj(20, 60, 2);
  if (!p || !base || !bar || p[0] < 0 || p[0] > W || base[1] < 0 || bar[1] > H) return;
  const text = '⚽ We score here! 🎉';
  const size = clamp(W * 0.045, 20, 32);
  ctx.save();
  ctx.font = `700 ${size}px Fredoka, ui-rounded, system-ui, sans-serif`;
  const width = ctx.measureText(text).width + size * 0.9;
  const scale = Math.min(1, Math.max(1, W - 24) / width), fs = size * scale;
  const w = width * scale, h = fs * 1.45;
  const x = clamp(p[0], w / 2 + 8, W - w / 2 - 8);
  const y = clamp(p[1], h + 44, H - 16);
  // A chunky speech bubble points down at the goal; leave room for the compass.
  ctx.fillStyle = '#fde047'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(x - 9, y - 2); ctx.lineTo(x, y + 11); ctx.lineTo(x + 9, y - 2); ctx.stroke(); ctx.fill();
  tag(x, y, text, '#fde047', '#422006', fs);
  roundRect(x - w / 2, y - h, w, h, h / 2); ctx.stroke();
  ctx.restore();
}
const ZONE_FILL = p => `rgba(253,224,71,${0.34 + 0.14 * p})`;
function drawMarks() {
  const pulse = 0.5 + 0.5 * Math.sin(NOW / 260), rv = S.reveal;
  drawAttackDirection();
  if (S.team) for (const z of S.team) {
    const pts = rectPts(z.x - z.hw, z.y - z.hh, z.x + z.hw, z.y + z.hh);
    fillWorld(pts, 'rgba(147,197,253,.22)'); strokeWorld(pts, 'rgba(219,234,254,.9)', 1.5);
  }
  if (rv) {
    for (const z of rv.zones || []) {
      const pts = rectPts(z.x - z.hw, z.y - z.hh, z.x + z.hw, z.y + z.hh);
      fillWorld(pts, ZONE_FILL(pulse)); strokeWorld(pts, '#fde047', 3);
    }
    for (const a of rv.arrows || []) {
      if (a.good) { ring(a.to[0], a.to[1], 0.75, 1.05, `rgba(74,222,128,${0.6 + 0.3 * pulse})`); groundArrow(a.from, a.to, 'rgba(74,222,128,.85)'); }
      else groundArrow(a.from, a.to, 'rgba(239,68,68,.85)', 0.26);
    }
  }
  const mk = S.mark;
  if (mk && S.mode) {
    if (mk.kind === 'spot') {
      dots(S.pos[S.you], mk.pt, 'rgba(255,255,255,.75)');
      ring(mk.pt[0], mk.pt[1], 0.5, 0.78, `rgba(59,130,246,${0.75 + 0.25 * pulse})`);
      fillWorld(circlePts(mk.pt[0], mk.pt[1], 0.5, 24), 'rgba(59,130,246,.25)');
    } else if (mk.kind === 'shot') {
      const x = 17 + mk.gx, z = Math.max(0.15, mk.gy), r = 0.28;
      const pts = Array.from({ length: 20 }, (_, i) => [x + r * Math.cos(i / 20 * 2 * Math.PI), 60, z + r * Math.sin(i / 20 * 2 * Math.PI)]);
      fillWorld(pts, `rgba(253,224,71,${0.45 + 0.3 * pulse})`); strokeWorld(pts, '#fff', 2);
      strokeSeg([S.ball[0], S.ball[1], 0.15], [x, 60, z], 'rgba(255,255,255,.7)', 2);
    } else {
      const to = mk.kind === 'mate' ? S.pos[mk.id] : mk.kind === 'goal' ? [20, 60.2] : mk.pt;
      groundArrow(S.ball, to, `rgba(253,224,71,${0.75 + 0.2 * pulse})`);
      if (mk.kind === 'mate') ring(to[0], to[1], 0.6, 0.85, 'rgba(253,224,71,.95)');
    }
  }
  if (S.runPath) { dots(S.runPath[0], S.runPath[1], 'rgba(255,255,255,.6)'); }
}

/* ---------------- each frame ---------------- */
let lastT = 0;
function frame(now) {
  S.raf = 0;
  if (!S.on) return;
  NOW = now;
  const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
  runTweens(now);
  updateActors(dt);
  updateCamera(dt);
  if (W && H) { render(); updateCompass(); }
  S.raf = requestAnimationFrame(frame);
}
function updateActors(dt) {
  for (const id in S.pos) {
    const p = S.pos[id], q = S.prev[id] || p, dx = p[0] - q[0], dy = p[1] - q[1], d = Math.hypot(dx, dy);
    S.spd[id] = lerp(S.spd[id] || 0, dt > 0 ? d / dt : 0, 1 - Math.exp(-dt * 9));
    S.ph[id] = (S.ph[id] || 0) + d * (2 * Math.PI / 1.75);
    let tgt = null;
    if (d > 1e-4 && dt > 0 && d / dt > 0.8) tgt = Math.atan2(dx, dy);
    else if (S.faceFix[id] != null) tgt = S.faceFix[id];
    else if (dist(p, S.ball) > 0.4) tgt = bearing(p, S.ball);
    if (tgt != null) S.face[id] = lerpAng(S.face[id] ?? tgt, tgt, 1 - Math.exp(-dt * 7));
    S.prev[id] = p.slice();
  }
  S.ballRoll += dist(S.ball, S.prevBall) / 0.13;
  S.prevBall = S.ball.slice(0, 2);
}
function ballPitch() {
  const d = Math.max(0.3, dist(camPos(), S.ball));
  return clamp(Math.atan2(cam.z - S.ball[2] - 0.1, d) * 0.85, 4 * DEG, S.lookCap * DEG);
}
function updateCamera(dt) {
  if (S.you && S.pos[S.you]) {
    const p = S.pos[S.you], o = S.camOff;
    cam.x = p[0] + (o ? o[0] : 0); cam.y = p[1] + (o ? o[1] : 0);
    cam.z = (o ? o[2] : EYE) + (S.spd[S.you] > 1 && !o ? Math.sin(S.ph[S.you] * 2) * 0.035 : 0);
  }
  const k = 1 - Math.exp(-dt * 6);
  if (S.look === 'ball') { cam.yaw = lerpAng(cam.yaw, bearing(camPos(), S.ball), k); cam.pitch = lerp(cam.pitch, ballPitch(), k); }
  else if (Array.isArray(S.look)) { cam.yaw = lerpAng(cam.yaw, bearing(camPos(), S.look), k); cam.pitch = lerp(cam.pitch, 7 * DEG, k); }
  if (S.turn) { cam.yaw += S.turn * 1.9 * dt; noteLooked(); }
  if (S.tilt) cam.pitch = clamp(cam.pitch + S.tilt * 1.2 * dt, PITCH_MIN, PITCH_MAX);
  cam.yaw = wrap(cam.yaw);
}
function render() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  setBasis();
  const hy = CY - F * Math.tan(cam.pitch);
  drawSkyAndScenery(hy);
  drawGround(hy);
  drawMarks();
  const seen = id => !S.hidden.has(id) && (id !== S.you || S.camOff);
  for (const id in S.pos) if (seen(id)) shadow(S.pos[id][0], S.pos[id][1], 0.3, 0.2);
  shadow(S.ball[0], S.ball[1], 0.13, S.ball[2] > 0.1 ? 0.15 : 0.28);
  S.hits = []; S.boxes = {};
  const objs = [], depth = (x, y, z = 0) => toCam(x, y, z)[2];
  for (const id in S.pos) if (seen(id)) objs.push({ d: depth(S.pos[id][0], S.pos[id][1], 0.8), fn: () => { S.boxes[id] = drawPlayer(id); } });
  objs.push({ d: depth(S.ball[0], S.ball[1], S.ball[2]) - 0.05, fn: drawBall });
  objs.push({ d: depth(20, 60.8, 1), fn: () => drawGoal(60, 1, true) });
  objs.push({ d: depth(20, -0.8, 1), fn: () => drawGoal(0, -1, false) });
  for (const [x, y] of [[0, 0], [40, 0], [0, 60], [40, 60]]) objs.push({ d: depth(x, y, 0.7), fn: () => drawFlag(x, y) });
  for (const t of TREES) objs.push({ d: depth(t[0], t[1], 3), fn: () => drawTree(t) });
  objs.filter(o => o.d > NEAR).sort((a, b) => b.d - a.d).forEach(o => o.fn());
  // Name tags over our players, so you can tell who's who.
  for (const id in S.boxes) {
    const b = S.boxes[id]; if (!b || !BLUE.has(id)) continue;
    const me = id === S.you;
    tag((b.x0 + b.x1) / 2, b.top - 4, me ? 'You' : id, me ? '#fbbf24' : id === 'GK' ? '#15803d' : '#1d4ed8', me ? '#0f172a' : '#fff', clamp(0.32 * F / b.d, me ? 13 : 10, me ? 17 : 15));
  }
  if (S.team) for (const z of S.team) if (z.label) tag3d(z.x, z.y, 0.05, z.label, 'rgba(30,58,138,.85)');
  drawScoringGoalSign();
  const ourGoal = proj(20, 0, 2.75);
  if (ourGoal) tag(ourGoal[0], ourGoal[1], '🛡️ Our goal', '#1d4ed8', '#fff', clamp(0.55 * F / ourGoal[2], 12, 18));
  if (S.restrict === 'theirGK') tag3d(clamp(cam.x, 6, 34), BUILD_OUT.opp, 0.05, 'No blue shirts past here yet!', 'rgba(30,58,138,.88)');
  else if (S.restrict === 'ourGK') tag3d(clamp(cam.x, 6, 34), BUILD_OUT.own, 0.05, 'No white shirts past here yet!', 'rgba(30,41,59,.85)');
  const rv = S.reveal;
  if (rv && rv.zones && rv.zones.length) {
    const z = rv.zones[0], d = dist(camPos(), [z.x, z.y]) || 1;
    tag3d(z.x + (z.x - cam.x) / d * z.hh * 0.9, z.y + (z.y - cam.y) / d * z.hh * 0.9, 0.05, 'Best spot', '#a16207');
  }
  if (rv) for (const a of rv.arrows || []) if (a.good && a.label) tag3d(a.to[0], a.to[1], 2.25, a.label, '#15803d');
  ui.chip.hidden = !(S.you && S.pos[S.you] && !S.camOff && dist(S.pos[S.you], S.ball) < 1.9 && S.ball[2] < 0.3);
}
function updateCompass() {
  // The "We attack" arrow points at their goal, like a sat-nav: up means straight ahead.
  const rel = Math.round(wrap(bearing(camPos(), [20, 60]) - cam.yaw) / DEG);
  if (rel !== ui.attackRel) { ui.attackRel = rel; ui.attack.style.transform = `rotate(${rel}deg)`; }
  const w = ui.compass.clientWidth; if (!w) return;
  for (const m of ui.marks) {
    const tgt = m.at();
    if (m.k === 'ball' && dist(tgt, camPos()) < 0.9) { m.el.style.display = 'none'; continue; }
    m.el.style.display = '';
    const rel = wrap(bearing(camPos(), tgt) - cam.yaw) / DEG, edge = Math.abs(rel) > 75;
    const txt = edge ? (rel < 0 ? '◀ ' + m.label : m.label + ' ▶') : m.label;
    if (m.el.textContent !== txt) m.el.textContent = txt;
    const mw = m.el.offsetWidth;
    const x = clamp(w / 2 + clamp(rel, -75, 75) / 75 * (w / 2 - 12) - mw / 2, 4, w - mw - 4);
    m.el.style.transform = `translate(${x}px, -50%)`;
    m.el.style.opacity = edge ? 0.75 : 1;
  }
}

/* ---------------- animation ---------------- */
const tweens = [];
function tween(ms, fn) {
  return new Promise(res => tweens.push({ t0: performance.now(), ms: reduceMotion ? 1 : Math.max(1, ms), fn, res, tok: S.token }));
}
const wait = ms => tween(ms, () => {});
function runTweens(now) {
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i];
    if (tw.tok !== S.token) { tweens.splice(i, 1); continue; }
    const t = Math.min(1, (now - tw.t0) / tw.ms);
    tw.fn(t);
    if (t >= 1) { tweens.splice(i, 1); tw.res(); }
  }
}
function kick(id) { if (id && S.pos[id]) S.kick[id] = { t0: performance.now(), side: 1 }; }
// Who's on the ball when it starts moving: the nearest player, if they're close.
function onBall(except) {
  let best = null, bd = 1.5;
  for (const id in S.pos) { if (id === except) continue; const d = dist(S.pos[id], S.ball); if (d < bd) { bd = d; best = id; } }
  return best;
}
// Move players and the ball in straight lines, like the game's beats.
function moveTo(map, ms, opts = {}) {
  const from = {}, ids = Object.keys(map).filter(id => id === 'ball' || S.pos[id]);
  for (const id of ids) from[id] = id === 'ball' ? S.ball.slice(0, 3) : S.pos[id].slice();
  // Someone running with the ball is dribbling: it surges ahead with each touch.
  let drib = null;
  if (map.ball) for (const id of ids) {
    if (id !== 'ball' && dist(from[id], from.ball) < 1.8 && dist(map[id], map.ball) < 1.8 && dist(from[id], map[id]) > 1) { drib = id; break; }
  }
  if (map.ball && !drib && dist(from.ball, map.ball) > 2.5) kick(onBall());
  const air = opts.air ? clamp(0.5 + 0.1 * dist(from.ball, map.ball), 0.8, 3.2) : 0;
  return tween(ms, t => {
    for (const id of ids) {
      const a = from[id], b = map[id], x = lerp(a[0], b[0], t), y = lerp(a[1], b[1], t);
      if (id === 'ball') { S.ball[0] = x; S.ball[1] = y; S.ball[2] = air ? Math.sin(Math.PI * t) * air : lerp(a[2] || 0, b[2] || 0, t); }
      else S.pos[id] = [x, y];
    }
    if (drib) {
      const a = from[drib], b = map[drib], L = dist(a, b) || 1, n = Math.max(2, Math.round(L / 1.8));
      const off = 0.45 * Math.abs(Math.sin(Math.PI * t * n)) * (1 - t);
      S.ball[0] += (b[0] - a[0]) / L * off; S.ball[1] += (b[1] - a[1]) / L * off;
    }
  });
}
/* The game's beats ({ ms, id: [x, y], air }), a bit slower so you can follow
   them from on the pitch. walk { id: [from, to] } moves someone over the
   whole clip instead (YOU walking to where the question starts). */
function beats(list, walk) {
  if (!S.on) return Promise.resolve();
  const tok = S.token;
  return (async () => {
    if (S.introP) await S.introP;
    S.busy = true; S.look = 'ball'; S.lookCap = 40;
    const total = list.reduce((a, b) => a + b.ms, 0) * SLOW;
    let el = 0;
    for (const bt of list) {
      const map = {};
      for (const k in bt) if (k !== 'ms' && k !== 'air' && !(walk && k in walk)) map[k] = bt[k];
      const ms = bt.ms * SLOW, e0 = el;
      const parts = [moveTo(map, ms, { air: bt.air })];
      if (walk) parts.push(tween(ms, t => {
        const k = Math.min(1, (e0 + ms * t) / total);
        for (const id in walk) if (S.pos[id]) S.pos[id] = [lerp(walk[id][0][0], walk[id][1][0], k), lerp(walk[id][0][1], walk[id][1][1], k)];
      }));
      await Promise.all(parts);
      el += ms;
    }
    if (tok === S.token) { S.busy = false; S.look = S.lockLook ? 'ball' : null; S.lookCap = 22; setLookButtons(); }
  })();
}
function moveAll(map, ms) { return S.on ? moveTo(map, ms) : Promise.resolve(); }
function set(id, p) {
  if (!S.on) return;
  if (id === 'ball') { S.ball = [p[0], p[1], p[2] || 0]; S.prevBall = S.ball.slice(0, 2); }
  else if (S.pos[id]) { S.pos[id] = p.slice(0, 2); S.prev[id] = S.pos[id].slice(); }
}
async function turnTo(pt, ms = 500, pitch = 7 * DEG) {
  const y0 = cam.yaw, y1 = bearing(camPos(), pt), p0 = cam.pitch;
  S.look = null;
  await tween(ms, t => { cam.yaw = lerpAng(y0, y1, ease(t)); cam.pitch = lerp(p0, pitch, ease(t)); });
}
// You run to a spot: turn your head that way, run, then look at the ball.
function runTo(to, faceAt) {
  if (!S.on) return Promise.resolve();
  return (async () => {
    if (S.introP) await S.introP;
    S.busy = true; setLookButtons();
    const from = S.pos[S.you].slice(), L = dist(from, to);
    S.look = null;
    if (L > 0.5) {
      S.runPath = [from, to];
      const y0 = cam.yaw, y1 = bearing(from, to), p0 = cam.pitch;
      await tween(300, t => { cam.yaw = lerpAng(y0, y1, ease(t)); cam.pitch = lerp(p0, 10 * DEG, ease(t)); });
      await tween(clamp(L / 6.5, 0.45, 2.4) * 1000, t => { S.pos[S.you] = [lerp(from[0], to[0], t), lerp(from[1], to[1], t)]; });
      S.runPath = null;
    }
    if (!S.camOff) await turnTo(faceAt || S.ball, 420, 9 * DEG); // answered mid-run: keep the answer view's angle
    S.busy = false; setLookButtons();
  })();
}
/* A shot at their goal. gp: where in the goal ({ x across from the left post, y height }).
   g: how good the shot was (the game's grade). Only a great shot goes in; one that's
   on target but not great gets saved, and one right on the post hits it. */
function shoot(gp, g) {
  if (!S.on) return Promise.resolve();
  return (async () => {
    if (S.introP) await S.introP;
    S.busy = true; S.mark = null; setLookButtons();
    const info = S.shotInfo || { kx: 3, big: false }, reach = info.big ? 1.3 : 1;
    const gx = gp.x, gy = Math.max(0.12, gp.y), keeper = Object.keys(S.pos).find(keeperOf);
    const inGoal = gx >= 0 && gx <= 6 && gy <= 2, post = inGoal && (gx < 0.15 || gx > 5.85);
    const saved = inGoal && !post && (g == null ? Math.abs(gx - info.kx) < reach && gy < 1.7 : g < 2);
    const into = [17 + gx, 60.3, gy];
    kick(onBall());
    await wait(150);
    const L = dist(S.ball, into), ms = clamp(L / 18, 0.35, 1) * 1000;
    if (saved && keeper) {
      const k = S.pos[keeper];
      await Promise.all([moveTo({ ball: [17 + gx, k[1] + 0.1, gy] }, ms), moveTo({ [keeper]: [17 + gx, k[1]] }, ms * 0.8)]);
      await moveTo({ ball: [17 + gx + 1.5, k[1] - 2, 0] }, 450);
      banner('Saved!', 1600);
    } else if (post) {
      await moveTo({ ball: [17 + (gx < 3 ? 0 : 6), 60, gy] }, ms);
      await moveTo({ ball: [17 + (gx < 3 ? -2 : 8), 56, 0] }, 450, { air: 0.5 });
      banner('Off the post!', 1600);
    } else {
      await moveTo({ ball: into }, ms);
      await moveTo({ ball: inGoal ? [17 + gx, 61.2, Math.min(gy, 1.1)] : [17 + gx + (gx < 0 ? -1.5 : gx > 6 ? 1.5 : 0), 63, gy + 0.3] }, inGoal ? 220 : 400);
      banner(inGoal ? 'GOAL! ⚽🎉' : gy > 2 ? 'Over the bar!' : 'Wide!', 1600);
    }
    await wait(800);
    S.busy = false;
  })();
}

/* What happens after a wrong choice, played out so you can see it (the question
   then stops). The ball and players are wherever the moment left them.
     o.to   a spot that matters (the teammate you passed to, or where the ball goes) */
const OUTCOME_TEXT = {
  saved: 'Saved!', saveCatch: 'Saved!', blocked: 'Blocked!', over: 'Over the bar!', crossBlocked: 'Blocked!',
  tackled: 'Tackled!', tooSlow: 'Too slow! They closed you down.', keeperSlow: 'Too slow! Their keeper got there.',
  cleared: 'Wasted. Their ball now.', letGo: 'It got away…', safe: 'Safe… but there was a better chance.',
  safeArrive: 'Safe… but there was a better chance.', passBack: 'The chance has gone…', cutOut: 'Cut out!',
  deflect: 'Cut out!', offside: '🚩 Offside!', noFollow: 'Nobody followed in…', keeper: 'Their keeper got it.',
  nobody: 'Their ball…', closedDown: 'Their defender won it.', out: 'Out of play!',
};
function outcome(kind, o = {}) {
  if (!S.on || !kind || kind === 'none') return Promise.resolve();
  return (async () => {
    if (S.introP) await S.introP;
    S.busy = true; S.mark = null; S.look = 'ball'; S.lookCap = 30; setLookButtons();
    const keeper = Object.keys(S.pos).find(keeperOf), k = keeper && S.pos[keeper];
    const whites = Object.keys(S.pos).filter(id => !BLUE.has(id) && !keeperOf(id));
    const nearestWhite = pt => whites.slice().sort((a, b) => dist(S.pos[a], pt) - dist(S.pos[b], pt))[0];
    const b = () => S.ball.slice(0, 2), me = S.pos[S.you];
    const toward = (a, c, d) => { const L = dist(a, c) || 1; return [a[0] + (c[0] - a[0]) / L * d, a[1] + (c[1] - a[1]) / L * d]; };
    // The first of their players in the way of the ball from a to c, and where they'd meet it.
    const inTheWay = (a, c, reach) => {
      const L = dist(a, c) || 1, ux = (c[0] - a[0]) / L, uy = (c[1] - a[1]) / L;
      let best = null;
      for (const id of whites) {
        const q = S.pos[id], along = (q[0] - a[0]) * ux + (q[1] - a[1]) * uy, off = Math.abs((q[0] - a[0]) * uy - (q[1] - a[1]) * ux);
        if (along > 0.8 && along < L + 0.5 && off < reach && (!best || along < best.along)) best = { id, along, pt: [a[0] + ux * along, a[1] + uy * along] };
      }
      return best;
    };
    const winIt = async id => { // their player gets to the ball and takes it away
      if (!id) return;
      await moveTo({ [id]: toward(S.pos[id], b(), Math.max(0, dist(S.pos[id], b()) - 0.4)) }, clamp(dist(S.pos[id], b()) / 6, 0.35, 1.2) * 1000);
      const away = [b()[0] + (b()[0] < 20 ? -1 : 1) * 1.5, b()[1] - 3];
      await moveTo({ [id]: toward(S.pos[id], away, 2.6), ball: away }, 600);
    };
    const kickTo = async (to, ms, air) => { kick(onBall()); await wait(140); await moveTo({ ball: to }, ms, { air }); };
    let text = OUTCOME_TEXT[kind];
    switch (kind) {
      case 'saved': await Promise.all([kickTo(k ? [k[0], k[1] - 0.3, 0.9] : [20, 60.2], 560)]); break;
      case 'saveCatch': case 'safeArrive': case 'out': await wait(300); break;
      case 'blocked': {
        const hit = inTheWay(b(), [20, 60], 2.2);
        if (hit) { await kickTo(hit.pt, 300); await moveTo({ ball: [hit.pt[0] + (hit.pt[0] < 20 ? -3 : 3), hit.pt[1] - 3] }, 500, { air: 0.6 }); }
        else { await kickTo(k ? [k[0], k[1] - 0.3, 0.9] : [20, 60.2], 560); text = 'Saved!'; }
        break;
      }
      case 'over': {
        const x = 20 + (b()[0] > 20 ? 1.2 : -1.2);
        await kickTo([x, 60.4, 3.4], 620); await moveTo({ ball: [x, 64, 4.4] }, 380);
        break;
      }
      case 'crossBlocked': {
        const to = [21, 56], hit = inTheWay(b(), to, 3) || { id: nearestWhite(to), pt: to };
        await Promise.all([kickTo(hit.pt, 420), moveTo({ [hit.id]: toward(S.pos[hit.id], hit.pt, Math.max(0, dist(S.pos[hit.id], hit.pt) - 0.4)) }, 420)]);
        await moveTo({ ball: [hit.pt[0], 62.5] }, 500, { air: 0.6 });
        break;
      }
      case 'tackled': await winIt(nearestWhite(b())); break;
      case 'tooSlow': {
        if (k && dist(k, b()) < 5) { text = OUTCOME_TEXT.keeperSlow; await moveTo({ [keeper]: toward(k, b(), dist(k, b()) - 0.3) }, 500); }
        else await winIt(nearestWhite(b()));
        break;
      }
      case 'cleared': {
        const to = [b()[0] < 20 ? 7 : 33, Math.max(28, b()[1] - 16)];
        await kickTo(to, 900, 1); await winIt(nearestWhite(to));
        break;
      }
      case 'letGo': {
        const to = [b()[0] + (b()[0] < 20 ? 5 : -5), b()[1] + 1];
        await moveTo({ ball: to }, 900); await winIt(nearestWhite(to));
        break;
      }
      case 'safe': if (o.to) await kickTo(toward(o.to, b(), 0.5), 800); break;
      case 'passBack': await kickTo([b()[0] < 20 ? 13 : 27, Math.max(20, b()[1] - 22)], 1100); break;
      case 'cutOut': { // the pass to you gets cut out, because you're not in a good spot
        const from = b(), hit = inTheWay(from, me, 2.6) || { id: nearestWhite(me), pt: toward(me, from, 0.9) };
        await Promise.all([kickTo(hit.pt, clamp(dist(from, hit.pt) / 12, 0.4, 1.2) * 1000, o.air), moveTo({ [hit.id]: toward(S.pos[hit.id], hit.pt, Math.max(0, dist(S.pos[hit.id], hit.pt) - 0.4)) }, 600)]);
        await winIt(hit.id);
        break;
      }
      case 'offside': {
        const ahead = [me[0], Math.min(57, me[1] + 4.5)];
        await Promise.all([kickTo(ahead, 1000), (async () => { await wait(300); await moveTo({ [S.you]: [me[0], Math.min(56, me[1] + 3.4)] }, 900); })()]);
        break;
      }
      case 'noFollow': { // a teammate shoots, their keeper pushes it out, and nobody's there
        const at = k ? [k[0] + 0.5, k[1] - 3.2] : [20.5, 56.5];
        await kickTo(k ? [k[0], k[1] - 0.2, 0.6] : [20, 59.5], 560);
        await moveTo({ ball: at }, 420);
        const id = nearestWhite(at);
        await moveTo({ [id]: toward(S.pos[id], at, Math.max(0, dist(S.pos[id], at) - 0.4)) }, 600);
        await kickTo([at[0] < 20 ? 6 : 34, at[1] - 16], 900, 1);
        break;
      }
      case 'keeper': if (k) await kickTo([k[0], k[1] - 0.3, 0.8], 800, 0.6); break;
      case 'nobody': { if (o.to) await kickTo(o.to, 800); await winIt(nearestWhite(b())); break; }
      case 'closedDown': case 'deflect': await winIt(nearestWhite(b())); break;
    }
    banner(text || '', 1800);
    await wait(1500);
    S.busy = false; S.look = null; setLookButtons();
  })();
}
// A big moment: say so, and give it a second to sink in.
function cheer(text) {
  if (!S.on) return Promise.resolve();
  banner(text, 1900);
  return wait(1500);
}
// Where everyone is now (to work out the next beat), and a snapshot to come back to.
function positions() { const p = {}; for (const id in S.pos) p[id] = S.pos[id].slice(); p.ball = S.ball.slice(); return p; }
function snap() { return { pos: positions(), face: { ...S.face } }; }
function restore(sn, youAt) {
  if (!S.on || !sn) return;
  S.pos = {};
  for (const id in sn.pos) if (id !== 'ball') S.pos[id] = sn.pos[id].slice();
  S.ball = sn.pos.ball.slice();
  if (youAt) S.pos[S.you] = youAt.slice();
  S.face = { ...sn.face }; S.kick = {}; S.spd = {};
  S.prev = {}; for (const id in S.pos) S.prev[id] = S.pos[id].slice();
  S.prevBall = S.ball.slice(0, 2);
}
// "Look up!": lift your head from the ball and look toward `at` (their goal by default).
function lookUp(at) {
  if (!S.on) return Promise.resolve();
  S.lockLook = false; setLookButtons();
  banner('👀 Look up!', 1500);
  return turnTo(at || [20, 60], 750, 5 * DEG).then(() => { hint(tapHint(), 0); });
}
// Eyes on the ball: you can't look around until you've controlled it.
function lockLook(on) {
  S.lockLook = !!on;
  if (on) { S.look = 'ball'; S.lookCap = 40; hint('⚽ Eyes on the ball! Control it before you look up.', 3500); }
  else if (S.look === 'ball' && !S.busy) { S.look = null; S.lookCap = 22; }
  setLookButtons();
}

/* What a tap means now:
     'place' a spot on the grass (onPick({x, y}))
     'aim'   a teammate, a space or the goal ({x, y} on the pitch)
     'shot'  a spot in their goal ({x across from the left post, y height}); opts { kx, big }
     null    nothing (choose questions, or between steps)
   onPick may return the spot the game actually used (it keeps spots in bounds). */
function ask(mode, onPick, opts) {
  if (!S.on) return;
  // Start the three seconds when the first decision is ready, after any lead-up.
  if (!S.directionOrigin) {
    const tok = S.token;
    S.directionOrigin = S.pos[S.you].slice();
    const showDirection = () => { if (S.on && tok === S.token) S.directionAt = performance.now(); };
    if (S.introP) S.introP.then(showDirection); else showDirection();
  }
  S.mode = mode; S.onPick = onPick || null; S.mark = null; S.looked = false;
  cv.classList.toggle('tap', !!mode);
  if (mode === 'shot') {
    S.shotInfo = opts || { kx: 3, big: false };
    const keeper = Object.keys(S.pos).find(keeperOf);
    if (keeper) moveTo({ [keeper]: [17 + S.shotInfo.kx, S.shotInfo.big ? 57.6 : 59.3] }, 300);
    // Zoom in a little on the goal, like you would when you pick your spot.
    const d = Math.max(4, dist(camPos(), [20, 60]));
    const z = clamp(0.55 * W / (6 * F0 / d), 1, 2.6), z0 = cam.zoom;
    turnTo([20, 60], 500, clamp(Math.atan2(EYE - 0.9, d), 0, 12 * DEG));
    tween(500, t => { cam.zoom = lerp(z0, z, ease(t)); });
  } else if (cam.zoom !== 1) {
    const z0 = cam.zoom; tween(300, t => { cam.zoom = lerp(z0, 1, ease(t)); });
  }
  if (mode) hint(tapHint(), 0); else if (!S.lockLook) hideHint();
  setLookButtons();
}
const tapHint = () => (S.mode === 'place' ? '👆 Drag to look around · tap the grass where you should be'
  : S.mode === 'aim' ? '👆 Drag to look around · tap a teammate, a space or the goal'
    : S.mode === 'shot' ? '🎯 Tap where in the goal you would aim' : '👆 Drag to look around');

/* The answer, seen from a few steps behind you and a little higher, so you
   can see yourself next to the right spot. cfg:
     zones     [{x, y, hw, hh}] best spots (yellow, like the map)
     arrows    [{from, to, good, label}] the best pass (green) or your pass (red)
     goalZones [[x1, x2]] where to aim in the goal
     look      [x, y] what to look at (default: the best spot if you're away from it, else the ball)
     key       [[colour, words]] a small key in the corner */
function reveal(cfg) {
  if (!S.on) return;
  S.reveal = cfg; S.mode = null; S.mark = null; S.busy = false; S.lockLook = false; S.hidden = new Set(); S.team = null;
  cv.classList.remove('tap');
  hideHint();
  answerView(cfg.look);
  if (cfg.key && cfg.key.length) {
    ui.key.innerHTML = cfg.key.map(([c, t]) => `<span><i style="background:${c}"></i>${t}</span>`).join('');
    ui.key.hidden = false;
  }
  ui.map.hidden = false;
  setLookButtons();
}
function answerView(look) {
  const me = S.pos[S.you], rv = S.reveal || {};
  let at = look;
  if (!at && rv.zones && rv.zones.length) {
    const z = rv.zones.reduce((a, b) => (dist(me, [a.x, a.y]) < dist(me, [b.x, b.y]) ? a : b));
    if (dist(me, [z.x, z.y]) > 2.5) at = [z.x, z.y];
  }
  if (!at || dist(me, at) < 1) at = dist(me, S.ball) > 1 ? S.ball : [20, 60];
  const yaw = bearing(me, at);
  S.look = null; cam.zoom = 1;
  S.camOff = [-Math.sin(yaw) * 3.4, -Math.cos(yaw) * 3.4, 2.6];
  cam.yaw = yaw; cam.pitch = 21 * DEG;
  S.faceFix = { [S.you]: yaw }; S.face[S.you] = yaw;
}
// Show me: back to your own eyes, run to the right spot, then the answer view again.
function showRun(to) {
  if (!S.on) return Promise.resolve();
  return (async () => {
    S.camOff = null; S.faceFix = {};
    await runTo(to);
    answerView();
  })();
}
// Teammates' best spots, labelled (the 👥 Team button).
function team(list) { if (S.on) S.team = list; }
function setMap(on) {
  if (!host) return;
  host.classList.toggle('pov-map', !!on);
  ui.map.textContent = on ? '👀 Your view' : '🗺️ Map';
}

/* ---------------- words on top ---------------- */
let bannerT = 0, hintT = 0;
function banner(text, ms = 1600, low = false) {
  ui.banner.textContent = text; ui.banner.classList.add('on');
  ui.banner.classList.toggle('low', low);
  clearTimeout(bannerT); if (ms) bannerT = setTimeout(hideBanner, ms);
}
function hideBanner() { if (ui.banner) ui.banner.classList.remove('on'); }
function hint(text, ms) {
  ui.hint.textContent = text; ui.hint.classList.add('on');
  clearTimeout(hintT); if (ms) hintT = setTimeout(hideHint, ms);
}
function hideHint() { if (ui.hint) ui.hint.classList.remove('on'); }
function noteLooked() {
  if (S.looked) return;
  S.looked = true;
  if (S.mode) hint(S.mode === 'place' ? '🟢 Now tap the grass where you should be' : S.mode === 'aim' ? '⚽ Now tap a teammate, a space or the goal' : tapHint(), 3200);
}

/* ---------------- input ---------------- */
const canLook = () => S.on && !S.lockLook && !(S.busy && !S.reveal);
function setLookButtons() { if (ui.l) ui.l.disabled = ui.r.disabled = !canLook(); }
function hitTest(x, y) {
  const c = S.hits.filter(h => x >= h.x0 - 6 && x <= h.x1 + 6 && y >= h.y0 - 6 && y <= h.y1 + 6);
  c.sort((a, b) => a.d - b.d);
  return c[0] || null;
}
function onTap(x, y) {
  if (!S.mode || S.busy || !S.onPick) return;
  let pick = null;
  if (S.mode === 'place') {
    const g = groundAt(x, y);
    if (!g) return hint('Tap the grass', 1500);
    S.mark = { kind: 'spot', pt: g }; pick = g;
  } else if (S.mode === 'aim') {
    const h = hitTest(x, y);
    if (h && h.kind === 'mate') { S.mark = { kind: 'mate', id: h.id }; pick = S.pos[h.id]; }
    else if (h && h.kind === 'goal') { S.mark = { kind: 'goal' }; pick = [20, 60.2]; }
    else {
      const g = groundAt(x, y);
      if (!g) return hint('Tap the grass, a teammate or the goal', 1500);
      S.mark = { kind: 'pt', pt: g }; pick = g;
    }
  } else if (S.mode === 'shot') {
    const g = goalPlaneAt(x, y);
    if (!g) return hint('Tap on their goal', 1500);
    S.mark = { kind: 'shot', gx: g[0], gy: g[1] };
    S.onPick({ x: g[0], y: g[1] });
    hideHint();
    return;
  }
  const used = S.onPick({ x: pick[0], y: pick[1] });
  if (used && S.mark.pt) S.mark.pt = [used.x, used.y];
  hideHint();
}
function bindInput() {
  let drag = null;
  cv.addEventListener('pointerdown', e => {
    if (!S.on || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, yaw: cam.yaw, pitch: cam.pitch, moved: false };
  });
  cv.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) > 8 && canLook()) { drag.moved = true; cv.classList.add('drag'); }
    if (drag.moved && canLook()) {
      cam.yaw = wrap(drag.yaw - dx / F); cam.pitch = clamp(drag.pitch - dy / F, PITCH_MIN, PITCH_MAX);
      S.look = null;
      if (Math.abs(dx) > 30) noteLooked();
    }
  });
  const end = (e, tap) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag; drag = null; cv.classList.remove('drag');
    if (tap && !d.moved) { const r = cv.getBoundingClientRect(); onTap(e.clientX - r.left, e.clientY - r.top); }
  };
  cv.addEventListener('pointerup', e => end(e, true));
  cv.addEventListener('pointercancel', e => end(e, false));
  for (const [b, dir] of [[ui.l, -1], [ui.r, 1]]) {
    b.addEventListener('pointerdown', e => { e.preventDefault(); if (!canLook()) return; try { b.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } S.turn = dir; S.look = null; });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, () => { S.turn = 0; });
  }
  const KEYS = { ArrowLeft: ['turn', -1], ArrowRight: ['turn', 1], ArrowUp: ['tilt', -1], ArrowDown: ['tilt', 1] };
  addEventListener('keydown', e => {
    const k = KEYS[e.key];
    if (!k || !canLook() || layer.hidden || host.classList.contains('pov-map')) return;
    const t = e.target, tagName = t && t.tagName;
    if (tagName === 'INPUT' || tagName === 'SELECT' || tagName === 'TEXTAREA') return;
    S[k[0]] = k[1]; S.look = null; e.preventDefault();
  });
  addEventListener('keyup', e => { const k = KEYS[e.key]; if (k) S[k[0]] = 0; });
}

function injectCSS() {
  if (document.getElementById('pov-css')) return;
  const st = document.createElement('style');
  st.id = 'pov-css';
  st.textContent = `
.pov-layer { position: absolute; inset: 0; border-radius: 1rem; overflow: hidden; background: #8fc7f2; -webkit-user-select: none; user-select: none; }
.pov-layer[hidden] { display: none; }
.pov-cv { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; cursor: grab; }
.pov-cv.tap { cursor: crosshair; }
.pov-cv.drag { cursor: grabbing; }
.pov-attack { position: absolute; left: .45rem; top: .4rem; display: flex; align-items: center; gap: .25rem; padding: .15rem .6rem .15rem .2rem; border-radius: 999px; background: rgba(15,23,42,.66); color: #fde68a; font-size: .8rem; font-weight: 700; white-space: nowrap; pointer-events: none; }
.pov-attack svg { width: 1.45rem; height: 1.45rem; flex: none; }
.pov-attack path { fill: #fbbf24; stroke: #78350f; stroke-width: 1; stroke-linejoin: round; }
.pov-compass { position: absolute; top: .5rem; left: 50%; transform: translateX(-50%); width: min(50%, 19rem); height: 1.7rem; border-radius: 999px; background: rgba(15,23,42,.55); overflow: hidden; pointer-events: none; }
.pov-compass::after { content: ''; position: absolute; left: 50%; top: 3px; bottom: 3px; width: 2px; margin-left: -1px; background: rgba(255,255,255,.7); border-radius: 2px; }
.pov-compass .mk { position: absolute; top: 50%; left: 0; font-size: .75rem; font-weight: 600; color: #fff; white-space: nowrap; }
.pov-look { position: absolute; top: 50%; transform: translateY(-50%); width: 2.6rem; height: 3.8rem; border: 0; border-radius: .9rem; background: rgba(15,23,42,.42); color: #fff; font: inherit; font-size: 1.2rem; cursor: pointer; touch-action: none; transition: opacity .2s; }
.pov-look:active { background: rgba(15,23,42,.65); }
.pov-look[disabled] { opacity: 0; pointer-events: none; }
.pov-l { left: .4rem; } .pov-r { right: .4rem; }
.pov-hint { position: absolute; left: 50%; bottom: .6rem; transform: translateX(-50%); max-width: calc(100% - 7rem); width: max-content; background: rgba(15,23,42,.74); color: #fff; padding: .3rem .8rem; border-radius: 999px; font-size: .85rem; font-weight: 600; text-align: center; opacity: 0; transition: opacity .35s; pointer-events: none; }
.pov-hint.on { opacity: 1; }
.pov-banner { position: absolute; left: 50%; top: 42%; width: 92%; text-align: center; transform: translate(-50%, -50%) scale(.85); font-size: clamp(1.4rem, 3.4vw, 2.6rem); font-weight: 700; color: #fff; text-shadow: 0 3px 14px rgba(0,0,0,.65), 0 0 2px rgba(0,0,0,.8); opacity: 0; transition: opacity .25s, transform .25s; pointer-events: none; }
.pov-banner.on { opacity: 1; transform: translate(-50%, -50%) scale(1); }
.pov-banner.low { top: 74%; }
.pov-chip { position: absolute; left: .5rem; top: 2.6rem; background: rgba(15,23,42,.6); color: #fff; padding: .3rem .7rem; border-radius: 999px; font-size: .8rem; font-weight: 600; pointer-events: none; }
.pov-chip[hidden], .pov-key[hidden], .pov-mapbtn[hidden] { display: none; }
.pov-key { position: absolute; left: .5rem; top: 2.7rem; display: grid; gap: .1rem; background: rgba(15,23,42,.62); color: #fff; padding: .4rem .65rem; border-radius: .7rem; font-size: .8rem; font-weight: 600; pointer-events: none; }
.pov-key i { display: inline-block; width: 1.1rem; height: .6rem; border-radius: .2rem; margin-right: .4rem; vertical-align: middle; }
.pov-mapbtn { position: absolute; right: .5rem; bottom: .5rem; border: 0; border-radius: 999px; padding: .35rem .75rem; background: rgba(255,255,255,.95); color: #0f172a; font: inherit; font-size: .85rem; font-weight: 700; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,.2); pointer-events: auto; }
.pitch-box.pov-map .pov-layer { background: transparent; pointer-events: none; }
.pitch-box.pov-map .pov-layer > :not(.pov-mapbtn) { display: none; }
@media (max-width: 600px) { .pov-look { width: 2.2rem; height: 3.2rem; font-size: 1rem; } .pov-hint { font-size: .78rem; max-width: calc(100% - 5.4rem); } .pov-compass { left: auto; right: .5rem; transform: none; width: calc(100% - 7.2rem); } .pov-compass .mk { font-size: .68rem; } .pov-attack { font-size: .7rem; padding-right: .45rem; } .pov-attack svg { width: 1.2rem; height: 1.2rem; } }
`;
  document.head.appendChild(st);
}

window.POV = {
  mount, start, stop, beats, moveAll, set, ask, runTo, shoot, outcome, cheer, positions, snap, restore,
  lookUp, lockLook, reveal, showRun, team, setMap, banner, hint,
  get on() { return S.on; },
  // for tests: the state, the camera, and where a point on the pitch shows on screen
  _S: S, _cam: cam, _proj: (x, y, z = 0) => { setBasis(); return proj(x, y, z); },
};
})();
