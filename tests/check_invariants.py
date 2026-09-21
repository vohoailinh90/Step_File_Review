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


@check(f"STRUCTURE  no app module exceeds {MODULE_LINE_BUDGET} lines")
def _module_budget():
    problems = []
    for p in sorted(APP_DIR.glob("*.js")):
        n = len(p.read_bytes().splitlines())
        if n > MODULE_LINE_BUDGET:
            problems.append(f"src/app/{p.name} is {n} lines (budget {MODULE_LINE_BUDGET}) -- split it")
    return problems


@check("STRUCTURE  app modules carry no <script> tags")
def _no_tags_in_modules():
    problems = []
    for p in sorted(APP_DIR.glob("*.js")):
        body = p.read_bytes()
        for tag in (b"<script", b"</script"):
            if tag in body:
                problems.append(f"src/app/{p.name} contains {tag.decode()} -- "
                                "the template owns the tags, modules are body only")
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
    targets = [*APP_DIR.glob("*.js"), *(ROOT / "src" / "ui").iterdir(), *VENDOR.glob("*.js")]
    for p in targets:
        text = p.read_text(encoding="utf-8", errors="replace")
        for host in CDN_HOSTS:
            if host in text:
                problems.append(f"{p.relative_to(ROOT)} references {host}")
    return problems


@check("PRODUCT  the viewer only ever fetches its own origin")
def _same_origin_only():
    problems = []
    for p in sorted(APP_DIR.glob("*.js")):
        text = p.read_text(encoding="utf-8")
        for m in re.finditer(r"""(fetch|importScripts|import)\s*\(\s*[`"']([^`"')]*)""", text):
            url = m.group(2)
            if re.match(r"[a-z]+:", url) or url.startswith("//"):
                line = text.count("\n", 0, m.start()) + 1
                problems.append(f"src/app/{p.name}:{line} fetches an absolute URL: {url!r}")
        if "XMLHttpRequest" in text or "WebSocket" in text:
            problems.append(f"src/app/{p.name} uses XMLHttpRequest/WebSocket -- "
                            "review whether it can leave the machine")
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
    }
    problems = []
    for m in re.finditer(r"^\s*(?:import|from)\s+([a-zA-Z0-9_]+)", src, re.M):
        mod = m.group(1)
        if mod not in allowed:
            problems.append(f"stepview.py imports {mod!r}, which is not stdlib or cascadio")
    return problems


# --------------------------------------------------------------------- main ---

if __name__ == "__main__":
    total = len(passes) + len(failures)
    print()
    if failures:
        print(f"{len(failures)} of {total} checks FAILED: {', '.join(failures)}")
        raise SystemExit(1)
    print(f"all {total} invariant checks passed")
