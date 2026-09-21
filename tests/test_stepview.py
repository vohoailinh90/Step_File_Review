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
import hashlib
import json
import sys
import tempfile
import threading
import unittest
import urllib.request
from pathlib import Path

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

    @unittest.expectedFailure
    def test_cache_name_has_no_windows_illegal_characters(self):
        """KNOWN BUG on Windows -- convert_bytes does not sanitise the upload name.

        convert_bytes() builds the cache filename from `Path(name).stem[:40]`,
        where `name` is the X-Filename header the browser sent. A STEP exported
        from a PDM system commonly carries a revision separator, e.g.
        "HOUSING:REV-B.step". That colon reaches the cache path unchanged:

            C:\\Users\\<you>\\.stepview_cache\\HOUSING:REV-B_normal_<hash>.glb

        Win32 rejects ':' in a filename, so the drop fails with a raw OSError
        rather than the actionable message every other failure path in this file
        produces. POSIX accepts the colon, which is why it has gone unnoticed.

        Fix is one line in convert_bytes -- sanitise the stem before use:
            stem = re.sub(r'[<>:"/\\\\|?*\\x00-\\x1f]', '_', Path(name).stem)[:40] or "model"

        Left failing deliberately: this suite was added to surface defects, not
        to change viewer behaviour in the same commit. Remove this decorator in
        the commit that lands the fix.
        """
        for hostile in ['HOUSING:REV-B.step', 'q?.step', 'star*.step',
                        'pipe|x.step', 'lt<gt>.step', 'quote".step']:
            out = stepview.convert_bytes(b"AAAA" + hostile.encode(), hostile, "normal")
            bad = WIN_ILLEGAL & set(out.name)
            self.assertFalse(bad, f"{hostile!r} produced cache name {out.name!r} with {bad}")

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
        self.assertIn("pip install cascadio", msg)
        self.assertIn("proxy", msg.lower(), "corporate-proxy hint must survive")


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

    def test_status_reports_engine_and_interpreter(self):
        with urllib.request.urlopen(self.url("/status"), timeout=5) as r:
            body = json.loads(r.read())
        self.assertEqual(set(body), {"engine", "python"})
        self.assertIsInstance(body["engine"], bool)
        self.assertEqual(body["python"], sys.executable)

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
