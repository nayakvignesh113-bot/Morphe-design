# Morphe Design Studio

Generative design for plate parts that runs in the browser. You draw the supports, loads and keep-out zones. Morphe then grows a family of six topology-optimized designs, sizes each one to the thinnest standard plate gauge that meets your factor of safety (and deflection limit, if you set one), recommends the lightest design that passes, and exports it as DXF/SVG for laser, waterjet or CNC cutting.

There is no install and no server. Everything runs client-side in one `index.html`, with the FEA running in Web Workers.

## Use

1. Pick a template (cantilever, simply supported beam, L-bracket, wall shelf bracket) or start from a blank plate.
2. On the drawing board:
   - **Support**: drag along an edge, or tap for a bolt point. Choose fixed, slides horizontally or slides vertically.
   - **Load**: tap for a 1 kN downward load, or drag to set its direction. Edit Fx/Fy in N.
   - **Keep-out / Keep-solid**: mark clearances, flanges and mounting faces.
3. Set the material, the manufacturing process (this sets the minimum member width), the target factor of safety and the deflection limit.
4. Press **Generate designs**. The designs form live. The recommended one is marked, and the mass-vs-deflection chart shows the trade-off.
5. Inspect the Stress, Deflection and Thin-webs views, then download the CAD pack (DXF + SVG + CSV report + project JSON).

## Method

| Step | What is done |
|---|---|
| Analysis | 2D plane stress, 4-node bilinear quads, banded Cholesky direct solver |
| Optimization | SIMP (p = 3), density filter, Heaviside projection with β continuation 1 → 16, optimality-criteria update |
| Design family | Volume fraction 0.20 / 0.30 / 0.45 × two member-size filters (process minimum width, and 1.8× that) |
| Clean-up | Threshold at 0.5; remove islands not connected to a support; fill enclosed slivers smaller than a min-width square; widen members narrower than the minimum width (morphological opening check) |
| Sizing | Solved with E = 1, t = 1. Stress ∝ 1/t and deflection ∝ 1/(E·t), so the required thickness is exact and then rounded up to a standard gauge |
| Stress | Element-centroid von Mises. Elements touching a point load are excluded from the peak (a point load has no finite stress) |
| Export | Marching squares on the cleaned layout → Douglas–Peucker simplification → closed DXF polylines in mm |

## Validation

`node tests/validate.js` (also runs in CI on every push):

| Check | Reference | Result |
|---|---|---|
| MBB beam 60×20, compliance history | Independent Python/SciPy port of Andreassen et al. (2011) 88-line code (`tests/ref88.py`) | Identical to 4+ significant figures over 60 iterations |
| Cantilever 200×20 mm tip deflection | Timoshenko beam theory (bending + shear) | −0.02 % |
| Mid-span bending stress | Mc/I | −0.12 % |

## Limits

Linear-elastic, static, in-plane loads, uniform thickness, a single load case. It does **not** check buckling of slender compression members, out-of-plane loading, fatigue or bolt-hole bearing. Before you release a part, run the exported geometry through a full FEA.

## Develop

```
src/core.js             solver, optimizer, post-processing (shared by worker and tests)
src/app.js              interface, sizing, export
src/index.template.html layout and styles
build.py                inlines src/ into index.html
tests/                  validation suite and top88 reference
```

Edit the files in `src/`, run `python3 build.py`, and commit the regenerated `index.html`. CI fails if it is out of date.

## Reference

Andreassen E., Clausen A., Schevenels M., Lazarov B.S., Sigmund O. (2011). Efficient topology optimization in MATLAB using 88 lines of code. *Structural and Multidisciplinary Optimization* 43, 1–16.
