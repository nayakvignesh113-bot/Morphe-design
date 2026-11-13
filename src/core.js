// Morphe core: 2D plane-stress FEA + SIMP topology optimization (density filter + Heaviside projection)
// Shared by the Web Worker and the Node validation harness. Units: N, mm, MPa.

function makeKE(nu) {
  const k = [1/2 - nu/6, 1/8 + nu/8, -1/4 - nu/12, -1/8 + 3*nu/8,
             -1/4 + nu/12, -1/8 - nu/8, nu/6, 1/8 - 3*nu/8];
  const c = 1 / (1 - nu*nu);
  const m = [
    [k[0],k[1],k[2],k[3],k[4],k[5],k[6],k[7]],
    [k[1],k[0],k[7],k[6],k[5],k[4],k[3],k[2]],
    [k[2],k[7],k[0],k[5],k[6],k[3],k[4],k[1]],
    [k[3],k[6],k[5],k[0],k[7],k[2],k[1],k[4]],
    [k[4],k[5],k[6],k[7],k[0],k[1],k[2],k[3]],
    [k[5],k[4],k[3],k[2],k[1],k[0],k[7],k[6]],
    [k[6],k[3],k[4],k[1],k[2],k[7],k[0],k[5]],
    [k[7],k[2],k[1],k[4],k[3],k[6],k[5],k[0]]];
  const KE = new Float64Array(64);
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) KE[i*8+j] = c * m[i][j];
  return KE;
}

// Mesh: elements (ix, iy), iy counted from the top row. Element node order LL, LR, UR, UL (y up).
function makeMesh(nelx, nely) {
  const colwise = nely <= nelx;
  const node = colwise ? (ix, iy) => ix*(nely+1) + iy : (ix, iy) => iy*(nelx+1) + ix;
  const nel = nelx*nely, nn = (nelx+1)*(nely+1), ndof = 2*nn;
  const edof = new Int32Array(nel*8);
  let bw = 0;
  for (let ix = 0; ix < nelx; ix++) for (let iy = 0; iy < nely; iy++) {
    const e = ix*nely + iy;
    const ns = [node(ix, iy+1), node(ix+1, iy+1), node(ix+1, iy), node(ix, iy)];
    let lo = Infinity, hi = -Infinity;
    for (let a = 0; a < 4; a++) {
      edof[e*8+2*a] = 2*ns[a]; edof[e*8+2*a+1] = 2*ns[a]+1;
      lo = Math.min(lo, 2*ns[a]); hi = Math.max(hi, 2*ns[a]+1);
    }
    bw = Math.max(bw, hi - lo);
  }
  return { nelx, nely, nel, nn, ndof, edof, bw, node };
}

// Symmetric banded matrix, lower band storage: A[i][j], i-bw <= j <= i at i*(bw+1) + (j-i+bw)
function assembleBand(mesh, KE, Evals) {
  const { ndof, bw, nel, edof } = mesh, w = bw + 1;
  const A = new Float64Array(ndof * w);
  for (let e = 0; e < nel; e++) {
    const s = Evals[e], o = e*8;
    for (let a = 0; a < 8; a++) {
      const gi = edof[o+a];
      for (let b = 0; b < 8; b++) {
        const gj = edof[o+b];
        if (gi >= gj) A[gi*w + (gj - gi + bw)] += s * KE[a*8+b];
      }
    }
  }
  return A;
}

function applyFixed(A, mesh, fixedMask) {
  const { ndof, bw } = mesh, w = bw + 1;
  for (let d = 0; d < ndof; d++) {
    if (!fixedMask[d]) continue;
    for (let j = Math.max(0, d-bw); j < d; j++) A[d*w + (j-d+bw)] = 0;
    for (let i = d+1; i <= Math.min(ndof-1, d+bw); i++) A[i*w + (d-i+bw)] = 0;
    A[d*w + bw] = 1;
  }
}

function cholBand(A, n, bw) {
  const w = bw + 1;
  for (let i = 0; i < n; i++) {
    const j0 = Math.max(0, i - bw), ri = i*w - i + bw;
    for (let j = j0; j <= i; j++) {
      const rj = j*w - j + bw;
      let s = A[ri + j];
      const k0 = Math.max(j0, j - bw);
      for (let k = k0; k < j; k++) s -= A[ri + k] * A[rj + k];
      if (j === i) {
        if (!(s > 0)) s = 1e-30; // guard
        A[ri + i] = Math.sqrt(s);
      } else A[ri + j] = s / A[rj + j];
    }
  }
}

function solveBand(L, n, bw, f) {
  const w = bw + 1, x = Float64Array.from(f);
  for (let i = 0; i < n; i++) {
    const ri = i*w - i + bw; let s = x[i];
    for (let k = Math.max(0, i-bw); k < i; k++) s -= L[ri + k] * x[k];
    x[i] = s / L[ri + i];
  }
  for (let i = n-1; i >= 0; i--) {
    let s = x[i];
    const kmax = Math.min(n-1, i+bw);
    for (let k = i+1; k <= kmax; k++) s -= L[k*w - k + bw + i] * x[k];
    x[i] = s / L[i*w - i + bw + i];
  }
  return x;
}

function feSolve(mesh, KE, Evals, F, fixedMask) {
  const A = assembleBand(mesh, KE, Evals);
  applyFixed(A, mesh, fixedMask);
  cholBand(A, mesh.ndof, mesh.bw);
  const f = Float64Array.from(F);
  for (let d = 0; d < mesh.ndof; d++) if (fixedMask[d]) f[d] = 0;
  return solveBand(A, mesh.ndof, mesh.bw, f);
}

// Density filter as CSR (weights rmin - dist)
function makeFilter(nelx, nely, rmin) {
  const nel = nelx*nely, R = Math.ceil(rmin) - 1;
  const ptr = new Int32Array(nel+1), idx = [], wt = [];
  const Hs = new Float64Array(nel);
  for (let ix = 0; ix < nelx; ix++) for (let iy = 0; iy < nely; iy++) {
    const e = ix*nely + iy;
    for (let jx = Math.max(0, ix-R); jx <= Math.min(nelx-1, ix+R); jx++)
      for (let jy = Math.max(0, iy-R); jy <= Math.min(nely-1, iy+R); jy++) {
        const wgt = rmin - Math.hypot(ix-jx, iy-jy);
        if (wgt > 0) { idx.push(jx*nely + jy); wt.push(wgt); Hs[e] += wgt; }
      }
    ptr[e+1] = idx.length;
  }
  return { ptr, idx: Int32Array.from(idx), wt: Float64Array.from(wt), Hs };
}

function applyH(flt, v, out) { // out = H v  (H symmetric)
  const { ptr, idx, wt } = flt;
  for (let e = 0; e < ptr.length - 1; e++) {
    let s = 0;
    for (let p = ptr[e]; p < ptr[e+1]; p++) s += wt[p] * v[idx[p]];
    out[e] = s;
  }
  return out;
}

// Plane-stress element stress at centroid. Returns von Mises.
function elementVM(mesh, u, nu, E, h, e) {
  const o = e*8, ed = mesh.edof;
  const dx = [-1, 1, 1, -1], dy = [-1, -1, 1, 1];
  let ex = 0, ey = 0, g = 0;
  for (let a = 0; a < 4; a++) {
    const ua = u[ed[o+2*a]], va = u[ed[o+2*a+1]];
    ex += dx[a]*ua; ey += dy[a]*va; g += dy[a]*ua + dx[a]*va;
  }
  ex /= 2*h; ey /= 2*h; g /= 2*h;
  const c = E / (1 - nu*nu);
  const sx = c*(ex + nu*ey), sy = c*(nu*ex + ey), txy = c*(1-nu)/2*g;
  return Math.sqrt(sx*sx - sx*sy + sy*sy + 3*txy*txy);
}

const projT = (x, b, eta) => (Math.tanh(b*eta) + Math.tanh(b*(x-eta))) / (Math.tanh(b*eta) + Math.tanh(b*(1-eta)));
const projD = (x, b, eta) => { const t = Math.tanh(b*(x-eta)); return b*(1-t*t) / (Math.tanh(b*eta) + Math.tanh(b*(1-eta))); };

/*
 job: { nelx, nely, nu, F (Float64Array ndof, N), fixed (Uint8Array ndof), passive (Int8Array nel: 0 design,1 void,2 solid),
        vf (of non-void area), rmin (elements), penal, symX, maxIter, projection (bool), loadNodes (Int32Array) }
 onIter(it, c, vol, beta, xPhys)
*/
function optimize(job, onIter) {
  const { nelx, nely, nu, passive } = job;
  const penal = job.penal || 3, Emin = 1e-9, eta = 0.5;
  const mesh = makeMesh(nelx, nely), KE = makeKE(nu), nel = mesh.nel;
  const flt = makeFilter(nelx, nely, job.rmin);
  let nDesign = 0, nSolid = 0, nVoid = 0;
  for (let e = 0; e < nel; e++) { if (passive[e] === 0) nDesign++; else if (passive[e] === 2) nSolid++; else nVoid++; }
  const target = Math.max(nSolid + 1, job.vf * (nel - nVoid)); // material in element-units
  const x = new Float64Array(nel), xT = new Float64Array(nel), xP = new Float64Array(nel);
  const fillDesign = Math.min(1, Math.max(0.01, (target - nSolid) / Math.max(1, nDesign)));
  for (let e = 0; e < nel; e++) x[e] = passive[e] === 1 ? 0 : passive[e] === 2 ? 1 : fillDesign;
  const proj = job.projection !== false;
  let beta = 1;
  const physical = (xin) => {
    applyH(flt, xin, xT);
    for (let e = 0; e < nel; e++) {
      xT[e] /= flt.Hs[e];
      let v = proj ? projT(xT[e], beta, eta) : xT[e];
      if (passive[e] === 1) v = 0; else if (passive[e] === 2) v = 1;
      xP[e] = v;
    }
  };
  physical(x);
  const Ev = new Float64Array(nel), dc = new Float64Array(nel), dv = new Float64Array(nel);
  const tmp = new Float64Array(nel), xnew = new Float64Array(nel);
  const maxIter = job.maxIter || 120;
  let c = 0, it = 0, change = 1, loopBeta = 0;
  const mirror = (e) => { const ix = Math.floor(e / nely), iy = e % nely; return (nelx-1-ix)*nely + iy; };
  while (it < maxIter) {
    it++; loopBeta++;
    for (let e = 0; e < nel; e++) Ev[e] = Emin + Math.pow(xP[e], penal) * (1 - Emin);
    const U = feSolve(mesh, KE, Ev, job.F, job.fixed);
    c = 0;
    for (let e = 0; e < nel; e++) {
      const o = e*8; let ce = 0;
      for (let a = 0; a < 8; a++) {
        let s = 0; const ua = mesh.edof[o+a];
        for (let b = 0; b < 8; b++) s += KE[a*8+b] * U[mesh.edof[o+b]];
        ce += U[ua] * s;
      }
      c += Ev[e] * ce;
      dc[e] = passive[e] ? 0 : -penal * (1 - Emin) * Math.pow(xP[e], penal-1) * ce;
      dv[e] = passive[e] ? 0 : 1;
    }
    // chain rule through projection and filter
    for (let e = 0; e < nel; e++) {
      const d = proj ? projD(xT[e], beta, eta) : 1;
      tmp[e] = dc[e] * d / flt.Hs[e];
    }
    applyH(flt, tmp, dc);
    for (let e = 0; e < nel; e++) { const d = proj ? projD(xT[e], beta, eta) : 1; tmp[e] = dv[e] * d / flt.Hs[e]; }
    applyH(flt, tmp, dv);
    if (job.symX) for (let e = 0; e < nel; e++) {
      const m = mirror(e); if (m > e) { const a = (dc[e]+dc[m])/2, b = (dv[e]+dv[m])/2; dc[e]=dc[m]=a; dv[e]=dv[m]=b; }
    }
    // OC with bisection on physical volume
    let l1 = 0, l2 = 1e9; const move = 0.2;
    while ((l2 - l1) / (l1 + l2) > 1e-4 && l2 > 1e-40) {
      const lm = 0.5 * (l1 + l2);
      for (let e = 0; e < nel; e++) {
        if (passive[e] === 1) { xnew[e] = 0; continue; }
        if (passive[e] === 2) { xnew[e] = 1; continue; }
        const r = Math.sqrt(Math.max(0, -dc[e]) / Math.max(1e-30, dv[e]) / lm);
        xnew[e] = Math.max(0, Math.max(x[e]-move, Math.min(1, Math.min(x[e]+move, x[e]*r))));
      }
      physical(xnew);
      let vol = 0; for (let e = 0; e < nel; e++) vol += xP[e];
      if (vol > target) l1 = lm; else l2 = lm;
    }
    change = 0;
    for (let e = 0; e < nel; e++) { change = Math.max(change, Math.abs(xnew[e] - x[e])); x[e] = xnew[e]; }
    physical(x);
    let vol = 0; for (let e = 0; e < nel; e++) vol += xP[e];
    if (onIter) onIter(it, c, vol / Math.max(1, nel - nVoid), beta, xP);
    if (proj && beta < 16 && (loopBeta >= 25 || change <= 0.01)) { beta *= 2; loopBeta = 0; physical(x); }
    else if ((!proj || beta >= 16) && change < 0.01 && it > 20) break;
  }
  return { xPhys: Float64Array.from(xP), c, it, mesh };
}

// ---------- post-processing ----------
function components(nelx, nely, mask) { // 4-connected labels for mask==1
  const nel = nelx*nely, lab = new Int32Array(nel).fill(-1); let n = 0;
  const st = new Int32Array(nel);
  for (let s = 0; s < nel; s++) {
    if (!mask[s] || lab[s] >= 0) continue;
    let sp = 0; st[sp++] = s; lab[s] = n;
    while (sp) {
      const e = st[--sp], ix = Math.floor(e/nely), iy = e % nely;
      const nb = [ix>0 ? e-nely : -1, ix<nelx-1 ? e+nely : -1, iy>0 ? e-1 : -1, iy<nely-1 ? e+1 : -1];
      for (const m of nb) if (m >= 0 && mask[m] && lab[m] < 0) { lab[m] = n; st[sp++] = m; }
    }
    n++;
  }
  return { lab, n };
}

function morphOpen(nelx, nely, solid, r) { // opening with disk radius r (elements); returns opened mask
  const nel = nelx*nely, R = Math.floor(r), disk = [];
  for (let a = -R; a <= R; a++) for (let b = -R; b <= R; b++) if (a*a + b*b <= r*r) disk.push([a, b]);
  const er = new Uint8Array(nel), op = new Uint8Array(nel);
  for (let ix = 0; ix < nelx; ix++) for (let iy = 0; iy < nely; iy++) {
    let ok = 1;
    for (const [a, b] of disk) { const jx = ix+a, jy = iy+b;
      if (jx < 0 || jy < 0 || jx >= nelx || jy >= nely || !solid[jx*nely+jy]) { ok = 0; break; } }
    er[ix*nely+iy] = ok;
  }
  for (let ix = 0; ix < nelx; ix++) for (let iy = 0; iy < nely; iy++) {
    if (!er[ix*nely+iy]) continue;
    for (const [a, b] of disk) { const jx = ix+a, jy = iy+b;
      if (jx >= 0 && jy >= 0 && jx < nelx && jy < nely) op[jx*nely+jy] = 1; }
  }
  return op;
}

/* Analyse a 0/1 layout with E = 1 MPa, t = 1 mm, real loads (N), element size h (mm).
   Stress scales as 1/t; displacement as 1/(E t). */
function evaluate(job, field, h) {
  const { nelx, nely, nu, passive } = job;
  const mesh = makeMesh(nelx, nely), nel = mesh.nel, KE = makeKE(nu);
  const solid = new Uint8Array(nel);
  for (let e = 0; e < nel; e++) solid[e] = passive[e] === 2 ? 1 : passive[e] === 1 ? 0 : (field[e] > 0.5 ? 1 : 0);
  // enforce minimum member width: grow under-width members (2 passes), never into keep-out zones
  let added = 0;
  const rW0 = ((job.minWidth || 0) / h - 1) / 2;
  if (job.enforceWidth && rW0 >= 1) for (let pass = 0; pass < 2; pass++) {
    const op = morphOpen(nelx, nely, solid, rW0);
    const d = Math.max(1, Math.ceil(rW0 / 2)), D = [];
    for (let a = -d; a <= d; a++) for (let b = -d; b <= d; b++) if (a*a + b*b <= d*d + 0.5) D.push([a, b]);
    const grow = [];
    for (let ix = 0; ix < nelx; ix++) for (let iy = 0; iy < nely; iy++) {
      const e = ix*nely + iy; if (!solid[e] || op[e]) continue;
      for (const [a, b] of D) { const jx = ix+a, jy = iy+b;
        if (jx >= 0 && jy >= 0 && jx < nelx && jy < nely) { const m = jx*nely + jy; if (!solid[m] && passive[m] !== 1) grow.push(m); } }
    }
    for (const m of grow) if (!solid[m]) { solid[m] = 1; added++; }
    if (!grow.length) break;
  }
  // fill enclosed slivers of void too small to cut (smaller than a min-width square)
  let filled = 0;
  { const vmask = new Uint8Array(nel); for (let e = 0; e < nel; e++) vmask[e] = solid[e] ? 0 : 1;
    const vc = components(nelx, nely, vmask), size = new Int32Array(vc.n), edge = new Uint8Array(vc.n), keepout = new Uint8Array(vc.n);
    for (let e = 0; e < nel; e++) if (vmask[e]) { const l = vc.lab[e], ix = Math.floor(e/nely), iy = e % nely; size[l]++;
      if (ix === 0 || iy === 0 || ix === nelx-1 || iy === nely-1) edge[l] = 1; if (passive[e] === 1) keepout[l] = 1; }
    const minA = Math.max(4, Math.pow((job.minWidth || 0) / h, 2));
    for (let e = 0; e < nel; e++) if (vmask[e]) { const l = vc.lab[e]; if (!edge[l] && !keepout[l] && size[l] < minA) { solid[e] = 1; filled++; } } }
  // keep only material connected to a support
  const fixedNode = new Uint8Array(mesh.nn);
  for (let d = 0; d < mesh.ndof; d++) if (job.fixed[d]) fixedNode[d >> 1] = 1;
  const { lab, n } = components(nelx, nely, solid);
  const keep = new Uint8Array(n);
  for (let e = 0; e < nel; e++) if (solid[e]) for (let a = 0; a < 4; a++) if (fixedNode[mesh.edof[e*8+2*a] >> 1]) keep[lab[e]] = 1;
  let anyKeep = false; for (let i = 0; i < n; i++) anyKeep = anyKeep || keep[i];
  let removed = 0;
  if (anyKeep) for (let e = 0; e < nel; e++) if (solid[e] && !keep[lab[e]]) { solid[e] = 0; removed++; }
  // loaded nodes must touch material
  const loadNode = new Uint8Array(mesh.nn);
  for (let d = 0; d < mesh.ndof; d++) if (job.F[d] !== 0) loadNode[d >> 1] = 1;
  const touched = new Uint8Array(mesh.nn);
  for (let e = 0; e < nel; e++) if (solid[e]) for (let a = 0; a < 4; a++) touched[mesh.edof[e*8+2*a] >> 1] = 1;
  let brokenLoads = 0; for (let i = 0; i < mesh.nn; i++) if (loadNode[i] && !touched[i]) brokenLoads++;
  // FE with solid/void (void = 1e-6 of solid)
  const Ev = new Float64Array(nel);
  for (let e = 0; e < nel; e++) Ev[e] = solid[e] ? 1 : 1e-6;
  const U = feSolve(mesh, KE, Ev, job.F, job.fixed);
  const vm = new Float32Array(nel);
  let vmMax = 0, vmMaxAll = 0, vmEl = -1, nSolid = 0;
  for (let e = 0; e < nel; e++) {
    if (!solid[e]) continue;
    nSolid++;
    const s = elementVM(mesh, U, nu, 1, h, e); vm[e] = s;
    vmMaxAll = Math.max(vmMaxAll, s);
    let atLoad = false;
    for (let a = 0; a < 4; a++) if (loadNode[mesh.edof[e*8+2*a] >> 1]) atLoad = true;
    if (!atLoad && s > vmMax) { vmMax = s; vmEl = e; }
  }
  const dmag = new Float32Array(mesh.nn);
  let dMax = 0, dLoad = 0;
  for (let i = 0; i < mesh.nn; i++) {
    const m = Math.hypot(U[2*i], U[2*i+1]); dmag[i] = m;
    if (touched[i]) dMax = Math.max(dMax, m);
    if (loadNode[i]) dLoad = Math.max(dLoad, m);
  }
  let comp = 0; for (let d = 0; d < mesh.ndof; d++) comp += job.F[d] * U[d];
  // holes: void components not touching the domain edge
  const voidMask = new Uint8Array(nel); for (let e = 0; e < nel; e++) voidMask[e] = solid[e] ? 0 : 1;
  const vc = components(nelx, nely, voidMask), edgeTouch = new Uint8Array(vc.n);
  for (let e = 0; e < nel; e++) if (voidMask[e]) { const ix = Math.floor(e/nely), iy = e % nely;
    if (ix === 0 || iy === 0 || ix === nelx-1 || iy === nely-1) edgeTouch[vc.lab[e]] = 1; }
  let holes = 0; for (let i = 0; i < vc.n; i++) if (!edgeTouch[i]) holes++;
  // thin features vs minimum member width
  let thin = new Uint8Array(nel), thinCount = 0;
  const rW = ((job.minWidth || 0) / h - 1) / 2;
  if (rW >= 1) {
    const op = morphOpen(nelx, nely, solid, rW);
    for (let e = 0; e < nel; e++) if (solid[e] && !op[e] && passive[e] !== 2) { thin[e] = 1; thinCount++; }
  }
  const U32 = new Float32Array(U);
  return { added, filled, solid, vm, vmMax, vmMaxAll, vmEl, dmag, dMax, dLoad, comp, nSolid, holes, removed, brokenLoads, thin, thinCount, U: U32 };
}

if (typeof module !== 'undefined') module.exports = { makeKE, makeMesh, feSolve, makeFilter, optimize, evaluate, components, morphOpen };
