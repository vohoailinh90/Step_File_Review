#!/usr/bin/env python3
"""Check that a repository's root holds only what a user needs to run the app.

Per `deterministic_work` in agent-routing/policy.yaml, "is there a test file in
the root, is this root .py a module or an entry point" is computable, so it is
a script and a CI step rather than a convention agents are trusted to follow.
A root with forty .py files, half of them tests, leaves the user unable to tell
which file starts the app; that is the failure this gate exists to prevent.
See .claude/skills/repo-layout/SKILL.md for the layout it enforces.

Only the top level of the repository is inspected; everything below a
directory is that directory's business. Links are classified by what they
lead to. Test names are matched by word (split on _ - . and CamelCase), so a
name glued together without a boundary (`runtests.py`) is not caught.

Errors (exit 1):
  - a test file in the root: test_*.py, *_test.py, conftest.py, or any .py
    whose name has a `test`/`tests` word (run_tests_sample.py) -> tests/
  - a test directory in the root other than tests/ (test_support/, testdata/)
    -> under tests/
  - a root .py that is neither an entry point nor a tool file: a library
    module, not something a user runs -> into the app's package. An entry
    point has a top-level `if __name__ == "__main__":` guard, or imports
    streamlit at the top level (a Streamlit app is run by `streamlit run`
    and has no guard); setup.py and noxfile.py are tool files and exempt
  - a root .py that cannot be read or parsed: a broken link, unreadable,
    not UTF-8, or a syntax error (it cannot be classified)
  - more root entry points than --max-root-scripts (default 3): the user still
    cannot tell which one to run -> keep the launchers, move the rest

Usage:
    python3 scripts/layout_check.py                  # this repository
    python3 scripts/layout_check.py path/to/repo
    python3 scripts/layout_check.py --max-root-scripts 2

Exit status: 0 clean, 1 findings, 2 bad arguments.
"""

from __future__ import annotations

import argparse
import ast
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MAX_ROOT_SCRIPTS = 3
TEST_DIR = "tests"
# Python tooling reads these from the root by name and they carry no main guard.
TOOL_ENTRY_POINTS = frozenset({"setup.py", "noxfile.py"})
TEST_WORDS = frozenset({"test", "tests", "testing", "testdata"})
WORD_SPLIT = re.compile(r"[_\-.]+")
CAMEL_BOUNDARY = re.compile(r"(?<=[a-z0-9])(?=[A-Z])")


def is_test_name(stem: str) -> bool:
    """test_x, x_test, run_tests_sample, TestRunner, conftest — but not latest or attest."""
    if stem == "conftest":
        return True
    words = WORD_SPLIT.split(CAMEL_BOUNDARY.sub("_", stem))
    return any(word.lower() in TEST_WORDS for word in words)


def has_main_guard(tree: ast.Module) -> bool:
    """Whether the module has a top-level `if __name__ == "__main__":`."""
    for node in tree.body:
        if not isinstance(node, ast.If):
            continue
        test = node.test
        if not (isinstance(test, ast.Compare) and len(test.ops) == 1 and isinstance(test.ops[0], ast.Eq)):
            continue
        sides = [test.left, test.comparators[0]]
        names = [side for side in sides if isinstance(side, ast.Name) and side.id == "__name__"]
        mains = [side for side in sides if isinstance(side, ast.Constant) and side.value == "__main__"]
        if names and mains:
            return True
    return False


def is_streamlit_app(tree: ast.Module) -> bool:
    """Whether the module imports streamlit at the top level: `streamlit run` is its entry point."""
    for node in tree.body:
        if isinstance(node, ast.Import) and any(alias.name.split(".")[0] == "streamlit" for alias in node.names):
            return True
        if isinstance(node, ast.ImportFrom) and node.level == 0 and (node.module or "").split(".")[0] == "streamlit":
            return True
    return False


def check(root: Path, max_root_scripts: int) -> list[str]:
    errors: list[str] = []
    entry_points: list[str] = []
    for path in sorted(root.iterdir(), key=lambda p: p.name):
        name = path.name
        if name.startswith("."):
            continue
        if path.is_dir():
            if name != TEST_DIR and is_test_name(name):
                errors.append(f"{name}/: test directory in the root -> move it under {TEST_DIR}/")
            continue
        if path.suffix != ".py":
            continue
        if is_test_name(path.stem):
            errors.append(f"{name}: test file in the root -> move it to {TEST_DIR}/")
            continue
        if name in TOOL_ENTRY_POINTS:
            continue
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=name)
        except (OSError, SyntaxError, UnicodeDecodeError, ValueError) as exc:
            errors.append(f"{name}: cannot be read or parsed ({exc.__class__.__name__}), so it cannot be classified")
            continue
        if not (has_main_guard(tree) or is_streamlit_app(tree)):
            errors.append(
                f"{name}: library module in the root (no `if __name__ == \"__main__\":`, not a Streamlit app)"
                " -> move it into the app's package"
            )
            continue
        entry_points.append(name)
    if len(entry_points) > max_root_scripts:
        errors.append(
            f"{len(entry_points)} entry points in the root ({', '.join(entry_points)}),"
            f" limit {max_root_scripts} -> keep the launchers users run, move the rest into the package"
        )
    return errors


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("root", nargs="?", default=str(ROOT), help="repository root (default: this repository)")
    parser.add_argument("--max-root-scripts", type=int, default=DEFAULT_MAX_ROOT_SCRIPTS,
                        help=f"root entry points allowed (default {DEFAULT_MAX_ROOT_SCRIPTS})")
    try:
        args = parser.parse_args(argv)
    except SystemExit as exc:
        return 0 if exc.code == 0 else 2
    root = Path(args.root)
    if not root.is_dir():
        print(f"error: {root} is not a directory", file=sys.stderr)
        return 2
    if args.max_root_scripts < 0:
        print("error: --max-root-scripts must be >= 0", file=sys.stderr)
        return 2
    errors = check(root, args.max_root_scripts)
    for error in errors:
        print(f"ERROR {error}")
    print(f"layout_check: {len(errors)} error(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
