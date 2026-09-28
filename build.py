#!/usr/bin/env python3
"""build.py — assemble viewer.html from src/ and vendor/.

    python build.py            rebuild viewer.html from source
    python build.py --check    verify the committed viewer.html matches source
    python build.py --list     show the part manifest and sizes

viewer.html is a GENERATED file. It stays committed because shipping it is the
product -- QuickSTEP is a two-file tool that runs with no build step, no npm and
no internet on the machine that uses it. Building is a *contributor* step, not a
user step. Edit src/ and vendor/, never viewer.html.

Stdlib only, by design: adding a bundler would add the toolchain this project
exists to avoid.

All file I/O is binary. On Windows, text mode would rewrite every "\\n" to
"\\r\\n" and silently produce a viewer.html that no longer matches source.
"""
import argparse
import hashlib
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TEMPLATE = ROOT / "src" / "viewer.template.html"
OUTPUT = ROOT / "viewer.html"
DIRECTIVE = re.compile(rb"@@INCLUDE:([^@]+)@@")


def render() -> bytes:
    """Resolve every @@INCLUDE:path@@ in the template against the repo root."""
    if not TEMPLATE.exists():
        sys.exit(f"template not found: {TEMPLATE}")
    template = TEMPLATE.read_bytes()
    missing = []

    def sub(m: re.Match) -> bytes:
        rel = m.group(1).decode()
        part = ROOT / rel
        # keep a stray "../" in the template from reaching outside the repo
        try:
            part.resolve().relative_to(ROOT)
        except ValueError:
            missing.append(f"{rel} (outside the repository)")
            return b""
        if not part.is_file():
            missing.append(rel)
            return b""
        return part.read_bytes()

    out = DIRECTIVE.sub(sub, template)
    if missing:
        sys.exit("missing template part(s):\n  " + "\n  ".join(missing))
    if b"@@INCLUDE:" in out:
        sys.exit("unresolved @@INCLUDE@@ directive after rendering")
    return out


def parts() -> list[str]:
    return [m.group(1).decode() for m in DIRECTIVE.finditer(TEMPLATE.read_bytes())]


def main() -> int:
    ap = argparse.ArgumentParser(description="Assemble viewer.html from source")
    ap.add_argument("--check", action="store_true",
                    help="verify the committed viewer.html matches source; do not write")
    ap.add_argument("--list", action="store_true", help="show the part manifest")
    args = ap.parse_args()

    if args.list:
        total = 0
        for rel in parts():
            size = (ROOT / rel).stat().st_size if (ROOT / rel).is_file() else 0
            total += size
            print(f"  {rel:30s} {size:>9,} B")
        print(f"  {'TOTAL':30s} {total:>9,} B")
        return 0

    built = render()
    digest = hashlib.sha256(built).hexdigest()

    if args.check:
        if not OUTPUT.exists():
            print(f"FAIL  {OUTPUT.name} is missing -- run: python build.py")
            return 1
        current = OUTPUT.read_bytes()
        if current == built:
            print(f"OK    {OUTPUT.name} matches source ({len(built):,} B, sha256 {digest[:16]})")
            return 0
        print(f"FAIL  {OUTPUT.name} does not match source.")
        print(f"      committed: {len(current):>9,} B  sha256 {hashlib.sha256(current).hexdigest()[:16]}")
        print(f"      from src:  {len(built):>9,} B  sha256 {digest[:16]}")
        print("      Someone edited viewer.html directly, or forgot to rebuild.")
        print("      Fix: port the change into src/, then run: python build.py")
        return 1

    OUTPUT.write_bytes(built)
    print(f"wrote {OUTPUT.name}  {len(built):,} B  sha256 {digest[:16]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
