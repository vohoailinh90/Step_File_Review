#!/usr/bin/env python3
"""Unit tests for stepview.py (the launcher).

    python -m unittest discover -s tests -v

Stdlib unittest only -- this project ships with one pip dependency and adding a
test framework to it would be a worse trade than writing a few more lines here.

`cascadio` is NOT required: every test that would tessellate stubs _tessellate.
That keeps the suite runnable on a machine with no CAD engine installed, which
is also what CI has.

Weighting follows CLAUDE.md: Windows is the platform this tool is run on, so the
filename, path-length and encoding cases are Windows cases.
"""
import contextlib
import hashlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.request
from pathlib import Path, PureWindowsPath
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import stepview  # noqa: E402

# Characters Win32 forbids in a filename, plus the reserved device names.
WIN_ILLEGAL = set('<>:"/\\|?*')
WIN_RESERVED = {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)),
                *(f"LPT{i}" for i in range(1, 10))}


class TempCache(unittest.TestCase):
    """Redirects CACHE_DIR so no test touches the developer's real cache."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self._real_cache = stepview.CACHE_DIR
        stepview.CACHE_DIR = Path(self._tmp.name) / "cache"
        self._real_tess = stepview._tessellate
        self.tess_calls = []

        def fake_tessellate(src, out, tol, label=None):
            self.tess_calls.append((Path(src).name, Path(out).name, tol, label))
            Path(out).write_bytes(b"glTF\x02\x00\x00\x00stub")
        stepview._tessellate = fake_tessellate

    def tearDown(self):
        stepview.CACHE_DIR = self._real_cache
        stepview._tessellate = self._real_tess
        self._tmp.cleanup()

    def write_step(self, name="part.step", body=b"ISO-10303-21;\nHEADER;\n"):
        p = Path(self._tmp.name) / name
        p.write_bytes(body)
        return p


class QualityPresets(unittest.TestCase):
    def test_three_presets_exist(self):
        self.assertEqual(set(stepview.QUALITY), {"fine", "normal", "coarse"})

    def test_tolerances_are_ordered_fine_to_coarse(self):
        fine, normal, coarse = (stepview.QUALITY[k] for k in ("fine", "normal", "coarse"))
        for i, axis in enumerate(("linear", "angular")):
            self.assertLess(fine[i], normal[i], f"fine must be tighter than normal ({axis})")
            self.assertLess(normal[i], coarse[i], f"normal must be tighter than coarse ({axis})")

    def test_tolerances_are_positive(self):
        for name, tol in stepview.QUALITY.items():
            self.assertTrue(all(v > 0 for v in tol), f"{name} has a non-positive tolerance")

    def test_step_extensions_are_lowercase_dotted(self):
        self.assertEqual(stepview.STEP_EXT, {".step", ".stp"})
        for ext in stepview.STEP_EXT:
            self.assertEqual(ext, ext.lower())
            self.assertTrue(ext.startswith("."))

    def test_upload_guard_is_two_gigabytes(self):
        self.assertEqual(stepview.MAX_UPLOAD, 2 * 1024 ** 3)


class ConvertFromDisk(TempCache):
    def test_first_call_tessellates_and_caches(self):
        src = self.write_step()
        out = stepview.convert(src, stepview.QUALITY["normal"], quality="normal")
        self.assertTrue(out.exists())
        self.assertEqual(len(self.tess_calls), 1)
        self.assertTrue(out.name.startswith("part_normal_"))
        self.assertTrue(out.name.endswith(".glb"))

    def test_second_call_is_a_cache_hit(self):
        src = self.write_step()
        a = stepview.convert(src, stepview.QUALITY["normal"], quality="normal")
        b = stepview.convert(src, stepview.QUALITY["normal"], quality="normal")
        self.assertEqual(a, b)
        self.assertEqual(len(self.tess_calls), 1, "cache hit must not re-tessellate")

    def test_force_reconverts_the_same_key(self):
        src = self.write_step()
        a = stepview.convert(src, stepview.QUALITY["normal"], quality="normal")
        b = stepview.convert(src, stepview.QUALITY["normal"], force=True, quality="normal")
        self.assertEqual(a, b, "force must reuse the key, not invent a new one")
        self.assertEqual(len(self.tess_calls), 2)

    def test_quality_is_part_of_the_cache_key(self):
        src = self.write_step()
        fine = stepview.convert(src, stepview.QUALITY["fine"], quality="fine")
        coarse = stepview.convert(src, stepview.QUALITY["coarse"], quality="coarse")
        self.assertNotEqual(fine, coarse, "two qualities must not share a cache entry")
        self.assertEqual(len(self.tess_calls), 2)

    def test_editing_the_file_invalidates_the_cache(self):
        src = self.write_step()
        first = stepview.convert(src, stepview.QUALITY["normal"], quality="normal")
        # a real edit changes both size and mtime; both are in the key
        src.write_bytes(b"ISO-10303-21;\nHEADER;\nCHANGED;\n")
        second = stepview.convert(src, stepview.QUALITY["normal"], quality="normal")
        self.assertNotEqual(first, second, "an edited STEP file must reconvert")

    def test_cache_directory_is_created_on_demand(self):
        self.assertFalse(stepview.CACHE_DIR.exists())
        stepview.convert(self.write_step(), stepview.QUALITY["normal"], quality="normal")
        self.assertTrue(stepview.CACHE_DIR.is_dir())


class ConvertFromUpload(TempCache):
    def test_keyed_by_content_not_by_name(self):
        data = b"ISO-10303-21;\nBODY;\n"
        a = stepview.convert_bytes(data, "left.step", "normal")
        b = stepview.convert_bytes(data, "left.step", "normal")
        self.assertEqual(a, b)
        self.assertEqual(len(self.tess_calls), 1, "identical content must hit the cache")

    def test_different_content_gets_a_different_entry(self):
        a = stepview.convert_bytes(b"AAAA", "x.step", "normal")
        b = stepview.convert_bytes(b"BBBB", "x.step", "normal")
        self.assertNotEqual(a, b)

    def test_content_digest_appears_in_the_filename(self):
        data = b"ISO-10303-21;\n"
        out = stepview.convert_bytes(data, "hub.step", "normal")
        self.assertIn(hashlib.sha1(data).hexdigest()[:16], out.name)

    def test_unknown_quality_falls_back_to_normal(self):
        stepview.convert_bytes(b"AAAA", "x.step", "banana")
        self.assertEqual(self.tess_calls[0][2], stepview.QUALITY["normal"])

    def test_blank_name_becomes_model(self):
        out = stepview.convert_bytes(b"AAAA", "", "normal")
        self.assertTrue(out.name.startswith("model_"), out.name)

    def test_long_name_is_truncated(self):
        out = stepview.convert_bytes(b"AAAA", "x" * 300 + ".step", "normal")
        stem = out.name.split("_normal_")[0]
        self.assertLessEqual(len(stem), 40, "stem must be capped to keep paths short")

    def test_temp_file_is_removed_after_conversion(self):
        before = set(Path(tempfile.gettempdir()).glob("*.step"))
        stepview.convert_bytes(b"AAAA", "leak.step", "normal")
        self.assertEqual(set(Path(tempfile.gettempdir()).glob("*.step")) - before, set(),
                         "the uploaded temp file must not be left behind")


class WindowsFilenameSafety(TempCache):
    """CLAUDE.md: Windows is the platform this runs on. Cache names must be legal there."""

    def test_cache_name_has_no_windows_illegal_characters(self):
        """A PDM-style upload name must not reach the cache path unsanitised.

        convert_bytes() builds the cache filename from the browser's X-Filename
        header. A STEP exported from a PDM system commonly carries a revision
        separator, e.g. "HOUSING:REV-B.step", and that colon survives
        Path().stem on Windows as well as POSIX. Before safe_stem() it reached
        the cache path and Win32 rejected the write with a bare OSError.
        """
        for hostile in ['HOUSING:REV-B.step', 'q?.step', 'star*.step',
                        'pipe|x.step', 'lt<gt>.step', 'quote".step',
                        'a/b.step', 'a\\b.step', '\x01ctrl.step']:
            out = stepview.convert_bytes(b"AAAA" + hostile.encode(), hostile, "normal")
            bad = WIN_ILLEGAL & set(out.name)
            self.assertFalse(bad, f"{hostile!r} produced cache name {out.name!r} with {bad}")
            self.assertFalse(any(ord(c) < 32 for c in out.name),
                             f"{hostile!r} left a control character in {out.name!r}")

    def test_sanitising_does_not_move_an_ordinary_cache_entry(self):
        """The fix must not invalidate the cache for names that were always legal.

        Every existing user has a warm cache keyed on the old naming. If
        safe_stem() altered an ordinary stem, their next open would reconvert --
        for a large assembly that is the one cost this tool exists to avoid.
        """
        for ordinary in ["assembly.step", "HOUSING-REV-B.step", "part_01.stp",
                         "Bracket (rev 2).step", "hub.v3.step", "ĐỘNG-CƠ.step"]:
            self.assertEqual(stepview.safe_stem(ordinary), Path(ordinary).stem[:40],
                             f"{ordinary!r} must keep its original stem")

    def test_safe_stem_replaces_every_illegal_character(self):
        # Multi-character prefix on purpose. On Windows a SINGLE letter followed
        # by ':' is a drive designator, so pathlib consumes "a:" before the regex
        # can run and "a:b.step" yields "b". Any longer prefix keeps the colon,
        # which is the real PDM case ("HOUSING:REV-B.step"). The drive form is
        # pinned separately below.
        for ch in '<>:"|?*':
            self.assertEqual(stepview.safe_stem(f"revA{ch}B.step"), "revA_B",
                             f"{ch!r} must be replaced")
        self.assertEqual(stepview.safe_stem("revA\x00B.step"), "revA_B", "NUL must be replaced")
        self.assertEqual(stepview.safe_stem("revA\x1fB.step"), "revA_B", "C0 range must be replaced")

    def test_a_drive_designator_is_dropped_rather_than_sanitised(self):
        """Windows parses "a:" as a drive; POSIX does not. Both outcomes are safe.

        Found by CI on windows-latest -- not by a local run and not by review,
        both of which were on Linux. On POSIX "a:b.step" keeps the colon and
        sanitises to "a_b"; on Windows pathlib strips the drive and the stem is
        already "b". The property that matters is the same on both: the result
        is a single legal component that stays inside the cache directory. This
        asserts that property rather than one platform's string.
        """
        for hostile in ["a:b.step", "C:x.step", "Z:evil.step"]:
            stem = stepview.safe_stem(hostile)
            self.assertTrue(stem, f"{hostile!r} produced an empty stem")
            self.assertFalse(WIN_ILLEGAL & set(stem),
                             f"{hostile!r} left an illegal character in {stem!r}")
            out = stepview.convert_bytes(b"AAAA" + hostile.encode(), hostile, "normal")
            self.assertEqual(out.parent, stepview.CACHE_DIR,
                             f"{hostile!r} escaped the cache directory")

    def test_safe_stem_falls_back_to_model_when_nothing_is_left(self):
        for empty in ["", ".step", "/", "///"]:
            self.assertTrue(stepview.safe_stem(empty),
                            f"{empty!r} must not produce an empty stem")
        self.assertEqual(stepview.safe_stem(""), "model")
        self.assertEqual(stepview.safe_stem("/"), "model")

    def test_safe_stem_is_idempotent(self):
        # Sanitising an already-sanitised name must not keep changing it, or a
        # cache entry could migrate on every open.
        for name in ['HOUSING:REV-B.step', 'q?.step', 'part.step', '']:
            once = stepview.safe_stem(name)
            self.assertEqual(stepview.safe_stem(once), once, f"{name!r} is not stable")

    def test_safe_stem_honours_the_length_limit(self):
        self.assertEqual(len(stepview.safe_stem("x" * 300 + ".step")), 40)
        self.assertEqual(len(stepview.safe_stem(":" * 300 + ".step")), 40,
                         "replacement must happen before truncation, not after")

    def test_path_separators_in_an_upload_name_are_stripped(self):
        # Path(name).stem already drops directory parts, so a traversal attempt
        # in X-Filename cannot escape the cache directory. Worth pinning.
        for hostile in ["../../evil.step", "a/b.step", "/etc/passwd.step"]:
            out = stepview.convert_bytes(b"AAAA" + hostile.encode(), hostile, "normal")
            self.assertEqual(out.parent, stepview.CACHE_DIR,
                             f"{hostile!r} escaped the cache directory")
            self.assertNotIn("/", out.name)
            self.assertNotIn("\\", out.name)

    def test_cache_name_is_not_a_reserved_device_name(self):
        # Win32 reserves a name only when the stem IS the device name ("CON",
        # "CON.glb"). The quality and hash suffix mean "CON.step" becomes
        # "CON_normal_<hash>.glb", whose stem is not a device name -- legal.
        for hostile in ["CON.step", "nul.step", "COM1.step", "LPT9.step"]:
            out = stepview.convert_bytes(b"AAAA" + hostile.encode(), hostile, "normal")
            self.assertNotIn(Path(out.name).stem.upper(), WIN_RESERVED,
                             f"{hostile!r} produced reserved name {out.name!r}")

    def test_cache_path_stays_well_under_max_path(self):
        # Win32 MAX_PATH is 260. The cache sits under the user profile, so budget
        # generously for a long profile name and still require slack.
        out = stepview.convert_bytes(b"AAAA", "x" * 300 + ".step", "normal")
        self.assertLess(len(out.name), 120, f"cache filename too long: {out.name!r}")


class WindowsPathSemantics(unittest.TestCase):
    """Run safe_stem() under Windows path parsing, whatever platform this is.

    CI on windows-latest caught a divergence that every local run and every
    review missed, because all of them were on Linux: pathlib reads a single
    letter followed by ':' as a drive, so "a:b.step" has stem "b" there and
    "a:b" here. pathlib can be forced into its Windows flavour anywhere, so that
    class of bug does not actually need a Windows box to find -- only the
    discipline of asking for it. These tests make the asking automatic.

    Only safe_stem() is exercised under the patch. convert_bytes() also calls
    .unlink() on a temp path, which a Pure path cannot do.
    """

    def setUp(self):
        self._real_path = stepview.Path
        stepview.Path = PureWindowsPath

    def tearDown(self):
        stepview.Path = self._real_path

    def test_illegal_characters_are_replaced_under_windows_parsing(self):
        for ch in '<>:"|?*':
            self.assertEqual(stepview.safe_stem(f"revA{ch}B.step"), "revA_B",
                             f"{ch!r} must be replaced under Windows parsing")

    def test_the_real_pdm_name_survives_as_a_legal_stem(self):
        self.assertEqual(stepview.safe_stem("HOUSING:REV-B.step"), "HOUSING_REV-B")

    def test_a_drive_letter_is_consumed_by_pathlib(self):
        # Documented divergence, not a defect: the drive is stripped, and what
        # remains is a single legal component.
        for hostile, expected in [("a:b.step", "b"), ("C:x.step", "x"),
                                  ("Z:evil.step", "evil")]:
            self.assertEqual(stepview.safe_stem(hostile), expected)

    def test_windows_separators_are_consumed_not_escaped(self):
        for hostile in [r"..\..\evil.step", r"C:\Windows\System32\evil.step",
                        r"\\server\share\x.step", r"a\b.step"]:
            stem = stepview.safe_stem(hostile)
            self.assertTrue(stem, f"{hostile!r} produced an empty stem")
            self.assertFalse(WIN_ILLEGAL & set(stem),
                             f"{hostile!r} left an illegal character in {stem!r}")
            self.assertNotIn("..", stem, f"{hostile!r} kept a traversal fragment")

    def test_every_illegal_character_class_is_covered_under_windows(self):
        for name in ['q?.step', 'star*.step', 'pipe|x.step', 'lt<gt>.step',
                     'quote".step', '\x01ctrl.step', 'REV:A.step']:
            stem = stepview.safe_stem(name)
            self.assertFalse(WIN_ILLEGAL & set(stem), f"{name!r} -> {stem!r}")
            self.assertFalse(any(ord(c) < 32 for c in stem), f"{name!r} -> {stem!r}")


class EngineCheck(unittest.TestCase):
    def test_non_fatal_check_returns_a_bool_and_never_raises(self):
        self.assertIsInstance(stepview.check_engine(fatal=False), bool)

    def test_failure_message_names_this_interpreter(self):
        if stepview.check_engine(fatal=False):
            self.skipTest("cascadio is installed; the failure path cannot be observed")
        import contextlib
        import io
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            stepview.check_engine(fatal=False)
        msg = buf.getvalue()
        self.assertIn(sys.executable, msg, "must name the exact interpreter to fix")
        self.assertIn(f'"{sys.executable}" -m pip install', msg)
        self.assertIn("proxy", msg.lower(), "corporate-proxy hint must survive")


class EngineDiagnosis(unittest.TestCase):
    """An ImportError is not proof the engine is missing.

    cascadio 0.1.1 imports numpy when it loads but does not declare it, so on a
    clean Python `pip install cascadio` succeeds and `import cascadio` then fails
    with "No module named 'numpy'". check_engine called every ImportError "not
    installed" and prescribed the install that had just succeeded. Found by the
    CI engine job on PR #1, the first time `--check` could fail.
    """

    def test_only_cascadio_itself_missing_means_not_installed(self):
        what, fix = stepview.diagnose_engine(
            ModuleNotFoundError("No module named 'cascadio'", name="cascadio"))
        self.assertIn("is not installed", what)
        self.assertEqual(fix.split(), list(stepview.ENGINE_PACKAGES))

    def test_a_missing_dependency_is_named_and_is_what_gets_installed(self):
        what, fix = stepview.diagnose_engine(
            ModuleNotFoundError("No module named 'numpy'", name="numpy"))
        self.assertIn("is installed but cannot load", what)
        self.assertIn("'numpy'", what)
        self.assertEqual(fix, "numpy")

    def test_a_broken_dependency_is_reinstalled_not_installed(self):
        # `numpy._core` can only go missing once `numpy` itself imported: numpy
        # is installed and damaged, and `pip install numpy` would be a no-op.
        what, fix = stepview.diagnose_engine(
            ModuleNotFoundError("No module named 'numpy._core'", name="numpy._core"))
        self.assertIn("is installed but failed to load", what)
        self.assertIn("numpy._core", what)
        self.assertEqual(fix, "--force-reinstall numpy")

    def test_a_missing_part_of_cascadio_is_a_broken_install(self):
        what, fix = stepview.diagnose_engine(
            ModuleNotFoundError("No module named 'cascadio._core'", name="cascadio._core"))
        self.assertIn("is installed but failed to load", what)
        self.assertEqual(fix.split(), ["--force-reinstall", *stepview.ENGINE_PACKAGES])

    def test_a_dll_load_failure_is_reported_verbatim(self):
        err = ImportError("DLL load failed while importing _core: "
                          "The specified module could not be found.")
        what, fix = stepview.diagnose_engine(err)
        self.assertIn(str(err), what)
        self.assertEqual(fix.split(), ["--force-reinstall", *stepview.ENGINE_PACKAGES])

    def test_a_dropped_file_gets_the_same_diagnosis_as_check(self):
        # A STEP file dropped on the page converts through _tessellate, and its
        # error is what the page shows -- it must not fall back to "not installed".
        with tempfile.TemporaryDirectory() as d:
            Path(d, "cascadio").mkdir()
            Path(d, "cascadio", "__init__.py").write_text("import quickstep_absent_dependency\n")
            with mock.patch.dict(sys.modules), mock.patch.object(sys, "path", [d, *sys.path]):
                sys.modules.pop("cascadio", None)
                with self.assertRaises(RuntimeError) as cm:
                    stepview._tessellate(Path(d, "a.step"), Path(d, "a.glb"),
                                         stepview.QUALITY["normal"])
        self.assertIn("needs the module 'quickstep_absent_dependency'", str(cm.exception))
        self.assertIn(f'"{sys.executable}" -m pip install quickstep_absent_dependency',
                      str(cm.exception))


class EngineCheckEndToEnd(unittest.TestCase):
    """`stepview.py --check` against a cascadio that installs but cannot load.

    The CI engine job's case, run the way a user runs it: a real interpreter, a
    real import, the real exit status. The stand-in cascadio imports a module
    that does not exist, as cascadio 0.1.1 imports numpy on a clean Python.
    """

    def test_an_undeclared_dependency_is_named_and_fails_the_check(self):
        with tempfile.TemporaryDirectory() as d:
            pkg = Path(d, "cascadio")
            pkg.mkdir()
            (pkg / "__init__.py").write_text("import quickstep_absent_dependency\n")
            r = subprocess.run([sys.executable, str(Path(stepview.__file__).resolve()), "--check"],
                               env=dict(os.environ, PYTHONPATH=d),
                               capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn("needs the module 'quickstep_absent_dependency'", r.stdout)
        self.assertIn("-m pip install quickstep_absent_dependency", r.stdout)
        self.assertNotIn("is not installed for this Python", r.stdout)


class EngineReportEncoding(unittest.TestCase):
    """The engine report must survive the stream it is printed to.

    Windows words a DLL-load failure in the UI language, and redirected stdout is
    strictly encoded in the locale's ANSI code page -- cp1252, cp1258, cp932.
    """

    def report(self, encoding, detail):
        raw = io.BytesIO()
        out = io.TextIOWrapper(raw, encoding=encoding, errors="strict")
        diagnosis = stepview.diagnose_engine(
            ImportError("DLL load failed while importing _core: " + detail))
        with mock.patch.object(stepview, "engine_problem", return_value=diagnosis):
            with contextlib.redirect_stdout(out):
                self.assertFalse(stepview.check_engine(fatal=False))
        out.flush()
        return raw.getvalue()

    def test_a_localised_error_cannot_crash_a_code_page_stream(self):
        # U+6307 U+5B9A, Japanese: nothing in cp1252 can encode them.
        report = self.report("cp1252", chr(0x6307) + chr(0x5B9A))
        self.assertIn(b"DLL load failed while importing _core", report)

    def test_a_stream_that_can_show_the_text_shows_it_as_is(self):
        # U+1EC5, Vietnamese -- the kind of letter in a user name, and so in the
        # interpreter path the fix command has to name exactly.
        text = "Nguy" + chr(0x1EC5) + "n"
        self.assertIn(text.encode("utf-8"), self.report("utf-8", text))


class CheckCommandExitStatus(unittest.TestCase):
    """`stepview.py --check` must be able to fail.

    It used to print "STEP conversion unavailable." and exit 0, so the CI job that
    exists to confirm the engine imports could never go red -- a cascadio that
    installs but cannot load (a Windows DLL-load failure, say) passed. Codex review
    round 7 on PR #1. check_engine is stubbed so both branches run everywhere,
    whether or not cascadio is installed here.
    """

    def setUp(self):
        # Never the real ~/.stepview_cache or the real viewer.html: every
        # prerequisite is a stand-in the test controls.
        self.tmp = Path(tempfile.mkdtemp())
        self.viewer = self.tmp / "viewer.html"
        self.viewer.write_text("<!DOCTYPE html>", encoding="utf-8")
        self.cache = self.tmp / ".stepview_cache"

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def run_check(self, engine_ok, viewer=None, cache=None):
        saved = (stepview.check_engine, stepview.VIEWER, stepview.CACHE_DIR, sys.argv)
        stepview.check_engine = lambda fatal=True: engine_ok
        stepview.VIEWER = viewer or self.viewer
        stepview.CACHE_DIR = cache or self.cache
        sys.argv = ["stepview.py", "--check"]
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                stepview.main()
            return 0
        except SystemExit as e:
            return e.code
        finally:
            stepview.check_engine, stepview.VIEWER, stepview.CACHE_DIR, sys.argv = saved

    def test_a_missing_engine_exits_nonzero(self):
        self.assertNotEqual(self.run_check(False), 0, "--check reported success without an engine")

    def test_a_working_setup_exits_zero(self):
        self.assertIn(self.run_check(True), (0, None))

    def test_a_missing_viewer_exits_nonzero(self):
        # Codex review round 9: "viewer.html present: False", then "Setup OK", exit 0.
        code = self.run_check(True, viewer=self.tmp / "nowhere" / "viewer.html")
        self.assertNotEqual(code, 0, "--check reported success without viewer.html")

    def test_an_unwritable_cache_exits_nonzero(self):
        # A file where the cache folder belongs: every launch that converts dies.
        blocker = self.tmp / "cache-is-a-file"
        blocker.write_text("x", encoding="utf-8")
        self.assertNotEqual(self.run_check(True, cache=blocker), 0,
                            "--check reported success with no usable cache folder")

    def test_the_check_creates_the_cache_folder_a_launch_would(self):
        self.assertIn(self.run_check(True), (0, None))
        self.assertTrue(self.cache.is_dir())


class HttpSurface(unittest.TestCase):
    """The server is part of the product contract: loopback only, three routes."""

    @classmethod
    def setUpClass(cls):
        import http.server
        import socket
        cls.viewer = Path(tempfile.mkdtemp()) / "viewer.html"
        cls.viewer.write_bytes(b"<!DOCTYPE html><title>stub</title>")
        stepview.Handler.routes = {"/": (cls.viewer, "text/html; charset=utf-8")}
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            cls.port = s.getsockname()[1]
        cls.httpd = http.server.ThreadingHTTPServer(("127.0.0.1", cls.port), stepview.Handler)
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()

    def url(self, path):
        return f"http://127.0.0.1:{self.port}{path}"

    def status(self, problem):
        with mock.patch.object(stepview, "engine_problem", return_value=problem):
            with urllib.request.urlopen(self.url("/status"), timeout=5) as r:
                return json.loads(r.read())

    def test_status_reports_a_working_engine_and_the_interpreter(self):
        self.assertEqual(self.status(None), {"engine": True, "python": sys.executable})

    def test_status_says_why_the_engine_cannot_load_and_how_to_fix_it(self):
        body = self.status(("cascadio is installed but cannot load.", "numpy"))
        self.assertEqual(body, {
            "engine": False, "python": sys.executable,
            "problem": "cascadio is installed but cannot load.",
            "fix": f'"{sys.executable}" -m pip install numpy',
        })

    def test_root_serves_the_viewer(self):
        with urllib.request.urlopen(self.url("/"), timeout=5) as r:
            self.assertEqual(r.status, 200)
            self.assertIn("text/html", r.headers["Content-Type"])
            self.assertIn(b"<!DOCTYPE html>", r.read())

    def test_unknown_path_is_a_json_404(self):
        with self.assertRaises(urllib.error.HTTPError) as cm:
            urllib.request.urlopen(self.url("/etc/passwd"), timeout=5)
        self.assertEqual(cm.exception.code, 404)
        self.assertEqual(json.loads(cm.exception.read()), {"error": "Not found"})

    def test_query_string_does_not_defeat_route_matching(self):
        with urllib.request.urlopen(self.url("/?model=/model.glb&name=a.step"), timeout=5) as r:
            self.assertEqual(r.status, 200)

    def test_convert_rejects_an_empty_body(self):
        req = urllib.request.Request(self.url("/convert"), data=b"", method="POST")
        with self.assertRaises(urllib.error.HTTPError) as cm:
            urllib.request.urlopen(req, timeout=5)
        self.assertEqual(cm.exception.code, 400)

    def test_convert_rejects_an_oversized_declaration(self):
        req = urllib.request.Request(self.url("/convert"), data=b"x", method="POST")
        req.add_header("Content-Length", str(stepview.MAX_UPLOAD + 1))
        with self.assertRaises(urllib.error.HTTPError) as cm:
            urllib.request.urlopen(req, timeout=5)
        self.assertEqual(cm.exception.code, 413, "the 2 GB guard must reject before reading")

    def test_get_on_convert_is_404(self):
        with self.assertRaises(urllib.error.HTTPError) as cm:
            urllib.request.urlopen(self.url("/convert"), timeout=5)
        self.assertEqual(cm.exception.code, 404)


if __name__ == "__main__":
    unittest.main(verbosity=2)
