"""Serve the browser preview locally."""
from __future__ import annotations

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit
import webbrowser

ROOT = Path(__file__).resolve().parent


class Handler(SimpleHTTPRequestHandler):
    """Serve only the browser entry points and their required module trees."""
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript'}

    def do_GET(self):
        # Map stable root URLs while preventing arbitrary files from being served.
        path = unquote(urlsplit(self.path).path)
        target = (ROOT / path.lstrip('/')).resolve()
        if path == '/':
            self.path = '/web/index.html'
        elif path == '/emitter_debug.html':
            self.path = '/web/emitter_debug.html'
        elif path == '/player.html':
            self.path = '/web/player.html'
        elif not target.is_relative_to(ROOT) or not path.startswith(('/web/', '/src/', '/runtime/')) or not target.is_file():
            self.send_error(404)
            return
        super().do_GET()

    def do_HEAD(self):
        self.send_error(405)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        super().end_headers()


def main():
    """Start a local-only server and optionally open the card preview."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--no-browser', action='store_true')
    parser.add_argument('--port', type=int, default=0)
    args = parser.parse_args()
    with ThreadingHTTPServer(('127.0.0.1', args.port), partial(Handler, directory=str(ROOT))) as server:
        url = f'http://127.0.0.1:{server.server_port}/'
        print(f'CGSS Cartoon Unify: {url}', flush=True)
        print('Press Ctrl+C to stop.', flush=True)
        if not args.no_browser:
            webbrowser.open(url)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == '__main__':
    main()
