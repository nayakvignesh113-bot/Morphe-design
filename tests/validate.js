// Validation of the Morphe solver. Run: node tests/validate.js  (exits 1 on failure)
const C = require('../src/core.js');
const ref = require('./top88_reference.json');
let fail = 0;
const check = (name, got, want, tolPct) => {
  const err = Math.abs(got / want - 1) * 100, ok = err <= tolPct;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: got ${got.toPrecision(6)}, expected ${want.toPrecision(6)} (${err.toFixed(3)}% <= ${tolPct}%)`);
  if (!ok) fail++;
};

// 1. MBB beam, 60x20, vf 0.5, density filter rmin 1.5, no projection: compliance history vs independent top88 (Python/SciPy)
{
  const nelx = 60, nely = 20, mesh = C.makeMesh(nelx, nely);
  const F = new Float64Array(mesh.ndof); F[1] = -1;
  const fixed = new Uint8Array(mesh.ndof);
  for (let iy = 0; iy <= nely; iy++) fixed[2 * iy] = 1; fixed[mesh.ndof - 1] = 1;
  const hist = [];
  C.optimize({ nelx, nely, nu: 0.3, F, fixed, passive: new Int8Array(nelx * nely), vf: 0.5, rmin: 1.5, penal: 3, maxIter: ref.length, projection: false }, (it, c) => hist.push(c));
  for (const i of [0, 9, 29, ref.length - 1]) check(`top88 MBB compliance, iteration ${i + 1}`, hist[i], ref[i], 0.01);
}

// 1b. Same beam with two load cases (second load at top-centre), summed compliance, vs the same reference code
{
  const ref2 = require('./top88_reference_2cases.json');
  const nelx = 60, nely = 20, mesh = C.makeMesh(nelx, nely);
  const F1 = new Float64Array(mesh.ndof); F1[1] = -1;
  const F2 = new Float64Array(mesh.ndof); F2[2 * (nelx / 2) * (nely + 1) + 1] = -1;
  const fixed = new Uint8Array(mesh.ndof);
  for (let iy = 0; iy <= nely; iy++) fixed[2 * iy] = 1; fixed[mesh.ndof - 1] = 1;
  const hist = [];
  C.optimize({ nelx, nely, nu: 0.3, Fs: [F1, F2], fixed, passive: new Int8Array(nelx * nely), vf: 0.5, rmin: 1.5, penal: 3, maxIter: ref2.length, projection: false }, (it, c) => hist.push(c));
  for (const i of [0, 9, ref2.length - 1]) check(`two load cases, summed compliance, iteration ${i + 1}`, hist[i], ref2[i], 0.01);
}

// 2. Solid cantilever 200x20 mm, t = 1 mm, E = 1 MPa, nu 0.3, 1 N tip shear: Timoshenko beam theory
{
  const L = 200, H = 20, nelx = 200, nely = 20, mesh = C.makeMesh(nelx, nely);
  const F = new Float64Array(mesh.ndof), fixed = new Uint8Array(mesh.ndof);
  for (let iy = 0; iy <= nely; iy++) { const n = mesh.node(0, iy); fixed[2 * n] = fixed[2 * n + 1] = 1; }
  for (let iy = 0; iy <= nely; iy++) F[2 * mesh.node(nelx, iy) + 1] = -1 / (nely + 1);
  const r = C.evaluate({ nelx, nely, nu: 0.3, F, fixed, passive: new Int8Array(nelx * nely).fill(2) }, new Float64Array(nelx * nely).fill(1), 1);
  const I = H ** 3 / 12, G = 1 / 2.6;
  check('cantilever tip deflection vs Timoshenko', r.dLoad, L ** 3 / (3 * I) + L / (5 / 6 * G * H), 0.5);
  const ix = nelx / 2, xc = (ix + 0.5), yc = H / 2 - 0.5;
  check('mid-span top-fibre bending stress vs Mc/I', r.vm[ix * nely], (L - xc) * yc / I, 0.5);
}
// 3. Out-of-plane plate buckling, simply supported square plate in uniaxial compression: N_cr = 4 pi^2 D / b^2
{
  const n = 40, b = 100, nu = 0.3, mesh = C.makeMesh(n, n);
  const S = new Float64Array(3 * mesh.nel); for (let e = 0; e < mesh.nel; e++) S[3 * e] = -1;
  const wfix = new Uint8Array(3 * mesh.nn);
  for (let ix = 0; ix <= n; ix++) for (let iy = 0; iy <= n; iy++) if (ix === 0 || iy === 0 || ix === n || iy === n) wfix[3 * mesh.node(ix, iy)] = 1;
  const solid = new Uint8Array(mesh.nel).fill(1);
  check('SS plate buckling, k = 4', C.buckle(mesh, nu, b / n, solid, S, wfix).lam, 4 * Math.PI ** 2 / (12 * (1 - nu * nu)) / b ** 2, 0.5);
  for (let e = 0; e < mesh.nel; e++) S[3 * e] = 1;
  const lt = C.buckle(mesh, nu, b / n, solid, S, wfix).lam;
  console.log(`${lt === Infinity ? 'PASS' : 'FAIL'}  tension-only plate reports no buckling (${lt})`); if (lt !== Infinity) fail++;
}

// 3b. Biaxial plate where buckling under the reversed load is 8x easier: the solver must still return the real-load mode
{
  const n = 40, a = 100, nu = 0.3, mesh = C.makeMesh(n, n), D = 1 / (12 * (1 - nu * nu));
  const S = new Float64Array(3 * mesh.nel); for (let e = 0; e < mesh.nel; e++) { S[3 * e] = -1; S[3 * e + 1] = 3; }
  const wfix = new Uint8Array(3 * mesh.nn);
  for (let ix = 0; ix <= n; ix++) for (let iy = 0; iy <= n; iy++) if (ix === 0 || iy === 0 || ix === n || iy === n) wfix[3 * mesh.node(ix, iy)] = 1;
  let best = Infinity; for (let m = 1; m < 12; m++) for (let k = 1; k < 6; k++) { const den = m * m - 3 * k * k; if (den > 0) best = Math.min(best, D * Math.PI ** 2 * (m * m + k * k) ** 2 / den / a ** 2); }
  check('biaxial plate, reversed-load mode dominant', C.buckle(mesh, nu, a / n, new Uint8Array(mesh.nel).fill(1), S, wfix).lam, best, 0.5);
}

// 4. Euler cantilever column (200 x 10 mm strip, clamped root, axial tip load) through the full evaluate() path, nu = 0
{
  const L = 200, B = 10, nelx = 200, nely = 10, mesh = C.makeMesh(nelx, nely);
  const F = new Float64Array(mesh.ndof), fixed = new Uint8Array(mesh.ndof);
  for (let iy = 0; iy <= nely; iy++) { const n = mesh.node(0, iy); fixed[2 * n] = fixed[2 * n + 1] = 1; }
  for (let iy = 0; iy <= nely; iy++) F[2 * mesh.node(nelx, iy)] = -(iy === 0 || iy === nely ? 0.5 : 1) / nely;
  const r = C.evaluate({ nelx, nely, nu: 0, F, fixed, passive: new Int8Array(nelx * nely).fill(2) }, new Float64Array(nelx * nely).fill(1), 1);
  check('Euler cantilever column, pi^2 EI / 4L^2', r.lamB, Math.PI ** 2 * (B / 12) / (4 * L * L), 0.5);
}
// 5. Load-case envelope: case 2 = 2 x case 1 must govern stress (x2), deflection (x2) and buckling (x0.5)
{
  const nelx = 60, nely = 20, mesh = C.makeMesh(nelx, nely);
  const F1 = new Float64Array(mesh.ndof), fixed = new Uint8Array(mesh.ndof);
  for (let iy = 0; iy <= nely; iy++) { const n = mesh.node(0, iy); fixed[2 * n] = fixed[2 * n + 1] = 1; }
  F1[2 * mesh.node(nelx, nely / 2)] = -1; F1[2 * mesh.node(nelx, nely / 2) + 1] = -1;
  const F2 = F1.map(v => 2 * v);
  const job = { nelx, nely, nu: 0.3, fixed, passive: new Int8Array(nelx * nely).fill(2) }, full = new Float64Array(nelx * nely).fill(1);
  const one = C.evaluate({ ...job, F: F1 }, full, 1), two = C.evaluate({ ...job, Fs: [F1, F2] }, full, 1);
  check('envelope stress = 2 x case 1', two.vmMax, 2 * one.vmMax, 1e-6);
  check('envelope deflection = 2 x case 1', two.dLoad, 2 * one.dLoad, 1e-6);
  check('envelope buckling factor = case 1 / 2', two.lamB, one.lamB / 2, 1e-4);
  const idx = two.vmCase === 1 && two.dCase === 1 && two.lamCase === 1;
  console.log(`${idx ? 'PASS' : 'FAIL'}  governing case identified for stress, deflection, buckling (${two.vmCase}, ${two.dCase}, ${two.lamCase})`); if (!idx) fail++;
}
console.log(fail ? `${fail} check(s) failed` : 'All checks passed');
process.exit(fail ? 1 : 0);
