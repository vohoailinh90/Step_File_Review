#!/usr/bin/env python3
"""
stepview.py -- quick local STEP viewer launcher.

Usage:
    python stepview.py                             # open the viewer, then drag & drop STEP files
    python stepview.py assembly.step               # convert (cached) + open viewer
    python stepview.py assembly.step --coarse      # faster tessellation for huge files
    python stepview.py assembly.step --convert-only
    python stepview.py --warm folder/              # pre-convert every STEP in a folder

Once the viewer is open you can drop .step / .stp files straight onto it -- the
conversion runs in this local process, not in the browser and not in the cloud.
First open of a big assembly pays the one-time tessellation cost; every open
after that comes from the local cache and is near-instant.

Requires:  pip install cascadio     (bundled OpenCASCADE, no CAD install needed)
"""
# README promises Python 3.9-3.13. The annotations below use PEP 604 unions
# ("str | None"), which 3.9 evaluates at runtime and rejects with a bare
# TypeError on import -- the one failure mode this file otherwise works hard to
# avoid. Postponing annotations makes them strings, so 3.9 imports cleanly with
# no change to behaviour. tests/check_invariants.py enforces this pairing.
from __future__ import annotations

import argparse
import hashlib
import http.server
import json
import re
import socket
import sys
import tempfile
import threading
import time
import webbrowser
from pathlib import Path
from urllib.parse import quote, unquote

CACHE_DIR = Path.home() / ".stepview_cache"
VIEWER = Path(__file__).parent / "viewer.html"
STEP_EXT = {".step", ".stp"}

# Tessellation tolerance presets: (linear deflection, angular deflection rad)
QUALITY = {
    "fine":   (0.01, 0.25),
    "normal": (0.10, 0.50),
    "coarse": (0.50, 1.00),
}


def check_engine(fatal: bool = True) -> bool:
    """Verify the tessellation engine is importable, with an actionable message."""
    try:
        import cascadio  # noqa: F401
        return True
    except ImportError:
        py = Path(sys.executable).name
        msg = (
            "\n  The tessellation engine (cascadio) is not installed for this Python.\n"
            f"  Python in use: {sys.executable}  ({sys.version.split()[0]})\n\n"
            f"  Install it with:\n      \"{sys.executable}\" -m pip install cascadio\n\n"
            "  Behind a corporate proxy, add your proxy:\n"
            f"      \"{sys.executable}\" -m pip install --proxy http://user:pass@proxy:port cascadio\n"
            "  Or download the wheel on a machine with access and install it offline:\n"
            f"      \"{sys.executable}\" -m pip install cascadio-0.1.1-cp312-abi3-win_amd64.whl\n\n"
            "  Wheels exist for Windows/macOS/Linux on Python 3.9-3.13 (64-bit).\n"
            "  GLB / GLTF / STL files still open without it -- only STEP needs the engine.\n"
        )
        if fatal:
            sys.exit(msg)
        print(msg)
        return False


def _tessellate(src: Path, out: Path, tol: tuple, label: str | None = None):
    try:
        import cascadio
    except ImportError:
        raise RuntimeError(
            "the tessellation engine is not installed -- run:  "
            f'"{sys.executable}" -m pip install cascadio'
        ) from None
    tmp = out.with_suffix(".partial")
    try:
        cascadio.step_to_glb(str(src), str(tmp), tol_linear=tol[0], tol_angular=tol[1])
        if not tmp.exists() or tmp.stat().st_size == 0:
            raise RuntimeError("no geometry produced")
        tmp.replace(out)      # atomic: a failed run never leaves a bad cache entry
    except Exception as e:
        tmp.unlink(missing_ok=True)
        raise RuntimeError(
            f"could not read '{label or src.name}' as STEP -- the file may be corrupt, "
            f"incomplete, or not a STEP file ({e})"
        ) from None


def convert(path: Path, tol: tuple, force: bool = False, quality: str = "normal") -> Path:
    """Convert a STEP file on disk, using the cache when possible."""
    CACHE_DIR.mkdir(exist_ok=True)
    st = path.stat()
    key = hashlib.sha1(f"{path.resolve()}|{st.st_mtime_ns}|{st.st_size}|{tol}".encode()).hexdigest()[:16]
    out = CACHE_DIR / f"{path.stem}_{quality}_{key}.glb"
    if out.exists() and not force:
        print(f"[cache]   {path.name}  ->  {out.name}  (instant)")
        return out

    print(f"[convert] {path.name}  ({st.st_size/1e6:.1f} MB, {quality}) ...", flush=True)
    t0 = time.time()
    _tessellate(path, out, tol)
    dt = time.time() - t0
    print(f"[done]    {dt:.1f} s  ->  {out.name}  ({out.stat().st_size/1e6:.2f} MB)")
    if dt > 15:
        print("          Tip: use --coarse, or keep the cache warm with --warm.")
    return out


# Characters Win32 rejects in a filename, plus the C0 control range. POSIX
# accepts all but "/", which is why an unsanitised upload name worked in testing
# and failed on the platform this tool is actually used on.
_ILLEGAL_FILENAME = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def safe_stem(name: str, limit: int = 40) -> str:
    """Turn an untrusted upload filename into a cache stem Windows will accept.

    The browser supplies the name via X-Filename, and a STEP exported from a PDM
    system commonly carries a revision separator -- "HOUSING:REV-B.step". That
    colon survives Path().stem on Windows as well as POSIX, so it reached the
    cache path and Win32 rejected the whole write with a bare OSError instead of
    the actionable message every other failure here produces.

    Path().stem already discards directory components, so "../../evil.step"
    cannot escape the cache directory; this is about legality, not traversal.
    Both properties are pinned in tests/test_stepview.py.
    """
    return _ILLEGAL_FILENAME.sub("_", Path(name).stem)[:limit] or "model"


def convert_bytes(data: bytes, name: str, quality: str) -> Path:
    """Convert STEP content posted from the viewer, cached by content hash."""
    CACHE_DIR.mkdir(exist_ok=True)
    tol = QUALITY.get(quality, QUALITY["normal"])
    digest = hashlib.sha1(data).hexdigest()[:16]
    stem = safe_stem(name)
    out = CACHE_DIR / f"{stem}_{quality}_{digest}.glb"
    if out.exists():
        print(f"[cache]   {name}  ->  {out.name}  (instant)")
        return out

    print(f"[convert] {name}  ({len(data)/1e6:.1f} MB, {quality}) ...", flush=True)
    t0 = time.time()
    suffix = Path(name).suffix or ".step"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(data)
        tmp_path = Path(tmp.name)
    try:
        _tessellate(tmp_path, out, tol, label=name)
    finally:
        tmp_path.unlink(missing_ok=True)
    print(f"[done]    {time.time()-t0:.1f} s  ->  {out.name}  ({out.stat().st_size/1e6:.2f} MB)")
    return out


MAX_UPLOAD = 2 * 1024**3          # 2 GB guard


class Handler(http.server.BaseHTTPRequestHandler):
    """Serves the viewer, the pre-converted model, and a local /convert endpoint."""
    routes: dict = {}
    protocol_version = "HTTP/1.1"

    def _send(self, code, body: bytes, ctype: str):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _error(self, code, msg):
        self._send(code, json.dumps({"error": msg}).encode(), "application/json")

    def do_GET(self):
        if self.path.split("?")[0] == "/status":
            try:
                import cascadio  # noqa: F401
                ok = True
            except ImportError:
                ok = False
            self._send(200, json.dumps({"engine": ok, "python": sys.executable}).encode(),
                       "application/json")
            return
        item = self.routes.get(self.path.split("?")[0])
        if item is None:
            self._error(404, "Not found")
            return
        file, ctype = item
        self._send(200, Path(file).read_bytes(), ctype)

    def do_POST(self):
        if self.path.split("?")[0] != "/convert":
            self._error(404, "Not found")
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            self._error(400, "Bad Content-Length")
            return
        if length <= 0:
            self._error(400, "Empty upload")
            return
        if length > MAX_UPLOAD:
            self._error(413, f"File is larger than {MAX_UPLOAD/1e9:.0f} GB")
            return

        name = unquote(self.headers.get("X-Filename", "model.step"))
        quality = self.headers.get("X-Quality", "normal")

        # read the body in chunks so a 500 MB assembly doesn't spike memory badly
        chunks, remaining = [], length
        while remaining > 0:
            block = self.rfile.read(min(1 << 20, remaining))
            if not block:
                break
            chunks.append(block)
            remaining -= len(block)
        data = b"".join(chunks)
        if len(data) != length:
            self._error(400, "Upload interrupted")
            return

        try:
            glb = convert_bytes(data, name, quality)
        except Exception as e:
            print(f"[error]   {name}: {e}")
            self._error(500, str(e))
            return
        self._send(200, glb.read_bytes(), "model/gltf-binary")

    def log_message(self, *a):   # silence per-request noise
        pass


def serve_and_open(glb: Path | None, name: str):
    if not VIEWER.exists():
        sys.exit(f"viewer.html not found next to this script ({VIEWER})")

    Handler.routes = {"/": (VIEWER, "text/html; charset=utf-8"),
                      "/viewer.html": (VIEWER, "text/html; charset=utf-8")}
    query = ""
    if glb is not None:
        Handler.routes["/model.glb"] = (glb, "model/gltf-binary")
        query = f"?model=/model.glb&name={quote(name)}"

    with socket.socket() as s:                    # grab a free port on loopback
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()

    url = f"http://127.0.0.1:{port}/{query}"
    print(f"[viewer]  {url}")
    print("          Drag & drop .step files onto the page to convert and view them.")
    webbrowser.open(url)
    print("          Ctrl+C to stop.")
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        print("\nStopped.")


def main():
    ap = argparse.ArgumentParser(description="Quick local STEP viewer")
    ap.add_argument("file", nargs="?", help="STEP file (or GLB) to open")
    ap.add_argument("--fine", action="store_true", help="fine tessellation (slower, smoother)")
    ap.add_argument("--coarse", action="store_true", help="coarse tessellation (fastest, big assemblies)")
    ap.add_argument("--force", action="store_true", help="ignore cache, reconvert")
    ap.add_argument("--convert-only", action="store_true", help="convert to GLB, don't open the viewer")
    ap.add_argument("--out", help="with --convert-only: write GLB here instead of the cache")
    ap.add_argument("--warm", metavar="DIR", help="pre-convert all STEP files in a folder")
    ap.add_argument("--check", action="store_true", help="verify the setup and exit")
    args = ap.parse_args()

    if args.check:
        ok = check_engine(fatal=False)
        print(f"  viewer.html present: {VIEWER.exists()}   cache: {CACHE_DIR}")
        print("  Setup OK -- STEP conversion available." if ok else "  STEP conversion unavailable.")
        # A check has to be able to fail. Installers, scripts and CI read the exit
        # status, not the text, and --check used to return 0 even when cascadio
        # could not be imported -- including a Windows DLL-load failure.
        if not ok:
            sys.exit(1)
        return

    qname = "fine" if args.fine else "coarse" if args.coarse else "normal"
    tol = QUALITY[qname]

    if args.warm:
        check_engine()
        folder = Path(args.warm)
        files = [p for p in folder.rglob("*") if p.suffix.lower() in STEP_EXT]
        print(f"Warming cache for {len(files)} STEP file(s) in {folder} ...")
        for p in files:
            try:
                convert(p, tol, force=args.force, quality=qname)
            except Exception as e:
                print(f"[error]   {p.name}: {e}")
        return

    if not args.file:
        check_engine(fatal=False)      # viewer still useful for GLB/STL without it
        serve_and_open(None, "")
        return

    src = Path(args.file)
    if not src.exists():
        sys.exit(f"File not found: {src}")

    if src.suffix.lower() in STEP_EXT:
        check_engine()
        glb = convert(src, tol, force=args.force, quality=qname)
        if args.out:
            Path(args.out).write_bytes(glb.read_bytes())
            print(f"[copy]    -> {args.out}")
    elif src.suffix.lower() in {".glb", ".gltf"}:
        glb = src
    else:
        sys.exit("Expected a .step/.stp or .glb file")

    if not args.convert_only:
        serve_and_open(glb, src.name)


if __name__ == "__main__":
    main()
