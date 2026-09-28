"""Serve the instrumented test page through stepview.py's own handler, for t5.

run.js starts this with the page it built and a throwaway cache folder, so the
real /convert endpoint (cascadio) is exercised without touching
~/.stepview_cache. Prints "port <n>" once it is listening.

    python tools/serve_stepview.py PAGE CACHE_DIR
"""
import http.server
import sys
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))      # the repo root
import stepview                                                    # noqa: E402


def main():
    page, cache = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
    stepview.CACHE_DIR = cache
    stepview.Handler.routes = {"/": (page, "text/html; charset=utf-8"),
                               "/viewer.html": (page, "text/html; charset=utf-8")}
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), stepview.Handler)
    print("port", httpd.server_address[1], flush=True)
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    try:
        sys.stdin.read()                  # run until run.js closes our stdin (or kills us)
    except KeyboardInterrupt:
        pass
    httpd.shutdown()


if __name__ == "__main__":
    main()
