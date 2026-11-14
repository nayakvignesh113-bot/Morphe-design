"""Prove the independent solver on analytical cases before using it as a reference."""
import numpy as np, time
from indep import *
res = []
# 1. Cantilever, plane stress: tip deflection vs Timoshenko beam (bending + shear)
L, Hh, t, E, nu, P = 200.0, 20.0, 5.0, 69000.0, 0.33, 100.0
d = dict(mat=dict(E=E, nu=nu), t=t, outline=[[[0,0],[L,0],[L,Hh],[0,Hh]]], holes=[], exclR=0,
         features=[dict(type='fix', dof='xy', x0=0, y0=0, x1=0, y1=Hh), dict(type='load', x=L, y=Hh/2, fx=0, fy=-P)])
I = t * Hh**3 / 12; G = E / (2*(1+nu)); dth = P*L**3/(3*E*I) + P*L/((5/6)*G*t*Hh)
for size in (2.0, 1.0, 0.5):
    o = run_design(d, size, 0.5, patch=6.0, buckling=False)   # wide patch: avoids the point-load singularity, which is mesh-dependent
    c = o['cases'][1]
    print(f'cantilever size {size}: tip defl {c["defl"]:.5f} mm vs Timoshenko {dth:.5f}  ({c["defl"]/dth-1:+.2%}); reactions {c["react"]} loads {c["sumF"]}')
# 2. Buckling of a simply supported plate under uniform compression (k = 4 for a square) and clamped square (k = 10.07)
def plate_test(a, b, nxx, clamp_all, size, nu=0.3):
    dom = domain_from([[[0,0],[a,0],[a,b],[0,b]]], []); m = make_mesh(dom, size)
    fac = m.boundary_facets(); sets = [fac]; D = 1.0
    mb = Basis(m, ElementTriMorley(), intorder=4)
    Nq = (np.full((m.t.shape[1], mb.X.shape[1]), -1.0), np.zeros((m.t.shape[1], mb.X.shape[1])), np.zeros((m.t.shape[1], mb.X.shape[1])))
    lam = plate_buckling(m, Nq, D, nu, sets if clamp_all else [], [] if clamp_all else sets)
    return lam, m.t.shape[1]
for nm, clamp, kref in (('simply supported square', False, 4.0), ('clamped square', True, 10.07)):
    for size in (8.0, 4.0, 2.0):
        lam, n = plate_test(100.0, 100.0, -1.0, clamp, size)
        k = lam * 100.0**2 / (np.pi**2 * 1.0)
        print(f'{nm}: {n} triangles  k = {k:.4f} vs {kref}  ({k/kref-1:+.2%})')
