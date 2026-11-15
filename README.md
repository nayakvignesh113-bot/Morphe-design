# Morphe Design Studio

Generative design for plate parts that runs in the browser. You draw the supports, loads and keep-out zones. Morphe then grows a family of six topology-optimized designs, sizes each one to the thinnest standard plate gauge that meets your factor of safety (and deflection limit, if you set one), recommends the lightest design that passes, and exports it as DXF/SVG for laser, waterjet or CNC cutting.

There is no install and no server. Everything runs client-side in one `index.html`, with the FEA running in Web Workers.

## Use

1. Pick a template (bolted bracket, cantilever, simply supported beam, L-bracket, wall shelf bracket, bracket with three load cases) or start from a blank plate.
2. On the drawing board:
   - **Support**: drag along an edge, or tap for a bolt point. Choose fixed, slides horizontally or slides vertically.
   - **Load**: set its size (N) and direction (0° right, 90° up, 270° down) in the toolbar, then tap; or drag from the point to aim it. Edit Fx/Fy in the list afterwards.
   - **Bolt hole**: pick a bolt (M4–M20). The tool cuts the ISO 273 clearance hole and keeps a material ring 1.5 d around it. A *support bolt* holds the hole edge; a *load pin* pushes on the side of the hole facing the load (cosine bearing pressure). Checks: plate bearing F/(d·t) (enters thickness sizing), bolt shear (class 8.8, through the threads), edge distance ≥ 1.5 d, spacing ≥ 3 d. Holes export as exact DXF circles.
   - **Load cases**: press **+ Load case** for a separate situation the part must survive (e.g. working load, a sideways knock, reversed load). New loads go into the active case; move a load between cases from its row. Loads in the same case act together.
   - **Keep-out**: a region that must stay empty (clearance for a bolt head, shaft or neighbouring part). Give rectangles a corner radius.
   - **Keep-solid**: a region that must stay material (mounting flange, seating face, area around a hole to be drilled).
3. Set the material, the manufacturing process (this sets the minimum member width), the target factor of safety, the buckling load factor and the deflection limit.
4. Press **Generate designs**. The designs form live. The recommended one is marked, and the mass-vs-deflection chart shows the trade-off.
5. Inspect the Stress, Deflection, Buckling and Thin-webs views, then download the CAD pack (DXF + STL + SVG + CSV report + project JSON), or DXF/STL on their own.
6. Save project / Open project keeps a setup as a file. The current setup is also kept in your browser between visits, and Undo (Ctrl+Z) steps back through edits.

## Equations and validation in the app

Below each design, **How the numbers are calculated** lists every equation (plane stress, finite elements, SIMP, filter and projection, optimality criteria, von Mises, buckling eigenproblem, thickness scaling, Richardson extrapolation) with that design's own numbers substituted, down to the thickness, factor of safety, deflection, buckling factor and mass. **How to validate this design** gives the setup for an independent FEA run (supports, loads, material, thickness) with the expected values and tolerances, a strain-gauge location for a physical test, and, for the solid cantilever reference, a beam-theory hand check. The CAD pack includes the same as `validation.txt`.

Note: thickness is re-sized for every setup, so adding load makes the plate thicker and the reported deflection may barely move. Untick thickness sizing to compare loads at one thickness.

## Method

| Step | What is done |
|---|---|
| Analysis | 2D plane stress, 4-node bilinear quads, banded Cholesky direct solver |
| Optimization | SIMP (p = 3), density filter, Heaviside projection with β continuation 1 → 16, optimality-criteria update. With several load cases the summed compliance is minimized (one factorization, one back-solve per case) |
| Design family | Volume fraction 0.20 / 0.30 / 0.45 × two member-size filters (process minimum width, and 1.8× that) |
| Clean-up | Threshold at 0.5; remove islands not connected to a support; fill enclosed slivers smaller than a min-width square; widen members narrower than the minimum width (morphological opening check) |
| Buckling | Linear eigenvalue of out-of-plane plate buckling: ACM 12-dof plate elements, geometric stiffness from the in-plane stresses, Lanczos (full re-orthogonalization, residual test) for the smallest positive load factor, which stays correct when the reversed-load mode dominates. Bolted supports clamped, sliding supports simply supported |
| Mesh check | After each run, every design's cut outline (the smoothed layout that becomes the DXF) is resampled onto the same, 2× and 3× finer meshes and re-analysed. Peak stress, which element-centre stress under-reads at rounded junctions and bending surfaces, is extrapolated from the two finest meshes (first-order Richardson). Sizing uses that value and the fine-mesh deflection and buckling. Designs whose peak still rises >10% on the last refinement (a sharp corner) or whose outline loses material when smoothed are rejected. Stress within 3 optimizer elements of supports and point loads is reported separately as a hot spot |
| Bolt holes | Support bolts: hole-edge nodes held. Load pins: nodal forces ∝ max(0, n̂·F̂) over the hole edge. Reactions R = K u − F per hole and case give the bearing force. The material ring is checked by bearing, not by the FE peak (a held, stair-stepped hole edge is not a reliable FE stress) |
| Fatigue | Optional (repeated R = 0 or fully reversed R = −1 loading). Modified Goodman on the mesh-checked peak von Mises stress: 1/n = σa/Se + σm/Sut, with Se = ka·kc·ke·Sf (Marin surface factor from the process, axial 0.85, 99 % reliability 0.814). Steel/Ti: endurance limit; aluminium: strength at 5×10⁸ cycles. Scales as 1/t, so it enters thickness sizing exactly |
| Load cases | Every design is analysed for every case: stress, deflection and buckling are each taken from the worst case, and the report names which case governs |
| Sizing | Solved with E = 1, t = 1. Stress ∝ 1/t, deflection ∝ 1/(E·t), buckling load ∝ E·t³, so each required thickness is exact; the largest one wins, rounded up to a standard gauge |
| Stress | Element-centroid von Mises. Elements touching a point load are excluded from the peak (a point load has no finite stress) |
| Export | Marching squares on the cleaned layout → Douglas–Peucker simplification → closed DXF polylines in mm |

## Validation

`node tests/validate.js` (also runs in CI on every push):

| Check | Reference | Result |
|---|---|---|
| MBB beam 60×20, compliance history | Independent Python/SciPy port of Andreassen et al. (2011) 88-line code (`tests/ref88.py`) | Identical to 4+ significant figures over 60 iterations |
| MBB beam, two load cases, summed compliance | Same reference code with a second load column | Identical over 60 iterations |
| Load-case envelope (case 2 = 2 × case 1) | Linearity: stress ×2, deflection ×2, buckling factor ×0.5, case 2 flagged | Exact |
| Cantilever 200×20 mm tip deflection | Timoshenko beam theory (bending + shear) | −0.02 % |
| Mid-span bending stress | Mc/I | −0.12 % |
| Simply supported square plate, uniaxial compression | N_cr = 4π²D/b² | −0.07 % |
| Cantilever strip column (ν = 0) | Euler π²EI/4L² | 0.00 % |
| Plate in pure tension | No buckling | No buckling |
| Statics: support reactions vs applied loads, two cases | ΣR + ΣF = 0 | residual < 10⁻⁵ % |
| Biaxial plate (σx = −1, σy = +3), reversed-load mode 8.3× easier | Exact positive mode (m = 3, n = 1) | −0.12 % |

### Independent benchmark (`benchmark/`)

The finished designs are re-solved with a separate solver (conforming triangle mesh of the exported outline, quadratic P2 elements, Morley plate elements for buckling, SciPy sparse solves). 24 designs from the six templates, all those the app's own mesh check marks converged, were compared; the criteria were fixed before the run.

| Quantity | Independent / app | Within target |
|---|---|---|
| Deflection at load | 0.954 – 1.003 (mean 0.983) | 24 / 24 within 5 % |
| Buckling factor | 0.999 – 1.041 (mean 1.020; app lower in 23 of 24) | 24 / 24 within 5 % |
| Peak stress, finest app mesh | 0.920 – 1.130 (mean 1.038) | 22 / 24 within 10 % (misses: bolted E +11 %, shelf A +13 %) |
| Sizing stress / independent peak, after the 10 % allowance | 0.990 – 1.27 (mean 1.07) | never more than 1 % under |

The benchmark also found and fixed a defect (closed outlines could collapse to two points in the DXF, SVG and hand-off for some designs; the browser suite now checks every design) and showed that the app's finest mesh read peak stress up to 8 % low on some designs, which is why sizing now carries a 10 % discretisation allowance. One limit stays open: stress at sharp inner corners depends on the cut corner radius, and on bolted E the independent peak kept rising as the mesh was refined (107, 120, 137 MPa at 2, 1, 0.5 element sizes). Specify an inner corner radius of at least 1 mm when cleaning the outline in CAD. The independent solver shares the app's modelling assumptions (plane stress, Kirchhoff plates, bonded bolt edge), so this checks the numerics, not the physics. No physical test has been done yet. Details and reproduction steps: `benchmark/README.md`.

## Outline import and minimum inner radius
- **Import DXF / SVG**: LINE, ARC, CIRCLE, ELLIPSE, LWPOLYLINE/POLYLINE (with bulges), and SVG paths, rectangles, circles and polygons are chained into closed loops (even-odd: outer loop is the edge, inner loops are cut-outs). Units are read from the file (DXF `$INSUNITS`, SVG width/viewBox) or set with the units picker. The design space becomes the outline's bounding box. Splines, text and 3D entities are skipped with a warning; open or self-crossing outlines are refused with the location.
- **Min inner radius**: every re-entrant corner and every slot narrower than twice the radius in the final outline is closed to at least this radius (morphological closing on a grid 6x finer than the optimiser mesh). The mesh check, exports and area all use this finished geometry. Values below 1 mm are treated as 1 mm. The imported outline is a hard envelope: material is never added outside it, so its own sharp corners are kept as drawn.
- Tests: `node tests/geom.js` (39 checks on the geometry layer) and `python3 tests/e2e_import.py` (import, envelope, radius via shapely, persistence).

## Why the mesh check matters

On the cantilever template, the optimizer mesh under-reads the peak stress at member junctions by 10–25%. Without the check, design A reported FoS 4.22; on the mesh-checked outline it is 3.22. The check also catches outlines that lose a member when smoothed for cutting, and square re-entrant corners. On the L-bracket with a square keep-out corner, every design is rejected and the tool offers to round the corner; at R 12 mm the designs converge.

## Limits

Linear-elastic, static, in-plane loads, uniform thickness. Buckling is a linear (bifurcation) check, so keep the buckling load factor at 3 or more to cover imperfections. It does **not** check out-of-plane applied loads, bolt preload/friction, fretting or welds. Fatigue data for plastics is not included. Before you release a part, run the exported geometry through a full FEA.

## Hand-off file

`*_handoff.json` (button, and in the CAD pack) carries the finished part for detailed checks in MechDe or any other tool: `geometry.outline` (closed polylines, mm), `geometry.holes`, `design.thickness`, `material`, `supports`, `loads` (with load case), `requirements` and `results`. Units: mm, N, MPa, g; origin at the bottom-left of the design space.

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

## Licence and citation

Proprietary, all rights reserved (see `LICENSE`). Use, copying, modification or distribution needs the author's written permission. To cite, see `CITATION.cff`.
