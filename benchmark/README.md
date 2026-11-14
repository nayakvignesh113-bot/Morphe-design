# Independent benchmark

Re-solves finished Morphe designs with a different solver and compares deflection, buckling factor and peak stress.

## What is independent

| | Morphe (app) | Reference (`indep.py`) |
|---|---|---|
| Geometry | Q4 grid, stair-stepped | Conforming triangle mesh of the exported outline (the part that would be cut) |
| In-plane elements | 4-node bilinear | 6-node quadratic triangles (P2) |
| Plate buckling | ACM 12-dof plate element | Morley element |
| Solvers | Banded Cholesky, Lanczos | SciPy sparse LU, ARPACK |

It shares the app's modelling assumptions (plane stress, Kirchhoff plate theory, bonded bolt edge, the same exclusion zones around supports and loads, a point load as a one-element patch). It checks the numerics, not the physics. A physical test is still needed.

## Solver sanity (`sanity.py`, `sanity.txt`)

| Case | Reference | Result |
|---|---|---|
| Cantilever 200×20 mm, tip deflection | Timoshenko beam theory | −0.2 % on three meshes |
| Reactions vs applied load | Statics | 10⁻⁹ N (10⁻⁴ N over all 36 designs) |
| Simply supported square plate buckling | k = 4.000 | 3.998 (−0.06 %) |
| Clamped square plate buckling | k = 10.07 | 10.05 (−0.24 %) |

## Criteria (fixed before the run)

Deflection within 5 %, buckling factor within 5 %, peak stress away from supports and loads within 10 %. Misses are reported, not averaged away.

## Results

Six templates × six variants = 36 designs. The 12 the app's own mesh check rejects (not converged, sharp corners) are excluded; **24 compared** (plate thickness 4–10 mm).

| Quantity | Independent / app | Within target |
|---|---|---|
| Deflection at load | 0.954 – 1.003 (mean 0.983) | 24 / 24 |
| Buckling factor | 0.999 – 1.041 (mean 1.020) | 24 / 24 |
| Peak stress, finest app mesh | 0.920 – 1.130 (mean 1.038) | **22 / 24** |

Stress misses: bolted E (independent +11.1 %) and shelf A (+13.0 %). Per-design table: `report.txt`.

Deflection at a point load depends on how the load is spread (the exact solution is singular). Widening or narrowing the patch 2× moved the independent deflection by at most 1.1 %, so the agreement is not an artefact of that choice.

## Findings and what was done

1. **Defect fixed.** The outline tracer simplified each closed loop as an open line. When the loop's ends coincided, the main outline collapsed to two points. Three of six bolted-bracket designs, including the recommended one, exported a wrong DXF, SVG and hand-off outline. STL and all stress, deflection and buckling numbers were unaffected. The browser suite now checks every design's outline.
2. **Stress allowance added.** The app's finest-mesh peak read between 8 % low and 13 % high against the reference. Two of 24 designs were sized more than 5 % below it (worst −7.4 %). Sizing now uses the larger of the extrapolated peak and 1.10 × the finest-mesh peak. After the change the sizing stress is never more than 1 % under the reference (min 0.990, mean 1.073). The 1.10 factor was set from these 24 designs; it has not been tested on other geometry.
3. **Open: inner corners.** The reference peak is not mesh-converged on designs with sharp inner corners. At element sizes 2, 1 and 0.5 × the app's finest size, vmAway was 107, 120 and 137 MPa on bolted E (+14 % on the last halving), 80.5, 83.1 and 86.4 on shelf A (+4 %), 59.0, 59.1 and 60.3 on cantilever B (+2 %). The real stress depends on the radius the cutter leaves. The app cannot resolve a corner smaller than one element (0.7–0.9 mm). Specify an inner radius of at least 1 mm in CAD. Enforcing a process-dependent minimum inner radius in the optimizer is not done yet.

## Reproduce

```
pip install scikit-fem triangle shapely numpy scipy playwright
python3 sanity.py
python3 gen.py bolted,cantilever,beam,lbracket,shelf,multicase designs.json   # drives the app in headless Chrome (set CHROME=path)
python3 bench.py                                                               # independent solves
python3 report.py
```

`designs.json` holds the extracted designs, so `bench.py` and `report.py` run without a browser.
