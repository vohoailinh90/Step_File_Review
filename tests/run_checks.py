#!/usr/bin/env python3
"""run_checks.py -- everything a contributor (or an agent) must run before claiming done.

    python tests/run_checks.py             invariants + unit tests + geometry
    python tests/run_checks.py --mutations also prove the checks can fail (slower)

Exit status is the contract -- automation and agents read it, not the text:

    0  every stage ran and passed: verified as far as this repo can verify
    1  a stage ran and failed
    2  a stage could not run (e.g. no `node`), so what it covers is unchecked

Exit 0 still does not mean the change was *reviewed* -- see CLAUDE.md.
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

# Every stage is required. There used to be an "optional" flag, set on the node
# stage, and a missing node produced exit 0 with a note that the geometry maths
# had not been checked -- a green result for an unverified change. Codex review
# round 7 on PR #1 found it. The text admitted the gap; the exit status hid it,
# and automation and agents read the exit status.
STAGES = [
    ("build fidelity", [PY, "build.py", "--check"]),
    ("repo + product invariants", [PY, "tests/check_invariants.py"]),
    ("launcher unit tests", [PY, "-m", "unittest", "discover", "-s", "tests", "-p", "test_*.py"]),
    (f"viewer unit tests ({len(JS_TESTS)} files)", ["node", "--test", *JS_TESTS]),
]

# The exit status IS the contract.
EXIT_OK = 0        # every stage ran, and every stage passed
EXIT_FAILED = 1    # a stage ran and failed
EXIT_NOT_RUN = 2   # a stage could not run -- nothing is known about what it covers


def verdict(results) -> int:
    """Exit status for [(stage, status)], status in {"ok", "fail", "not-run"}.

    A failure outranks a stage that could not run: both mean "not verified", but a
    failure is the more specific news. Neither is ever EXIT_OK.
    """
    statuses = {status for _, status in results}
    if "fail" in statuses:
        return EXIT_FAILED
    if "not-run" in statuses:
        return EXIT_NOT_RUN
    return EXIT_OK


def main() -> int:
    ap = argparse.ArgumentParser(description="Run every automated check")
    ap.add_argument("--mutations", action="store_true",
                    help="also run tests/mutation_check.py (proves the checks can fail)")
    args = ap.parse_args()

    stages = list(STAGES)
    if args.mutations:
        stages.append(("mutation checks", [PY, "tests/mutation_check.py"]))

    results = []
    for name, cmd in stages:
        if cmd[0] != PY and shutil.which(cmd[0]) is None:
            print(f"NOT RUN  {name}  ({cmd[0]} not found)")
            results.append((name, "not-run"))
            continue
        r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
        if r.returncode == 0:
            print(f"ok       {name}")
            results.append((name, "ok"))
        else:
            print(f"FAIL     {name}")
            out = (r.stdout + r.stderr).strip()
            print("         " + out.replace("\n", "\n         ")[:4000])
            results.append((name, "fail"))

    code = verdict(results)
    print()
    if code == EXIT_FAILED:
        print("FAILED: " + ", ".join(n for n, st in results if st == "fail"))
    elif code == EXIT_NOT_RUN:
        missing = ", ".join(n for n, st in results if st == "not-run")
        print(f"NOT VERIFIED: {missing} could not run, so nothing it covers was checked.")
        print("Install what it needs (the viewer tests need Node 18+) and run again.")
    else:
        print("all checks passed")
    return code


if __name__ == "__main__":
    raise SystemExit(main())
