# Browser tests

Headless-Chromium tests for `viewer.html`, driven by [Playwright](https://playwright.dev). They open the viewer on small models with known dimensions, then click faces and edges, measure and explode, and check the numbers and drawings against the design values.

## Setup

Node 18 or later, from this folder:

```
npm install --no-save playwright@1.56.1
npx playwright install chromium
```

There is deliberately no `package.json`: the repo adds no npm manifest (see `CLAUDE.md`), and `--no-save` installs Playwright into `node_modules/` here without writing one. Both are ignored by git.

t5 also needs the Python that runs `stepview.py`, with `cascadio` installed. t6 and t7 need a large generated model (see [Models](#models)). When either is missing, those tests are skipped and the rest still run.

## Run

```
node run.js              all tests
node run.js t2 t18       only these
node run.js -v t13       stream the test's own output
```

`run.js` does the following:

- builds `www/viewer_test.html` from the repo's `viewer.html`, adding a `window.__qs` debug handle to the app;
- serves that page and `models/` on a free loopback port;
- runs each test in its own Node process and prints one line per test, then a summary.

Each test's full output goes to `out/<test>.log`, with its screenshots alongside. The exit code is 1 if anything failed. A test fails when it prints a line starting with `FAIL`, reports `N FAILURES`, or exits non-zero.

On Windows, run the same commands in PowerShell or `cmd`. To pick the Python used for t5, set `PYTHON`, e.g. `set PYTHON=C:\Python312\python.exe`. Without it, `run.js` tries `python`, `python3` and `py`, and uses the first one that can import `cascadio`.

## The tests

| Test | What it checks |
|---|---|
| t1 | the surfaces found on each part (report only) |
| t2 | the core measurements, with real mouse clicks: hole to hole, plane to axis, circle to edge, corner arc, boss, fillet torus, sphere, bracket walls, and the same distance while exploded. Runs on the B-rep GLB and on the plain GLB |
| t3 | Keep, leaving Measure mode, Face mode on a hole, edges and caps following exploded parts, Z-only explode; screenshots in `out/` |
| t4 | Section → Plane from circle, STL measurements, the panel on unit toggle |
| t5 | the full pipeline: STEP upload → `stepview.py` `/convert` → B-rep data → exact R2 fillet |
| t6 | timings on the 401-part model (report only) |
| t7 | 400 bolts sharing one geometry, each coaxial in its hole with 0.100 mm clearance |
| t8 | the same face picked twice, picks against a section cut, raw units, Edge-mode highlight while exploded, loading a new model while measuring, STL Face mode |
| t9 | raw / mm labels; a straight edge is exact only with B-rep data |
| t10 | feature edges stay on their parts before, during and after explode |
| t11 | areas marked (mesh); circle to edge measured to the edge itself |
| t12 | non-uniform scale; an edge is exact only when its two faces meet in it |
| t13 | exact circles from two B-rep faces; (mesh) extents; Keep only with a drawn number |
| t14 | patches of one cylinder; per-part section planes and caps while exploded |
| t15 | angle labels; cone clearance to a plane along its axis |
| t16 | a label for pairs whose figures are all zero, marked (assembled) when exploded |
| t17 | free boundaries split at corners (open STL sheets) |
| t18 | parallel edges measured between the picked segments |
| t19 | a lone plane or freeform face labels its area |

t9–t19 were written against review findings on the measure / explode feature (PR #2). The `codexN` in a file name is the order the tests were written in; it does not match the review round number.

## Models

`models/` holds the committed test models, all in millimetres:

- `asm.step` — a plate (100 × 60 × 10, Ø10 and Ø16 holes, 1 mm chamfer, R5 corners), a stepped Ø20/Ø12 shaft with an R2 shoulder fillet and a Ø12 ball end, and a U-bracket rotated 30° with 20 mm between its inner walls. `asm_brep.glb` is it converted with B-rep data, as `stepview.py` does; `asm_plain.glb` is the same without.
- `asm2.step` / `asm2_brep.glb` — two instances of one bolt and a lofted body with B-spline faces.
- `plate.stl` — the plate alone as STL. `sheet_*.stl` are open sheets: a 40 × 20 rectangle meshed 4 × 2, the same as two bare triangles, and an R10 disc.

`tools/make_models.py` rebuilds them with build123d and cascadio, using `stepview.py`'s normal tolerance. The GLB and STL files it writes are byte-identical to the committed ones; the STEP files differ only in the timestamp in their header. `--big` also writes `big.step` and `big_brep.glb`, the 401-part assembly for t6 and t7 (about 2 MB). These are not committed.

```
python -m pip install build123d cascadio
python tools/make_models.py --big
```

`tools/inspect_glb.py <file.glb>` prints a GLB's nodes, meshes and `TM_brep_faces` data. It needs numpy.
