"""Independent plane-stress + Kirchhoff plate-buckling solver for Morphe designs (mm, N, MPa).
Differs from the app in every discretisation choice: conforming triangle mesh of the exported outline (the app uses a Q4 grid),
quadratic P2 displacements, Morley plate elements for buckling (the app uses ACM), scipy sparse LU / ARPACK (the app: banded Cholesky / Lanczos)."""
import numpy as np, scipy.sparse.linalg as spl
from shapely.geometry import Polygon, Point, MultiPolygon
import triangle as tr
from skfem import *
from skfem.helpers import dd, ddot, trace, eye, sym_grad

def domain_from(outline, holes, nseg=64):
    dom = None
    for l in outline:
        if len(l) < 3: continue
        p = Polygon(l).buffer(0)
        dom = p if dom is None else dom.symmetric_difference(p)          # even-odd: outer loops solid, inner loops void
    for h in holes:
        dom = dom.difference(Point(h['x'], h['y']).buffer(h['r'], quad_segs=nseg // 4))
    return dom

def make_mesh(dom, size, simplify=0.0):
    if simplify > 0: dom = dom.simplify(simplify, preserve_topology=True)
    polys = list(dom.geoms) if isinstance(dom, MultiPolygon) else [dom]
    V, S, H = [], [], []
    for pg in polys:
        for ring in [pg.exterior] + list(pg.interiors):
            c = np.array(ring.coords)[:-1]; n0 = len(V)
            V += c.tolist(); S += [[n0 + i, n0 + (i + 1) % len(c)] for i in range(len(c))]
        for ring in pg.interiors: H.append(list(Polygon(ring).representative_point().coords)[0])
    d = {'vertices': np.array(V), 'segments': np.array(S)}
    if H: d['holes'] = np.array(H)
    t = tr.triangulate(d, f'pq28a{0.43 * size * size:.8f}')
    return MeshTri(np.ascontiguousarray(t['vertices'].T), np.ascontiguousarray(t['triangles'].T))

def in_box(x, y, f, pad):
    x0, x1 = sorted((f['x0'], f['x1'])); y0, y1 = sorted((f['y0'], f['y1']))
    return (x >= x0 - pad) & (x <= x1 + pad) & (y >= y0 - pad) & (y <= y1 + pad)

def vec_dofs(ub, m, verts, facets, comps):
    out = []
    for c in comps:
        out += list(ub.nodal_dofs[c - 1, verts]) + list(ub.facet_dofs[c - 1, facets])
    return np.array(out, dtype=int)

def plate_buckling(m, Nq, D, nu, clamp_sets, pin_sets, intorder=4, k=4):
    """Smallest load factor lambda: (Kb + lambda Kg) w = 0 with Kg = int N_ab w,a v,b. Nq = (nxx, nyy, nxy) arrays at quadrature points (N/mm, compression negative)."""
    mb = Basis(m, ElementTriMorley(), intorder=intorder)
    def C(T): return D * ((1 - nu) * T + nu * eye(trace(T), 2))
    @BilinearForm
    def Kb(u, v, w): return ddot(C(dd(u)), dd(v))
    nxx, nyy, nxy = Nq
    @BilinearForm
    def Kg(u, v, w):
        return w['nxx'] * u.grad[0] * v.grad[0] + w['nyy'] * u.grad[1] * v.grad[1] + w['nxy'] * (u.grad[0] * v.grad[1] + u.grad[1] * v.grad[0])
    fields = {'nxx': nxx, 'nyy': nyy, 'nxy': nxy}
    A = asm(Kb, mb); G = asm(Kg, mb, **fields)
    con = []
    for sel in clamp_sets:
        dv = mb.get_dofs(sel); con += list(dv.nodal['u']) + list(dv.facet['u_n'])
    for sel in pin_sets:
        dv = mb.get_dofs(sel); con += list(dv.nodal['u'])
    con = np.unique(np.array(con, dtype=int)); free = np.setdiff1d(np.arange(mb.N), con)
    Af, Gf = A[free][:, free].tocsc(), (-G[free][:, free]).tocsc()
    mu = spl.eigsh(Gf, k=k, M=Af, which='LA', return_eigenvectors=False, tol=1e-9)
    mu = mu[mu > 0]
    return (1.0 / mu.max()) if len(mu) else np.inf

def run_design(d, size, hF, patch=1.0, buckling=True, ring_minW=3.0, keep=False):
    E, nu, t = d['mat']['E'], d['mat']['nu'], d['t']
    dom = domain_from(d['outline'], d['holes'])
    m = make_mesh(dom, size, simplify=0.01 * hF)
    ub = Basis(m, ElementVector(ElementTriP2()), intorder=4); N = ub.N
    lam_, mu_ = E * nu / (1 - nu ** 2), E / (2 * (1 + nu))
    @BilinearForm
    def K(u, v, w):
        eu, ev = sym_grad(u), sym_grad(v)
        return 2 * mu_ * (eu[0, 0] * ev[0, 0] + 2 * eu[0, 1] * ev[0, 1] + eu[1, 1] * ev[1, 1]) + lam_ * (eu[0, 0] + eu[1, 1]) * (ev[0, 0] + ev[1, 1])
    Kmat = t * asm(K, ub)
    fac = m.boundary_facets(); mid = m.p[:, m.facets[:, fac]].mean(axis=1)
    fixed = np.zeros(N, bool); clamp, pin, boxes = [], [], []
    for f in d['features']:
        if f['type'] != 'fix': continue
        sel = fac[in_box(mid[0], mid[1], f, 0.5 * hF)]
        if not len(sel): raise RuntimeError('support hit no boundary facets')
        comps = {'xy': [1, 2], 'x': [1], 'y': [2]}[f['dof']]
        fixed[vec_dofs(ub, m, np.unique(m.facets[:, sel]), sel, comps)] = True
        (clamp if f['dof'] == 'xy' else pin).append(sel); boxes.append(f)
    hsel = []
    for hh in d['holes']:
        r = np.hypot(mid[0] - hh['x'], mid[1] - hh['y']); sel = fac[np.abs(r - hh['r']) < 0.03 * hh['r']]; hsel.append(sel)
        if hh['role'] == 'support':
            fixed[vec_dofs(ub, m, np.unique(m.facets[:, sel]), sel, [1, 2])] = True; clamp.append(sel)
    cases, loadnodes = {}, {}
    def add(k, vec, verts, facets):
        cases[k] = cases.get(k, 0) + vec; loadnodes.setdefault(k, []).append((verts, facets))
    sc = ElementTriP2()
    for f in d['features']:
        if f['type'] != 'load': continue
        k, xL, yL, rp = f.get('lc', 1), f['x'], f['y'], 1.2 * patch * hF
        sel = fac[np.hypot(mid[0] - xL, mid[1] - yL) < 1.5 * rp]
        if not len(sel): raise RuntimeError('load point is not on the boundary')
        fb = FacetBasis(m, ElementVector(ElementTriP2()), facets=sel, intorder=4); fbs = FacetBasis(m, sc, facets=sel, intorder=4)
        wgt = lambda x, xL=xL, yL=yL, rp=rp: np.maximum(0, 1 - np.hypot(x[0] - xL, x[1] - yL) / rp)   # triangular patch = what one nodal force on a grid amounts to
        @LinearForm
        def Li(v, w): return wgt(w.x) * v
        integ = asm(Li, fbs).sum(); fx, fy = f['fx'] / integ, f['fy'] / integ
        @LinearForm
        def Lt(v, w): return wgt(w.x) * (fx * v[0] + fy * v[1])
        vs = np.unique(m.facets[:, sel]); vs = vs[np.hypot(m.p[0, vs] - xL, m.p[1, vs] - yL) < rp]
        fm = m.p[:, m.facets[:, sel]].mean(axis=1); fs = sel[np.hypot(fm[0] - xL, fm[1] - yL) < rp]
        add(k, asm(Lt, fb), vs, fs)
    for hh, sel in zip(d['holes'], hsel):
        if hh['role'] != 'load': continue
        k, F = hh['lc'], np.array([hh['fx'], hh['fy']]); u = F / np.linalg.norm(F); cx, cy = hh['x'], hh['y']
        fb = FacetBasis(m, ElementVector(ElementTriP2()), facets=sel, intorder=4); fbs = FacetBasis(m, sc, facets=sel, intorder=4)
        def cw(x, cx=cx, cy=cy, u=u):
            rx, ry = x[0] - cx, x[1] - cy; return np.maximum(0, (rx * u[0] + ry * u[1]) / (np.hypot(rx, ry) + 1e-30))
        @LinearForm
        def Li(v, w): return cw(w.x) * v
        integ = asm(Li, fbs).sum()
        @LinearForm
        def Lt(v, w): return cw(w.x) * (F[0] * v[0] + F[1] * v[1]) / integ
        vs = np.unique(m.facets[:, sel]); vs = vs[((m.p[0, vs] - cx) * u[0] + (m.p[1, vs] - cy) * u[1]) > 1e-9]
        fm = m.p[:, m.facets[:, sel]].mean(axis=1); fs = sel[((fm[0] - cx) * u[0] + (fm[1] - cy) * u[1]) > 1e-9]
        add(k, asm(Lt, fb), vs, fs)
    free = ~fixed; lu = spl.splu(Kmat[free][:, free].tocsc())
    exclR = d['exclR']
    cb = Basis(m, ElementVector(ElementTriP2()), quadrature=(np.array([[1 / 3], [1 / 3]]), np.array([0.5])))
    cen = m.p[:, m.t].mean(axis=1); near = np.zeros(m.t.shape[1], bool)
    for f in boxes:
        x0, x1 = sorted((f['x0'], f['x1'])); y0, y1 = sorted((f['y0'], f['y1']))
        near |= np.hypot(np.maximum(np.maximum(x0 - cen[0], cen[0] - x1), 0), np.maximum(np.maximum(y0 - cen[1], cen[1] - y1), 0)) <= exclR + 0.5 * hF
    for f in d['features']:
        if f['type'] == 'load': near |= np.hypot(cen[0] - f['x'], cen[1] - f['y']) <= exclR + 0.5 * hF
    ign = np.zeros_like(near)
    for hh in d['holes']:
        if hh['role'] != 'free': ign |= np.hypot(cen[0] - hh['x'], cen[1] - hh['y']) <= max(1.5 * 2 * hh['r'], hh['r'] + ring_minW) + 1e-9
    cof = E / (1 - nu ** 2); out = {'nel': int(m.t.shape[1]), 'ndof': int(N), 'cases': {}}
    ub4 = ub   # same quadrature (intorder 4) as the Morley basis
    for k, F in sorted(cases.items()):
        U = np.zeros(N); U[free] = lu.solve(F[free])
        g = cb.interpolate(U).grad; ex, ey, gam = g[0, 0, :, 0], g[1, 1, :, 0], g[0, 1, :, 0] + g[1, 0, :, 0]
        sx, sy, txy = cof * (ex + nu * ey), cof * (nu * ex + ey), cof * (1 - nu) / 2 * gam
        vm = np.sqrt(sx * sx - sx * sy + sy * sy + 3 * txy * txy)
        dl = 0.0
        for vs, fs in loadnodes[k]:
            dx = np.concatenate([U[ub.nodal_dofs[0, vs]], U[ub.facet_dofs[0, fs]]]); dy = np.concatenate([U[ub.nodal_dofs[1, vs]], U[ub.facet_dofs[1, fs]]])
            if len(dx): dl = max(dl, float(np.hypot(dx, dy).max()))
        xd = np.concatenate([ub.nodal_dofs[0], ub.facet_dofs[0]]); yd = np.concatenate([ub.nodal_dofs[1], ub.facet_dofs[1]])
        R = Kmat @ U - F; react = [float(R[xd][fixed[xd]].sum()), float(R[yd][fixed[yd]].sum())]
        res = dict(vmAway=float(vm[~near & ~ign].max()), vmAll=float(vm.max()), defl=dl, react=react, sumF=[float(F[xd].sum()), float(F[yd].sum())])
        if keep: res['vm_el'], res['cen'], res['near'], res['ign'] = vm, cen, near, ign
        if buckling:
            gq = ub4.interpolate(U).grad
            exq, eyq, gq_ = gq[0, 0], gq[1, 1], gq[0, 1] + gq[1, 0]
            Nq = (t * cof * (exq + nu * eyq), t * cof * (nu * exq + eyq), t * cof * (1 - nu) / 2 * gq_)
            D = E * t ** 3 / (12 * (1 - nu ** 2))
            res['lam'] = float(plate_buckling(m, Nq, D, nu, clamp, pin))
        out['cases'][k] = res
    return out
