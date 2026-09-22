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


@check("PRODUCT  no app source loads a remote URL (attribute, CSS url(), or DOM assignment)")
def _no_remote_resources_in_source():
    """Catches the whole class, not a hostname allowlist.

    Reported by Codex review on PR #1, and reproduced before being fixed: adding
    `background:url(https://example.com/pixel.png)` to viewer.css, or an
    `<img src="https://...">` to layout.html, rebuilt cleanly and passed all 12
    checks -- the tag check only knew about <script src> and <link href>, and the
    CDN check only matched a short hostname list. A future UI asset could have
    broken the advertised air-gapped behaviour with CI green.

    Scans the app's own sources rather than the built viewer.html on purpose:
    vendor/ is upstream code pinned by vendor/SHA256SUMS, so any change there
    already fails the vendor check, while its comments and spec links would
    produce endless false positives here.
    """
    problems = []

    def flag(rel, text, idx, what, value):
        line = text.count("\n", 0, idx) + 1
        problems.append(f"{rel}:{line} {what} points at a remote URL: {value!r}")

    # --- markup: every fetching attribute, however it is quoted ---------------
    names = "|".join(a.replace(":", r"\:") for a in URL_ATTRS)
    attr_re = re.compile(
        rf"""\b({names})\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))""", re.I)
    for rel in ("src/ui/layout.html", "src/viewer.template.html"):
        f = ROOT / rel
        if not f.is_file():
            continue
        text = f.read_text(encoding="utf-8")
        for m in attr_re.finditer(text):
            attr = m.group(1)
            raw = next(g for g in m.groups()[1:] if g is not None)
            # srcset is a comma-separated candidate list
            for cand in (raw.split(",") if attr.lower() == "srcset" else [raw]):
                url = cand.strip().split()[0] if cand.strip() else ""
                if REMOTE_URL.match(url):
                    flag(rel, text, m.start(), f"{attr}=", url)

    # --- CSS: url() and @import ----------------------------------------------
    css_f = ROOT / "src" / "ui" / "viewer.css"
    if css_f.is_file():
        css = css_f.read_text(encoding="utf-8")
        for m in re.finditer(r"""url\(\s*(['\"]?)([^)'\"]*)\1\s*\)""", css, re.I):
            if REMOTE_URL.match(m.group(2)):
                flag("src/ui/viewer.css", css, m.start(), "url()", m.group(2).strip())
        for m in re.finditer(r"""@import\s+(?:url\(\s*)?['\"]?([^'\")\s;]+)""", css, re.I):
            if REMOTE_URL.match(m.group(1)):
                flag("src/ui/viewer.css", css, m.start(), "@import", m.group(1))

    # --- app JS: a remote literal assigned to a URL-bearing property ---------
    # `a.href = URL.createObjectURL(blob)` is a call, not a literal, so the
    # screenshot download is unaffected.
    assign_re = re.compile(
        r"""\.(src|srcset|href|poster|action|formAction)\s*=\s*(['\"`])([^'\"`]*)\2""")
    setattr_re = re.compile(
        r"""setAttribute\(\s*(['\"])(src|srcset|href|poster|action)\1\s*,\s*(['\"`])([^'\"`]*)\3""",
        re.I)
    for f in sorted(APP_DIR.glob("*.js")):
        text = f.read_text(encoding="utf-8")
        rel = f"src/app/{f.name}"
        for m in assign_re.finditer(text):
            if REMOTE_URL.match(m.group(3)):
                flag(rel, text, m.start(), f".{m.group(1)} =", m.group(3))
        for m in setattr_re.finditer(text):
            if REMOTE_URL.match(m.group(4)):
                flag(rel, text, m.start(), f"setAttribute({m.group(2)!r})", m.group(4))
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
    for rel in ("stepview.py", "build.py", ".claude/hooks/no_direct_viewer_edit.py",
                "tests/check_invariants.py", "tests/mutation_check.py",
                "tests/run_checks.py", "tests/test_stepview.py"):
        f = ROOT / rel
        if not f.is_file():
            continue
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


# --------------------------------------------------------------------- main ---

if __name__ == "__main__":
    total = len(passes) + len(failures)
    print()
    if failures:
        print(f"{len(failures)} of {total} checks FAILED: {', '.join(failures)}")
        raise SystemExit(1)
    print(f"all {total} invariant checks passed")
