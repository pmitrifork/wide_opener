#!/usr/bin/env python3
"""
Minimal static server for the Human FX demo.

    python serve.py            # serves on http://localhost:8000
    python serve.py 5500       # custom port

Why not just `python -m http.server`?  This one sends the correct MIME types
for ES modules (.mjs) and wasm, which some Python versions get wrong and which
will otherwise make the browser refuse to load the app.

getUserMedia (the camera) works on http://localhost without HTTPS, so this is
all you need for the demo on the same machine.
"""
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".mjs": "text/javascript",
        ".js":  "text/javascript",
        ".wasm": "application/wasm",
        ".task": "application/octet-stream",
    }

    def end_headers(self):
        # never cache during development
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    print(f"Human FX  ->  http://localhost:{PORT}")
    print("Ctrl+C to stop.")
    HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
