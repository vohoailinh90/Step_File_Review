#!/usr/bin/env python3
"""Safety tests for tests/mutation_check.py itself.

    python -m unittest discover -s tests -p "test_*.py"

The mutation harness edits the working tree on purpose, so its own guarantees --
that it reverts what it changes and never destroys what it did not create -- are
exactly the kind of property that must be tested rather than trusted. Codex
review round 4 on PR #1 found the first version of `create` overwriting and then
deleting a pre-existing file while reporting the mutation as "caught": a green
result produced by destroying a contributor's uncommitted work.

Every test here uses a check command that always fails, so a mutation that runs
to completion reports "caught" deterministically and no real suite is invoked.
"""
import os
import shutil
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import mutation_check as mc  # noqa: E402

ALWAYS_FAILS = [sys.executable, "-c", "raise SystemExit(1)"]
TEMPLATE = "src/viewer.template.html"
ANCHOR = "@@INCLUDE:src/ui/layout.html@@"


def entry(create=None, replace=ANCHOR):
    return dict(name="harness/self-test", behaviour="harness self-test",
                file=TEMPLATE, find=ANCHOR, replace=replace,
                create=create or {}, must_fail=ALWAYS_FAILS)


class CreateNeverDestroysExistingFiles(unittest.TestCase):
    def setUp(self):
        self.rel = f"src/ui/_harness_probe_{os.getpid()}.html"
        self.path = mc.ROOT / self.rel
        self.assertFalse(self.path.exists(), "test fixture path must start free")

    def tearDown(self):
        self.path.unlink(missing_ok=True)

    def test_a_pre_existing_file_survives_byte_for_byte(self):
        work = b"UNCOMMITTED WORK \xe2\x80\x94 do not lose this\r\n"
        self.path.write_bytes(work)
        status, detail = mc.apply_one(entry({self.rel: "fixture\n"}))
        self.assertEqual(status, "drift", "an occupied fixture path must block the mutation")
        self.assertIn(self.rel, detail, "the report must name the path it refused")
        self.assertEqual(self.path.read_bytes(), work, "the contributor's file was modified")

    def test_a_blocked_mutation_does_not_touch_the_target_either(self):
        self.path.write_bytes(b"work\n")
        target = mc.ROOT / TEMPLATE
        before = (target.read_bytes(), target.stat().st_mtime_ns)
        mc.apply_one(entry({self.rel: "fixture\n"}, replace=ANCHOR + "<!--x-->"))
        self.assertEqual((target.read_bytes(), target.stat().st_mtime_ns), before,
                         "a refused mutation must not write the target at all")

    def test_occupied_reports_only_paths_that_exist(self):
        self.path.write_bytes(b"x")
        free = f"src/ui/_harness_free_{os.getpid()}.html"
        self.assertEqual(mc.occupied(entry({self.rel: "a", free: "b"})), [self.rel])


class CreateCleansUpAfterItself(unittest.TestCase):
    def test_a_created_file_is_removed(self):
        rel = f"src/ui/_harness_probe_{os.getpid()}.html"
        status, _ = mc.apply_one(entry({rel: "fixture\n"}))
        self.assertEqual(status, "caught")
        self.assertFalse((mc.ROOT / rel).exists(), "created fixture was left behind")

    def test_created_directories_are_removed_deepest_first(self):
        top = mc.ROOT / f"src/ui/_harness_dir_{os.getpid()}"
        rel = f"src/ui/_harness_dir_{os.getpid()}/deeper/probe.html"
        try:
            status, _ = mc.apply_one(entry({rel: "fixture\n"}))
            self.assertEqual(status, "caught")
            self.assertFalse(top.exists(), "directories created for a fixture must be removed")
        finally:
            shutil.rmtree(top, ignore_errors=True)

    def test_a_pre_existing_directory_is_kept(self):
        # The fixture's parent already exists (src/ui/), so cleanup must not remove it.
        rel = f"src/ui/_harness_probe_{os.getpid()}.html"
        mc.apply_one(entry({rel: "fixture\n"}))
        self.assertTrue((mc.ROOT / "src/ui").is_dir(), "cleanup removed a directory it did not create")


class TargetIsRestored(unittest.TestCase):
    def test_the_mutated_file_is_restored_exactly(self):
        target = mc.ROOT / TEMPLATE
        before = target.read_bytes()
        status, _ = mc.apply_one(entry(replace=ANCHOR + "<!--mutated-->"))
        self.assertEqual(status, "caught")
        self.assertEqual(target.read_bytes(), before)

    def test_a_find_that_no_longer_matches_is_drift_not_a_pass(self):
        e = entry()
        e["find"] = "this string does not occur anywhere in the template"
        status, detail = mc.apply_one(e)
        self.assertEqual(status, "drift")
        self.assertIn("matched 0 times", detail)


if __name__ == "__main__":
    unittest.main(verbosity=2)
