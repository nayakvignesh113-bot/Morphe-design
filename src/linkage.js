// Morphe linkage statics: planar rigid-body force balance for pinned mechanisms (excavator booms, cranes, press linkages, mounts).
// Pure functions (no DOM). Units are the caller's own but must be consistent: mm and N, or m and kN. Angles in radians. y is up.
//
// Model
//   bodies : [{ id, weight?: { x, y, W }, ext?: [{ id?, x, y, fx, fy } | { id, x, y, dir: [dx, dy] }] }]
//            a weight W acts downward (-y) at (x, y). An ext entry with `dir` and no fx/fy has a known direction and an UNKNOWN magnitude (a ground reaction).
//   pins   : [{ id, x, y, a, b }]   revolute joint between bodies a and b; either may be 'ground'. Unknown force (fx, fy) on body a (b gets the opposite).
//   links  : [{ id, a, p1: [x, y], b, p2: [x, y], force? }]   two-force member (cylinder, rod); F > 0 means it pushes its ends apart.
//            `force` fixes F (a cylinder held at a known pressure); without it F is solved.
// Result: { ok, rank, unknowns, equations, residual, pins: { id: { fa:[fx,fy], mag } }, links: { id: F }, ext: { id: magnitude }, ground: { id: [fx, fy] } }
const Linkage = (() => {
  const hyp = Math.hypot;
  const GROUND = 'ground';
  // least squares by Householder QR; returns { x, rank, residual }
  function lstsq(A, b, m, n) {
    const R = A.map(r => r.slice()), y = b.slice(), scale = Math.max(1e-300, ...A.flat().map(Math.abs));
    let rank = 0; const piv = [], cols = [];
    for (let k = 0; k < n; k++) {                // column k; no column pivoting: a rank-deficient column is reported, not hidden
      let nrm = 0; for (let i = rank; i < m; i++) nrm += R[i][k] * R[i][k]; nrm = Math.sqrt(nrm);
      if (nrm < 1e-10 * scale) continue;          // dependent column
      const alpha = R[rank][k] > 0 ? -nrm : nrm, v = new Array(m).fill(0);
      for (let i = rank; i < m; i++) v[i] = R[i][k]; v[rank] -= alpha;
      let vv = 0; for (let i = rank; i < m; i++) vv += v[i] * v[i];
      if (vv > 0) {
        for (let j = k; j < n; j++) { let s = 0; for (let i = rank; i < m; i++) s += v[i] * R[i][j]; s = 2 * s / vv; for (let i = rank; i < m; i++) R[i][j] -= s * v[i]; }
        let s = 0; for (let i = rank; i < m; i++) s += v[i] * y[i]; s = 2 * s / vv; for (let i = rank; i < m; i++) y[i] -= s * v[i];
      }
      piv.push(rank); cols.push(k); rank++;
    }
    const x = new Array(n).fill(0);
    for (let r = rank - 1; r >= 0; r--) { const k = cols[r]; let s = y[r]; for (let r2 = r + 1; r2 < rank; r2++) s -= R[r][cols[r2]] * x[cols[r2]]; x[k] = s / R[r][k]; }
    let res = 0; for (let i = rank; i < m; i++) res += y[i] * y[i];
    return { x, rank, residual: Math.sqrt(res) };
  }
  function solve(model) {
    const bodies = model.bodies || [], pins = model.pins || [], links = model.links || [];
    const idx = new Map(); bodies.forEach((b, i) => { if (b.id === GROUND || idx.has(b.id)) throw new Error('Body ids must be unique and not "ground": ' + b.id); idx.set(b.id, i); });
    const known = (id) => id === GROUND || idx.has(id);
    for (const p of pins) if (!known(p.a) || !known(p.b)) throw new Error('Pin ' + p.id + ' joins an unknown body.');
    for (const l of links) if (!known(l.a) || !known(l.b)) throw new Error('Link ' + l.id + ' joins an unknown body.');
    // unknown columns
    const cols = []; // {kind, id, extra}
    pins.forEach(p => { cols.push({ kind: 'pinx', id: p.id }); cols.push({ kind: 'piny', id: p.id }); });
    links.forEach(l => { if (!(l.force !== undefined && l.force !== null)) cols.push({ kind: 'link', id: l.id }); });
    const extList = []; bodies.forEach(b => (b.ext || []).forEach((e, k) => { if (e.dir && e.fx === undefined) { const id = e.id || (b.id + '#' + k); extList.push({ b, e, id }); cols.push({ kind: 'ext', id }); } }));
    const n = cols.length, m = 3 * bodies.length, colOf = new Map(cols.map((c, i) => [c.kind + ':' + c.id, i]));
    const A = Array.from({ length: m }, () => new Array(n).fill(0)), rhs = new Array(m).fill(0);
    const eq = (b) => 3 * idx.get(b);
    // add the force (fx, fy) acting at (x, y) on body b: coefficient on unknown column c (or a constant to rhs when c < 0) with moment about the origin
    const addForce = (b, x, y, cx, cy, c, k) => {      // force = k * (cx, cy) * unknown c
      if (b === GROUND) return; const r = eq(b);
      if (c >= 0) { A[r][c] += k * cx; A[r + 1][c] += k * cy; A[r + 2][c] += k * (x * cy - y * cx); }
      else { rhs[r] -= k * cx; rhs[r + 1] -= k * cy; rhs[r + 2] -= k * (x * cy - y * cx); }
    };
    for (const p of pins) {
      const cx = colOf.get('pinx:' + p.id), cy = colOf.get('piny:' + p.id);
      addForce(p.a, p.x, p.y, 1, 0, cx, 1); addForce(p.a, p.x, p.y, 0, 1, cy, 1);
      addForce(p.b, p.x, p.y, 1, 0, cx, -1); addForce(p.b, p.x, p.y, 0, 1, cy, -1);
    }
    for (const l of links) {
      const L = hyp(l.p2[0] - l.p1[0], l.p2[1] - l.p1[1]); if (!(L > 0)) throw new Error('Link ' + l.id + ' has zero length.');
      const ux = (l.p2[0] - l.p1[0]) / L, uy = (l.p2[1] - l.p1[1]) / L, c = colOf.has('link:' + l.id) ? colOf.get('link:' + l.id) : -1, F = l.force;
      // force on a at p1 = -F u ; on b at p2 = +F u
      if (c >= 0) { addForce(l.a, l.p1[0], l.p1[1], ux, uy, c, -1); addForce(l.b, l.p2[0], l.p2[1], ux, uy, c, 1); }
      else { addForce(l.a, l.p1[0], l.p1[1], ux * F, uy * F, -1, -1); addForce(l.b, l.p2[0], l.p2[1], ux * F, uy * F, -1, 1); }
    }
    for (const b of bodies) {
      if (b.weight) addForce(b.id, b.weight.x, b.weight.y, 0, -b.weight.W, -1, 1);
      (b.ext || []).forEach((e, k) => {
        if (e.dir && e.fx === undefined) { const L = hyp(e.dir[0], e.dir[1]); addForce(b.id, e.x, e.y, e.dir[0] / L, e.dir[1] / L, colOf.get('ext:' + (e.id || (b.id + '#' + k))), 1); }
        else addForce(b.id, e.x, e.y, e.fx, e.fy, -1, 1);
      });
    }
    const S = lstsq(A, rhs, m, n), out = { ok: S.rank === n && S.residual < 1e-7 * Math.max(1, ...rhs.map(Math.abs)), rank: S.rank, unknowns: n, equations: m, residual: S.residual, pins: {}, links: {}, ext: {}, ground: {} };
    out.problem = S.rank < n ? (m < n ? 'Statically indeterminate: more unknown forces than equations (too many supports or links for rigid-body statics; remove one, or give one cylinder a known force).' : 'Mechanism or redundant: the unknown forces cannot all be found (check that each body is held, and that no link is doubled).')
      : S.residual >= 1e-7 * Math.max(1, ...rhs.map(Math.abs)) ? 'Inconsistent: the loads cannot be balanced by the supports given (the mechanism would move).' : null;
    pins.forEach(p => {
      const fx = S.x[colOf.get('pinx:' + p.id)], fy = S.x[colOf.get('piny:' + p.id)]; out.pins[p.id] = { fa: [fx, fy], mag: hyp(fx, fy), a: p.a, b: p.b };
      if (p.a === GROUND) out.ground[p.id] = [-fx, -fy]; else if (p.b === GROUND) out.ground[p.id] = [fx, fy];   // force the ground exerts on the mechanism
    });
    links.forEach(l => { out.links[l.id] = colOf.has('link:' + l.id) ? S.x[colOf.get('link:' + l.id)] : l.force; });
    extList.forEach(x => { out.ext[x.id] = S.x[colOf.get('ext:' + x.id)]; });
    return out;
  }
  // member force on a body at a pin, for feeding a part model (force on body `bodyId`, as [fx, fy])
  function forceOn(res, pinId, bodyId) { const p = res.pins[pinId]; if (!p) return null; return bodyId === p.a ? p.fa.slice() : bodyId === p.b ? p.fa.map(v => -v) : null; }
  // ---- reference excavator attachment (boom, stick, bucket with idler and link); same geometry as the worked example in the documentation.
  // Lengths in m, forces in kN. Angles are absolute (from +x, counter-clockwise): boom chord th1, stick thS, bucket thB (the bucket's own frame angle).
  const EXC = {
    boomLen: 5.7, cylBase: [0.55, -0.35], boomP1: [1.7, -0.45], boomP2: [4.3, 1.1], boomCG: [2.7, 0], boomW: 1900,
    stickLen: 2.9, stickP3: [-0.7, 0.7], stickP4: [0.70, 0.50], stickR: [2.45, 0.30], stickCG: [1.4, 0.1], stickW: 1000,
    idlerQr: 0.45, idlerLr: 0.30, idlerAngQL: -70 * Math.PI / 180, bucketTip: [1.45 * Math.cos(-35 * Math.PI / 180), 1.45 * Math.sin(-35 * Math.PI / 180)], bucketB1: [0.2, 0.5], linkLen: 0.85, bucketCG: [0.55, -0.25], bucketW: 900,
    pressure: 34300,                                    // kPa (= kN/m2), relief
    bores: { boom: [0.130, 0.090, 2], stick: [0.120, 0.085, 1], bucket: [0.115, 0.080, 1] },   // bore, rod (m), number of cylinders
  };
  const rot = (a) => { const c = Math.cos(a), s = Math.sin(a); return (v) => [c * v[0] - s * v[1], s * v[0] + c * v[1]]; };
  const add2 = (a, b) => [a[0] + b[0], a[1] + b[1]], sub2 = (a, b) => [a[0] - b[0], a[1] - b[1]];
  function excavatorPose(th1, thS, thB, G = EXC) {
    const R1 = rot(th1), RS = rot(thS), RB = rot(thB), O = [0, 0];
    const K = R1([G.boomLen, 0]), P1 = R1(G.boomP1), P2 = R1(G.boomP2);
    const T = add2(K, RS([G.stickLen, 0])), P3 = add2(K, RS(G.stickP3)), P4 = add2(K, RS(G.stickP4)), R = add2(K, RS(G.stickR));
    const E = add2(T, RB(G.bucketTip)), B1 = add2(T, RB(G.bucketB1));
    // idler point L: on circle(R, idlerLr) and circle(B1, linkLen); the intersection with the larger y
    const dv = sub2(B1, R), dist = hyp(dv[0], dv[1]), a = (G.idlerLr ** 2 - G.linkLen ** 2 + dist ** 2) / (2 * dist), h2 = G.idlerLr ** 2 - a * a;
    if (h2 < 0) throw new Error('The bucket link cannot reach: the bucket angle is outside the linkage range.');
    const hh = Math.sqrt(h2), mid = [R[0] + a * dv[0] / dist, R[1] + a * dv[1] / dist], nrm = [-dv[1] / dist, dv[0] / dist];
    const c1 = [mid[0] + hh * nrm[0], mid[1] + hh * nrm[1]], c2 = [mid[0] - hh * nrm[0], mid[1] - hh * nrm[1]], L = c1[1] > c2[1] ? c1 : c2;
    const ang = Math.atan2(L[1] - R[1], L[0] - R[0]) - G.idlerAngQL, Q = [R[0] + G.idlerQr * Math.cos(ang), R[1] + G.idlerQr * Math.sin(ang)];
    return { O, K, P1, P2, T, P3, P4, R, E, B1, L, Q, cgBoom: R1(G.boomCG), cgStick: add2(K, RS(G.stickCG)), cgBucket: add2(T, RB(G.bucketCG)) };
  }
  const cylForce = (name, G = EXC) => { const [d, r, k] = G.bores[name]; return { push: G.pressure * Math.PI / 4 * d * d * k, pull: G.pressure * Math.PI / 4 * (d * d - r * r) * k }; };
  // mode: 'crowd' (stick cylinder at relief, bucket held), 'breakout' (bucket cylinder at relief, stick held), 'lift' (hook load `load` kN at the bucket pin)
  function excavatorCase(th1, thS, thB, mode, load = 0, G = EXC) {
    const p = excavatorPose(th1, thS, thB, G), g = 9.81 / 1000;
    const tipDir = (from, to) => { const r = sub2(to, from), n = hyp(r[0], r[1]); return [-r[1] / n, r[0] / n]; };
    const bodies = [
      { id: 'boom', weight: { x: p.cgBoom[0], y: p.cgBoom[1], W: G.boomW * g }, ext: [] },
      { id: 'stick', weight: { x: p.cgStick[0], y: p.cgStick[1], W: G.stickW * g }, ext: [] },
      { id: 'bucket', weight: { x: p.cgBucket[0], y: p.cgBucket[1], W: G.bucketW * g }, ext: [] },
      { id: 'idler', ext: [] }];
    if (mode === 'crowd') bodies[2].ext.push({ id: 'tip', x: p.E[0], y: p.E[1], dir: tipDir(p.K, p.E) });
    else if (mode === 'breakout') bodies[2].ext.push({ id: 'tip', x: p.E[0], y: p.E[1], dir: tipDir(p.T, p.E) });
    else if (mode === 'lift') bodies[2].ext.push({ id: 'hook', x: p.T[0], y: p.T[1], fx: 0, fy: -load });
    else throw new Error('Unknown mode ' + mode);
    const pins = [{ id: 'O', x: 0, y: 0, a: 'boom', b: 'ground' }, { id: 'K', x: p.K[0], y: p.K[1], a: 'stick', b: 'boom' }, { id: 'T', x: p.T[0], y: p.T[1], a: 'bucket', b: 'stick' }, { id: 'R', x: p.R[0], y: p.R[1], a: 'idler', b: 'stick' }];
    const links = [
      { id: 'boomCyl', a: 'ground', p1: G.cylBase, b: 'boom', p2: p.P1 },
      { id: 'stickCyl', a: 'boom', p1: p.P2, b: 'stick', p2: p.P3 },
      { id: 'bucketCyl', a: 'stick', p1: p.P4, b: 'idler', p2: p.Q },
      { id: 'link', a: 'idler', p1: p.L, b: 'bucket', p2: p.B1 }];
    if (mode === 'crowd') links[1].force = cylForce('stick', G).push;
    if (mode === 'breakout') links[2].force = cylForce('bucket', G).push;
    const res = solve({ bodies, pins, links });
    return { pose: p, result: res, tip: res.ext.tip !== undefined ? res.ext.tip : null };
  }
  return { solve, forceOn, lstsq, EXC, excavatorPose, excavatorCase, cylForce };
})();
if (typeof module !== 'undefined') module.exports = Linkage;
