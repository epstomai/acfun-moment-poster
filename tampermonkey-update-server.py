from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


HOST = "127.0.0.1"
PORT = 8787
ROOT = Path(__file__).resolve().parent


class UserscriptHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, format, *args):
        print(format % args, flush=True)


def main():
    handler = partial(UserscriptHandler, directory=str(ROOT))
    server = ThreadingHTTPServer((HOST, PORT), handler)
    print(f"Serving Tampermonkey updates at http://{HOST}:{PORT}/acfun动态.user.js", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
