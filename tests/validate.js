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
console.log(fail ? `${fail} check(s) failed` : 'All checks passed');
process.exit(fail ? 1 : 0);
