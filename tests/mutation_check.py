#!/usr/bin/env python3
"""mutation_check.py -- prove the checks in tests/ can actually fail.

    python tests/mutation_check.py            run every mutation
    python tests/mutation_check.py --list     show the manifest
    python tests/mutation_check.py -k gate    run mutations matching a substring

A passing suite is not evidence on its own. A test that would still pass with the
behaviour deleted reports safety that is not there. The only thing that settles
it is to break the behaviour and require the test to notice.

That loop is computable -- edit a file, run a command, read an exit code -- so it
is a script and not a review task. Each MUTATIONS entry names a behaviour, the
edit that breaks it, and the command that must fail as a result. An entry whose
`find` no longer matches exactly once fails as DRIFT rather than silently
proving nothing.

An entry may also carry `create`: a {path: content} mapping of extra files to add
for the duration of the run. That is how a "a newly added source is not scanned"
behaviour gets pinned -- the defect only exists when a file that did not exist
before is included in the build.

Every edit is reverted in a finally block, including on Ctrl-C, and every created
file is removed. Nothing is left modified on disk.

When you ship a fix with a test, add the mutation that would have caught it.
"""
import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PY = sys.executable

INVARIANTS = [PY, "tests/check_invariants.py"]
UNIT_PY = [PY, "-m", "unittest", "discover", "-s", "tests", "-p", "test_*.py"]
# Every JS suite, discovered. A mutation must be caught by *some* suite; naming
# one file here is how src/app/00-scene.js and 30-select.js went uncovered.
JS = ["node", "--test", *sorted(str(p.relative_to(ROOT)) for p in (ROOT / "tests").glob("*.test.mjs"))]
GEOMETRY = JS

MUTATIONS = [
    # ---- the build contract -------------------------------------------------
    dict(name="build/viewer-hand-edited",
         behaviour="viewer.html must be rejected if edited instead of rebuilt",
         file="viewer.html",
         find="<title>QuickSTEP Viewer</title>",
         replace="<title>QuickSTEP Viewer EDITED</title>",
         must_fail=INVARIANTS),
    dict(name="build/module-dropped-from-template",
         behaviour="a module left out of the template must not build silently",
         file="src/viewer.template.html",
         find="@@INCLUDE:src/app/50-section.js@@",
         replace="",
         must_fail=INVARIANTS),
    dict(name="build/vendor-modified",
         behaviour="an edit to vendored upstream code must be caught",
         file="vendor/STLLoader.js",
         find="THREE.STLLoader = STLLoader;",
         replace="THREE.STLLoader = STLLoader; // local tweak",
         must_fail=INVARIANTS),
    dict(name="build/script-tag-in-module",
         behaviour="modules are script bodies; the template owns the tags",
         file="src/app/20-parts.js",
         find="// ── Part list ",
         replace="</script><script>\n// ── Part list ",
         must_fail=INVARIANTS),

    # ---- the product contract: offline, self-contained, loopback ------------
    dict(name="product/cdn-script-added",
         behaviour="a remote <script src> must never ship in viewer.html",
         file="src/viewer.template.html",
         find="</head>",
         replace='<script src="https://cdn.jsdelivr.net/npm/three@0.160/build/three.min.js"></script>\n</head>',
         must_fail=INVARIANTS),
    dict(name="product/absolute-fetch-added",
         behaviour="the viewer must not fetch an absolute URL",
         file="src/app/60-io.js",
         find="fetch('/convert', {",
         replace="fetch('https://example.com/convert', {",
         must_fail=INVARIANTS),
    dict(name="product/server-bound-to-all-interfaces",
         behaviour="the helper server must stay on 127.0.0.1",
         file="stepview.py",
         find='httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)',
         replace='httpd = http.server.ThreadingHTTPServer(("0.0.0.0", port), Handler)',
         must_fail=INVARIANTS),
    dict(name="product/third-party-import-added",
         behaviour="stepview.py must stay stdlib + cascadio",
         file="stepview.py",
         find="import argparse",
         replace="import argparse\nimport requests",
         must_fail=INVARIANTS),

    dict(name="product/remote-css-url-added",
         behaviour="a CSS url() pointing off-machine must break the air-gap check",
         file="src/ui/viewer.css",
         find="#hintbar{color:var(--dim)}",
         replace="#hintbar{color:var(--dim);background:url(https://example.com/pixel.png)}",
         must_fail=INVARIANTS),
    dict(name="product/remote-img-src-added",
         behaviour="an <img src> pointing off-machine must break the air-gap check",
         file="src/ui/layout.html",
         find='<div id="info"></div>',
         replace='<div id="info"></div><img src="https://evil.example/track.png">',
         must_fail=INVARIANTS),

    dict(name="product/remote-inline-style-url",
         behaviour="a remote url() in a style attribute must break the air-gap check",
         file="src/ui/layout.html",
         find='<div id="info"></div>',
         replace='<div id="info" style="background:url(https://example.com/p.png)"></div>',
         must_fail=INVARIANTS),
    dict(name="product/remote-embedded-style-block",
         behaviour="a remote url() in an inline <style> block must break it too",
         file="src/ui/layout.html",
         find='<div id="info"></div>',
         replace='<style>#info{background:url(https://example.com/p.png)}</style><div id="info"></div>',
         must_fail=INVARIANTS),
    dict(name="product/remote-js-style-url",
         behaviour="a remote url() assigned to .style from JS must break it too",
         file="src/app/60-io.js",
         find="fetch('/status')",
         replace="void(document.body.style.background='url(https://example.com/p.png)'), fetch('/status')",
         must_fail=INVARIANTS),
    dict(name="product/remote-innerhtml-img",
         behaviour="a remote <img src> inside an innerHTML string must break it too",
         file="src/app/60-io.js",
         find="function openPicker()",
         replace="function injectRemote(){ document.body.innerHTML += '<img src=\"https://example.com/t.png\">'; }\nfunction openPicker()",
         must_fail=INVARIANTS),

    dict(name="product/new-included-source-unscanned",
         behaviour="a source newly added to the build must be scanned for remote URLs",
         file="src/viewer.template.html",
         find="@@INCLUDE:src/ui/layout.html@@",
         replace="@@INCLUDE:src/ui/layout.html@@@@INCLUDE:src/ui/probe.html@@",
         create={"src/ui/probe.html":
                 '<div style="background:url(https://example.com/probe.png)"></div>\n'},
         must_fail=INVARIANTS),

    # ---- the geometry the viewer reports to an engineer ---------------------
    dict(name="geometry/rms-gate-loosened",
         behaviour="loosening the rms gate lets a bad circle fit be reported",
         file="src/app/40-geometry.js",
         find="if (fit && fit.rms < 0.03){",
         replace="if (fit && fit.rms < 0.5){",
         must_fail=GEOMETRY),
    dict(name="geometry/planarity-check-removed",
         behaviour="a non-planar loop must not be reported as a circle",
         file="src/app/40-geometry.js",
         find="if (planeDev / rMean > 0.02) return null;",
         replace="",
         must_fail=GEOMETRY),
    dict(name="geometry/min-point-count-removed",
         behaviour="too few points must not produce a diameter",
         file="src/app/40-geometry.js",
         find="if (pts.length < 5) return null;",
         replace="",
         must_fail=GEOMETRY),
    dict(name="geometry/centre-becomes-first-point",
         behaviour="the fitted centre must be the ring centroid, not a vertex",
         file="src/app/40-geometry.js",
         find="center.multiplyScalar(1/pts.length);",
         replace="center.copy(pts[0]);",
         must_fail=GEOMETRY),
    dict(name="geometry/closed-length-not-closed",
         behaviour="a closed polyline must include the closing segment",
         file="src/app/40-geometry.js",
         find="if (closed && pts.length>2) L += pts[0].distanceTo(pts[pts.length-1]);",
         replace="",
         must_fail=GEOMETRY),
    dict(name="geometry/fmt-precision-collapsed",
         behaviour="fmt must keep its magnitude bands",
         file="src/app/40-geometry.js",
         find="if (a >= 10) return v.toFixed(2);",
         replace="if (a >= 10) return v.toFixed(0);",
         must_fail=GEOMETRY),

    # ---- unit scaling: a wrong scale here is a 1000x error that looks plausible
    dict(name="scene/unit-scale-broken",
         behaviour="glTF metres must be reported as millimetres (x1000)",
         file="src/app/00-scene.js",
         find="let unitScale = 1000;",
         replace="let unitScale = 1;",
         must_fail=JS),
    dict(name="scene/area-scaled-like-a-length",
         behaviour="area must scale by unitScale squared, not unitScale",
         file="src/app/00-scene.js",
         find="fmt(v * unitScale * unitScale)",
         replace="fmt(v * unitScale)",
         must_fail=JS),

    # ---- the face flood-fill ----------------------------------------------
    dict(name="select/break-angle-widened",
         behaviour="a face must stop at a break sharper than 20 degrees",
         file="src/app/30-select.js",
         find="THREE.MathUtils.degToRad(20)",
         replace="THREE.MathUtils.degToRad(85)",
         must_fail=JS),
    dict(name="select/break-angle-narrowed",
         behaviour="a face must grow across a break softer than 20 degrees",
         file="src/app/30-select.js",
         find="THREE.MathUtils.degToRad(20)",
         replace="THREE.MathUtils.degToRad(2)",
         must_fail=JS),
    dict(name="select/normal-comparison-loses-abs",
         behaviour="a surface folded back on itself stays one face (documented)",
         file="src/app/30-select.js",
         find="Math.abs(nCur.dot(nNb)) > COS",
         replace="nCur.dot(nNb) > COS",
         must_fail=JS),
    dict(name="select/flatness-threshold-loosened",
         behaviour="a folded face must report curved, not planar",
         file="src/app/30-select.js",
         find="Math.abs(nCur.dot(n0)) < 0.999",
         replace="Math.abs(nCur.dot(n0)) < 0.5",
         must_fail=JS),

    # ---- the launcher ------------------------------------------------------
    dict(name="launcher/breaks-on-oldest-supported-python",
         behaviour="stepview.py must import on Python 3.9, which README promises",
         file="stepview.py",
         find="from __future__ import annotations\n",
         replace="",
         must_fail=INVARIANTS),
    dict(name="launcher/cache-key-ignores-mtime",
         behaviour="editing a STEP file must invalidate its cache entry",
         file="stepview.py",
         find='key = hashlib.sha1(f"{path.resolve()}|{st.st_mtime_ns}|{st.st_size}|{tol}".encode()).hexdigest()[:16]',
         replace='key = hashlib.sha1(f"{path.resolve()}".encode()).hexdigest()[:16]',
         must_fail=UNIT_PY),
    dict(name="launcher/filename-not-sanitised",
         behaviour="an untrusted upload name must not reach the cache path raw",
         file="stepview.py",
         find="stem = safe_stem(name)",
         replace='stem = Path(name).stem[:40] or "model"',
         must_fail=UNIT_PY),
    dict(name="launcher/sanitiser-charset-narrowed",
         # Drops ':' from the illegal set -- the exact character a PDM revision
         # name carries, and the one whose Windows parsing diverges from POSIX.
         # Caught by both the native and the WindowsPathSemantics test classes.
         behaviour="every Win32-illegal character must be replaced, not just some",
         file="stepview.py",
         find='[<>:"',
         replace='[<>"',
         must_fail=UNIT_PY),
    dict(name="launcher/sanitiser-fallback-removed",
         behaviour="a name that sanitises to nothing must fall back to 'model'",
         file="stepview.py",
         find='[:limit] or "model"',
         replace="[:limit]",
         must_fail=UNIT_PY),
    dict(name="launcher/upload-guard-removed",
         behaviour="an oversized upload must be refused before it is read",
         file="stepview.py",
         find="if length > MAX_UPLOAD:",
         replace="if False:",
         must_fail=UNIT_PY),
    dict(name="launcher/quality-not-in-cache-key",
         behaviour="two tessellation qualities must not share a cache entry",
         file="stepview.py",
         find='out = CACHE_DIR / f"{path.stem}_{quality}_{key}.glb"',
         replace='out = CACHE_DIR / f"{path.stem}_{key}.glb"',
         must_fail=UNIT_PY),
    dict(name="launcher/upload-keyed-by-name-not-content",
         behaviour="uploads must be cached by content hash",
         file="stepview.py",
         find="digest = hashlib.sha1(data).hexdigest()[:16]",
         replace="digest = hashlib.sha1(name.encode()).hexdigest()[:16]",
         must_fail=UNIT_PY),
    dict(name="launcher/unknown-quality-not-defaulted",
         behaviour="an unknown quality must fall back to normal, not crash",
         file="stepview.py",
         find='tol = QUALITY.get(quality, QUALITY["normal"])',
         replace="tol = QUALITY[quality]",
         must_fail=UNIT_PY),
    dict(name="launcher/status-drops-interpreter",
         behaviour="/status must report which interpreter is serving",
         file="stepview.py",
         find='self._send(200, json.dumps({"engine": ok, "python": sys.executable}).encode(),',
         replace='self._send(200, json.dumps({"engine": ok}).encode(),',
         must_fail=UNIT_PY),
]


def run(cmd) -> int:
    return subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True).returncode


def main() -> int:
    ap = argparse.ArgumentParser(description="Prove the checks can fail")
    ap.add_argument("--list", action="store_true", help="show the manifest and exit")
    ap.add_argument("-k", metavar="SUBSTR", help="only mutations whose name contains SUBSTR")
    args = ap.parse_args()

    entries = [m for m in MUTATIONS if not args.k or args.k in m["name"]]
    if args.list:
        for m in entries:
            print(f"  {m['name']:44s} {m['behaviour']}")
        print(f"\n  {len(entries)} mutation(s)")
        return 0
    if not entries:
        print(f"no mutation matches {args.k!r}")
        return 1

    print(f"Running {len(entries)} mutation(s). Each must make its check FAIL.\n")
    caught, escaped, drifted = [], [], []

    for m in entries:
        target = ROOT / m["file"]
        original = target.read_bytes()
        occurrences = original.count(m["find"].encode())
        if occurrences != 1:
            drifted.append(m["name"])
            print(f"DRIFT {m['name']}")
            print(f"      {m['file']}: `find` matched {occurrences} times, expected exactly 1")
            print(f"      The code moved. Update this mutation -- until then it proves nothing.")
            continue

        mutated = original.replace(m["find"].encode(), m["replace"].encode(), 1)
        created = []
        try:
            for rel, content in (m.get("create") or {}).items():
                extra = ROOT / rel
                extra.parent.mkdir(parents=True, exist_ok=True)
                extra.write_text(content, encoding="utf-8")
                created.append(extra)
            target.write_bytes(mutated)
            rc = run(m["must_fail"])
        finally:
            target.write_bytes(original)
            for extra in created:
                extra.unlink(missing_ok=True)

        if rc != 0:
            caught.append(m["name"])
            print(f"ok    {m['name']:44s} caught")
        else:
            escaped.append(m["name"])
            print(f"MISS  {m['name']:44s} NOT caught")
            print(f"      {m['behaviour']}")
            print(f"      {' '.join(m['must_fail'])} still passed with the behaviour broken.")

    print()
    print(f"caught {len(caught)}/{len(entries)}"
          + (f", escaped {len(escaped)}" if escaped else "")
          + (f", drifted {len(drifted)}" if drifted else ""))
    if escaped:
        print("\nescaped mutations mean those behaviours are untested:")
        for n in escaped:
            print(f"  - {n}")
    return 1 if (escaped or drifted) else 0


if __name__ == "__main__":
    raise SystemExit(main())
