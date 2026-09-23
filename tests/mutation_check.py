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

Two further fields keep a mutation honest about WHAT caught it:

  expect   a substring of the check_invariants.py check title that must be the
           one to FAIL. Without it, any failing check counts -- and one did. For
           most of this PR's life the harness never rebuilt viewer.html, so every
           mutation to src/ was "caught" by the build-fidelity check simply
           because viewer.html was stale. With eight offline and structure checks
           DISABLED, twelve mutations still reported "caught". They proved
           nothing about the checks they were named after.
  rebuild  default True: run build.py after applying the mutation, as a
           contributor would, and restore viewer.html afterwards. Checks that
           inspect the BUILT file can only see a mutation after a rebuild. Only a
           mutation whose point is a stale viewer.html sets it False.

An entry may also carry `create`: a {path: content} mapping of extra files to add
for the duration of the run. That is how a "a newly added source is not scanned"
behaviour gets pinned -- the defect only exists when a file that did not exist
before is included in the build.

Every edit is reverted in a finally block, including on Ctrl-C, and every created
file and directory is removed. Nothing is left modified on disk.

The harness NEVER touches a path that existed before the run. A `create` path
that is already occupied is reported as DRIFT and the mutation is skipped:
overwriting a contributor's file and then deleting it would destroy uncommitted
work, and git cannot bring back an untracked file. Found by Codex review round 4
on PR #1 -- the first version of `create` did exactly that while reporting the
mutation as caught. tests/test_mutation_harness.py pins the guard.

When you ship a fix with a test, add the mutation that would have caught it.
"""
import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PY = sys.executable
VIEWER = ROOT / "viewer.html"

INVARIANTS = [PY, "tests/check_invariants.py"]
UNIT_PY = [PY, "-m", "unittest", "discover", "-s", "tests", "-p", "test_*.py"]
# Every JS suite, discovered. A mutation must be caught by *some* suite; naming
# one file here is how src/app/00-scene.js and 30-select.js went uncovered.
JS = ["node", "--test", *sorted(str(p.relative_to(ROOT)) for p in (ROOT / "tests").glob("*.test.mjs"))]
GEOMETRY = JS

MUTATIONS = [
    # ---- the build contract -------------------------------------------------
    dict(name="build/viewer-hand-edited",
         expect="faithful build",
         rebuild=False,
         behaviour="viewer.html must be rejected if edited instead of rebuilt",
         file="viewer.html",
         find="<title>QuickSTEP Viewer</title>",
         replace="<title>QuickSTEP Viewer EDITED</title>",
         must_fail=INVARIANTS),
    dict(name="build/module-dropped-from-template",
         expect="concatenated in filename order",
         behaviour="a module left out of the template must not build silently",
         file="src/viewer.template.html",
         find="@@INCLUDE:src/app/50-section.js@@",
         replace="",
         must_fail=INVARIANTS),
    dict(name="build/vendor-modified",
         expect="vendor files are unmodified",
         behaviour="an edit to vendored upstream code must be caught",
         file="vendor/STLLoader.js",
         find="THREE.STLLoader = STLLoader;",
         replace="THREE.STLLoader = STLLoader; // local tweak",
         must_fail=INVARIANTS),
    dict(name="build/script-tag-in-module",
         expect="carry no <script> tags",
         behaviour="modules are script bodies; the template owns the tags",
         file="src/app/20-parts.js",
         find="// ── Part list ",
         replace="</script><script>\n// ── Part list ",
         must_fail=INVARIANTS),

    # ---- the product contract: offline, self-contained, loopback ------------
    dict(name="product/cdn-script-added",
         expect="loads nothing from the network",
         behaviour="a remote <script src> must never ship in viewer.html",
         file="src/viewer.template.html",
         find="</head>",
         replace='<script src="https://cdn.jsdelivr.net/npm/three@0.160/build/three.min.js"></script>\n</head>',
         must_fail=INVARIANTS),
    dict(name="product/absolute-fetch-added",
         expect="only ever fetches its own origin",
         behaviour="the viewer must not fetch an absolute URL",
         file="src/app/60-io.js",
         find="fetch('/convert', {",
         replace="fetch('https://example.com/convert', {",
         must_fail=INVARIANTS),
    dict(name="product/server-bound-to-all-interfaces",
         expect="binds loopback only",
         behaviour="the helper server must stay on 127.0.0.1",
         file="stepview.py",
         find='httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)',
         replace='httpd = http.server.ThreadingHTTPServer(("0.0.0.0", port), Handler)',
         must_fail=INVARIANTS),
    dict(name="product/third-party-import-added",
         expect="imports nothing outside the stdlib",
         behaviour="stepview.py must stay stdlib + cascadio",
         file="stepview.py",
         find="import argparse",
         replace="import argparse\nimport requests",
         must_fail=INVARIANTS),
    dict(name="product/install-omits-an-engine-dependency",
         expect="installs what the engine needs to load",
         behaviour="an install instruction must include numpy, which cascadio needs but does not declare",
         file="src/ui/layout.html",
         find='<code id="pipcmd">pip install cascadio numpy</code>',
         replace='<code id="pipcmd">pip install cascadio</code>',
         must_fail=INVARIANTS),
    dict(name="product/ci-engine-job-tests-another-install",
         expect="installs what the engine needs to load",
         behaviour="CI's engine job must run the install README documents, not a different one",
         file=".github/workflows/ci.yml",
         find="      - run: python -m pip install cascadio numpy\n",
         replace="      - run: python -m pip install cascadio numpy trimesh\n",
         must_fail=INVARIANTS),

    dict(name="product/remote-css-url-added",
         expect="fetches a remote URL, by any route",
         behaviour="a CSS url() pointing off-machine must break the air-gap check",
         file="src/ui/viewer.css",
         find="#hintbar{color:var(--dim)}",
         replace="#hintbar{color:var(--dim);background:url(https://example.com/pixel.png)}",
         must_fail=INVARIANTS),
    dict(name="product/remote-img-src-added",
         expect="fetches a remote URL, by any route",
         behaviour="an <img src> pointing off-machine must break the air-gap check",
         file="src/ui/layout.html",
         find='<div id="info"></div>',
         replace='<div id="info"></div><img src="https://evil.example/track.png">',
         must_fail=INVARIANTS),

    dict(name="product/remote-inline-style-url",
         expect="fetches a remote URL, by any route",
         behaviour="a remote url() in a style attribute must break the air-gap check",
         file="src/ui/layout.html",
         find='<div id="info"></div>',
         replace='<div id="info" style="background:url(https://example.com/p.png)"></div>',
         must_fail=INVARIANTS),
    dict(name="product/remote-embedded-style-block",
         expect="fetches a remote URL, by any route",
         behaviour="a remote url() in an inline <style> block must break it too",
         file="src/ui/layout.html",
         find='<div id="info"></div>',
         replace='<style>#info{background:url(https://example.com/p.png)}</style><div id="info"></div>',
         must_fail=INVARIANTS),
    dict(name="product/remote-js-style-url",
         expect="fetches a remote URL, by any route",
         behaviour="a remote url() assigned to .style from JS must break it too",
         file="src/app/60-io.js",
         find="fetch('/status')",
         replace="void(document.body.style.background='url(https://example.com/p.png)'), fetch('/status')",
         must_fail=INVARIANTS),
    dict(name="product/remote-innerhtml-img",
         expect="fetches a remote URL, by any route",
         behaviour="a remote <img src> inside an innerHTML string must break it too",
         file="src/app/60-io.js",
         find="function openPicker()",
         replace="function injectRemote(){ document.body.innerHTML += '<img src=\"https://example.com/t.png\">'; }\nfunction openPicker()",
         must_fail=INVARIANTS),

    dict(name="product/new-included-source-unscanned",
         expect="fetches a remote URL, by any route",
         behaviour="a source newly added to the build must be scanned for remote URLs",
         file="src/viewer.template.html",
         find="@@INCLUDE:src/ui/layout.html@@",
         replace="@@INCLUDE:src/ui/layout.html@@@@INCLUDE:src/ui/probe.html@@",
         create={"src/ui/probe.html":
                 '<div style="background:url(https://example.com/probe.png)"></div>\n'},
         must_fail=INVARIANTS),

    dict(name="product/hook-uses-undocumented-interpreter",
         expect="interpreter README tells users to run",
         behaviour="the hook must run under the interpreter README documents",
         file=".claude/settings.example.json",
         find='"command": "python \\"${CLAUDE_PROJECT_DIR}',
         replace='"command": "python3 \\"${CLAUDE_PROJECT_DIR}',
         must_fail=INVARIANTS),

    dict(name="product/fetch-in-newly-included-script",
         expect="only ever fetches its own origin",
         behaviour="a fetch() in a script newly added to the build must be caught",
         file="src/viewer.template.html",
         find="@@INCLUDE:src/app/60-io.js@@",
         replace="@@INCLUDE:src/app/60-io.js@@@@INCLUDE:src/ui/probe.js@@",
         create={"src/ui/probe.js": "fetch('https://example.com/leak');\n"},
         must_fail=INVARIANTS),
    dict(name="product/eventsource-with-runtime-url",
         expect="only ever fetches its own origin",
         behaviour="a network API fed a URL built at runtime must be caught by presence",
         file="src/app/60-io.js",
         find="function openPicker()",
         replace="function stream(u){ return new EventSource(u); }\nfunction openPicker()",
         must_fail=INVARIANTS),
    dict(name="product/remote-literal-in-unlisted-api",
         expect="remote URL, outside an inert context",
         behaviour="a remote URL handed to an API nobody listed must still be caught",
         file="src/app/60-io.js",
         find="function openPicker()",
         replace="function req(){ return new Request('https://example.com/r'); }\nfunction openPicker()",
         must_fail=INVARIANTS),

    dict(name="product/vendor-gains-a-network-endpoint",
         expect="every remote URL in vendor/ has been reviewed",
         behaviour="a new URL in vendored code must be reviewed, whatever the hash says",
         file="vendor/STLLoader.js",
         find="THREE.STLLoader = STLLoader;",
         replace='THREE.STLLoader = STLLoader; fetch("https://example.com/leak");',
         must_fail=INVARIANTS),
    dict(name="product/xmlns-named-variable-bypass",
         expect="remote URL, outside an inert context",
         behaviour="the xmlns exemption must not cover a JS variable named xmlns",
         file="src/app/60-io.js",
         find="function openPicker()",
         replace="const xmlns = 'https://example.com/leak'; fetch(xmlns);\nfunction openPicker()",
         must_fail=INVARIANTS),
    dict(name="product/protocol-relative-in-unlisted-api",
         expect="remote URL, outside an inert context",
         behaviour="a protocol-relative //host literal must be caught in any API",
         file="src/app/60-io.js",
         find="function openPicker()",
         replace="function req(){ return new Request('//example.com/leak'); }\nfunction openPicker()",
         must_fail=INVARIANTS),
    dict(name="product/escaped-slash-url",
         expect="remote URL, outside an inert context",
         behaviour='"https:\\/\\/host" evaluates to https://host and must be caught',
         file="src/app/60-io.js",
         find="function openPicker()",
         replace="function req(){ return new Request('https:\\/\\/example.com/r'); }\nfunction openPicker()",
         must_fail=INVARIANTS),
    dict(name="launcher/imports-urllib-request",
         expect="imports nothing outside the stdlib",
         behaviour="the launcher must not import an outbound-network module",
         file="stepview.py",
         find="def check_engine(",
         replace="import urllib.request\n\n\ndef check_engine(",
         must_fail=INVARIANTS),
    dict(name="launcher/dials-out-on-its-socket",
         expect="uses its socket to listen, never to connect",
         behaviour="the launcher's socket must only listen, never connect out",
         file="stepview.py",
         find="def check_engine(",
         replace="def _dial():\n    return socket.create_connection(('example.com', 443))\n\n\ndef check_engine(",
         must_fail=INVARIANTS),

    # One per decoder. Each is caught only because decode_literal_escapes()
    # undoes that encoding -- remove a decoder and its mutation escapes.
    dict(name="product/html-entity-encoded-url",
         expect="remote URL, outside an inert context",
         behaviour="&#104;ttps is decoded by the HTML parser and must be caught",
         file="src/ui/layout.html",
         find='<div id="info"></div>',
         replace='<img src="&#104;ttps://example.com/t.png"><div id="info"></div>',
         must_fail=INVARIANTS),
    dict(name="product/css-escape-encoded-url",
         expect="remote URL, outside an inert context",
         behaviour="\\68ttps is decoded by the CSS parser and must be caught",
         file="src/ui/viewer.css",
         find="#hintbar{color:var(--dim)}",
         replace="#hintbar{color:var(--dim);background:url(\\68ttps://example.com/p.png)}",
         must_fail=INVARIANTS),
    dict(name="product/js-escape-encoded-url",
         expect="remote URL, outside an inert context",
         behaviour="\\x68ttps is decoded by the JS engine and must be caught",
         file="src/app/60-io.js",
         find="function openPicker()",
         replace="function req(){ return new Request('\\x68ttps://example.com/r'); }\nfunction openPicker()",
         must_fail=INVARIANTS),

    # Codex review round 8: "remote" is what the browser's URL parser resolves
    # to another host, not one spelling of it. Each of these passed every check
    # while the test wanted a dotted hostname after a literal "//".
    dict(name="product/single-label-protocol-relative",
         expect="remote URL, outside an inert context",
         behaviour="//intranet has no dot and is still another host",
         file="src/app/60-io.js",
         find="function openPicker()",
         replace="function req(){ return new Request('//intranet/leak'); }\nfunction openPicker()",
         must_fail=INVARIANTS),
    dict(name="product/backslash-protocol-relative",
         expect="remote URL, outside an inert context",
         behaviour="the URL parser reads \\ as / -- \\\\host is //host, and UNC from a file:// page",
         file="src/app/60-io.js",
         find="function openPicker()",
         replace="function req(){ return new Request('\\\\\\\\intranet\\\\leak'); }\nfunction openPicker()",
         must_fail=INVARIANTS),
    dict(name="product/backslash-host-vs-css-decoder",
         expect="remote URL, outside an inert context",
         behaviour="'\\\\\\\\evil' is \\\\evil at runtime; a CSS pass reads \\e as hex and must not hide it",
         file="src/app/60-io.js",
         find="function openPicker()",
         replace="function req(){ return new Request('\\\\\\\\evil.com/leak'); }\nfunction openPicker()",
         must_fail=INVARIANTS),
    dict(name="product/scheme-without-slashes",
         expect="remote URL, outside an inert context",
         behaviour="https:host skips the missing slashes and is https://host",
         file="src/app/60-io.js",
         find="function openPicker()",
         replace="function req(){ return new Request('https:example.com/r'); }\nfunction openPicker()",
         must_fail=INVARIANTS),
    dict(name="product/js-escaped-whitespace-before-host",
         expect="remote URL, outside an inert context",
         behaviour="'\\t//host' is TAB //host at runtime; the URL parser strips the tab",
         file="src/app/60-io.js",
         find="function openPicker()",
         replace="function req(){ return new Request('\\t//intranet/leak'); }\nfunction openPicker()",
         must_fail=INVARIANTS),
    dict(name="product/unquoted-protocol-relative-css",
         expect="fetches a remote URL, by any route",
         behaviour="an unquoted url(//host) is invisible to the quoted-literal scan",
         file="src/ui/viewer.css",
         find="#hintbar{color:var(--dim)}",
         replace="#hintbar{color:var(--dim);background:url(//intranet/p.png)}",
         must_fail=INVARIANTS),

    # Codex review round 8: the vendor checks globbed vendor/*.js, so a nested
    # vendored include was unhashed and its URLs unreviewed.
    dict(name="vendor/nested-include-unreviewed",
         expect="every remote URL in vendor/ has been reviewed",
         behaviour="a vendored script at any depth must have its URLs reviewed",
         file="src/viewer.template.html",
         find="@@INCLUDE:vendor/STLLoader.js@@</script>",
         replace="@@INCLUDE:vendor/STLLoader.js@@</script>\n<script>@@INCLUDE:vendor/lib/probe.js@@</script>",
         create={"vendor/lib/probe.js": 'fetch("https://example.com/leak");\n'},
         must_fail=INVARIANTS),
    dict(name="vendor/nested-include-unhashed",
         expect="vendor files are unmodified",
         behaviour="a vendored script at any depth must be pinned by SHA256SUMS",
         file="src/viewer.template.html",
         find="@@INCLUDE:vendor/STLLoader.js@@</script>",
         replace="@@INCLUDE:vendor/STLLoader.js@@</script>\n<script>@@INCLUDE:vendor/lib/probe.js@@</script>",
         create={"vendor/lib/probe.js": "var probe = 1;\n"},
         must_fail=INVARIANTS),
    dict(name="vendor/nested-stylesheet-unquoted-url",
         expect="every remote URL in vendor/ has been reviewed",
         behaviour="the vendor review must read url() the way the app scan does",
         file="src/viewer.template.html",
         find="@@INCLUDE:vendor/STLLoader.js@@</script>",
         replace="@@INCLUDE:vendor/STLLoader.js@@</script>\n<style>@@INCLUDE:vendor/lib/x.css@@</style>",
         create={"vendor/lib/x.css": ".a{background:url(//intranet/p.png)}\n"},
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

    # ---- the PreToolUse hook: the one guardrail that runs off CI ------------
    dict(name="hook/blocks-the-vendor-upgrade-procedure",
         behaviour="an upgrade must be able to record reviewed URLs in vendor/URLS",
         file=".claude/hooks/no_direct_viewer_edit.py",
         find='VENDOR_METADATA = {"sha256sums", "urls"}',
         replace='VENDOR_METADATA = {"sha256sums"}',
         must_fail=UNIT_PY),
    dict(name="hook/stops-protecting-viewer-html",
         behaviour="a direct write to the generated viewer.html must be denied",
         file=".claude/hooks/no_direct_viewer_edit.py",
         find="    if name == GENERATED.casefold():",
         replace="    if False:",
         must_fail=UNIT_PY),
    dict(name="hook/case-sensitive-again",
         behaviour="Viewer.html names the same file on Windows and must be denied",
         file=".claude/hooks/no_direct_viewer_edit.py",
         find="    name = Path(file_path).name.casefold()",
         replace="    name = Path(file_path).name",
         must_fail=UNIT_PY),

    # ---- exit statuses that automation acts on ----------------------------
    dict(name="checks/not-run-reported-as-success",
         behaviour="a stage that could not run must not produce exit 0",
         file="tests/run_checks.py",
         find='    if "not-run" in statuses:\n        return EXIT_NOT_RUN',
         replace='    if "not-run" in statuses:\n        return EXIT_OK',
         must_fail=UNIT_PY),
    dict(name="launcher/check-cannot-fail",
         behaviour="stepview.py --check must exit non-zero when the engine is unavailable",
         file="stepview.py",
         find="        if not ok:\n            sys.exit(1)\n",
         replace="",
         must_fail=UNIT_PY),
    dict(name="launcher/installed-engine-called-not-installed",
         behaviour="an engine that installs but cannot load must not be reported as not installed",
         file="stepview.py",
         find='    if missing == "cascadio":\n',
         replace='    if isinstance(err, ImportError):\n',
         must_fail=UNIT_PY),
    dict(name="launcher/broken-dependency-gets-a-plain-install",
         behaviour="an installed-but-broken dependency must be reinstalled, not installed",
         file="stepview.py",
         find='    if missing and "." not in missing:\n',
         replace='    if missing and not missing.startswith("cascadio"):\n',
         must_fail=UNIT_PY),
    dict(name="launcher/conversion-error-guesses-not-installed",
         behaviour="a dropped STEP file must get the same engine diagnosis as --check",
         file="stepview.py",
         find="        what, fix = diagnose_engine(e)\n"
              "        raise RuntimeError(f'{what} Fix it with:  \"{sys.executable}\" -m pip install {fix}') from None\n",
         replace="        raise RuntimeError('the tessellation engine is not installed -- run: pip install cascadio numpy') from None\n",
         must_fail=UNIT_PY),
    dict(name="launcher/status-hides-the-fix",
         behaviour="the page must be told why the engine cannot load and how to fix it",
         file="stepview.py",
         find="                status[\"fix\"] = f'\"{sys.executable}\" -m pip install {fix}'\n",
         replace="",
         must_fail=UNIT_PY),
    dict(name="launcher/localised-load-error-crashes-report",
         behaviour="a DLL-load error worded in the UI language must not crash the report",
         file="stepview.py",
         find='    print(msg.encode(enc, "backslashreplace").decode(enc) if enc else msg)\n',
         replace="    print(msg)\n",
         must_fail=UNIT_PY),
    dict(name="launcher/report-escapes-what-the-stream-can-show",
         behaviour="a non-ASCII interpreter path must print as is wherever the stream can hold it",
         file="stepview.py",
         find='    print(msg.encode(enc, "backslashreplace").decode(enc) if enc else msg)\n',
         replace='    print(msg.encode("ascii", "backslashreplace").decode("ascii"))\n',
         must_fail=UNIT_PY),

    dict(name="launcher/non-ascii-message",
         expect="text is ASCII, so no Windows locale can crash it",
         behaviour="an em dash in a message crashes redirected output on Japanese Windows",
         file="stepview.py",
         find='"  Setup OK -- STEP conversion available."',
         replace='"  Setup OK \u2014 STEP conversion available."',
         must_fail=INVARIANTS),

    # ---- the launcher ------------------------------------------------------
    dict(name="launcher/breaks-on-oldest-supported-python",
         expect="oldest Python README promises",
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
         find='status = {"engine": problem is None, "python": sys.executable}',
         replace='status = {"engine": problem is None}',
         must_fail=UNIT_PY),
]


def run(cmd) -> int:
    return subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True).returncode


def occupied(m) -> list:
    """`create` paths that already exist -- never ours to overwrite or delete."""
    return [rel for rel in (m.get("create") or {}) if (ROOT / rel).exists()]


def apply_one(m) -> tuple:
    """Apply one mutation, run its check, revert everything.

    Returns (status, detail) with status "caught", "escaped" or "drift".
    """
    target = ROOT / m["file"]
    original = target.read_bytes()
    occurrences = original.count(m["find"].encode())
    if occurrences != 1:
        return "drift", (f"{m['file']}: `find` matched {occurrences} times, expected "
                         f"exactly 1. The code moved -- until this is updated it proves nothing.")
    taken = occupied(m)
    if taken:
        return "drift", ("fixture path(s) already exist and were not touched: "
                         + ", ".join(taken) + ". Move them aside or rename the fixture.")

    mutated = original.replace(m["find"].encode(), m["replace"].encode(), 1)
    created_files, created_dirs, target_written = [], [], False
    rc, output, not_run = 0, "", None
    rebuild = m.get("rebuild", True)
    # saved only after the early returns, so a refused mutation touches nothing
    viewer_original = VIEWER.read_bytes() if rebuild else None
    try:
        try:
            for rel, content in (m.get("create") or {}).items():
                extra = ROOT / rel
                # record each directory this run has to make, so cleanup removes it
                missing, d = [], extra.parent
                while not d.exists():
                    missing.append(d)
                    d = d.parent
                for d in reversed(missing):
                    d.mkdir()
                    created_dirs.append(d)
                # "x" = exclusive create: if something appeared at this path since
                # occupied() looked, fail rather than overwrite it.
                with open(extra, "x", encoding="utf-8") as fh:
                    fh.write(content)
                created_files.append(extra)
        except FileExistsError as e:
            return "drift", f"fixture path appeared mid-run and was not touched: {e.filename}"
        target.write_bytes(mutated)
        target_written = True
        if rebuild:
            subprocess.run([PY, "build.py"], cwd=ROOT, capture_output=True)
        try:
            res = subprocess.run(m["must_fail"], cwd=ROOT, capture_output=True, text=True)
            rc, output = res.returncode, res.stdout
        except FileNotFoundError:
            not_run = m["must_fail"][0]
    finally:
        if target_written:
            target.write_bytes(original)
        if viewer_original is not None:
            VIEWER.write_bytes(viewer_original)
        for f in created_files:
            f.unlink(missing_ok=True)
        for d in reversed(created_dirs):          # deepest first
            try:
                d.rmdir()
            except OSError:
                pass                              # not empty: someone else's, leave it
    if not_run:
        # Not a pass and not a crash: a mutation whose check cannot run proves
        # nothing, and the run as a whole must not look green because of it.
        return "drift", f"could not run: `{not_run}` was not found"
    if rc == 0:
        return "escaped", ""
    expect = m.get("expect")
    if expect and not any(l.startswith("FAIL") and expect in l for l in output.splitlines()):
        others = [l[4:].strip() for l in output.splitlines() if l.startswith("FAIL")]
        return "escaped", (f"the check it targets ({expect!r}) never failed -- it was "
                           f"caught only by {others or 'a non-zero exit'}, which proves "
                           f"nothing about that check")
    return "caught", ""


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
        status, detail = apply_one(m)
        if status == "caught":
            caught.append(m["name"])
            print(f"ok    {m['name']:44s} caught")
        elif status == "escaped":
            escaped.append(m["name"])
            print(f"MISS  {m['name']:44s} NOT caught")
            print(f"      {m['behaviour']}")
            print(f"      {detail or ' '.join(m['must_fail']) + ' still passed with the behaviour broken.'}")
        else:
            drifted.append(m["name"])
            print(f"DRIFT {m['name']}")
            print(f"      {detail}")

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
