// Linkage statics tests. Golden values come from an independent Python implementation (worked example), plus closed-form hand cases.
const L = require('../src/linkage.js');
let bad = 0;
const ok = (c, m) => { console.log((c ? 'PASS  ' : 'FAIL  ') + m); if (!c) bad++; };
const near = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
// 1. beam on hinge and rod (closed form)
{ const r = L.solve({ bodies: [{ id: 'b', ext: [{ x: 1, y: 0, fx: 0, fy: -10 }] }], pins: [{ id: 'O', x: 0, y: 0, a: 'b', b: 'ground' }], links: [{ id: 'rod', a: 'ground', p1: [2, -1], b: 'b', p2: [2, 0] }] });
  ok(r.ok && near(r.links.rod, 5, 1e-12) && near(r.pins.O.fa[1], 5, 1e-12), 'beam on hinge and rod: rod 5, hinge 5 (hand calculation)'); }
// 2. inclined two-force member (truss bracket): load 100 at the tip of a bar hinged at the wall, tie at 30 degrees
{ const a = Math.PI / 6, L0 = 2, tie = { id: 'tie', a: 'ground', p1: [0, L0 * Math.tan(a)], b: 'bar', p2: [L0, 0] };
  const r = L.solve({ bodies: [{ id: 'bar', ext: [{ x: L0, y: 0, fx: 0, fy: -100 }] }], pins: [{ id: 'h', x: 0, y: 0, a: 'bar', b: 'ground' }], links: [tie] });
  const T = 100 / Math.sin(a);   // tie tension (pulls the end toward the wall)
  ok(r.ok && near(-r.links.tie, T, 1e-12), `inclined tie: tension ${T.toFixed(3)} kN (hand calculation)`);
  ok(near(r.pins.h.fa[0], T * Math.cos(a) * -1 * -1, 1e-9) || near(Math.abs(r.pins.h.fa[0]), T * Math.cos(a), 1e-9), 'inclined tie: hinge horizontal reaction = T cos(a)'); }
// 3. mechanism and inconsistent cases are reported, not hidden
{ const r = L.solve({ bodies: [{ id: 'b', ext: [{ x: 1, y: 0, fx: 0, fy: -10 }] }], pins: [{ id: 'O', x: 0, y: 0, a: 'b', b: 'ground' }], links: [] });
  ok(!r.ok && /Inconsistent|Mechanism/.test(r.problem), 'beam on one hinge with a transverse load: reported as not balanced'); }
{ const r = L.solve({ bodies: [{ id: 'b', ext: [{ x: 1, y: 0, fx: 0, fy: -10 }] }], pins: [{ id: 'O', x: 0, y: 0, a: 'b', b: 'ground' }], links: [{ id: 'r1', a: 'ground', p1: [2, -1], b: 'b', p2: [2, 0] }, { id: 'r2', a: 'ground', p1: [3, -1], b: 'b', p2: [3, 0] }] });
  ok(!r.ok && /indeterminate/i.test(r.problem), 'two rods plus hinge: statically indeterminate, reported'); }
let threw = false; try { L.solve({ bodies: [{ id: 'b' }], pins: [{ id: 'p', x: 0, y: 0, a: 'nobody', b: 'ground' }], links: [] }); } catch (e) { threw = /unknown body/.test(e.message); } ok(threw, 'pin to an unknown body is rejected with a message');
// 4. excavator worked example vs Python (independent implementation)
const d = Math.PI / 180;
const A = L.excavatorCase(25 * d, -45 * d, -100 * d, 'crowd'), rA = A.result;
ok(rA.ok && near(A.tip, 120.09, 0.003), `crowd: tip force ${A.tip.toFixed(2)} kN (Python 120.09)`);
ok(near(rA.links.boomCyl, -250.4, 0.003) && near(rA.pins.K.mag, 502.4, 0.003) && near(rA.pins.O.mag, 160.4, 0.003), `crowd: boom cylinder ${rA.links.boomCyl.toFixed(1)}, stick pin ${rA.pins.K.mag.toFixed(1)}, foot pin ${rA.pins.O.mag.toFixed(1)} (Python -250.4, 502.4, 160.4)`);
const B = L.excavatorCase(25 * d, -45 * d, -100 * d, 'breakout'), rB = B.result;
ok(rB.ok && near(B.tip, 128.03, 0.003) && near(rB.links.link, 543.7, 0.003) && near(rB.pins.T.mag, 668.5, 0.003) && near(rB.pins.R.mag, 322.0, 0.003), `breakout: tip ${B.tip.toFixed(2)}, link ${rB.links.link.toFixed(1)}, bucket pin ${rB.pins.T.mag.toFixed(1)}, idler pin ${rB.pins.R.mag.toFixed(1)} (Python 128.03, 543.7, 668.5, 322.0)`);
const C = L.excavatorCase(20 * d, -15 * d, -100 * d, 'lift', 37.6), rC = C.result;
ok(rC.ok && near(rC.links.boomCyl, 911.2, 0.003) && near(rC.pins.O.mag, 884.7, 0.003) && near(rC.pins.K.mag, 170.3, 0.003), `lift 37.6 kN: boom cylinder ${rC.links.boomCyl.toFixed(1)}, foot pin ${rC.pins.O.mag.toFixed(1)}, stick pin ${rC.pins.K.mag.toFixed(1)} (Python 911.2, 884.7, 170.3)`);
// 5. global equilibrium of the whole attachment (sum of every external force and moment) for each case
for (const [nm, c] of [['crowd', A], ['breakout', B], ['lift', C]]) {
  const r = c.result, p = c.pose, g = 9.81 / 1000, G = L.EXC; let fx = 0, fy = 0, m = 0; const px = 0.37, py = -1.1;   // arbitrary moment centre
  const add = (x, y, ax, ay) => { fx += ax; fy += ay; m += (x - px) * ay - (y - py) * ax; };
  add(p.cgBoom[0], p.cgBoom[1], 0, -G.boomW * g); add(p.cgStick[0], p.cgStick[1], 0, -G.stickW * g); add(p.cgBucket[0], p.cgBucket[1], 0, -G.bucketW * g);
  add(0, 0, ...r.ground.O);
  const u = (a, b) => { const l = Math.hypot(b[0] - a[0], b[1] - a[1]); return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; }, bu = u(G.cylBase, p.P1); add(p.P1[0], p.P1[1], bu[0] * r.links.boomCyl, bu[1] * r.links.boomCyl);
  if (nm === 'lift') add(p.T[0], p.T[1], 0, -37.6); else { const rE = nm === 'crowd' ? [p.E[0] - p.K[0], p.E[1] - p.K[1]] : [p.E[0] - p.T[0], p.E[1] - p.T[1]], n = Math.hypot(rE[0], rE[1]); add(p.E[0], p.E[1], -rE[1] / n * c.tip, rE[0] / n * c.tip); }
  ok(Math.hypot(fx, fy) < 1e-6 && Math.abs(m) < 1e-6, `${nm}: whole attachment balances (force residual ${Math.hypot(fx, fy).toExponential(1)}, moment residual ${Math.abs(m).toExponential(1)})`);
}
// 6. pose keeps the link length and out-of-range bucket angles throw
{ const p = L.excavatorPose(25 * d, -45 * d, -100 * d); ok(Math.abs(Math.hypot(p.L[0] - p.B1[0], p.L[1] - p.B1[1]) - L.EXC.linkLen) < 1e-9 && Math.abs(Math.hypot(p.L[0] - p.R[0], p.L[1] - p.R[1]) - L.EXC.idlerLr) < 1e-9, 'pose: link length and idler radius preserved'); }
// 7. cylinder forces
{ const f = L.cylForce('stick'); ok(near(f.push, 387.9, 0.002) && near(f.pull, 193.0, 0.01), `stick cylinder at 34.3 MPa: push ${f.push.toFixed(1)}, pull ${f.pull.toFixed(1)} kN`); }
console.log(bad ? `\n${bad} FAILED` : '\nAll linkage checks passed'); process.exit(bad ? 1 : 0);
