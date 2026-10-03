"""Serve the instrumented test page through stepview.py's own handler, for t5.

run.js starts this with the page it built and a throwaway cache folder, so the
real /convert endpoint (cascadio) is exercised without touching
~/.stepview_cache. Prints "port <n>" once it is listening, and runs until run.js
kills it.

    python -u tools/serve_stepview.py PAGE CACHE_DIR
"""
import faulthandler
import http.server
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))      # the repo root
import stepview                                                    # noqa: E402

HANG_S = 30        # asm.step converts in well under a second


def main():
    page, cache = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
    stepview.CACHE_DIR = cache
    stepview.Handler.routes = {"/": (page, "text/html; charset=utf-8"),
                               "/viewer.html": (page, "text/html; charset=utf-8")}

    # A conversion that hangs says nothing by itself: dump every thread's stack
    # into the log (run.js keeps stderr in out/stepview.log) if one runs too long.
    convert = stepview.convert_bytes

    def watched(*a, **k):
        faulthandler.dump_traceback_later(HANG_S, file=sys.stderr)
        try:
            return convert(*a, **k)
        finally:
            faulthandler.cancel_dump_traceback_later()
    stepview.convert_bytes = watched

    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), stepview.Handler)
    print("port", httpd.server_address[1], flush=True)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    # Idle the main thread the way stepview.serve_and_open() does. Blocking it in
    # a read on stdin instead is not the same process shape: on Windows a thread
    # stuck in a synchronous pipe read can stall other threads' console/handle calls.
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
