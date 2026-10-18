"""
TCP Port connectivity check.
Tests socket connection and handshakes with configured timeout.
"""

import socket
import time
from typing import Any, Dict


def run_tcp_check(
    name: str,
    host: str,
    port: int,
    timeout_seconds: float = 2.0,
    target_container: str = ""
) -> Dict[str, Any]:
    """
    Attempts a raw TCP socket connection to host:port.
    """
    start_time = time.perf_counter()
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(timeout_seconds)

    try:
        sock.connect((host, port))
        latency_ms = (time.perf_counter() - start_time) * 1000.0
        return {
            "check_type": "tcp",
            "name": name,
            "healthy": True,
            "host": host,
            "port": port,
            "response_time_ms": round(latency_ms, 2),
            "target_container": target_container,
            "error": None,
        }
    except socket.timeout:
        latency_ms = (time.perf_counter() - start_time) * 1000.0
        return {
            "check_type": "tcp",
            "name": name,
            "healthy": False,
            "host": host,
            "port": port,
            "response_time_ms": round(latency_ms, 2),
            "target_container": target_container,
            "error": f"TCP connection timed out after {timeout_seconds}s",
        }
    except ConnectionRefusedError:
        latency_ms = (time.perf_counter() - start_time) * 1000.0
        return {
            "check_type": "tcp",
            "name": name,
            "healthy": False,
            "host": host,
            "port": port,
            "response_time_ms": round(latency_ms, 2),
            "target_container": target_container,
            "error": "Connection refused (service not listening or firewall drop)",
        }
    except Exception as err:
        latency_ms = (time.perf_counter() - start_time) * 1000.0
        return {
            "check_type": "tcp",
            "name": name,
            "healthy": False,
            "host": host,
            "port": port,
            "response_time_ms": round(latency_ms, 2),
            "target_container": target_container,
            "error": f"Socket error: {str(err)}",
        }
    finally:
        try:
            sock.close()
        except Exception:
            pass
