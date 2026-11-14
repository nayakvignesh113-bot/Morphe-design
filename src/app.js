'use strict';
// ---------------- data ----------------
const MATERIALS = {
  al6061: { name: 'Aluminium 6061-T6', E: 68900, nu: 0.33, Sy: 276, rho: 2700 },
  al5052: { name: 'Aluminium 5052-H32', E: 70300, nu: 0.33, Sy: 193, rho: 2680 },
  e250:   { name: 'Structural steel IS 2062 E250', E: 200000, nu: 0.30, Sy: 250, rho: 7850 },
  ss304:  { name: 'Stainless steel 304', E: 193000, nu: 0.29, Sy: 215, rho: 8000 },
  ti64:   { name: 'Titanium Ti-6Al-4V', E: 113800, nu: 0.34, Sy: 880, rho: 4430 },
  acry:   { name: 'Acrylic (PMMA) sheet', E: 3200, nu: 0.37, Sy: 60, rho: 1190 },
  pla:    { name: 'PLA, FDM printed', E: 3500, nu: 0.36, Sy: 40, rho: 1240 },
  pa12:   { name: 'Nylon PA12, SLS', E: 1700, nu: 0.40, Sy: 46, rho: 1010 },
};
const PROCESSES = {
  laser:  { name: 'Laser / plasma cut plate', minW: 3, cut: true },
  water:  { name: 'Waterjet cut plate', minW: 2.5, cut: true },
  mill:   { name: 'CNC milled plate (Ø6 end mill)', minW: 6, cut: false },
  fdm:    { name: 'FDM 3D print', minW: 2, cut: false },
  am:     { name: 'SLS / metal additive', minW: 1.2, cut: false },
  custom: { name: 'Custom minimum width', minW: null, cut: false },
};
const GAUGES = [0.5, 0.8, 1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 14, 16, 18, 20, 22, 25, 28, 30, 32, 36, 40, 45, 50, 60, 70, 80, 100];
const RES = { draft: 1800, std: 3200, fine: 6400 };
const VARIANTS = [
  { id: 'A', name: 'Lean', vf: 0.20, bold: false },
  { id: 'B', name: 'Balanced', vf: 0.30, bold: false },
  { id: 'C', name: 'Robust', vf: 0.45, bold: false },
  { id: 'D', name: 'Lean, bold webs', vf: 0.20, bold: true },
  { id: 'E', name: 'Balanced, bold webs', vf: 0.30, bold: true },
  { id: 'F', name: 'Robust, bold webs', vf: 0.45, bold: true },
];

const PRESETS = {
  cantilever: () => ({ W: 200, H: 100, sym: false, features: [
    { type: 'fix', dof: 'xy', x0: 0, y0: 0, x1: 0, y1: 100 },
    { type: 'load', x: 200, y: 50, fx: 0, fy: -2000 } ] }),
  beam: () => ({ W: 300, H: 75, sym: true, features: [
    { type: 'fix', dof: 'xy', x0: 0, y0: 0, x1: 6, y1: 0 },
    { type: 'fix', dof: 'y', x0: 294, y0: 0, x1: 300, y1: 0 },
    { type: 'load', x: 150, y: 75, fx: 0, fy: -3000 } ] }),
  lbracket: () => ({ W: 160, H: 160, sym: false, features: [
    { type: 'void', shape: 'rect', x0: 64, y0: 64, x1: 160, y1: 160 },
    { type: 'fix', dof: 'xy', x0: 0, y0: 160, x1: 64, y1: 160 },
    { type: 'load', x: 160, y: 32, fx: 0, fy: -1500 } ] }),
  shelf: () => ({ W: 150, H: 150, sym: false, features: [
    { type: 'fix', dof: 'xy', x0: 0, y0: 125, x1: 0, y1: 140 },
    { type: 'fix', dof: 'xy', x0: 0, y0: 10, x1: 0, y1: 25 },
    { type: 'solid', shape: 'rect', x0: 0, y0: 143, x1: 150, y1: 150 },
    { type: 'load', x: 50, y: 150, fx: 0, fy: -400 },
    { type: 'load', x: 100, y: 150, fx: 0, fy: -400 },
    { type: 'load', x: 148, y: 150, fx: 0, fy: -400 } ] }),
  multicase: () => ({ W: 200, H: 100, sym: false, features: [
    { type: 'fix', dof: 'xy', x0: 0, y0: 0, x1: 0, y1: 100 },
    { type: 'load', lc: 1, x: 200, y: 50, fx: 0, fy: -2000 },
    { type: 'load', lc: 2, x: 200, y: 50, fx: -1500, fy: 0 },
    { type: 'load', lc: 3, x: 200, y: 50, fx: 0, fy: 1000 } ] }),
  blank: () => ({ W: 200, H: 100, sym: false, features: [] }),
};

// ---------------- state ----------------
const S = {
  preset: 'cantilever', W: 200, H: 100, res: 'std', sym: false,
  lc: 1, nLC: 1, mat: 'al6061', proc: 'laser', minW: 3, fos: 2, bfs: 3, dlim: 0, autoT: true, tFix: 5,
  features: [], tool: 'load', supType: 'xy', voidShape: 'rect', view: 'shape',
  run: null, results: {}, selected: 'B', dirty: false, lastDisc: null,
};
const $ = (id) => document.getElementById(id);
const caseOf = (f) => f.lc || 1;
const numCases = () => Math.max(S.nLC || 1, ...S.features.filter(f => f.type === 'load').map(caseOf));
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const fmt = (v, d = 1) => (v === undefined || v === null || !isFinite(v)) ? '–' : v.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
let toastT;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600); }

function applyPreset(key, noSnap) {
  if (!noSnap) snapshot();
  const p = PRESETS[key]();
  S.preset = key; S.W = p.W; S.H = p.H; S.sym = p.sym; S.features = p.features;
  S.nLC = Math.max(1, ...p.features.filter(f => f.type === 'load').map(f => f.lc || 1)); S.lc = 1;
  syncInputs(); markDirty(); draw();
}

// ---------------- discretization ----------------
function discretize() {
  const N = RES[S.res];
  let h = Math.sqrt(S.W * S.H / N);
  const nelx = Math.max(8, Math.round(S.W / h)), nely = Math.max(4, Math.round(S.H / h));
  const hx = S.W / nelx, hy = S.H / nely; h = (hx + hy) / 2;
  const nel = nelx * nely, nn = (nelx + 1) * (nely + 1), ndof = 2 * nn;
  const colwise = nely <= nelx;
  const node = colwise ? (ix, iy) => ix * (nely + 1) + iy : (ix, iy) => iy * (nelx + 1) + ix;
  const nodeXY = (ix, iy) => [ix * hx, S.H - iy * hy];
  const passive = new Int8Array(nel), fixed = new Uint8Array(ndof);
  const inside = (f, x, y) => f.shape === 'circle' ? Math.hypot(x - f.cx, y - f.cy) <= f.r
    : x >= Math.min(f.x0, f.x1) && x <= Math.max(f.x0, f.x1) && y >= Math.min(f.y0, f.y1) && y <= Math.max(f.y0, f.y1);
  const center = (ix, iy) => [(ix + 0.5) * hx, S.H - (iy + 0.5) * hy];
  for (const f of S.features) if (f.type === 'solid') for (let ix = 0; ix < nelx; ix++) for (let iy = 0; iy < nely; iy++) { const [x, y] = center(ix, iy); if (inside(f, x, y)) passive[ix * nely + iy] = 2; }
  const padR = Math.max(1.6 * h, 0.6 * S.minW);
  const pads = [];
  const nearest = (x, y) => [Math.min(nelx, Math.max(0, Math.round(x / hx))), Math.min(nely, Math.max(0, Math.round((S.H - y) / hy)))];
  let nFixX = 0, nFixY = 0;
  const fixNodes = new Set();
  for (const f of S.features) if (f.type === 'fix') {
    const x0 = Math.min(f.x0, f.x1) - hx / 2, x1 = Math.max(f.x0, f.x1) + hx / 2, y0 = Math.min(f.y0, f.y1) - hy / 2, y1 = Math.max(f.y0, f.y1) + hy / 2;
    const hit = [];
    for (let ix = 0; ix <= nelx; ix++) for (let iy = 0; iy <= nely; iy++) { const [x, y] = nodeXY(ix, iy); if (x >= x0 && x <= x1 && y >= y0 && y <= y1) hit.push([ix, iy]); }
    if (!hit.length) hit.push(nearest((f.x0 + f.x1) / 2, (f.y0 + f.y1) / 2));
    for (const [ix, iy] of hit) { const n = node(ix, iy); fixNodes.add(n);
      if (f.dof !== 'y' && !fixed[2 * n]) { fixed[2 * n] = 1; nFixX++; }
      if (f.dof !== 'x' && !fixed[2 * n + 1]) { fixed[2 * n + 1] = 1; nFixY++; } }
    if (hit.length <= 5) for (const [ix, iy] of hit) pads.push(nodeXY(ix, iy));
  }
  let nLoads = 0, loadInVoid = false;
  const caseIds = [...new Set(S.features.filter(f => f.type === 'load').map(caseOf))].sort((a, b) => a - b);
  const Fs = caseIds.map(() => new Float64Array(ndof));
  for (const f of S.features) if (f.type === 'load') {
    const [ix, iy] = nearest(f.x, f.y), n = node(ix, iy), Fk = Fs[caseIds.indexOf(caseOf(f))];
    Fk[2 * n] += f.fx; Fk[2 * n + 1] += f.fy; nLoads++;
    pads.push(nodeXY(ix, iy));
  }
  for (const [px, py] of pads) for (let ix = 0; ix < nelx; ix++) for (let iy = 0; iy < nely; iy++) {
    const [x, y] = center(ix, iy); if (Math.hypot(x - px, y - py) <= padR) passive[ix * nely + iy] = 2; }
  for (const f of S.features) if (f.type === 'void') for (let ix = 0; ix < nelx; ix++) for (let iy = 0; iy < nely; iy++) {
    const [x, y] = center(ix, iy); if (inside(f, x, y)) { const e = ix * nely + iy; if (passive[e] === 2) loadInVoid = true; passive[e] = 1; } }
  const errors = [];
  if (!nLoads) errors.push('Add at least one load: pick the Load tool and tap where the force acts.');
  if (nFixX === 0 || nFixY === 0 || nFixX + nFixY < 3) errors.push('The part can still move or spin. Add a fixed support, or supports that hold it both horizontally and vertically.');
  if (loadInVoid) errors.push('A load or support sits inside a keep-out zone. Move it onto material.');
  const rmin0 = Math.max(1.5, 0.6 * S.minW / h);
  return { W: S.W, H: S.H, nelx, nely, hx, hy, h, nel, ndof, passive, Fs, caseIds, fixed, errors, rmin0, nu: MATERIALS[S.mat].nu };
}

// ---------------- worker pool ----------------
const workerURL = URL.createObjectURL(new Blob([$('worker-src').textContent], { type: 'text/javascript' }));
let pool = [];
function startRun() {
  const d = discretize();
  if (d.errors.length) { showBanner(d.errors.join(' '), true); return; }
  pool.forEach(w => w.terminate()); pool = [];
  const runId = Date.now();
  S.run = { runId, disc: d, queue: [], active: 0, done: 0, total: VARIANTS.length + 1, started: performance.now() };
  S.results = {}; S.dirty = false; S.lastDisc = d; showBanner(symmetryIssue());
  const rB = Math.max(2.5, 1.8 * d.rmin0);
  const base = { runId, nelx: d.nelx, nely: d.nely, nu: d.nu, Fs: d.Fs, fixed: d.fixed, passive: d.passive, h: d.h, minWidth: S.minW, symX: S.sym, enforceWidth: true };
  S.run.queue.push({ ...base, jobId: 'base', kind: 'eval' });
  for (const v of VARIANTS) S.run.queue.push({ ...base, jobId: v.id, kind: 'opt', vf: v.vf, rmin: v.bold ? rB : d.rmin0, maxIter: 110, penal: 3 });
  for (const j of S.run.queue) S.results[j.jobId] = { id: j.jobId, status: 'queued', it: 0, x: null, ev: null };
  if (!S.results[S.selected]) S.selected = 'B';
  const nW = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
  for (let i = 0; i < nW; i++) { const w = new Worker(workerURL); w.onmessage = onWorker; pool.push(w); feed(w); }
  $('go').textContent = 'Restart'; $('go').classList.remove('stale');
  $('runinfo').textContent = `${d.nelx} × ${d.nely} elements (${fmt(d.h, 2)} mm), ${nW} parallel solver${nW > 1 ? 's' : ''}.`;
  buildGallery(); renderAll();
}
function feed(w) {
  const r = S.run; if (!r || !r.queue.length) return;
  const job = r.queue.shift(); r.active++; S.results[job.jobId].status = 'running'; w.postMessage(job);
}
function onWorker(m) {
  const d = m.data; if (!S.run || d.runId !== S.run.runId) return;
  const R = S.results[d.jobId];
  if (d.type === 'iter') { R.x = d.x; R.it = d.it; R.beta = d.beta; updateCard(d.jobId); if (d.jobId === S.selected) draw(); return; }
  S.run.active--; S.run.done++;
  if (d.type === 'error') { R.status = 'error'; R.error = d.message; }
  else { R.status = 'done'; R.x = d.x; R.ev = d.ev; R.it = d.it; }
  feed(m.target);
  if (S.run.done === S.run.total) { S.run.finished = performance.now(); computeDistinct(); if (!S.dirty) $('go').textContent = 'Generate designs'; pool.forEach(w => w.terminate()); pool = []; }
  renderAll();
}

// ---------------- metrics ----------------
function gaugeUp(t) { for (const g of GAUGES) if (g >= t - 1e-9) return g; return Math.ceil(t); }
function metrics(R) {
  if (!R || !R.ev || !S.lastDisc) return null;
  const d = S.lastDisc, M = MATERIALS[S.mat], ev = R.ev;
  const area = ev.nSolid * d.hx * d.hy;
  const tS = ev.vmMax * S.fos / M.Sy;
  const tD = S.dlim > 0 ? ev.dLoad / (M.E * S.dlim) : 0;
  const lamHat = ev.lamB, tB = isFinite(lamHat) && lamHat > 0 ? Math.cbrt(S.bfs / (lamHat * M.E)) : 0;
  const tReq = Math.max(tS, tD, tB);
  const multi = d.caseIds.length > 1, cn = (k) => multi ? ` (load case ${d.caseIds[k || 0]})` : '';
  const governs = (tReq === tB && tB > 0 ? 'buckling' + cn(ev.lamCase) : tReq === tD && tD > 0 ? 'deflection' + cn(ev.dCase) : 'stress' + cn(ev.vmCase));
  const t = S.autoT ? gaugeUp(tReq) : S.tFix;
  const sig = ev.vmMax / t, fos = M.Sy / sig, defl = ev.dLoad / (M.E * t), dmax = ev.dMax / (M.E * t);
  const mass = M.rho * 1e-9 * area * t * 1000;
  const Fd = d.Fs[ev.dCase || 0]; let Ftot = 0; for (let i = 0; i < Fd.length; i++) Ftot += Fd[i] * Fd[i]; Ftot = Math.sqrt(Ftot);
  const blf = isFinite(lamHat) ? lamHat * M.E * t * t * t : Infinity;
  const pass = fos >= S.fos - 1e-9 && (!(S.dlim > 0) || defl <= S.dlim + 1e-12) && blf >= S.bfs * (1 - 1e-9) && !ev.brokenLoads;
  const thinPct = ev.nSolid ? ev.thinCount / ev.nSolid * 100 : 0;
  const webWarn = PROCESSES[S.proc].cut && t > S.minW * 1.5;
  return { cn, multi, blf, governs, area, tReq, t, sig, fos, defl, dmax, mass, stiff: defl > 0 ? Ftot / defl : 0, pass, thinPct, webWarn, holes: ev.holes, added: ev.added * d.hx * d.hy };
}
function computeDistinct() {
  const ids = VARIANTS.map(v => v.id).filter(id => S.results[id] && S.results[id].ev);
  for (const a of ids) {
    let s = 0, n = 0; const A = S.results[a].ev.solid;
    for (const b of ids) { if (a === b) continue; const B = S.results[b].ev.solid; let I = 0, U = 0;
      for (let e = 0; e < A.length; e++) { if (A[e] && B[e]) I++; if (A[e] || B[e]) U++; } s += U ? 1 - I / U : 0; n++; }
    S.results[a].distinct = n ? s / n * 100 : 0;
  }
}
function recommended() {
  let best = null, bm = Infinity;
  for (const v of VARIANTS) { const m = metrics(S.results[v.id]); if (m && m.pass && m.mass < bm) { bm = m.mass; best = v.id; } }
  return best;
}

// ---------------- canvas: main stage ----------------
const stage = $('stage');
let view = { ox: 0, oy: 0, s: 1, cw: 0, ch: 0 };
function layoutStage() {
  const cw = stage.parentElement.clientWidth - 24;
  const ml = 44, mr = 18, mt = 18, mb = 40;
  const maxH = Math.min(560, Math.max(260, window.innerHeight * 0.58));
  const s = Math.min((cw - ml - mr) / S.W, (maxH - mt - mb) / S.H);
  const ch = mt + mb + S.H * s;
  const dpr = window.devicePixelRatio || 1;
  stage.width = Math.round(cw * dpr); stage.height = Math.round(ch * dpr);
  stage.style.height = ch + 'px';
  view = { ox: ml + ((cw - ml - mr) - S.W * s) / 2, oy: mt, s, cw, ch, dpr };
}
const P = (x, y) => [view.ox + x * view.s, view.oy + (S.H - y) * view.s];
function colormap(t) {
  const st = [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]];
  t = Math.max(0, Math.min(1, t)) * 4; const i = Math.min(3, Math.floor(t)), f = t - i;
  return st[i].map((c, k) => Math.round(c + (st[i + 1][k] - c) * f));
}
function hexRGB(hex) { const h = hex.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }

function fieldImage(R, mode, w, h) {
  const d = S.lastDisc, nelx = d.nelx, nely = d.nely;
  const nid = nely <= nelx ? (ix, iy) => ix * (nely + 1) + iy : (ix, iy) => iy * (nelx + 1) + ix;
  const nodeOf = (ix, iy, a) => a === 0 ? nid(ix, iy + 1) : a === 1 ? nid(ix + 1, iy + 1) : a === 2 ? nid(ix + 1, iy) : nid(ix, iy);
  const cv = document.createElement('canvas'); cv.width = nelx; cv.height = nely;
  const g = cv.getContext('2d'), img = g.createImageData(nelx, nely);
  const ink = hexRGB(css('--ink')), bad = hexRGB(css('--bad'));
  const M = MATERIALS[S.mat], m = metrics(R);
  for (let ix = 0; ix < nelx; ix++) for (let iy = 0; iy < nely; iy++) {
    const e = ix * nely + iy, p = (iy * nelx + ix) * 4;
    let rgb = ink, a = 0;
    if (R.ev && mode !== 'live') {
      if (R.ev.solid[e]) {
        a = 255;
        if (mode === 'stress' && m) rgb = colormap(R.ev.vm[e] / m.t / (M.Sy / S.fos));
        if (mode === 'thin' && R.ev.thin[e]) rgb = bad;
        if (mode === 'buckle' && R.ev.modeB) { let s2 = 0; for (let a = 0; a < 4; a++) s2 += Math.abs(R.ev.modeB[nodeOf(ix, iy, a)]); rgb = colormap(s2 / 4); }
      }
    } else if (R.x) a = Math.round(255 * Math.max(0, Math.min(1, R.x[e])));
    img.data[p] = rgb[0]; img.data[p + 1] = rgb[1]; img.data[p + 2] = rgb[2]; img.data[p + 3] = a;
  }
  g.putImageData(img, 0, 0);
  return cv;
}

function draw() {
  layoutStage();
  const g = stage.getContext('2d'), dpr = view.dpr;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, view.cw, view.ch);
  const [x0, y0] = P(0, S.H), Wp = S.W * view.s, Hp = S.H * view.s;
  // paper + grid every 10 mm
  g.fillStyle = css('--paper'); g.fillRect(x0, y0, Wp, Hp);
  g.strokeStyle = css('--grid'); g.lineWidth = 1; g.beginPath();
  const step = S.W > 400 || S.H > 400 ? 50 : 10;
  for (let x = step; x < S.W; x += step) { const [px] = P(x, 0); g.moveTo(Math.round(px) + .5, y0); g.lineTo(Math.round(px) + .5, y0 + Hp); }
  for (let y = step; y < S.H; y += step) { const [, py] = P(0, y); g.moveTo(x0, Math.round(py) + .5); g.lineTo(x0 + Wp, Math.round(py) + .5); }
  g.stroke();
  // design
  const R = S.results[S.selected];
  const geomOK = R && S.lastDisc && S.lastDisc.nelx && R.x;
  if (geomOK) {
    if (S.view === 'deform' && R.ev) drawDeformed(g, R);
    else {
      const mode = R.ev ? (S.view === 'deform' ? 'shape' : S.view) : 'live';
      const dd = S.lastDisc, [dx0, dy0] = P(0, dd.H);
      g.save(); g.globalAlpha = S.dirty ? 0.25 : 1; g.imageSmoothingEnabled = true;
      g.drawImage(fieldImage(R, mode), dx0, dy0, dd.W * view.s, dd.H * view.s); g.restore();
    }
  }
  // domain outline
  g.strokeStyle = css('--muted'); g.lineWidth = 1; g.setLineDash([4, 3]); g.strokeRect(x0 + .5, y0 + .5, Wp - 1, Hp - 1); g.setLineDash([]);
  drawFeatures(g);
  drawDims(g);
  if (drag && drag.preview) drawPreview(g);
  drawLegend();
}

function hatch(g, color) {
  const c = document.createElement('canvas'); c.width = c.height = 8; const h = c.getContext('2d');
  h.strokeStyle = color; h.lineWidth = 1; h.beginPath(); h.moveTo(0, 8); h.lineTo(8, 0); h.stroke();
  return g.createPattern(c, 'repeat');
}
function rectPx(f) { const [ax, ay] = P(Math.min(f.x0, f.x1), Math.max(f.y0, f.y1)), [bx, by] = P(Math.max(f.x0, f.x1), Math.min(f.y0, f.y1)); return [ax, ay, bx - ax, by - ay]; }
function drawFeatures(g) {
  const accent = css('--accent'), load = css('--load'), muted = css('--muted'), ink = css('--ink');
  for (const f of S.features) {
    if (f.type === 'void' || f.type === 'solid') {
      g.save();
      g.fillStyle = f.type === 'void' ? hatch(g, muted) : hatch(g, ink);
      g.strokeStyle = f.type === 'void' ? muted : ink; g.lineWidth = 1.2; g.setLineDash(f.type === 'void' ? [5, 3] : []);
      g.globalAlpha = 0.85;
      if (f.shape === 'circle') { const [cx, cy] = P(f.cx, f.cy); g.beginPath(); g.arc(cx, cy, f.r * view.s, 0, Math.PI * 2); g.fill(); g.stroke(); }
      else { const [x, y, w, h] = rectPx(f); g.fillRect(x, y, w, h); g.strokeRect(x, y, w, h); }
      g.restore();
    }
  }
  for (const f of S.features) if (f.type === 'fix') {
    let [x, y, w, h] = rectPx(f);
    if (w < 6) { x -= (6 - w) / 2; w = 6; } if (h < 6) { y -= (6 - h) / 2; h = 6; }
    g.save(); g.fillStyle = accent; g.globalAlpha = 0.22; g.fillRect(x, y, w, h); g.globalAlpha = 1;
    g.strokeStyle = accent; g.lineWidth = 1.5; g.strokeRect(x, y, w, h);
    // symbols along the long axis, placed outside the domain edge when the support lies on one
    const vertical = h >= w, n = Math.max(1, Math.floor((vertical ? h : w) / 16));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n, sx = vertical ? x + w / 2 : x + t * w, sy = vertical ? y + t * h : y + h / 2;
      g.fillStyle = accent; g.strokeStyle = accent;
      if (f.dof === 'xy') { g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx - 5, sy + 8); g.lineTo(sx + 5, sy + 8); g.closePath(); if (vertical) { g.save(); g.translate(sx, sy); g.rotate(Math.PI / 2); g.translate(-sx, -sy); g.fill(); g.restore(); } else g.fill(); }
      else { g.beginPath(); g.arc(sx + (f.dof === 'x' ? -6 : 0), sy + (f.dof === 'y' ? 6 : 0), 3.5, 0, Math.PI * 2); g.lineWidth = 1.5; g.stroke(); }
    }
    g.restore();
  }
  const multiLC = numCases() > 1, sameSpot = {};
  for (const f of S.features) if (f.type === 'load') {
    const mag = Math.hypot(f.fx, f.fy) || 1, [tx, ty] = P(f.x, f.y);
    const spot = Math.round(tx / 4) + ',' + Math.round(ty / 4), nth = sameSpot[spot] = (sameSpot[spot] || 0) + 1;
    const ux = f.fx / mag, uy = -f.fy / mag, L = 46;
    const sx = tx - ux * L, sy = ty - uy * L;
    g.save(); g.strokeStyle = load; g.fillStyle = load; g.lineWidth = 2.5;
    if (multiLC && caseOf(f) !== S.lc) { g.globalAlpha = 0.4; g.setLineDash([5, 3]); }
    g.beginPath(); g.moveTo(sx, sy); g.lineTo(tx - ux * 8, ty - uy * 8); g.stroke();
    g.beginPath(); g.moveTo(tx, ty); g.lineTo(tx - ux * 11 - uy * 5, ty - uy * 11 + ux * 5); g.lineTo(tx - ux * 11 + uy * 5, ty - uy * 11 - ux * 5); g.closePath(); g.fill();
    g.font = `600 12px ${css('--font-mono')}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    const label = (multiLC ? `C${caseOf(f)} ` : '') + (mag >= 1000 ? fmt(mag / 1000, 2) + ' kN' : fmt(mag, 0) + ' N');
    g.setLineDash([]);
    const tw = g.measureText(label).width / 2 + 4;
    const lx = Math.max(tw, Math.min(view.cw - tw, sx - ux * 14 + (Math.abs(uy) > .7 ? (tx > view.cw - 60 ? -26 : 0) : 0)));
    g.fillText(label, lx, sy - uy * 12 + (Math.abs(uy) > .7 ? (uy > 0 ? -2 : 2) : 0) + (nth > 1 && Math.abs(uy) <= .7 ? (nth - 1) * 14 : 0));
    g.restore();
  }
}
function drawDims(g) {
  const muted = css('--muted'); g.save(); g.strokeStyle = muted; g.fillStyle = muted; g.lineWidth = 1;
  g.font = `12px ${css('--font-mono')}`; g.textAlign = 'center'; g.textBaseline = 'top';
  const [ax, ay] = P(0, 0), [bx] = P(S.W, 0), yb = ay + 18;
  g.beginPath(); g.moveTo(ax, ay + 6); g.lineTo(ax, yb + 4); g.moveTo(bx, ay + 6); g.lineTo(bx, yb + 4); g.moveTo(ax, yb); g.lineTo(bx, yb); g.stroke();
  const arrow = (x, y, dx, dy) => { g.beginPath(); g.moveTo(x, y); g.lineTo(x + dx * 7 - dy * 3, y + dy * 7 + dx * 3); g.lineTo(x + dx * 7 + dy * 3, y + dy * 7 - dx * 3); g.closePath(); g.fill(); };
  arrow(ax, yb, 1, 0); arrow(bx, yb, -1, 0);
  g.fillStyle = css('--paper'); const lw = g.measureText(S.W + '').width + 8; g.fillRect((ax + bx) / 2 - lw / 2, yb - 7, lw, 14);
  g.fillStyle = muted; g.textBaseline = 'middle'; g.fillText(fmt(S.W, 0), (ax + bx) / 2, yb);
  const [, ty] = P(0, S.H), xl = ax - 20;
  g.beginPath(); g.moveTo(ax - 6, ty); g.lineTo(xl - 4, ty); g.moveTo(ax - 6, ay); g.lineTo(xl - 4, ay); g.moveTo(xl, ty); g.lineTo(xl, ay); g.stroke();
  arrow(xl, ty, 0, 1); arrow(xl, ay, 0, -1);
  g.save(); g.translate(xl, (ty + ay) / 2); g.rotate(-Math.PI / 2);
  g.fillStyle = css('--panel'); const hw = g.measureText(S.H + '').width + 8; g.fillRect(-hw / 2, -7, hw, 14);
  g.fillStyle = muted; g.fillText(fmt(S.H, 0), 0, 0); g.restore();
  g.restore();
}
function drawDeformed(g, R) {
  const d = S.lastDisc, ev = R.ev, U = ev.U, nely = d.nely, nelx = d.nelx;
  const colwise = nely <= nelx, node = colwise ? (ix, iy) => ix * (nely + 1) + iy : (ix, iy) => iy * (nelx + 1) + ix;
  let umax = 0; for (let i = 0; i < U.length; i += 2) umax = Math.max(umax, Math.hypot(U[i], U[i + 1]));
  const k = umax ? 0.07 * Math.max(d.W, d.H) / umax : 0;
  const pt = (ix, iy) => { const n = node(ix, iy); return P(ix * d.hx + k * U[2 * n], d.H - iy * d.hy + k * U[2 * n + 1]); };
  g.save(); g.globalAlpha = 0.18; g.drawImage(fieldImage(R, 'shape'), ...P(0, d.H), d.W * view.s, d.H * view.s); g.globalAlpha = 1;
  g.fillStyle = css('--accent'); g.beginPath();
  for (let ix = 0; ix < nelx; ix++) for (let iy = 0; iy < nely; iy++) {
    if (!ev.solid[ix * nely + iy]) continue;
    const a = pt(ix, iy + 1), b = pt(ix + 1, iy + 1), c = pt(ix + 1, iy), e = pt(ix, iy);
    g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]); g.lineTo(e[0], e[1]); g.closePath();
  }
  g.fill(); g.restore();
}
function drawLegend() {
  const L = $('legend'), m = metrics(S.results[S.selected]);
  if (S.view === 'stress' && m) {
    const M = MATERIALS[S.mat];
    L.innerHTML = `<span>von Mises at ${fmt(m.t, 1)} mm${m.multi ? ', worst of all load cases' : ''}</span><canvas id="cbar" width="160" height="10"></canvas><span class="mono">0 → ${fmt(M.Sy / S.fos, 0)} MPa (allowable = yield ÷ FoS)</span><span>· peak ${fmt(m.sig, 0)} MPa · yellow means fully used</span>`;
    const c = $('cbar').getContext('2d'); for (let i = 0; i < 160; i++) { const [r, gg, b] = colormap(i / 159); c.fillStyle = `rgb(${r},${gg},${b})`; c.fillRect(i, 0, 1, 10); }
  } else if (S.view === 'deform' && m) L.innerHTML = `<span>Deflected shape, exaggerated. Real deflection at the load: <b class="mono">${fmt(m.defl, 3)} mm</b>${m.cn(S.results[S.selected].ev.dCase)}</span>`;
  else if (S.view === 'buckle' && m) L.innerHTML = isFinite(m.blf) ? `<span>First out-of-plane buckling mode (relative amplitude). It buckles at <b class="mono">${fmt(m.blf, 2)}×</b> the applied loads at ${fmt(m.t, 1)} mm${m.cn(S.results[S.selected].ev.lamCase)}.</span>` : '<span>No part of this design is in compression, so it cannot buckle.</span>';
  else if (S.view === 'thin' && m) L.innerHTML = `<span>Red: material narrower than ${fmt(S.minW, 1)} mm · ${fmt(m.thinPct, 1)}% of the part</span>`;
  else L.innerHTML = '';
}

// ---------------- interaction ----------------
let drag = null;
function toMM(ev) { const r = stage.getBoundingClientRect(); const px = ev.clientX - r.left, py = ev.clientY - r.top;
  return [Math.max(0, Math.min(S.W, (px - view.ox) / view.s)), Math.max(0, Math.min(S.H, S.H - (py - view.oy) / view.s)), px, py]; }
stage.addEventListener('pointerdown', (ev) => {
  stage.setPointerCapture(ev.pointerId);
  const [x, y, px, py] = toMM(ev); drag = { x0: x, y0: y, x1: x, y1: y, px, py, moved: false, preview: S.tool !== 'erase' };
  draw();
});
stage.addEventListener('pointermove', (ev) => {
  if (!drag) { const [x, y] = toMM(ev); $('tip').textContent = `x ${fmt(x, 1)} mm, y ${fmt(y, 1)} mm · ` + toolTip(); return; }
  const [x, y, px, py] = toMM(ev); drag.x1 = x; drag.y1 = y; if (Math.hypot(px - drag.px, py - drag.py) > 6) drag.moved = true; draw();
});
stage.addEventListener('pointerup', (ev) => {
  if (!drag) return; const d = drag; drag = null;
  const snap = (v) => Math.round(v * 2) / 2;
  snapshot();
  if (S.tool === 'erase') { if (!eraseAt(d.x0, d.y0)) undoStack.pop(); }
  else if (S.tool === 'load') {
    let fx = 0, fy = -1000;
    if (d.moved) { const ang = Math.atan2(d.y1 - d.y0, d.x1 - d.x0), sn = Math.round(ang / (Math.PI / 12)) * (Math.PI / 12); fx = Math.round(1000 * Math.cos(sn)); fy = Math.round(1000 * Math.sin(sn)); }
    S.features.push({ type: 'load', lc: S.lc, x: snap(d.x0), y: snap(d.y0), fx, fy });
  } else if (S.tool === 'support') {
    S.features.push({ type: 'fix', dof: S.supType, x0: snap(d.x0), y0: snap(d.y0), x1: snap(d.x1), y1: snap(d.y1) });
  } else if (S.tool === 'void' || S.tool === 'solid') {
    if (S.tool === 'void' && S.voidShape === 'circle') { const r = Math.hypot(d.x1 - d.x0, d.y1 - d.y0); if (r > 1) S.features.push({ type: 'void', shape: 'circle', cx: snap(d.x0), cy: snap(d.y0), r: snap(r) }); }
    else if (Math.abs(d.x1 - d.x0) > 1 && Math.abs(d.y1 - d.y0) > 1) S.features.push({ type: S.tool, shape: 'rect', x0: snap(d.x0), y0: snap(d.y0), x1: snap(d.x1), y1: snap(d.y1) });
  }
  markDirty(); renderFeats(); draw();
});
stage.addEventListener('pointercancel', () => { drag = null; draw(); });
function drawPreview(g) {
  const d = drag, accent = css('--accent'); g.save(); g.strokeStyle = S.tool === 'load' ? css('--load') : accent; g.lineWidth = 1.5; g.setLineDash([4, 3]);
  const [ax, ay] = P(d.x0, d.y0), [bx, by] = P(d.x1, d.y1);
  if (S.tool === 'load') { g.beginPath(); g.arc(ax, ay, 5, 0, Math.PI * 2); g.stroke(); if (d.moved) { g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke(); } }
  else if (S.tool === 'void' && S.voidShape === 'circle') { g.beginPath(); g.arc(ax, ay, Math.hypot(bx - ax, by - ay), 0, Math.PI * 2); g.stroke(); }
  else g.strokeRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax) || 2, Math.abs(by - ay) || 2);
  g.restore();
}
function eraseAt(x, y) {
  const tol = 12 / view.s;
  for (let i = S.features.length - 1; i >= 0; i--) {
    const f = S.features[i]; let hit = false;
    if (f.type === 'load') hit = Math.hypot(f.x - x, f.y - y) < tol * 1.5;
    else if (f.shape === 'circle') hit = Math.hypot(f.cx - x, f.cy - y) <= f.r + tol;
    else hit = x >= Math.min(f.x0, f.x1) - tol && x <= Math.max(f.x0, f.x1) + tol && y >= Math.min(f.y0, f.y1) - tol && y <= Math.max(f.y0, f.y1) + tol;
    if (hit) { S.features.splice(i, 1); return true; }
  }
  return false;
}
function toolTip() {
  return { support: 'Drag along an edge to hold it. Tap for a single bolt point.', load: 'Tap to place a 1 kN downward load, or drag to set its direction. Edit the value below.',
    void: 'Drag to mark a zone that must stay empty (clearance, other parts).', solid: 'Drag to mark material that must stay (flanges, mounting faces).', erase: 'Tap a support, load or zone to remove it.' }[S.tool];
}
function setTool(t) { S.tool = t; document.querySelectorAll('#tools button').forEach(b => b.setAttribute('aria-pressed', b.dataset.tool === t)); $('suptype').style.display = t === 'support' ? '' : 'none'; $('voidshape').style.display = t === 'void' ? '' : 'none'; $('tip').textContent = toolTip(); }
document.querySelectorAll('#tools button').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
document.querySelectorAll('#views button').forEach(b => b.addEventListener('click', () => { S.view = b.dataset.view; document.querySelectorAll('#views button').forEach(c => c.setAttribute('aria-pressed', c === b)); draw(); }));
$('suptype').addEventListener('change', e => S.supType = e.target.value);
function renderCases() { const sel = $('lcsel'), n = numCases(); if (S.lc > n) S.lc = n;
  sel.innerHTML = Array.from({ length: n }, (_, k) => `<option value="${k + 1}">Load case ${k + 1}</option>`).join(''); sel.value = S.lc; }
$('lcsel').addEventListener('change', e => { S.lc = +e.target.value; setTool('load'); draw(); });
$('lcadd').addEventListener('click', () => { S.nLC = numCases() + 1; S.lc = S.nLC; renderCases(); renderFeats(); setTool('load'); draw(); toast(`Load case ${S.lc}: new loads go here. Each design must survive every case.`); });
$('voidshape').addEventListener('change', e => S.voidShape = e.target.value);

function renderFeats() {
  const box = $('feats'); box.innerHTML = '';
  let nl = 0, ns = 0, nv = 0, nk = 0;
  S.features.forEach((f, i) => {
    const row = document.createElement('div'); row.className = 'feat';
    if (f.type === 'load') {
      nl++; row.innerHTML = `<span class="tag load">Load ${nl}</span><label>Case <select id="lcf${i}">${Array.from({ length: numCases() }, (_, k) => `<option value="${k + 1}"${caseOf(f) === k + 1 ? ' selected' : ''}>${k + 1}</option>`).join('')}</select></label><span class="mono">at (${fmt(f.x, 1)}, ${fmt(f.y, 1)}) mm</span>
        <label>Fx <input type="number" step="50" id="fx${i}" value="${f.fx}"></label><label>Fy <input type="number" step="50" id="fy${i}" value="${f.fy}"></label><span class="hint">N, +y up</span>`;
      row.querySelector(`#lcf${i}`).addEventListener('change', e => { snapshot(); f.lc = +e.target.value; markDirty(); renderFeats(); draw(); });
      row.querySelector(`#fx${i}`).addEventListener('change', e => { snapshot(); f.fx = +e.target.value || 0; markDirty(); draw(); });
      row.querySelector(`#fy${i}`).addEventListener('change', e => { snapshot(); f.fy = +e.target.value || 0; markDirty(); draw(); });
    } else if (f.type === 'fix') {
      ns++; row.innerHTML = `<span class="tag sup">Support ${ns}</span><select id="st${i}" aria-label="Support type"><option value="xy">Fixed (bolted)</option><option value="y">Slides horizontally</option><option value="x">Slides vertically</option></select>
        <span class="mono">(${fmt(Math.min(f.x0, f.x1), 0)}, ${fmt(Math.min(f.y0, f.y1), 0)}) to (${fmt(Math.max(f.x0, f.x1), 0)}, ${fmt(Math.max(f.y0, f.y1), 0)}) mm</span>`;
      const s = row.querySelector('select'); s.value = f.dof; s.addEventListener('change', e => { snapshot(); f.dof = e.target.value; markDirty(); draw(); });
    } else if (f.type === 'void') { nv++; row.innerHTML = `<span class="tag">Keep-out ${nv}</span><span class="mono">${f.shape === 'circle' ? `Ø${fmt(2 * f.r, 1)} at (${fmt(f.cx, 1)}, ${fmt(f.cy, 1)})` : `${fmt(Math.abs(f.x1 - f.x0), 1)} × ${fmt(Math.abs(f.y1 - f.y0), 1)}`} mm</span>`; }
    else { nk++; row.innerHTML = `<span class="tag">Keep-solid ${nk}</span><span class="mono">${fmt(Math.abs(f.x1 - f.x0), 1)} × ${fmt(Math.abs(f.y1 - f.y0), 1)} mm</span>`; }
    const x = document.createElement('button'); x.className = 'x'; x.setAttribute('aria-label', 'Remove'); x.textContent = '×';
    x.addEventListener('click', () => { snapshot(); S.features.splice(i, 1); markDirty(); renderFeats(); draw(); }); row.appendChild(x);
    box.appendChild(row);
  });
}
const undoStack = [];
function snapshot() { undoStack.push(JSON.stringify({ W: S.W, H: S.H, sym: S.sym, features: S.features })); if (undoStack.length > 60) undoStack.shift(); $('undo').disabled = false; }
function undo() { const st = undoStack.pop(); if (!st) return; const o = JSON.parse(st); Object.assign(S, o); $('undo').disabled = !undoStack.length; syncInputs(); markDirty(); draw(); }
function persist() { try { localStorage.setItem('morphe.project.v1', projectJSON()); } catch (e) { /* storage unavailable */ } }
function symmetryIssue() {
  if (!S.sym) return '';
  const tol = Math.max(1, S.W / 100), W = S.W;
  const key = f => f.type === 'load' ? [f.x, f.y, f.fx, f.fy] : f.shape === 'circle' ? [f.cx, f.cy, f.r] : [Math.min(f.x0, f.x1), Math.min(f.y0, f.y1), Math.max(f.x0, f.x1), Math.max(f.y0, f.y1)];
  const mirror = f => f.type === 'load' ? [W - f.x, f.y, -f.fx, f.fy] : f.shape === 'circle' ? [W - f.cx, f.cy, f.r] : (() => { const k = key(f); return [W - k[2], k[1], W - k[0], k[3]]; })();
  for (const f of S.features) {
    const m = mirror(f);
    const ok = S.features.some(g => g.type === f.type && (f.type !== 'load' || caseOf(g) === caseOf(f)) && (g.shape || '') === (f.shape || '') && key(g).every((v, i) => Math.abs(v - m[i]) <= (f.type === 'load' && i > 1 ? 1 : tol)));
    if (!ok) return 'Mirror symmetry is on, but the supports, loads or zones are not mirror-symmetric. The designs will be symmetric anyway; turn symmetry off for an asymmetric load case.';
  }
  return '';
}
function markDirty() { persist(); if (Object.keys(S.results).length) { S.dirty = true; $('go').classList.add('stale'); $('go').textContent = 'Regenerate designs'; showBanner('Setup changed. The designs shown are from the previous setup. Press Regenerate designs to update them.'); } }
function showBanner(msg, err) { const b = $('banner'); b.textContent = msg; b.className = 'banner' + (msg ? ' show' : '') + (err ? ' err' : ''); }

// ---------------- gallery / summary / detail ----------------
function buildGallery() {
  const gal = $('gallery'); gal.innerHTML = '';
  const items = [{ id: 'base', name: 'Solid plate (reference)' }, ...VARIANTS.map(v => ({ id: v.id, name: v.name }))];
  for (const it of items) {
    const b = document.createElement('button'); b.className = 'card'; b.id = 'card-' + it.id; b.setAttribute('aria-pressed', it.id === S.selected);
    b.innerHTML = `<canvas width="${S.lastDisc.nelx}" height="${S.lastDisc.nely}"></canvas><div class="head"><span class="letter">${it.id === 'base' ? '◻' : it.id}</span><span class="name">${it.name}</span></div>
      <div class="chips"></div><div class="stats"></div><div class="bar"><i></i></div>`;
    b.addEventListener('click', () => { S.selected = it.id; document.querySelectorAll('.card').forEach(c => c.setAttribute('aria-pressed', c === b)); renderDetail(); draw(); });
    gal.appendChild(b); updateCard(it.id);
  }
}
function updateCard(id) {
  const c = $('card-' + id), R = S.results[id]; if (!c || !R) return;
  const cv = c.querySelector('canvas'), g = cv.getContext('2d');
  g.fillStyle = css('--paper'); g.fillRect(0, 0, cv.width, cv.height);
  if (R.x) g.drawImage(fieldImage(R, R.ev ? 'shape' : 'live'), 0, 0);
  const bar = c.querySelector('.bar i');
  bar.style.width = (R.status === 'done' ? 100 : Math.min(98, R.it / 110 * 100)) + '%';
  c.querySelector('.bar').style.visibility = R.status === 'done' ? 'hidden' : 'visible';
  const st = c.querySelector('.stats'), ch = c.querySelector('.chips'), m = metrics(R);
  if (R.status === 'error') { ch.innerHTML = `<span class="chip bad">Solver error</span>`; return; }
  if (!m) { st.innerHTML = `<span>${R.status === 'queued' ? 'Waiting' : 'Iteration ' + R.it}</span>`; ch.innerHTML = ''; return; }
  st.innerHTML = `<span>Mass</span><b>${fmt(m.mass, m.mass < 100 ? 1 : 0)} g</b><span>Plate</span><b>${fmt(m.t, 1)} mm</b><span>FoS</span><b>${fmt(m.fos, 2)}</b><span>δ load</span><b>${fmt(m.defl, 3)} mm</b>`;
  const rec = recommended();
  ch.innerHTML = (id === rec ? '<span class="chip rec">Recommended</span>' : '') + (m.pass ? '<span class="chip ok">Meets spec</span>' : '<span class="chip bad">Fails spec</span>')
    + (R.ev.brokenLoads ? '<span class="chip bad">Load not carried</span>' : '') + (m.thinPct > 5 ? '<span class="chip warn">Thin webs</span>' : '') + (S.autoT && m.governs.startsWith('buckling') ? '<span class="chip warn">Buckling governs</span>' : '');
}
function renderSummary() {
  const r = S.run; if (!r) return;
  const prog = VARIANTS.reduce((a, v) => a + (S.results[v.id].status === 'done' ? 110 : S.results[v.id].it), 0) / (VARIANTS.length * 110);
  $('prog').style.width = (r.done === r.total ? 100 : prog * 100) + '%';
  if (r.done < r.total) { $('verdict').textContent = `Growing ${VARIANTS.length} designs from your load case…`; $('verdictSub').textContent = `${r.done} of ${r.total} finished. Watch them form on the board and in the cards below.`; return; }
  const rec = recommended(), M = MATERIALS[S.mat], mb = metrics(S.results.base);
  const secs = ((r.finished - r.started) / 1000).toFixed(0);
  if (!rec) { $('verdict').textContent = 'No design meets the requirements at the chosen thickness.'; $('verdictSub').textContent = S.autoT ? 'Check the load path: every load needs material connecting it to a support.' : 'Turn on thickness sizing, or raise the plate thickness.'; return; }
  const m = metrics(S.results[rec]), v = VARIANTS.find(x => x.id === rec);
  $('verdict').innerHTML = `Recommended: <span style="color:var(--accent)">${rec} · ${v.name}</span>, ${fmt(m.t, 1)} mm ${M.name}, <span class="num">${fmt(m.mass, m.mass < 100 ? 1 : 0)} g</span>`;
  const save = mb ? (1 - m.mass / mb.mass) * 100 : 0;
  $('verdictSub').textContent = `Factor of safety ${fmt(m.fos, 2)}, buckling load factor ${isFinite(m.blf) ? fmt(m.blf, 1) : 'n/a'}, deflection at the load ${fmt(m.defl, 3)} mm. Thickness set by ${m.governs}.${m.multi ? ` Checked against all ${S.lastDisc.caseIds.length} load cases.` : ''} ${save > 0 ? fmt(save, 0) + '% lighter than a solid plate sized to the same requirement (' + fmt(mb.mass, 0) + ' g at ' + fmt(mb.t, 1) + ' mm).' : ''} Solved in ${secs} s.`;
  if (m.webWarn) { const b = document.createElement('button'); b.className = 'btn'; b.style.marginLeft = '8px'; b.textContent = `Make webs at least ${fmt(m.t, 1)} mm (plate thickness) and regenerate`;
    b.addEventListener('click', () => { S.minW = m.t; S.proc = 'custom'; syncInputs(); startRun(); }); $('verdictSub').append(' For cut plate, webs thinner than the plate are hard to cut cleanly.', b); }
}
function renderDetail() {
  const R = S.results[S.selected], m = metrics(R), tb = $('metrics');
  const v = VARIANTS.find(x => x.id === S.selected);
  $('dtitle').textContent = S.selected === 'base' ? 'Solid plate (reference)' : `Design ${S.selected} · ${v.name}`;
  if (!m) { tb.innerHTML = `<tr><td>Status</td><td>${R ? (R.status === 'running' ? 'Optimizing, iteration ' + R.it : R.status) : 'Not run'}</td></tr>`; return; }
  const M = MATERIALS[S.mat], d = S.lastDisc;
  const rows = [
    ['Plate thickness', `${fmt(m.t, 1)} mm` + (S.autoT ? ` (needs ${fmt(m.tReq, 2)})` : '')],
    ['Mass', `${fmt(m.mass, 1)} g`],
    ['Material area', `${fmt(m.area, 0)} mm²`],
    ...(m.multi ? [['Load cases checked', `${d.caseIds.length}, worst case governs each check`]] : []),
    ['Peak von Mises stress', `${fmt(m.sig, 1)} MPa${m.cn(R.ev.vmCase)}`],
    ['Factor of safety on yield', `${fmt(m.fos, 2)} (target ${fmt(S.fos, 2)})`],
    ['Buckling load factor', isFinite(m.blf) ? `${fmt(m.blf, 2)} (target ${fmt(S.bfs, 1)})${m.cn(R.ev.lamCase)}` : 'No buckling (no compression)'],
    ['Thickness set by', S.autoT ? m.governs : 'your fixed value'],
    ['Deflection at load', `${fmt(m.defl, 4)} mm${m.cn(R.ev.dCase)}`],
    ['Max deflection anywhere', `${fmt(m.dmax, 4)} mm`],
    ['Stiffness at load', `${fmt(m.stiff / 1000, 2)} kN/mm`],
    ['Through-holes', `${m.holes}`],
    ['Material below min width', `${fmt(m.thinPct, 1)} %`],
  ];
  if (R.ev.added) rows.push(['Added to widen thin webs', `${fmt(m.added, 0)} mm²`]);
  if (R.distinct !== undefined) rows.push(['Distinct from the other designs', `${fmt(R.distinct, 0)} %`]);
  if (R.it) rows.push(['Optimizer iterations', `${R.it}`]);
  rows.push(['Mesh', `${d.nelx} × ${d.nely}, ${fmt(d.h, 2)} mm elements`]);
  tb.innerHTML = rows.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('') +
    (m.webWarn ? `<tr><td colspan="2" style="text-align:left;color:var(--warn);font-family:var(--font-body)">For cut plate, keep webs at least as wide as the plate is thick (${fmt(m.t, 1)} mm). Raise Min member width to ${fmt(m.t, 1)} and regenerate.</td></tr>` : '') +
    (R.ev.brokenLoads ? `<tr><td colspan="2" style="text-align:left;color:var(--bad);font-family:var(--font-body)">A load is not connected to material. Try a more robust variant or add a keep-solid zone at the load.</td></tr>` : '');
}
function renderPareto() {
  const svg = $('pareto'), pts = [];
  for (const id of ['base', ...VARIANTS.map(v => v.id)]) { const m = metrics(S.results[id]); if (m) pts.push({ id, m }); }
  if (pts.length < 2) { svg.innerHTML = `<text x="210" y="130" text-anchor="middle" fill="var(--muted)" font-size="13">Appears when the designs finish.</text>`; return; }
  const W = 420, H = 260, L = 58, Rm = 16, T = 14, B = 44;
  const xs = pts.map(p => p.m.mass), ys = pts.map(p => p.m.defl);
  const nice = (lo, hi) => { const span = hi - lo || hi || 1; const st = Math.pow(10, Math.floor(Math.log10(span / 4))); const s2 = [1, 2, 5, 10].map(k => k * st).find(k => span / k <= 5); return [Math.floor(lo / s2) * s2, Math.ceil(hi / s2) * s2, s2]; };
  const [x0, x1, xs2] = nice(Math.min(...xs) * 0.95, Math.max(...xs) * 1.05), [y0, y1, ys2] = nice(Math.min(...ys) * 0.9, Math.max(...ys) * 1.08);
  const X = v => L + (v - x0) / (x1 - x0) * (W - L - Rm), Y = v => H - B - (v - y0) / (y1 - y0) * (H - T - B);
  let s = '';
  for (let v = x0; v <= x1 + 1e-9; v += xs2) s += `<line x1="${X(v)}" x2="${X(v)}" y1="${T}" y2="${H - B}" stroke="var(--grid)"/><text x="${X(v)}" y="${H - B + 16}" text-anchor="middle" font-size="11" fill="var(--muted)" font-family="var(--font-mono)">${+v.toPrecision(4)}</text>`;
  for (let v = y0; v <= y1 + 1e-12; v += ys2) s += `<line x1="${L}" x2="${W - Rm}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--grid)"/><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)" font-family="var(--font-mono)">${+v.toPrecision(3)}</text>`;
  s += `<line x1="${L}" x2="${W - Rm}" y1="${H - B}" y2="${H - B}" stroke="var(--muted)"/><line x1="${L}" x2="${L}" y1="${T}" y2="${H - B}" stroke="var(--muted)"/>`;
  s += `<text x="${(L + W - Rm) / 2}" y="${H - 8}" text-anchor="middle" font-size="12" fill="var(--ink)">Mass (g)</text>`;
  s += `<text transform="translate(14 ${(T + H - B) / 2}) rotate(-90)" text-anchor="middle" font-size="12" fill="var(--ink)">Deflection at load (mm)</text>`;
  const rec = recommended(), placed = [];
  for (const p of pts) {
    const cx = X(p.m.mass), cy = Y(p.m.defl), sel = p.id === S.selected, isRec = p.id === rec;
    const col = p.m.pass ? 'var(--accent)' : 'var(--bad)';
    s += p.id === 'base' ? `<rect x="${cx - 5}" y="${cy - 5}" width="10" height="10" fill="none" stroke="var(--muted)" stroke-width="1.5"/>`
      : `<circle cx="${cx}" cy="${cy}" r="${isRec ? 7 : 5}" fill="${isRec ? col : 'var(--paper)'}" stroke="${col}" stroke-width="2"/>`;
    if (sel) s += `<circle cx="${cx}" cy="${cy}" r="11" fill="none" stroke="var(--ink)" stroke-dasharray="2 2"/>`;
    const offs = [[9, -8], [9, 13], [-19, -8], [-19, 13], [-5, -14], [-5, 24]];
    let lx = cx + 9, ly = cy - 8;
    for (const [dx, dy] of offs) { const X0 = cx + dx, Y0 = cy + dy;
      if (!placed.some(q => Math.abs(q[0] - X0) < 14 && Math.abs(q[1] - Y0) < 12) && !pts.some(o => Math.hypot(X(o.m.mass) - X0 - 4, Y(o.m.defl) - Y0 + 4) < 7)) { lx = X0; ly = Y0; break; } }
    placed.push([lx, ly]);
    s += `<text x="${lx}" y="${ly}" font-size="12" font-weight="600" fill="var(--ink)" font-family="var(--font-display)">${p.id === 'base' ? 'Solid' : p.id}</text>`;
  }
  svg.innerHTML = s;
}
function renderAll() {
  for (const id of Object.keys(S.results)) updateCard(id);
  renderSummary(); renderDetail(); renderPareto(); draw();
}

// ---------------- geometry export ----------------
// Marching-squares setup shared by the outline (DXF/SVG) and the solid (STL) exports.
function msField(R) {
  const d = S.lastDisc, nelx = d.nelx, nely = d.nely, sol = R.ev.solid;
  // light 3x3 blur of the 0/1 layout, then nodal averages, then iso-level 0.5
  const b = new Float32Array(nelx * nely);
  for (let ix = 0; ix < nelx; ix++) for (let iy = 0; iy < nely; iy++) {
    let s = 0, n = 0; for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) { const jx = ix + a, jy = iy + c; if (jx >= 0 && jy >= 0 && jx < nelx && jy < nely) { const w = a === 0 && c === 0 ? 4 : 1; s += sol[jx * nely + jy] * w; n += w; } }
    b[ix * nely + iy] = s / n;
  }
  const NX = nelx + 3, NY = nely + 3, v = new Float32Array(NX * NY);
  for (let i = 0; i <= nelx; i++) for (let j = 0; j <= nely; j++) {
    let s = 0, n = 0; for (const [a, c] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) { const ex = i + a, ey = j + c; if (ex >= 0 && ey >= 0 && ex < nelx && ey < nely) { s += b[ex * nely + ey]; n++; } }
    v[(j + 1) * NX + (i + 1)] = n ? s / n : 0;
  }
  // padding ring sits 1/1000 of an element outside the plate edge, so outlines of edge-touching material land on the edge (within ~1 µm) without collapsing cells
  const eps = 1e-3 * d.h;
  const pos = (i, j) => [i === 0 ? -eps : i === NX - 1 ? d.W + eps : (i - 1) * d.hx, j === 0 ? d.H + eps : j === NY - 1 ? -eps : d.H - (j - 1) * d.hy];
  const t = 0.5, pts = new Map();
  const ekey = (i, j, dir) => (j * NX + i) * 2 + dir;
  const cross = (k) => { let p = pts.get(k); if (p) return p; const dir = k & 1, n = k >> 1, i = n % NX, j = Math.floor(n / NX);
    const a = v[j * NX + i], bb = dir ? v[(j + 1) * NX + i] : v[j * NX + i + 1], f = (t - a) / (bb - a);
    const [x0, y0] = pos(i, j), [x1, y1] = dir ? pos(i, j + 1) : pos(i + 1, j); p = [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f]; pts.set(k, p); return p; };
  // per cell: inside pieces (convex polygons) whose consecutive edge-crossings are the outline segments
  const cells = function* () {
    for (let j = 0; j < NY - 1; j++) for (let i = 0; i < NX - 1; i++) {
      const cv = [v[j * NX + i], v[j * NX + i + 1], v[(j + 1) * NX + i + 1], v[(j + 1) * NX + i]], c = cv.map(x => x > t);
      if (!c[0] && !c[1] && !c[2] && !c[3]) continue;
      const corner = [pos(i, j), pos(i + 1, j), pos(i + 1, j + 1), pos(i, j + 1)];
      const edge = [ekey(i, j, 0), ekey(i + 1, j, 1), ekey(i, j + 1, 0), ekey(i, j, 1)]; // after corner k: T, R, B, L
      const crosses = [c[0] !== c[1], c[1] !== c[2], c[2] !== c[3], c[3] !== c[0]];
      const nCross = crosses.filter(Boolean).length;
      if (nCross === 4 && !((cv[0] + cv[1] + cv[2] + cv[3]) / 4 > t)) {
        for (let k = 0; k < 4; k++) if (c[k]) yield [{ p: cross(edge[(k + 3) % 4]), e: edge[(k + 3) % 4] }, { p: corner[k] }, { p: cross(edge[k]), e: edge[k] }];
      } else {
        const piece = [];
        for (let k = 0; k < 4; k++) { if (c[k]) piece.push({ p: corner[k] }); if (crosses[k]) piece.push({ p: cross(edge[k]), e: edge[k] }); }
        yield piece;
      }
    }
  };
  return { cells, cross, d };
}
function contours(R) {
  const F = msField(R), adj = new Map();
  const link = (p, q) => { (adj.get(p) || adj.set(p, []).get(p)).push(q); (adj.get(q) || adj.set(q, []).get(q)).push(p); };
  for (const piece of F.cells()) for (let k = 0; k < piece.length; k++) { const a = piece[k], b = piece[(k + 1) % piece.length]; if (a.e !== undefined && b.e !== undefined) link(a.e, b.e); }
  const used = new Set(), loops = [];
  for (const start of adj.keys()) {
    if (used.has(start)) continue; const loop = []; let prev = -1, cur = start;
    while (cur !== undefined && !used.has(cur)) { used.add(cur); loop.push(F.cross(cur)); const nx = adj.get(cur).find(q => q !== prev && !used.has(q)); prev = cur; cur = nx; }
    if (loop.length > 2) loops.push(simplify(loop, 0.12 * F.d.h));
  }
  return loops;
}
// Extruded solid of the part, thickness t (mm), as binary STL. Caps come from the marching-squares pieces, so they match the outline exactly.
function makeSTL(R, t) {
  const F = msField(R), tris = [];
  const area = (poly) => { let a = 0; for (let k = 0; k < poly.length; k++) { const [x0, y0] = poly[k].p, [x1, y1] = poly[(k + 1) % poly.length].p; a += x0 * y1 - x1 * y0; } return a / 2; };
  for (const piece of F.cells()) {
    if (piece.length < 3) continue;
    const ccw = area(piece) > 0;
    for (let k = 1; k < piece.length - 1; k++) {
      let a = piece[0].p, b = piece[k].p, c = piece[k + 1].p; if (!ccw) [b, c] = [c, b];
      tris.push([[a[0], a[1], t], [b[0], b[1], t], [c[0], c[1], t]], [[a[0], a[1], 0], [c[0], c[1], 0], [b[0], b[1], 0]]);
    }
    let cx = 0, cy = 0; for (const q of piece) { cx += q.p[0]; cy += q.p[1]; } cx /= piece.length; cy /= piece.length;
    for (let k = 0; k < piece.length; k++) {
      const A = piece[k], B = piece[(k + 1) % piece.length]; if (A.e === undefined || B.e === undefined) continue;
      let p = A.p, q = B.p; if ((q[0] - p[0]) * (cy - p[1]) - (q[1] - p[1]) * (cx - p[0]) < 0) [p, q] = [q, p];
      tris.push([[p[0], p[1], 0], [q[0], q[1], 0], [q[0], q[1], t]], [[p[0], p[1], 0], [q[0], q[1], t], [p[0], p[1], t]]);
    }
  }
  const buf = new ArrayBuffer(84 + 50 * tris.length), dv = new DataView(buf);
  const head = 'Morphe Design Studio STL, units mm'; for (let k = 0; k < head.length; k++) dv.setUint8(k, head.charCodeAt(k));
  dv.setUint32(80, tris.length, true);
  let o = 84;
  for (const [a, b, c] of tris) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const L = Math.hypot(nx, ny, nz) || 1;
    for (const val of [nx / L, ny / L, nz / L, ...a, ...b, ...c]) { dv.setFloat32(o, val, true); o += 4; }
    dv.setUint16(o, 0, true); o += 2;
  }
  return new Uint8Array(buf);
}
function simplify(pts, tol) {
  if (pts.length < 5) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) { const [a, b] = st.pop(); let md = 0, mi = -1; const [ax, ay] = pts[a], [bx, by] = pts[b], L = Math.hypot(bx - ax, by - ay) || 1e-12;
    for (let i = a + 1; i < b; i++) { const dd = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / L; if (dd > md) { md = dd; mi = i; } }
    if (md > tol) { keep[mi] = 1; st.push([a, mi], [mi, b]); } }
  return pts.filter((_, i) => keep[i]);
}
function makeDXF(loops) {
  const L = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '9', '$EXTMIN', '10', '0', '20', '0', '9', '$EXTMAX', '10', String(S.lastDisc.W), '20', String(S.lastDisc.H), '0', 'ENDSEC',
    '0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LAYER', '70', '1', '0', 'LAYER', '2', 'PROFILE', '70', '0', '62', '7', '6', 'CONTINUOUS', '0', 'ENDTAB', '0', 'ENDSEC',
    '0', 'SECTION', '2', 'ENTITIES'];
  for (const lp of loops) {
    L.push('0', 'POLYLINE', '8', 'PROFILE', '66', '1', '70', '1');
    for (const [x, y] of lp) L.push('0', 'VERTEX', '8', 'PROFILE', '10', x.toFixed(4), '20', y.toFixed(4));
    L.push('0', 'SEQEND', '8', 'PROFILE');
  }
  L.push('0', 'ENDSEC', '0', 'EOF');
  return L.join('\r\n') + '\r\n';
}
function makeSVG(loops, m) {
  const W = S.lastDisc.W, H = S.lastDisc.H;
  const d = loops.map(lp => 'M' + lp.map(([x, y]) => `${x.toFixed(3)} ${(H - y).toFixed(3)}`).join(' L') + ' Z').join(' ');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}">\n<title>Morphe design ${S.selected}, ${m ? fmt(m.t, 1) + ' mm ' + MATERIALS[S.mat].name : ''}</title>\n<path d="${d}" fill="#000" fill-rule="evenodd"/>\n</svg>\n`;
}
function makeCSV() {
  const M = MATERIALS[S.mat];
  const head = ['design', 'name', 'meets_spec', 'plate_thickness_mm', 'required_thickness_mm', 'mass_g', 'area_mm2', 'peak_von_mises_MPa', 'factor_of_safety', 'deflection_at_load_mm', 'max_deflection_mm', 'stiffness_N_per_mm', 'buckling_load_factor', 'thickness_set_by', 'stress_case', 'deflection_case', 'buckling_case', 'holes', 'below_min_width_pct', 'distinct_pct'];
  const rows = [head.join(',')];
  for (const id of ['base', ...VARIANTS.map(v => v.id)]) { const R = S.results[id], m = metrics(R); if (!m) continue;
    const name = id === 'base' ? 'Solid plate' : VARIANTS.find(v => v.id === id).name;
    rows.push([id, `"${name}"`, m.pass, m.t, m.tReq.toFixed(3), m.mass.toFixed(2), m.area.toFixed(1), m.sig.toFixed(2), m.fos.toFixed(3), m.defl.toFixed(5), m.dmax.toFixed(5), m.stiff.toFixed(1), isFinite(m.blf) ? m.blf.toFixed(3) : 'none', `"${m.governs}"`, S.lastDisc.caseIds[R.ev.vmCase || 0], S.lastDisc.caseIds[R.ev.dCase || 0], isFinite(m.blf) ? S.lastDisc.caseIds[R.ev.lamCase || 0] : '', m.holes, m.thinPct.toFixed(2), R.distinct !== undefined ? R.distinct.toFixed(1) : ''].join(',')); }
  rows.push('', 'per_load_case', 'design,load_case,peak_von_mises_MPa,deflection_at_load_mm,buckling_load_factor');
  for (const id of ['base', ...VARIANTS.map(v => v.id)]) { const R = S.results[id], m = metrics(R); if (!m) continue;
    const E = MATERIALS[S.mat].E;
    S.lastDisc.caseIds.forEach((c, k) => { const lam = R.ev.lamC && R.ev.lamC[k];
      rows.push([id, c, (R.ev.vmMaxC[k] / m.t).toFixed(2), (R.ev.dLoadC[k] / (E * m.t)).toFixed(5), isFinite(lam) ? (lam * E * m.t ** 3).toFixed(3) : 'none'].join(',')); }); }
  rows.push('', `# material,"${M.name}",E_MPa,${M.E},yield_MPa,${M.Sy},density_kg_m3,${M.rho}`, `# target_FoS,${S.fos},target_buckling_factor,${S.bfs},deflection_limit_mm,${S.dlim || 'none'},min_member_width_mm,${S.minW}`, `# design_space_mm,${S.lastDisc.W},${S.lastDisc.H}`);
  return rows.join('\n') + '\n';
}
function loadProject(o, quiet) {
  if (!o || typeof o !== 'object' || !Array.isArray(o.features) || !(o.W >= 10) || !(o.H >= 10)) throw new Error('Not a Morphe project file.');
  const ok = ['load', 'fix', 'void', 'solid'];
  S.W = +o.W; S.H = +o.H; S.sym = !!o.symmetric;
  S.features = o.features.filter(f => f && ok.includes(f.type)).map(f => ({ ...f }));
  if (MATERIALS[o.material]) S.mat = o.material;
  if (PROCESSES[o.process]) S.proc = o.process;
  if (o.minWidth > 0) S.minW = +o.minWidth;
  S.nLC = Math.max(1, +o.loadCases || 1, ...S.features.filter(f => f.type === 'load').map(caseOf)); S.lc = 1;
  if (o.fos >= 1) S.fos = +o.fos;
  if (o.bucklingFactor >= 1) S.bfs = +o.bucklingFactor;
  S.dlim = o.deflLimit > 0 ? +o.deflLimit : 0;
  if (typeof o.autoThickness === 'boolean') S.autoT = o.autoThickness;
  if (o.thickness > 0) S.tFix = +o.thickness;
  if (o.mesh && RES[o.mesh]) S.res = o.mesh;
  S.preset = o.preset && PRESETS[o.preset] ? o.preset : S.preset;
  syncInputs(); if (!quiet) markDirty(); draw();
}
function projectJSON() { return JSON.stringify({ tool: 'Morphe Design Studio', version: 2, loadCases: numCases(), preset: S.preset, mesh: S.res, autoThickness: S.autoT, thickness: S.tFix, W: S.W, H: S.H, material: S.mat, process: S.proc, minWidth: S.minW, fos: S.fos, bucklingFactor: S.bfs, deflLimit: S.dlim, symmetric: S.sym, features: S.features }, null, 2); }

// zip (stored, no compression)
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function zip(files) {
  const enc = new TextEncoder(), parts = [], central = []; let off = 0;
  for (const f of files) {
    const name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true); h.setUint16(10, 0, true); h.setUint16(12, 0x21, true);
    h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
    parts.push(new Uint8Array(h.buffer), name, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true); c.setUint16(12, 0, true); c.setUint16(14, 0x21, true);
    c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), name);
    off += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((a, p) => a + p.length, 0);
  const e = new DataView(new ArrayBuffer(22)); e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cdSize, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type: 'application/zip' });
}
async function saveFile(filename, data) {
  let dl = null;
  try { if (window.claude && window.claude.use) dl = await window.claude.use('downloads'); } catch (e) { dl = null; }
  if (dl) {
    try { await dl.save({ filename, data }); toast('Saved ' + filename); }
    catch (err) {
      if (err && err.code === 'declined') return;
      if (err && (err.code === 'rejected_extension' || err.code === 'extension_not_enabled') && !/\.zip$/.test(filename)) {
        const bytes = typeof data === 'string' ? data : data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data;
        return saveFile(filename.replace(/\.[^.]+$/, '') + '.zip', zip([{ name: filename, data: bytes }]));
      }
      toast('Download not available here: ' + (err && err.message || 'unknown reason'));
    }
    return;
  }
  const blob = data instanceof Blob ? data : new Blob([data]);
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function ready() { const R = S.results[S.selected]; if (!R || !R.ev) { toast('Wait for this design to finish.'); return null; } if (S.dirty) toast('Exporting the design from the previous setup. Regenerate to export the current one.'); return R; }
const baseName = () => `morphe_${S.preset}_${S.selected === 'base' ? 'solid' : S.selected}`;
$('exZip').addEventListener('click', () => { const R = ready(); if (!R) return; const lp = contours(R), m = metrics(R);
  saveFile(baseName() + '.zip', zip([{ name: baseName() + '.dxf', data: makeDXF(lp) }, { name: baseName() + '.svg', data: makeSVG(lp, m) }, { name: baseName() + `_${fmt(m.t, 1)}mm.stl`, data: makeSTL(R, m.t) }, { name: 'morphe_report.csv', data: makeCSV() }, { name: 'morphe_project.json', data: projectJSON() }])); });
$('exDxf').addEventListener('click', () => { const R = ready(); if (!R) return; saveFile(baseName() + '.dxf', makeDXF(contours(R))); });
$('exStl').addEventListener('click', () => { const R = ready(); if (!R) return; const m = metrics(R); saveFile(baseName() + `_${fmt(m.t, 1)}mm.stl`, makeSTL(R, m.t)); });
$('exSvg').addEventListener('click', () => { const R = ready(); if (!R) return; saveFile(baseName() + '.svg', makeSVG(contours(R), metrics(R))); });
$('exCsv').addEventListener('click', () => { if (!S.results.base || !S.results.base.ev) { toast('Wait for the designs to finish.'); return; } saveFile('morphe_report.csv', makeCSV()); });
$('exPng').addEventListener('click', () => stage.toBlob(b => saveFile(baseName() + '_' + S.view + '.png', b)));
$('exCopy').addEventListener('click', async () => { const R = ready(); if (!R) return; try { await navigator.clipboard.writeText(makeDXF(contours(R))); toast('DXF copied. Paste into a text file and save it as .dxf'); } catch (e) { toast('Clipboard blocked by the browser.'); } });

// ---------------- inputs ----------------
function syncInputs() {
  $('preset').value = S.preset; $('W').value = S.W; $('H').value = S.H; $('res').value = S.res; $('sym').checked = S.sym;
  $('mat').value = S.mat; $('proc').value = S.proc; $('minw').value = S.minW; $('fos').value = S.fos; $('bfs').value = S.bfs; $('dlim').value = S.dlim;
  $('autot').checked = S.autoT; $('tfix').value = S.tFix; $('tfix').disabled = S.autoT;
  $('thint').textContent = S.autoT ? 'Thickness is picked per design so each one just meets the requirements.' : 'Every design is checked at this thickness.';
  if ($('lcsel')) renderCases();
  $('setupSum').textContent = `${S.W} × ${S.H} mm · ${MATERIALS[S.mat].name} · FoS ${S.fos} · buckling ≥ ${S.bfs}`;
  renderFeats();
}
function initInputs() {
  $('mat').innerHTML = Object.entries(MATERIALS).map(([k, m]) => `<option value="${k}">${m.name} · E ${fmt(m.E / 1000, 1)} GPa · Sy ${m.Sy} MPa</option>`).join('');
  $('proc').innerHTML = Object.entries(PROCESSES).map(([k, p]) => `<option value="${k}">${p.name}</option>`).join('');
  $('preset').addEventListener('change', e => applyPreset(e.target.value));
  const geo = (id, key, f = Number) => $(id).addEventListener('change', e => { const v = f(e.target.value); if (key === 'W' || key === 'H') { if (!(v >= 10)) { syncInputs(); return; } } S[key] = v; markDirty(); syncInputs(); draw(); });
  geo('W', 'W'); geo('H', 'H'); geo('res', 'res', String);
  $('sym').addEventListener('change', e => { S.sym = e.target.checked; markDirty(); });
  $('minw').addEventListener('change', e => { S.minW = Math.max(0.5, +e.target.value || 1); S.proc = 'custom'; syncInputs(); markDirty(); });
  $('proc').addEventListener('change', e => { S.proc = e.target.value; const p = PROCESSES[S.proc]; if (p.minW) S.minW = p.minW; syncInputs(); markDirty(); });
  const live = (id, key, f) => $(id).addEventListener('change', e => { S[key] = f(e.target); syncInputs(); renderAll(); });
  ['mat', 'fos', 'bfs', 'dlim', 'autot', 'tfix', 'sym', 'proc', 'minw', 'res'].forEach(id => $(id).addEventListener('change', persist));
  live('mat', 'mat', t => t.value); live('fos', 'fos', t => Math.max(1, +t.value || 1)); live('bfs', 'bfs', t => Math.max(1, +t.value || 1)); live('dlim', 'dlim', t => Math.max(0, +t.value || 0));
  live('autot', 'autoT', t => t.checked); live('tfix', 'tFix', t => Math.max(0.5, +t.value || 1));
  $('go').addEventListener('click', startRun);
  $('undo').addEventListener('click', undo);
  $('openProj').addEventListener('click', () => $('projFile').click());
  $('projFile').addEventListener('change', async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try { snapshot(); loadProject(JSON.parse(await f.text())); toast('Project opened. Press Regenerate designs.'); } catch (err) { undoStack.pop(); toast(err.message || 'Could not read that file.'); } });
  $('saveProj').addEventListener('click', () => saveFile(`morphe_${S.preset}_project.json`, projectJSON()));
  document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); undo(); } });
}
window.addEventListener('resize', () => draw());
if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => renderAll());

initInputs(); setTool('load');
if (window.matchMedia && window.matchMedia('(max-width: 900px)').matches) $('setupBox').open = false;
let restored = false;
try { const saved = localStorage.getItem('morphe.project.v1'); if (saved) { loadProject(JSON.parse(saved), true); restored = true; } } catch (e) { restored = false; }
if (!restored) applyPreset('cantilever', true);
$('undo').disabled = true;
S.dirty = false;
startRun();
