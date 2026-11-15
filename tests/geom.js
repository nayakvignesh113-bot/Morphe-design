// Tests for src/geom.js (outline import, exact coverage, distance transform, minimum inner radius). Run: node tests/geom.js
const G = require('../src/geom.js');
let fail = 0, n = 0;
const ok = (name, cond, info = '') => { n++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${info ? ' (' + info + ')' : ''}`); if (!cond) fail++; };
const near = (name, got, want, tol) => ok(name, Math.abs(got - want) <= tol, `got ${got.toPrecision(7)}, expected ${want.toPrecision(7)}, tol ${tol}`);
const circle = (cx, cy, r, k = 256, rev = false) => { const p = []; for (let i = 0; i < k; i++) { const a = 2 * Math.PI * i / k; p.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } return rev ? p.reverse() : p; };

// 1. coverage: total covered area equals the polygon area (plate with a hole, L shape), for several grids
{
  const plate = [[0, 0], [160, 0], [160, 100], [0, 100]], hole = circle(50, 50, 10), exact = 160 * 100 - Math.abs(G.polyArea(hole));
  for (const [nx, ny] of [[40, 25], [96, 60], [160, 100], [37, 23]]) {
    const cov = G.coverage([plate, hole], 160, 100, nx, ny); let s = 0; for (const v of cov) s += v; s *= (160 / nx) * (100 / ny);
    near(`coverage area, plate with hole, ${nx}x${ny} grid`, s, exact, exact * 2e-6);
  }
  const L = [[0, 0], [100, 0], [100, 40], [40, 40], [40, 100], [0, 100]], cov = G.coverage([L], 100, 100, 50, 50); let s = 0; for (const v of cov) s += v;
  near('coverage area, L shape (non-aligned edge at 40 mm)', s * 4, 100 * 40 + 40 * 60, 1e-3);
  const tri = [[0, 0], [100, 0], [0, 100]], c2 = G.coverage([tri], 100, 100, 30, 30); let s2 = 0; for (const v of c2) s2 += v;
  near('coverage area, diagonal edge', s2 * (100 / 30) ** 2, 5000, 1e-2);
  const nested = [[[0, 0], [100, 0], [100, 100], [0, 100]], [[20, 20], [80, 20], [80, 80], [20, 80]], [[40, 40], [60, 40], [60, 60], [40, 60]]], c3 = G.coverage(nested, 100, 100, 41, 41); let s3 = 0; for (const v of c3) s3 += v;
  near('coverage area, island inside a hole (even-odd nesting)', s3 * (100 / 41) ** 2, 10000 - 3600 + 400, 1e-2);
}
// 2. distance transform vs brute force, anisotropic spacing
{
  const nx = 31, ny = 19, hx = 1.2, hy = 0.9, m = new Uint8Array(nx * ny); let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 6; i++) m[Math.floor(rnd() * nx) * ny + Math.floor(rnd() * ny)] = 1;
  const d = G.edt2(m, nx, ny, hx, hy); let worst = 0;
  for (let ix = 0; ix < nx; ix++) for (let iy = 0; iy < ny; iy++) { let b = Infinity; for (let jx = 0; jx < nx; jx++) for (let jy = 0; jy < ny; jy++) if (m[jx * ny + jy]) b = Math.min(b, ((ix - jx) * hx) ** 2 + ((iy - jy) * hy) ** 2); worst = Math.max(worst, Math.abs(d[ix * ny + iy] - b)); }
  ok('distance transform equals brute force', worst < 1e-9, `max error ${worst.toExponential(1)}`);
}
// 3. minimum inner radius: closing
{
  const nx = 240, ny = 160, h = 0.5, solid = new Uint8Array(nx * ny).fill(1);
  const cut = (x0, x1, y0, y1) => { for (let ix = 0; ix < nx; ix++) for (let iy = 0; iy < ny; iy++) { const x = (ix + .5) * h, y = (iy + .5) * h; if (x >= x0 && x <= x1 && y >= y0 && y <= y1) solid[ix * ny + iy] = 0; } };
  cut(20, 40, 0, 50);       // wide slot from the top edge, square end (20 wide)
  cut(70, 74, 0, 50);       // narrow slot, 4 wide
  cut(90, 115, 20, 60);     // internal rectangular window
  const r = 3, add = G.closingAdded(solid, nx, ny, h, h, r), closed = solid.map((v, i) => v | add[i]);
  let sub = true; for (let i = 0; i < nx * ny; i++) if (add[i] && solid[i]) sub = false;
  ok('closing only adds material', sub);
  const at = (x, y) => closed[Math.floor(x / h) * ny + Math.floor(y / h)];
  ok('narrow slot (4 mm < 2r = 6 mm) is filled', at(72, 10) === 1 && at(72, 40) === 1);
  ok('wide slot stays open', at(30, 10) === 0 && at(30, 45) === 0 && at(21, 25) === 0);
  ok('square slot end is rounded (corner cell filled)', at(20.4, 49.6) === 1 && at(39.6, 49.6) === 1);
  ok('window corner is rounded', at(90.3, 59.7) === 1 && at(114.7, 20.3) === 1);
  // brute force: every void cell of the closed result must lie in some disc of radius r - 1.5 cells that is entirely void (opening property)
  const rr = r - 2.5 * h, R = Math.ceil(rr / h); let bad = 0, checked = 0;
  const discVoid = (cx, cy) => { for (let a = -R; a <= R; a++) for (let b = -R; b <= R; b++) { if (Math.hypot(a, b) * h > rr) continue; const x = cx + a, y = cy + b; if (x >= 0 && y >= 0 && x < nx && y < ny && closed[x * ny + y]) return false; } return true; };
  for (let ix = 2; ix < nx - 2; ix += 2) for (let iy = 2; iy < ny - 2; iy += 2) { if (closed[ix * ny + iy]) continue; checked++;
    let found = false; for (let a = -R; a <= R && !found; a++) for (let b = -R; b <= R && !found; b++) if (Math.hypot(a, b) * h <= rr && discVoid(ix + a, iy + b)) found = true; if (!found) bad++; }
  ok('opening property: every remaining void cell fits a disc of r minus 2.5 cells inside the void', bad === 0, `${checked} cells checked, ${bad} violations`);
  // a large circular void must be untouched
  const s2 = new Uint8Array(nx * ny).fill(1); for (let ix = 0; ix < nx; ix++) for (let iy = 0; iy < ny; iy++) if (Math.hypot((ix + .5) * h - 60, (iy + .5) * h - 40) <= 12) s2[ix * ny + iy] = 0;
  const a2 = G.closingAdded(s2, nx, ny, h, h, r); let added = 0; for (const v of a2) added += v;
  ok('a void with radius 12 mm is untouched by r = 3 mm', added === 0, `${added} cells added`);
  const s3 = new Uint8Array(nx * ny).fill(1); for (let ix = 0; ix < nx; ix++) for (let iy = 0; iy < ny; iy++) if (Math.hypot((ix + .5) * h - 60, (iy + .5) * h - 40) <= 2) s3[ix * ny + iy] = 0;
  const a3 = G.closingAdded(s3, nx, ny, h, h, r); let ad3 = 0; for (const v of a3) ad3 += v; ok('a void with radius 2 mm is filled by r = 3 mm', ad3 > 0.9 * Math.PI * 4 / (h * h));
  // channel to the grid border is not filled (outside the grid is void)
  const s4 = new Uint8Array(nx * ny).fill(1); for (let ix = 0; ix < nx; ix++) for (let iy = 0; iy < 4; iy++) s4[ix * ny + iy] = 0;   // 2 mm void strip along the top edge
  const a4 = G.closingAdded(s4, nx, ny, h, h, r); let ad4 = 0; for (const v of a4) ad4 += v; ok('void strip along the grid border (open to the outside) is not filled', ad4 === 0, `${ad4} cells added`);
}
// 4. DXF import
{
  const pair = (c, v) => `${c}\n${v}\n`;
  const lw = (flags, vs) => pair(0, 'LWPOLYLINE') + pair(8, '0') + pair(90, vs.length) + pair(70, flags) + vs.map(([x, y, b]) => pair(10, x) + pair(20, y) + (b ? pair(42, b) : '')).join('');
  const dxf = (ents, ins = 4) => pair(0, 'SECTION') + pair(2, 'HEADER') + pair(9, '$INSUNITS') + pair(70, ins) + pair(0, 'ENDSEC') + pair(0, 'SECTION') + pair(2, 'ENTITIES') + ents + pair(0, 'ENDSEC') + pair(0, 'EOF');
  const stad = dxf(lw(1, [[0, 0, 0], [100, 0, 1], [100, 20, 0], [0, 20, 1]]) + pair(0, 'CIRCLE') + pair(8, '0') + pair(10, 50) + pair(20, 10) + pair(40, 4));
  const P = G.parseDXF(stad), ch = G.chain(P.pieces), pr = G.prepare(ch.loops, 0.005);
  ok('DXF: stadium + circle gives 2 loops, no errors', pr.loops.length === 2 && !pr.errors.length && P.units === 'mm', `${pr.loops.length} loops, units ${P.units}`);
  const A = pr.loops.map(G.polyArea).map(Math.abs).sort((a, b) => b - a);
  near('DXF: stadium area (bulge arcs) = 100x20 + pi r^2', A[0], 2000 + Math.PI * 100, 0.003 * 263);
  near('DXF: circle area', A[1], Math.PI * 16, 0.003 * 25.1);
  const line = (a, b, c, d) => pair(0, 'LINE') + pair(8, '0') + pair(10, a) + pair(20, b) + pair(11, c) + pair(21, d);
  const arc = (cx, cy, r, a0, a1) => pair(0, 'ARC') + pair(8, '0') + pair(10, cx) + pair(20, cy) + pair(40, r) + pair(50, a0) + pair(51, a1);
  const rr = dxf(line(10, 0, 90, 0) + arc(90, 10, 10, 270, 360) + line(100, 10, 100, 70) + arc(90, 70, 10, 0, 90) + line(90, 80, 10, 80) + arc(10, 70, 10, 90, 180) + line(0, 70, 0, 10) + arc(10, 10, 10, 180, 270), 1);
  const P2 = G.parseDXF(rr), c2 = G.chain(P2.pieces, 25.4), p2 = G.prepare(c2.loops, 0.005);
  ok('DXF: rounded rectangle chained from 4 lines + 4 arcs into one loop (inch units)', p2.loops.length === 1 && !c2.warn.length && P2.units === 'in');
  near('DXF: rounded rectangle area in mm^2', Math.abs(G.polyArea(p2.loops[0])), (100 * 80 - (4 - Math.PI) * 100) * 25.4 * 25.4, 2e-4 * 5.1e6);
  const gap = G.chain(G.parseDXF(dxf(line(0, 0, 10, 0) + line(10, 0, 10, 10) + line(10, 10, 0, 10) + line(0, 10, 0, 1))).pieces);
  ok('DXF: an open outline is reported with its gap', gap.loops.length === 0 && /does not close/.test(gap.warn[0] || ''), gap.warn[0]);
  const spl = G.parseDXF(dxf(pair(0, 'SPLINE') + pair(8, '0')));
  ok('DXF: unsupported SPLINE is reported', /SPLINE/.test(spl.warn[0] || ''));
  let threw = false; try { G.parseDXF('AutoCAD Binary DXF\r\n\x1a\0'); } catch (e) { threw = /binary/i.test(e.message); } ok('DXF: binary file rejected with a clear message', threw);
}
// 5. SVG import
{
  const svg = (body, attrs = '') => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;
  let P = G.parseSVG(svg('<path d="M 50 100 A 50 100 0 1 0 150 100 A 50 100 0 1 0 50 100 Z"/>', 'viewBox="0 0 200 200" width="200mm" height="200mm"')), L = G.prepare(G.chain(P.pieces).loops, 0.005).loops;
  near('SVG: elliptical arc path area = pi a b', Math.abs(G.polyArea(L[0])), Math.PI * 50 * 100, 5); ok('SVG: physical size from width/viewBox gives mm', P.units === 'mm');
  P = G.parseSVG(svg('<g transform="translate(10,20) scale(2)"><rect x="0" y="0" width="30" height="10"/></g>', 'viewBox="0 0 100 100" width="50mm" height="50mm"')); L = G.chain(P.pieces).loops;
  near('SVG: group transform + viewBox scale (30x10 rect, x2, x0.5)', Math.abs(G.polyArea(L[0])), 300, 1e-6);
  P = G.parseSVG(svg('<path d="M0 0 C 0 55.2 44.8 100 100 100 L 0 100 Z"/>')); L = G.chain(P.pieces).loops;
  near('SVG: cubic quarter circle + lines area', Math.abs(G.polyArea(L[0])), 10000 - Math.PI * 100 * 100 / 4 + 0 * 1, 60);
  P = G.parseSVG(svg('<defs><path d="M0 0 L9 0 L9 9 Z"/></defs><rect x="0" y="0" width="20" height="10"/><circle cx="10" cy="5" r="2"/>')); L = G.chain(P.pieces).loops;
  ok('SVG: defs ignored, rect and circle read', L.length === 2);
  P = G.parseSVG(svg('<path d="m 0,0 h 40 v 20 h -40 z"/>')); L = G.chain(P.pieces).loops; near('SVG: relative h/v commands', Math.abs(G.polyArea(L[0])), 800, 1e-9);
  ok('SVG: y axis flipped to y-up (rect at svg y 0..20 ends at negative y)', G.bbox(L).y1 <= 1e-9 && G.bbox(L).y0 < -19.9);
}
// 6. validation of loops
{
  const bow = [[0, 0], [10, 10], [10, 0], [0, 10]];
  ok('prepare: self-crossing outline rejected', G.prepare([bow], 0.001).errors.length === 1);
  const A = [[0, 0], [10, 0], [10, 10], [0, 10]], B = [[5, 5], [15, 5], [15, 15], [5, 15]];
  ok('prepare: two overlapping loops rejected', G.prepare([A, B], 0.001).errors.length === 1);
  ok('prepare: disjoint loops accepted', G.prepare([A, [[20, 0], [30, 0], [30, 10], [20, 10]]], 0.001).errors.length === 0);
  ok('prepare: loop inside a loop (hole) accepted', G.prepare([A, [[3, 3], [7, 3], [7, 7], [3, 7]]], 0.001).errors.length === 0);
  const sq = []; for (let i = 0; i <= 400; i++) sq.push([i * 0.25, 0]); const big = G.simplifyLoop(sq.concat([[100, 50], [0, 50]]), 0.001); ok('simplifyLoop keeps a long straight edge as one segment', big.length === 4, `${big.length} points`);
  const sd = G.signedDist([A], 5, 5), sd2 = G.signedDist([A], -3, 5); near('signed distance inside', sd, 5, 1e-9); near('signed distance outside', sd2, -3, 1e-9);
}
console.log(fail ? `${fail} of ${n} geometry check(s) failed` : `All ${n} geometry checks passed`);
process.exit(fail ? 1 : 0);
