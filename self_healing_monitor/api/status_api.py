"""
Lightweight status and health HTTP API.
Exposes /health, /status, and /history endpoints for uptime probes,
load balancers, or monitoring dashboards. Runs in a background daemon thread
using Python standard library HTTP server (zero heavy dependencies).
"""

import http.server
import json
import threading
from typing import Any, Callable, Dict


class StatusHTTPHandler(http.server.BaseHTTPRequestHandler):
    get_status_fn: Callable[[], Dict[str, Any]]
    get_history_fn: Callable[[], Any]

    def log_message(self, format: str, *args: Any):
        # Suppress noisy standard HTTP server console logging
        pass

    def _send_json(self, status_code: int, data: Any):
        payload = json.dumps(data, indent=2, default=str).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        if self.path in ("/health", "/healthz"):
            self._send_json(200, {
                "status": "healthy",
                "service": "aws-self-healing-monitor"
            })
        elif self.path in ("/status", "/state"):
            status_data = self.get_status_fn()
            self._send_json(200, status_data)
        elif self.path in ("/history", "/events"):
            history_data = self.get_history_fn()
            self._send_json(200, {"history": history_data})
        else:
            self._send_json(404, {"error": "Endpoint not found. Available: /health, /status, /history"})


def start_status_api(
    port: int,
    get_status_fn: Callable[[], Dict[str, Any]],
    get_history_fn: Callable[[], Any]
) -> threading.Thread:
    """Spawns the HTTP status listener on a background thread."""

    class BoundHandler(StatusHTTPHandler):
        pass

    BoundHandler.get_status_fn = staticmethod(get_status_fn)
    BoundHandler.get_history_fn = staticmethod(get_history_fn)

    server = http.server.HTTPServer(("0.0.0.0", port), BoundHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return thread
