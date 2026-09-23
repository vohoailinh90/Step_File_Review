---
name: viewer-change
description: The correct procedure for changing QuickSTEP's viewer — which file to open for a given symptom, why viewer.html must never be edited, and what to run before claiming done. Use whenever a change touches the 3D view, the toolbar, the part list, selection, section planes, screenshots, drag-and-drop, or anything a user sees in the browser.
---

# Changing the viewer

`viewer.html` is **796 KB and generated**. Do not open it to work, and do not
edit it. Roughly 99% of its bytes are vendored three.js — reading it costs a huge
amount of context and tells you nothing, because the part you need is 831 lines
at the bottom, now split into `src/app/`.

## Find the file from the symptom

| The change is about | Open |
|---|---|
| camera, lighting, background, fit/iso/front/top/right, resize | `src/app/00-scene.js` |
| units, `L()` / `A2()` scaling, `unitScale` | `src/app/00-scene.js` |
| opening a file, format sniffing, GLB/GLTF/STL, load status, dispose | `src/app/10-load.js` |
| part list rows, hide/show, isolate, invert, hover highlight | `src/app/20-parts.js` |
| click-to-select, Part/Face/Edge modes, face flood-fill (20° break) | `src/app/30-select.js` |
| edge chaining, circle fitting, reported diameter/length/area, `fmt` | `src/app/40-geometry.js` |
| section planes, offset/flip, plane-from-circle, stencil caps | `src/app/50-section.js` |
| drag & drop, `/convert`, `/status`, screenshot, keyboard, autoload | `src/app/60-io.js` |
| colours, spacing, buttons, panels, responsive rules | `src/ui/viewer.css` |
| new toolbar button, new panel, any new DOM element | `src/ui/layout.html` |
| tessellation, cache, CLI flags, the local server | `stepview.py` |
| the order parts are concatenated, a new module | `src/viewer.template.html` |

`grep -rn "<symbol>" src/ stepview.py` beats guessing. `vendor/` is never the
answer — if a library misbehaves, patch around it in `src/app/`.

## The loop

```bash
# 1. edit src/...
python build.py                 # regenerate viewer.html
python tests/run_checks.py      # build fidelity + invariants + unit tests
python stepview.py              # look at it, if the change is visual
```

`python build.py --check` is what CI runs. A `src/` edit without a rebuild fails
it, so rebuild in the same commit.

## Things that will bite

- **Modules share one closure.** They are concatenated in filename order inside a
  single IIFE. No `import`/`export`. A `function` hoists across every module; a
  top-level `const` or `addEventListener` does not, so order matters for those.
- **No `<script>` tags in a module.** `src/viewer.template.html` owns them.
- **three.js is pinned** to a bundled r13x-era build: `renderer.outputEncoding`,
  `THREE.sRGBEncoding`, and `THREE.OrbitControls` / `THREE.GLTFLoader` globals.
  Post-r152 names (`outputColorSpace`, `SRGBColorSpace`, ESM imports) do not
  exist here and throw at runtime.
- **Nothing may be fetched from the network** — no CDN, no npm, no remote font.
  The viewer must work air-gapped. `tests/check_invariants.py` enforces this.
- **Keep modules under 250 lines.** Add `70-<name>.js` and a template entry
  rather than growing one past the budget.
- **Print ASCII only** from Python. Redirected output on Windows is encoded with
  the locale's code page, and no non-ASCII character survives all of them -- an
  em dash fails on Japanese Windows. `tests/check_invariants.py` enforces it.

## If the change affects a reported number

Diameter, length, area, bounding box, units, the 20° face break, or the
`rms < 0.03` circle gate: run `node --test tests/geometry.test.mjs`, and have
`geometry-reviewer` look at it. A wrong, confident number is the worst output
this tool can produce — someone checks a bore here and then drills.

Add the mutation that would have caught your change to
`tests/mutation_check.py`, then confirm it is caught:

```bash
python tests/mutation_check.py -k geometry
```
