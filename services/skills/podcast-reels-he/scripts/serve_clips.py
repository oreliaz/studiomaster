"""
Minimal HTTP server with CORS for Drive uploads (CSP-friendly).

Drive's CSP blocks fetches from external CDNs (catbox.moe, etc.) so
to feed files into the Chrome MCP file-input patch trick, serve them
from localhost where Drive's CSP allows the connect.

Usage:
  python serve_clips.py <dir> [<port=8770>]

Then in Chrome MCP do:
  fetch('http://127.0.0.1:8770/01_9x16.mp4').then(r => r.blob()).then(blob => ...)
"""
import http.server, socketserver, os, sys

DIR  = sys.argv[1] if len(sys.argv) > 1 else "."
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8770
os.chdir(DIR)

class CORSHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

print(f"serving {os.getcwd()} on http://127.0.0.1:{PORT}", flush=True)
with socketserver.TCPServer(("127.0.0.1", PORT), CORSHandler) as httpd:
    httpd.serve_forever()
