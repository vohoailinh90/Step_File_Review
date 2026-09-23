#!/usr/bin/env python3
"""check_invariants.py -- the properties of this repo that a script can prove.

    python tests/check_invariants.py

Two groups, and the split is the point:

  STRUCTURE  contributor-facing. Did the change go into the right files, and is
             viewer.html still a faithful build of them?
  PRODUCT    user-facing. Is the tool still self-contained, offline and
             loopback-only? These are the properties README.md sells.

None of this is judgement work, so none of it belongs to a reviewer -- human or
agent. A reviewer asked to eyeball a 796 KB file for a stray CDN reference will
sometimes miss it; this never will.

Stdlib only. Exit 0 = all checks passed.
"""
import hashlib
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

APP_DIR = ROOT / "src" / "app"
VENDOR = ROOT / "vendor"
VIEWER = ROOT / "viewer.html"
TEMPLATE = ROOT / "src" / "viewer.template.html"
DIRECTIVE = re.compile(rb"@@INCLUDE:([^@]+)@@")

# An agent has to be able to hold a module in view to change it safely. 250 is
# generous for the current spread (42-180) and still well inside a small read.
MODULE_LINE_BUDGET = 250

CDN_HOSTS = ("//cdn.", "//cdnjs.", "//unpkg.", "//jsdelivr.", "//cdn.jsdelivr.",
             "//fonts.googleapis.", "//ajax.googleapis.", "//code.jquery.",
             "//esm.sh", "//skypack.dev")

# HTML attributes whose value the browser FETCHES. `xmlns` and `xmlns:xlink` are
# namespace declarations, not loads, so they are deliberately absent -- flagging
# them would fail any inline SVG for no reason.
URL_ATTRS = ("src", "srcset", "href", "poster", "data", "action", "formaction",
             "background", "manifest", "cite", "longdesc", "profile", "archive",
             "codebase", "xlink:href")

# Absolute remote, or protocol-relative ("//host/x" inherits the page scheme).
# `data:` and `blob:` never leave the page, so they do not break the air-gap and
# are allowed -- an inline data: icon is a legitimate way to stay self-contained.
REMOTE_URL = re.compile(r"^\s*(?:https?:|ftps?:|wss?:|//)", re.I)

# CSS can fetch from a .css file, a style="" attribute, an inline <style> block,
# or a JS string assigned to .style.*. So the CSS scan runs over EVERY source
# file rather than only the stylesheet: enumerating *where* CSS lives is what
# leaked twice already. The lookbehind keeps `URL.createObjectURL(` from matching.
CSS_URL = re.compile(r"""(?<![\w.$])url\(\s*(['\"]?)([^)'\"]*)\1\s*\)""", re.I)
CSS_IMPORT = re.compile(r"""@import\s+(?:url\(\s*)?['\"]?([^'\")\s;]+)""", re.I)

def scanned_sources() -> list[str]:
    """Every non-vendor file that actually ships, DERIVED from build.py.

    Deliberately not a fixed list. build.py's template directives are the single
    source of truth for what lands in viewer.html, so the scan follows the build:
    a newly included source is covered the moment it is included, without editing
    this file. Codex review round 3 on PR #1 found the previous version
    enumerating three UI files, so adding `src/ui/probe.html` to the template
    shipped a remote url() past all 13 checks -- the same enumeration mistake the
    two earlier fixes made one level down.

    vendor/ is excluded because it is upstream code pinned by vendor/SHA256SUMS:
    any change there already fails that check, and its spec links and comments
    would produce constant false positives. A bundled library added OUTSIDE
    vendor/ is therefore scanned, which is the right default -- a new third-party
    blob in the app tree should be looked at, not waved through.
    """
    import build
    rels = [p for p in build.parts() if not p.startswith("vendor/")]
    rels.append("src/viewer.template.html")   # the shell is not in its own list
    return sorted(set(rels))


def shipped_js() -> list[str]:
    """The .js files among scanned_sources(): every script fragment that ships."""
    return [r for r in scanned_sources() if r.endswith(".js")]


# Browser APIs that can reach the network with a URL the code builds at RUNTIME,
# which no literal scan can see. This is the one place the offline checks list
# the dangerous side, and deliberately so: there is no source of truth in the
# repo to derive it from. It is not the guarantee -- the remote-literal backstop
# (_no_remote_url_literal) is. This only covers what that one cannot see. `fetch`
# is absent on purpose: it is the viewer's legitimate same-origin API.
NETWORK_APIS = (
    (r"\bXMLHttpRequest\b", "XMLHttpRequest"),
    (r"\bnew\s+WebSocket\b", "WebSocket"),
    (r"\bnew\s+EventSource\b", "EventSource"),
    (r"\bsendBeacon\s*\(", "navigator.sendBeacon"),
    (r"\bnew\s+(?:Shared)?Worker\b", "Worker"),
    (r"\bserviceWorker\s*\.\s*register\b", "serviceWorker.register"),
    (r"\bimportScripts\s*\(", "importScripts"),
    (r"\bnew\s+RTCPeerConnection\b", "RTCPeerConnection"),
    (r"\bnew\s+WebTransport\b", "WebTransport"),
    (r"\bwindow\s*\.\s*open\s*\(", "window.open"),
    (r"\blocation\s*\.\s*(?:assign|replace)\s*\(", "location.assign/replace"),
)

failures: list[str] = []
passes: list[str] = []


def check(name: str):
    """Run a check function; record pass/fail from its returned problem list."""
    def wrap(fn):
        try:
            problems = fn() or []
        except Exception as e:                      # a broken check is a failure
            problems = [f"check raised {type(e).__name__}: {e}"]
        if problems:
            failures.append(name)
            print(f"FAIL  {name}")
            for p in problems:
                print(f"      - {p}")
        else:
            passes.append(name)
            print(f"ok    {name}")
        return fn
    return wrap


# ---------------------------------------------------------------- STRUCTURE ---

@check("STRUCTURE  viewer.html is a faithful build of src/ and vendor/")
def _built():
    import build
    if not VIEWER.exists():
        return ["viewer.html is missing -- run: python build.py"]
    built = build.render()
    if VIEWER.read_bytes() == built:
        return []
    return ["viewer.html does not match source. Someone edited the generated "
            "file directly, or forgot to rebuild. Port the change into src/ "
            "and run: python build.py"]


@check("STRUCTURE  every template part exists and lives inside the repo")
def _parts_exist():
    problems = []
    for m in DIRECTIVE.finditer(TEMPLATE.read_bytes()):
        rel = m.group(1).decode()
        part = ROOT / rel
        if not part.is_file():
            problems.append(f"{rel} is referenced by the template but missing")
            continue
        try:
            part.resolve().relative_to(ROOT)
        except ValueError:
            problems.append(f"{rel} resolves outside the repository")
    return problems


@check("STRUCTURE  app modules are concatenated in filename order")
def _module_order():
    # The numeric prefixes only mean something if build order matches them --
    # these fragments share one closure, so order decides what is defined when.
    listed = [r for r in (m.group(1).decode() for m in DIRECTIVE.finditer(TEMPLATE.read_bytes()))
              if r.startswith("src/app/")]
    if listed != sorted(listed):
        return [f"template order {listed} is not sorted; renumber or reorder"]
    on_disk = sorted(f"src/app/{p.name}" for p in APP_DIR.glob("*.js"))
    if listed != on_disk:
        missing = set(on_disk) - set(listed)
        extra = set(listed) - set(on_disk)
        return ([f"{m} exists but the template never includes it" for m in sorted(missing)] +
                [f"{e} is included but does not exist" for e in sorted(extra)])
    return []


@check(f"STRUCTURE  no shipped script exceeds {MODULE_LINE_BUDGET} lines")
def _module_budget():
    problems = []
    for rel in shipped_js():            # derived: a script included from src/ui/ counts too
        n = len((ROOT / rel).read_bytes().splitlines())
        if n > MODULE_LINE_BUDGET:
            problems.append(f"{rel} is {n} lines (budget {MODULE_LINE_BUDGET}) -- split it")
    return problems


@check("STRUCTURE  shipped scripts carry no <script> tags")
def _no_tags_in_modules():
    problems = []
    for rel in shipped_js():            # derived: a stray </script> anywhere breaks the page
        body = (ROOT / rel).read_bytes()
        for tag in (b"<script", b"</script"):
            if tag in body:
                problems.append(f"{rel} contains {tag.decode()} -- "
                                "the template owns the tags, scripts are body only")
    return problems


@check("STRUCTURE  vendor files are unmodified (vendor/SHA256SUMS)")
def _vendor_intact():
    sums = VENDOR / "SHA256SUMS"
    if not sums.exists():
        return ["vendor/SHA256SUMS is missing"]
    problems = []
    seen = set()
    for line in sums.read_text().splitlines():
        if not line.strip():
            continue
        digest, _, name = line.partition("  ")
        name = name.strip()
        seen.add(name)
        f = VENDOR / name
        if not f.is_file():
            problems.append(f"vendor/{name} is listed in SHA256SUMS but missing")
            continue
        actual = hashlib.sha256(f.read_bytes()).hexdigest()
        if actual != digest.strip():
            problems.append(
                f"vendor/{name} was modified. Vendored libraries are upstream "
                f"code -- patch around them in src/app/, or upgrade deliberately "
                f"and refresh SHA256SUMS in the same commit.")
    for f in sorted(VENDOR.glob("*.js")):
        if f.name not in seen:
            problems.append(f"vendor/{f.name} is untracked by SHA256SUMS")
    return problems


# ------------------------------------------------------------------ PRODUCT ---

@check("PRODUCT  viewer.html loads nothing from the network")
def _no_external_resources():
    html = VIEWER.read_text(encoding="utf-8", errors="replace")
    problems = []
    for pat, why in (
        (r"<script[^>]+\bsrc\s*=", "a <script src=> would need a network fetch"),
        (r"<link[^>]+\bhref\s*=\s*[\"']?https?:", "a remote stylesheet"),
        (r"<link[^>]+\brel\s*=\s*[\"']?(preconnect|dns-prefetch)", "a remote preconnect"),
        (r"@import\s+(url\()?[\"']?https?:", "a remote CSS @import"),
        (r"\bintegrity\s*=", "an SRI hash implies a remote asset"),
        (r"<iframe", "an iframe can reach the network"),
    ):
        for m in re.finditer(pat, html, re.I):
            line = html.count("\n", 0, m.start()) + 1
            problems.append(f"viewer.html:{line} {why} ({m.group(0)[:40]!r})")
    return problems


@check("PRODUCT  no CDN hostname appears in source or vendor")
def _no_cdn():
    problems = []
    # derived from what ships, plus vendor/ (pinned, but a CDN host there is still
    # worth naming). An earlier version globbed src/app and src/ui by hand.
    targets = [ROOT / r for r in scanned_sources()] + sorted(VENDOR.glob("*.js"))
    for p in targets:
        text = p.read_text(encoding="utf-8", errors="replace")
        for host in CDN_HOSTS:
            if host in text:
                problems.append(f"{p.relative_to(ROOT)} references {host}")
    return problems


@check("PRODUCT  no app source fetches a remote URL, by any route")
def _no_remote_resources_in_source():
    """Covers the class, wherever it appears -- not a list of places to look.

    Two rounds of Codex review on PR #1 found four escapes here, each a member of
    the same class the check claimed to cover:

      round 1  <img src="https://...">                 in layout.html
      round 1  background:url(https://...)             in viewer.css
      round 2  style="background:url(https://...)"     inline attribute
      round 2  <style>...url(https://...)...</style>   embedded block

    Probing for the rest of the class then found two more that neither round
    named: `el.style.background = "url(https://...)"` and an `innerHTML` string
    carrying a remote `<img src>`. The lesson is in CLAUDE.md: the first two
    fixes enumerated *where* CSS and markup live, and kept missing places they
    live. So every scan below runs over every source file's full text.
    """
    problems = []
    names = "|".join(a.replace(":", r"\:") for a in URL_ATTRS)
    attr_re = re.compile(
        rf"""\b({names})\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>'"`]+))""", re.I)
    setattr_re = re.compile(
        rf"""setAttribute\(\s*(['\"])({names})\1\s*,\s*(['\"`])([^'\"`]*)\3""", re.I)

    def scan(rel: str, text: str):
        def flag(idx, what, value):
            line = text.count("\n", 0, idx) + 1
            problems.append(f"{rel}:{line} {what} points at a remote URL: {value!r}")

        # URL-bearing attributes, quoted or not. Also catches `.src = "https://"`
        # in JS, and an attribute inside an innerHTML string literal.
        for m in attr_re.finditer(text):
            attr = m.group(1)
            raw = next(g for g in m.groups()[1:] if g is not None)
            for cand in (raw.split(",") if attr.lower() == "srcset" else [raw]):
                url = cand.strip().split()[0] if cand.strip() else ""
                if REMOTE_URL.match(url):
                    flag(m.start(), f"{attr}=", url)
        for m in setattr_re.finditer(text):
            if REMOTE_URL.match(m.group(4)):
                flag(m.start(), f"setAttribute({m.group(2)})", m.group(4))
        # CSS url() and @import, wherever they sit: stylesheet, style attribute,
        # inline <style> block, or a JS string.
        for m in CSS_URL.finditer(text):
            if REMOTE_URL.match(m.group(2)):
                flag(m.start(), "css url()", m.group(2).strip())
        for m in CSS_IMPORT.finditer(text):
            if REMOTE_URL.match(m.group(1)):
                flag(m.start(), "css @import", m.group(1))

    # build.parts() already lists src/app/*.js, so one loop covers everything.
    for rel in scanned_sources():
        f = ROOT / rel
        if f.is_file():
            scan(rel, f.read_text(encoding="utf-8"))
    return problems


@check("PRODUCT  the viewer only ever fetches its own origin")
def _same_origin_only():
    """Scans every shipped source's FULL text, not only src/app/*.js.

    Codex review round 5 on PR #1: this check still globbed src/app/*.js after
    its sibling had been moved to scanned_sources(), so a fetch() in a newly
    included src/ui/probe.js passed all 14 checks. And JS does not only live in
    .js files -- an inline <script> or an onclick="" in markup ships too, so the
    whole text of every source is scanned, the same way the CSS scan works.
    """
    problems = []
    for rel in scanned_sources():
        text = (ROOT / rel).read_text(encoding="utf-8")
        for m in re.finditer(r"""(fetch|importScripts|import)\s*\(\s*[`"']([^`"')]*)""", text):
            url = m.group(2)
            if re.match(r"[a-z]+:", url) or url.startswith("//"):
                line = text.count("\n", 0, m.start()) + 1
                problems.append(f"{rel}:{line} fetches an absolute URL: {url!r}")
        for pattern, api in NETWORK_APIS:
            for m in re.finditer(pattern, text):
                line = text.count("\n", 0, m.start()) + 1
                problems.append(f"{rel}:{line} uses {api}, which can reach the network with "
                                f"a URL built at runtime -- the viewer's only network API is "
                                f"same-origin fetch()")
    return problems


@check("PRODUCT  no shipped source contains a remote URL, outside an inert context")
def _no_remote_url_literal():
    """The class-level guarantee. It inverts the enumeration.

    Five review rounds on PR #1 each found a network route the previous fix had
    not listed: <img src>, CSS url(), style="", <style>, .style.*, innerHTML, a
    newly included file, then EventSource. Listing the DANGEROUS side is listing
    an open set -- the web platform keeps adding ways to open a connection.

    So this lists the SAFE side instead, which is small and closed: a remote URL
    may appear only as an XML namespace declaration (xmlns / xmlns:xlink), which
    names a namespace and never fetches. Anywhere else, in any shipped source, it
    is a violation -- whichever API would consume it, including ones nobody here
    has thought of. That is why EventSource, sendBeacon, Worker, window.open and
    location.href are all caught by this check without being named in it.

    Comments are deliberately NOT exempt. Stripping JS comments with a regex is
    fragile precisely because every URL contains "//", and a comment stripper
    that misfires hides a real fetch. For an air-gap guarantee a false negative
    is far worse than a false positive, so a reference link in a comment should
    be written without its scheme ("threejs.org/docs").

    Two limits, stated rather than hidden: a URL assembled at runtime from
    fragments cannot be seen by any static check (NETWORK_APIS catches the APIs
    that would carry one), and a protocol-relative "//host" is caught by the
    attribute, CSS and fetch scans rather than here.
    """
    literal = re.compile(r"""(?:https?|wss?|ftps?)://[^\s'"`)<>\\]+""", re.I)
    inert = re.compile(r"""xmlns(?::[\w-]+)?\s*=\s*["']?$""", re.I)
    problems = []
    for rel in scanned_sources():
        text = (ROOT / rel).read_text(encoding="utf-8")
        for m in literal.finditer(text):
            if inert.search(text[max(0, m.start() - 48):m.start()]):
                continue
            line = text.count("\n", 0, m.start()) + 1
            problems.append(f"{rel}:{line} contains a remote URL {m.group(0)!r}. If it is a "
                            f"reference in a comment, drop the scheme; if the code uses it, "
                            f"the viewer is no longer air-gapped")
    return problems


@check("PRODUCT  the local server binds loopback only")
def _loopback_only():
    src = (ROOT / "stepview.py").read_text(encoding="utf-8")
    problems = []
    for bad in ('"0.0.0.0"', "'0.0.0.0'", '""', "'::'"):
        if f"bind(({bad}" in src or f"HTTPServer(({bad}" in src:
            problems.append(f"stepview.py binds {bad} -- the server must stay on 127.0.0.1")
    if '"127.0.0.1"' not in src:
        problems.append("stepview.py no longer mentions 127.0.0.1")
    binds = re.findall(r"(?:bind|HTTPServer)\(\(\s*([^,]+),", src)
    for b in binds:
        if b.strip() != '"127.0.0.1"':
            problems.append(f"unexpected bind address: {b.strip()}")
    return problems


@check("PRODUCT  stepview.py imports nothing outside the stdlib but cascadio")
def _stdlib_only():
    src = (ROOT / "stepview.py").read_text(encoding="utf-8")
    allowed = {
        "argparse", "hashlib", "http", "json", "socket", "sys", "tempfile",
        "threading", "time", "webbrowser", "pathlib", "urllib", "cascadio", "re",
        "__future__",
    }
    problems = []
    for m in re.finditer(r"^\s*(?:import|from)\s+([a-zA-Z0-9_]+)", src, re.M):
        mod = m.group(1)
        if mod not in allowed:
            problems.append(f"stepview.py imports {mod!r}, which is not stdlib or cascadio")
    return problems


@check("PRODUCT  every script imports on the oldest Python README promises (3.9)")
def _min_python():
    """PEP 604 unions ("str | None") are evaluated at runtime before 3.10.

    Found by CI on windows-latest/py3.9 after the suite had been green on 3.13
    everywhere: stepview.py failed at IMPORT with a bare TypeError, so a user
    on the oldest Python the README promises could not run the tool at all.
    The fix is `from __future__ import annotations`; this check keeps the two
    from drifting apart again.
    """
    import ast
    problems = []
    # Derived, not listed: every Python file in the repo outside vendor/ and git
    # internals. An earlier version named seven files, so a new test module would
    # have gone unchecked -- the same enumeration mistake the offline check made.
    skip = {".git", "vendor", "__pycache__", "node_modules"}
    for f in sorted(ROOT.rglob("*.py")):
        if skip & set(f.relative_to(ROOT).parts):
            continue
        rel = f.relative_to(ROOT).as_posix()
        tree = ast.parse(f.read_text(encoding="utf-8"), filename=rel)
        postponed = any(
            isinstance(n, ast.ImportFrom) and n.module == "__future__"
            and any(a.name == "annotations" for a in n.names)
            for n in tree.body)
        if postponed:
            continue
        for node in ast.walk(tree):
            targets = []
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                a = node.args
                targets = [x.annotation for x in (*a.posonlyargs, *a.args, *a.kwonlyargs)
                           if x.annotation]
                if node.returns:
                    targets.append(node.returns)
            elif isinstance(node, ast.AnnAssign) and node.annotation:
                targets = [node.annotation]
            for ann in targets:
                for sub in ast.walk(ann):
                    if isinstance(sub, ast.BinOp) and isinstance(sub.op, ast.BitOr):
                        problems.append(
                            f"{rel}:{getattr(node, 'lineno', '?')} uses a PEP 604 union "
                            f"in an annotation without `from __future__ import "
                            f"annotations` -- Python 3.9 raises TypeError on import")
                        break
    return problems


@check("PRODUCT  the hook runs under the interpreter README tells users to run")
def _hook_interpreter():
    """A hook that cannot launch protects nothing, silently.

    Found by Codex review round 4 on PR #1: settings.example.json invoked
    `python3`, but a standard python.org install on Windows -- the platform this
    tool is run on -- provides `python.exe` and the `py` launcher, not
    `python3.exe`. Copied into place, the hook would fail to start and the
    generated-file and vendor protection it advertises would never run.

    The interpreter names are DERIVED from README.md's own command lines rather
    than listed here: if the README's instructions work on a machine, the hook
    works there too, and if the README ever switches interpreter, this follows.
    """
    import json
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    documented = set(re.findall(r"(?m)^[ \t]*(python3?|py)[ \t]", readme))
    if not documented:
        return ["README.md documents no python/python3/py command to compare against"]
    settings_f = ROOT / ".claude" / "settings.example.json"
    if not settings_f.is_file():
        return []
    problems = []
    settings = json.loads(settings_f.read_text(encoding="utf-8"))
    for event, groups in (settings.get("hooks") or {}).items():
        for group in groups:
            for hook in group.get("hooks", []):
                parts = (hook.get("command") or "").split()
                exe = parts[0] if parts else ""
                if re.fullmatch(r"python[0-9.]*|py", exe) and exe not in documented:
                    problems.append(
                        f".claude/settings.example.json {event} hook runs `{exe}`, but "
                        f"README.md tells users to run {sorted(documented)} -- on a "
                        f"machine where only those exist the hook never starts")
    return problems


# --------------------------------------------------------------------- main ---

if __name__ == "__main__":
    total = len(passes) + len(failures)
    print()
    if failures:
        print(f"{len(failures)} of {total} checks FAILED: {', '.join(failures)}")
        raise SystemExit(1)
    print(f"all {total} invariant checks passed")
