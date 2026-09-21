#!/usr/bin/env python3
"""run_checks.py -- everything a contributor (or an agent) must run before claiming done.

    python tests/run_checks.py             invariants + unit tests + geometry
    python tests/run_checks.py --mutations also prove the checks can fail (slower)

Exit 0 means the change is verified to the extent this repo can verify it
automatically. It does not mean the change was *reviewed* -- see CLAUDE.md.
"""
import argparse
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PY = sys.executable

# Discovered, not listed: a new tests/*.test.mjs is picked up without editing
# this file, so a suite cannot be silently left out of the run.
JS_TESTS = sorted(str(p.relative_to(ROOT)) for p in (ROOT / "tests").glob("*.test.mjs"))

STAGES = [
    ("build fidelity", [PY, "build.py", "--check"], True),
    ("repo + product invariants", [PY, "tests/check_invariants.py"], True),
    ("launcher unit tests", [PY, "-m", "unittest", "discover", "-s", "tests", "-p", "test_*.py"], True),
    (f"viewer unit tests ({len(JS_TESTS)} files)", ["node", "--test", *JS_TESTS], False),
]


def main() -> int:
    ap = argparse.ArgumentParser(description="Run every automated check")
    ap.add_argument("--mutations", action="store_true",
                    help="also run tests/mutation_check.py (proves the checks can fail)")
    args = ap.parse_args()

    stages = list(STAGES)
    if args.mutations:
        stages.append(("mutation checks", [PY, "tests/mutation_check.py"], True))

    failed, skipped = [], []
    for name, cmd, required in stages:
        if shutil.which(cmd[0]) is None and cmd[0] != PY:
            # node is only needed for the geometry tests. Say so loudly rather
            # than reporting a green run that never exercised the maths.
            print(f"SKIP  {name}  ({cmd[0]} not found)")
            skipped.append(name)
            if required:
                failed.append(name)
            continue
        r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
        if r.returncode == 0:
            print(f"ok    {name}")
        else:
            print(f"FAIL  {name}")
            out = (r.stdout + r.stderr).strip()
            print("      " + out.replace("\n", "\n      ")[:4000])
            failed.append(name)

    print()
    if failed:
        print(f"FAILED: {', '.join(failed)}")
        return 1
    if skipped:
        print(f"passed, but SKIPPED: {', '.join(skipped)} -- the geometry maths was not checked")
        return 0
    print("all checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
