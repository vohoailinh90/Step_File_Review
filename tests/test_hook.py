#!/usr/bin/env python3
"""Tests for .claude/hooks/no_direct_viewer_edit.py.

    python -m unittest discover -s tests -p "test_*.py"

The hook is the one guardrail here that runs on a contributor's machine rather
than in CI, and until this file it had no tests -- it was checked by hand once.
Codex review round 6 then prompted a change that the hook quietly blocked: the
vendor-upgrade procedure requires editing vendor/URLS, which the hook denied.
"""
import json
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HOOK = ROOT / ".claude" / "hooks" / "no_direct_viewer_edit.py"
sys.path.insert(0, str(HOOK.parent))
import no_direct_viewer_edit as hook  # noqa: E402


def run_hook(stdin: str):
    """Run the hook exactly as Claude Code does: payload on stdin, JSON on stdout."""
    r = subprocess.run([sys.executable, str(HOOK)], input=stdin,
                       capture_output=True, text=True, timeout=10)
    return r.returncode, r.stdout.strip()


def denied(path: str) -> bool:
    return hook.decide(path) is not None


class GeneratedFileIsProtected(unittest.TestCase):
    def test_viewer_html_is_denied(self):
        self.assertTrue(denied("viewer.html"))
        self.assertTrue(denied("/abs/repo/viewer.html"))

    def test_case_variants_are_denied_for_windows_and_macos(self):
        for p in ("Viewer.html", "VIEWER.HTML", "viewer.HTML"):
            self.assertTrue(denied(p), f"{p} names the same file on a case-insensitive disk")

    def test_the_denial_explains_where_to_edit_instead(self):
        reason = hook.decide("viewer.html")
        self.assertIn("src/app", reason)
        self.assertIn("build.py", reason)


class VendorIsProtectedButUpgradable(unittest.TestCase):
    def test_vendored_libraries_are_denied(self):
        for p in ("vendor/three.min.js", "vendor/GLTFLoader.js", "VENDOR/STLLoader.js"):
            self.assertTrue(denied(p), p)

    def test_the_two_upgrade_metadata_files_are_allowed(self):
        # An upgrade must refresh SHA256SUMS and record new URLs in URLS; denying
        # either makes the documented procedure impossible to follow.
        for p in ("vendor/SHA256SUMS", "vendor/URLS", "vendor/urls", "VENDOR/Sha256Sums"):
            self.assertFalse(denied(p), f"{p} must stay editable for a vendor upgrade")

    def test_a_metadata_name_outside_vendor_is_not_special(self):
        self.assertFalse(denied("docs/URLS"))


class EverythingElseIsAllowed(unittest.TestCase):
    def test_sources_are_allowed(self):
        for p in ("src/app/40-geometry.js", "src/ui/viewer.css", "stepview.py",
                  "build.py", "tests/check_invariants.py", "CLAUDE.md"):
            self.assertFalse(denied(p), p)

    def test_a_file_merely_named_like_vendor_is_allowed(self):
        self.assertFalse(denied("src/app/vendor-notes.js"))


class ProcessProtocol(unittest.TestCase):
    def test_a_denial_is_a_json_permission_decision(self):
        rc, out = run_hook(json.dumps({"tool_input": {"file_path": "viewer.html"}}))
        self.assertEqual(rc, 0, "the hook exits 0; the decision is in the JSON")
        decision = json.loads(out)["hookSpecificOutput"]
        self.assertEqual(decision["hookEventName"], "PreToolUse")
        self.assertEqual(decision["permissionDecision"], "deny")

    def test_an_allowed_path_produces_no_output(self):
        rc, out = run_hook(json.dumps({"tool_input": {"file_path": "src/app/00-scene.js"}}))
        self.assertEqual((rc, out), (0, ""))

    def test_a_malformed_payload_fails_open(self):
        # A crashed hook must never block legitimate work.
        for bad in ("not json", "", "{}", '{"tool_input": null}'):
            rc, out = run_hook(bad)
            self.assertEqual((rc, out), (0, ""), f"payload {bad!r} should allow")


if __name__ == "__main__":
    unittest.main(verbosity=2)
