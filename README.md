# QuickSTEP — lightweight local STEP viewer

A two-file tool for engineers who just need to look at a STEP assembly, spin it around, and grab a screenshot — without waiting for SolidWorks or CATIA to load.

`stepview.py` runs a small local helper that converts STEP files to a lightweight mesh (GLB) using an embedded OpenCASCADE kernel, caches the result, and opens `viewer.html` in your default browser. Once the viewer is open you can drag and drop `.step` files straight onto the page — the tessellation happens in the local Python process, never in the browser and never in the cloud. The viewer is a single self-contained HTML file with the 3D engine bundled inside it — it works with no internet connection, and no data ever leaves the machine. The web server it starts listens on `127.0.0.1` only.

## Why it's fast

Full CAD applications rebuild exact B-rep geometry, feature history, and constraints on every open. For viewing, none of that is needed — only a tessellated mesh. The one-time tessellation of a huge assembly can still take a while (roughly comparable to a CAD import), but it happens once. Every subsequent open of the same file loads the cached mesh and is typically a second or two, even for assemblies with thousands of parts. To make even the *first* open fast, warm the cache in the background (overnight, or on file arrival):

```
python stepview.py --warm  \\server\projects\incoming_step\
```

## Setup (one time, per machine)

Requires 64-bit Python 3.9–3.13 and one package:

```
python -m pip install cascadio
python stepview.py --check          verify the setup
```

`cascadio` ships prebuilt wheels for Windows, macOS and Linux, so nothing is compiled and no CAD software or OpenCASCADE install is needed. If `pip` cannot reach the internet from a corporate network, either pass the proxy (`python -m pip install --proxy http://user:pass@proxy:port cascadio`) or download the matching `.whl` from pypi.org/project/cascadio on a machine with access and install it offline (`python -m pip install cascadio-0.1.1-cp312-abi3-win_amd64.whl`).

If several Pythons are installed, make sure it is the *same* interpreter that runs `stepview.py` — use `python -m pip` rather than a bare `pip`, or the full path shown by `--check`. Without the package the viewer still opens GLB, GLTF and STL files; only STEP conversion is unavailable, and it tells you so on the start screen.

Put `stepview.py` and `viewer.html` in the same folder. Optionally add a right-click "Open with QuickSTEP" entry or a `.bat` wrapper:

```
@echo off
python "C:\tools\quickstep\stepview.py" %1
```

## Usage

```
python stepview.py                          open the viewer, then drag & drop STEP files
python stepview.py assembly.step            open a file directly (cached after first run)
python stepview.py assembly.step --coarse   fastest conversion for very large assemblies
python stepview.py assembly.step --fine     smoother surfaces for report screenshots
python stepview.py assembly.step --force    reconvert, ignore cache
python stepview.py assembly.step --convert-only --out part.glb
```

The cache lives in `~/.stepview_cache` and is keyed on file path, modification time, size, and tessellation quality — editing the STEP file automatically triggers a fresh conversion. Files cached by a version of this tool that predates Measure mode lack the exact B-rep data it uses (they still open and measure, with fitted values); `--force` reconverts them.

## In the viewer

Drop a `.step` / `.stp` file anywhere on the page, or use **Open file…**. The **quality** selector controls tessellation: *Coarse* is fastest for very large assemblies, *Fine* gives smoother surfaces for report figures. Already-converted `.glb` / `.gltf` / `.stl` files load instantly without conversion.

Left mouse rotates, right mouse pans, wheel zooms. The toolbar has standard views (Iso / Front / Top / Right), Fit (`F`), feature edges (`E`), a white background toggle for report figures (`B`), an exploded view (`V`), and Screenshot (`S`) which saves a 2× resolution PNG named after the model with a timestamp — measurement dimensions on screen are included. The part panel lists every component with its triangle count: click to hide/show, double-click to isolate, and the footer buttons restore or invert visibility. The status bar shows part count, triangle count, file size, and bounding box dimensions.

## Selecting things in 3D

The **Select** group switches what a click picks: **Part** (`1`), **Face** (`2`), **Edge** (`3`), and **Measure** (`4` or `M`, see below).

Clicking a component in the 3D view highlights it and scrolls to its row in the part list, so you can immediately hide it (`H`), isolate it (`I`), or click the row to toggle it. Hovering a row highlights the matching geometry the other way round.

In Face mode the click selects the face you hit — the B-rep face from the STEP file, so a fillet is its own face — and reports its type and area: for a cylinder its diameter, radius, length and axis and whether it is a hole or a boss, for a cone its included angle, for a sphere its diameter, for a torus (the fillet round a shaft shoulder) its tube and ring radii, for a plane its normal. In Edge mode the click traces the connected feature edge and reports its length; if the edge is a circle it reports the **diameter**, centre and axis — useful for checking a bore or hole without opening CAD. Feature edges switch on automatically in Edge and Measure mode so you can see what you are aiming at.

Lengths are shown in millimetres. OpenCASCADE writes glTF in metres whatever units the STEP was authored in (the samples tested here were inch files, converted correctly), so the viewer displays mesh units × 1000. If a file ever disagrees, click **units** in the status bar to switch to raw mesh units.

## Measuring

**Measure** (`4` or `M`) opens the measure panel. Click a face or an edge: within a few pixels of an edge the edge is picked, anywhere else the face.

*One pick* gives its size, in the panel and drawn on the model: the **diameter** and **radius** of a cylinder (hole or boss), circle or arc — an arc also reports its angle and length, so the corner round of a plate reads as R5, 90° — a sphere's diameter, a cone's included angle and diameter range, a torus's tube radius (the fillet round a shaft shoulder), a straight edge's length, a plane's normal and area.

*Two picks* give the distances between them, the headline figure first:

| Picks | Reported |
|---|---|
| plane – plane | normal distance when parallel, otherwise the angle |
| plane – cylinder, cone or circle | with the axis parallel to the plane: axis to plane and the min / max to the surface (a hole's distance to a side face); with the axis square to it: both ends to the plane; otherwise the angle |
| cylinder / circle – cylinder / circle | centre distance of parallel axes, the gap between them (the wall between two holes), outside-to-outside, or the radial clearance of a shaft in a bore; for crossing axes the angle and the distance between the axes |
| plane – straight edge | distance when the edge runs parallel to the plane, otherwise the angle |
| circle – straight edge | centre to the picked edge, and circle to edge when the edge lies in the circle's plane (a hole to the plate edge); pick the side face instead for the distance to its plane |
| sphere – anything | centre distances |

Every pair also shows the **min distance (mesh)**: the shortest distance between the two picked pieces of geometry, measured on the triangles. A third click starts a new pair; clicking empty space clears it.

**Keep** (`K`) leaves the current dimensions on screen while you take the next measurement, so a screenshot can carry several. **Clear** (`Del`) removes everything; `Esc` drops the current picks and a second `Esc` the kept dimensions. Leaving Measure mode clears the measurements.

*How exact the numbers are.* STEP files converted by `stepview.py` carry the exact surface of every plane, cylinder, cone, sphere and torus face — cascadio's `include_brep` output, which makes the cached GLB about a quarter larger — so diameters, radii, axes and the distances derived from them are the CAD values; the panel says *source: exact (STEP B-rep)*. Face areas are always summed over the triangles — hence *area (mesh)* — so on curved faces and around holes they are close, not exact. An edge counts as exact only when its two B-rep faces pin it down — two planes meeting in a line, a plane cutting a cylinder square to its axis, two coaxial surfaces of revolution; any other edge is measured on the mesh. Without that data (a GLB from elsewhere, a cascadio build without the option, or a file cached by an earlier version of this tool — run it once with `--force`, or `--warm --force` on a folder) planes, cylinders and spheres are fitted to the mesh vertices instead. OpenCASCADE puts vertices exactly on the surface, so fitted diameters agree with the CAD to within about a millionth of the diameter, but cones and tori are then reported as freeform surfaces. The *min distance (mesh)* is taken between flat triangles that cut slightly inside curved surfaces, so it can be off by up to the tessellation tolerance on each surface — 0.1 mm at *Normal*, 0.01 mm at *Fine*; on the test parts it read 37.05 mm for a true 37.00 mm gap between two holes, which the exact *gap* row gives directly.

## Exploded view

**Explode** (`V`) opens the explode panel. **Amount** slides every part away from the assembly centre along the line from the centre through the part's own centre — at 100 % a part ends up three times as far out. **Along X / Y / Z** keeps the movement to one axis, which suits stacked assemblies; **Reset** puts everything back. Feature edges, section caps and highlights move with their parts, and Fit (`F`) frames the exploded model.

Measurements are always taken on the assembled geometry: the distance between two parts reads the same exploded or not, and while the parts are drawn apart its dimension is marked *(assembled)*.

## Section views

**Section** (`X`) opens the section panel.

*Standard planes* — **Right**, **Top** and **Front** cut through the model centre along the X, Y and Z normals. **Offset** slides the plane through the model, **Flip** swaps which side is kept, and **Off** clears the cut. **Caps** fills the cut surface using a stencil pass so the section reads as solid material rather than a hollow shell; it turns off automatically above 400 parts, where the extra draw calls start to cost more than they are worth.

*Plane from a circle* — press **Plane from circle…** then click any circular edge: a hole rim, a boss, a bore. The plane is built through that circle's axis and passes through its centre, and the **angle** slider sweeps the plane around the axis from 0° to 180°, so you can cut a bore at exactly the orientation you want. Offset then shifts the plane sideways from the axis. If you have already picked a circle in Edge mode, the button uses it directly.

## Known limits of this first version

Colors assigned in the source CAD are preserved when present in the STEP file; parts without color render in a neutral gray. Dimensions in the status bar come from the mesh bounding box. There is no assembly *tree* yet (the part list is flat), and the measure tool works on faces and edges, not on arbitrary points; those are natural next steps. STL files carry no face structure, so there a face is grown across triangles up to a 20° break: faces that meet tangentially — a fillet and the flat it runs into — merge into one freeform surface that has no diameter to report. The explode direction runs out from the assembly centre, so a part centred on it (a shaft through the middle of the assembly) stays put; Along X / Y / Z helps there. In Edge mode, diameters come from a least-squares fit to the tessellated rim: on the samples tested the fit recovered known diameters to within 0.02%, but a coarse tessellation will inscribe the polygon slightly inside the true circle, so treat that figure as a check rather than an inspection result — Measure mode reports the exact B-rep value.
