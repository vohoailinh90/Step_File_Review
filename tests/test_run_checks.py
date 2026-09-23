#!/usr/bin/env python3
"""Tests for tests/run_checks.py -- specifically, that its exit status tells the truth.

    python -m unittest discover -s tests -p "test_*.py"

run_checks.py's exit status is what CI, scripts and agents act on. Codex review
round 7 on PR #1 found it returning 0 when node was missing -- the viewer suites
never ran, the output admitted it, and the exit status said "verified".

These tests replace STAGES with tiny stand-in commands rather than running the
real ones. The real stages include `unittest discover`, which would run this file
again: running the real thing from here would recurse.
"""
import contextlib
import io
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import run_checks as rc  # noqa: E402

PY = sys.executable
OK = [PY, "-c", "pass"]
FAILS = [PY, "-c", "raise SystemExit(3)"]
MISSING = ["definitely-not-an-installed-binary-7f3a", "--test"]


def run_with(stages, argv=()):
    real_stages, real_argv = rc.STAGES, sys.argv
    rc.STAGES, sys.argv = stages, ["run_checks.py", *argv]
    try:
        with contextlib.redirect_stdout(io.StringIO()) as out:
            code = rc.main()
        return code, out.getvalue()
    finally:
        rc.STAGES, sys.argv = real_stages, real_argv


class Verdict(unittest.TestCase):
    def test_all_ok_is_ok(self):
        self.assertEqual(rc.verdict([("a", "ok"), ("b", "ok")]), rc.EXIT_OK)

    def test_a_failure_is_failed(self):
        self.assertEqual(rc.verdict([("a", "ok"), ("b", "fail")]), rc.EXIT_FAILED)

    def test_a_stage_that_could_not_run_is_never_ok(self):
        self.assertEqual(rc.verdict([("a", "ok"), ("b", "not-run")]), rc.EXIT_NOT_RUN)
        self.assertNotEqual(rc.EXIT_NOT_RUN, rc.EXIT_OK)

    def test_failure_outranks_not_run(self):
        self.assertEqual(rc.verdict([("a", "not-run"), ("b", "fail")]), rc.EXIT_FAILED)

    def test_the_three_codes_are_distinct(self):
        self.assertEqual(len({rc.EXIT_OK, rc.EXIT_FAILED, rc.EXIT_NOT_RUN}), 3)


class MainReportsTheTruth(unittest.TestCase):
    def test_every_stage_passing_exits_zero(self):
        code, out = run_with([("one", OK), ("two", OK)])
        self.assertEqual(code, rc.EXIT_OK)
        self.assertIn("all checks passed", out)

    def test_a_missing_executable_is_not_a_pass(self):
        # The round-7 defect: this used to exit 0.
        code, out = run_with([("real stage", OK), ("viewer tests", MISSING)])
        self.assertEqual(code, rc.EXIT_NOT_RUN, "a stage that could not run was reported as success")
        self.assertIn("NOT VERIFIED", out)
        self.assertIn("viewer tests", out)

    def test_a_failing_stage_exits_failed(self):
        code, out = run_with([("good", OK), ("bad", FAILS)])
        self.assertEqual(code, rc.EXIT_FAILED)
        self.assertIn("FAILED: bad", out)

    def test_no_stage_can_be_marked_optional(self):
        # The old STAGES carried a third "required" field; False on the node stage
        # is what let a missing node pass. Every entry is now (name, command).
        for stage in rc.STAGES:
            self.assertEqual(len(stage), 2, f"{stage[0]!r} has an extra field -- optional stages are gone")


if __name__ == "__main__":
    unittest.main(verbosity=2)
