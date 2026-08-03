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

The cache lives in `~/.stepview_cache` and is keyed on file path, modification time, size, and tessellation quality — editing the STEP file automatically triggers a fresh conversion.

## In the viewer

Drop a `.step` / `.stp` file anywhere on the page, or use **Open file…**. The **quality** selector controls tessellation: *Coarse* is fastest for very large assemblies, *Fine* gives smoother surfaces for report figures. Already-converted `.glb` / `.gltf` / `.stl` files load instantly without conversion.

Left mouse rotates, right mouse pans, wheel zooms. The toolbar has standard views (Iso / Front / Top / Right), Fit (`F`), feature edges (`E`), a white background toggle for report figures (`B`), and Screenshot (`S`) which saves a 2× resolution PNG named after the model with a timestamp. The part panel lists every component with its triangle count: click to hide/show, double-click to isolate, and the footer buttons restore or invert visibility. The status bar shows part count, triangle count, file size, and bounding box dimensions.

## Selecting things in 3D

The **Select** group switches what a click picks: **Part** (`1`), **Face** (`2`), **Edge** (`3`).

Clicking a component in the 3D view highlights it and scrolls to its row in the part list, so you can immediately hide it (`H`), isolate it (`I`), or click the row to toggle it. Hovering a row highlights the matching geometry the other way round.

In Face mode the click grows a face outward from the triangle you hit, stopping at any break sharper than 20°, and reports whether it is planar or curved plus its area. In Edge mode the click traces the connected feature edge and reports its length; if the edge is a circle it reports the **diameter**, centre and axis — useful for checking a bore or hole without opening CAD. Feature edges switch on automatically in Edge mode because the edges have to exist to be picked.

Lengths are shown in millimetres. OpenCASCADE writes glTF in metres whatever units the STEP was authored in (the samples tested here were inch files, converted correctly), so the viewer displays mesh units × 1000. If a file ever disagrees, click **units** in the status bar to switch to raw mesh units.

## Section views

**Section** (`X`) opens the section panel.

*Standard planes* — **Right**, **Top** and **Front** cut through the model centre along the X, Y and Z normals. **Offset** slides the plane through the model, **Flip** swaps which side is kept, and **Off** clears the cut. **Caps** fills the cut surface using a stencil pass so the section reads as solid material rather than a hollow shell; it turns off automatically above 400 parts, where the extra draw calls start to cost more than they are worth.

*Plane from a circle* — press **Plane from circle…** then click any circular edge: a hole rim, a boss, a bore. The plane is built through that circle's axis and passes through its centre, and the **angle** slider sweeps the plane around the axis from 0° to 180°, so you can cut a bore at exactly the orientation you want. Offset then shifts the plane sideways from the axis. If you have already picked a circle in Edge mode, the button uses it directly.

## Known limits of this first version

Colors assigned in the source CAD are preserved when present in the STEP file; parts without color render in a neutral gray. The viewer shows tessellated geometry, so it is not suitable for precise measurement — dimensions in the status bar come from the mesh bounding box. There is no assembly *tree* yet (the part list is flat), and no point-to-point measuring tool; those are natural next steps. Face detection works on tessellated triangles rather than the original B-rep, so a face that meets its neighbour at less than a 20° break will be grown across the junction, and a fillet is picked as one continuous curved face. Reported diameters come from a least-squares fit to the tessellated rim: on the samples tested the fit recovered known diameters to within 0.02%, but a coarse tessellation will inscribe the polygon slightly inside the true circle, so treat the figure as a check rather than an inspection result.
