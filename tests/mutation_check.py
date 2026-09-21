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

Every edit is reverted in a finally block, including on Ctrl-C. Nothing is left
modified on disk.

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
GEOMETRY = ["node", "--test", "tests/geometry.test.mjs"]

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

    # ---- the launcher ------------------------------------------------------
    dict(name="launcher/cache-key-ignores-mtime",
         behaviour="editing a STEP file must invalidate its cache entry",
         file="stepview.py",
         find='key = hashlib.sha1(f"{path.resolve()}|{st.st_mtime_ns}|{st.st_size}|{tol}".encode()).hexdigest()[:16]',
         replace='key = hashlib.sha1(f"{path.resolve()}".encode()).hexdigest()[:16]',
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
        try:
            target.write_bytes(mutated)
            rc = run(m["must_fail"])
        finally:
            target.write_bytes(original)

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
