"""
HTTP endpoint health check.
Validates status code and response time threshold.
Uses standard library urllib to avoid unnecessary heavy dependencies while
allowing requests if present.
"""

import time
import urllib.request
import urllib.error
from typing import Any, Dict, List


def run_http_check(
    name: str,
    url: str,
    expected_status_codes: List[int],
    timeout_seconds: float = 3.0,
    max_response_time_ms: float = 1500.0,
    target_container: str = ""
) -> Dict[str, Any]:
    """
    Executes a synchronous HTTP GET probe.
    Returns structured results including latency and failure reason.
    """
    start_time = time.perf_counter()
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "AWS-SelfHealingMonitor/1.0"}
    )

    try:
        with urllib.request.urlopen(req, timeout=timeout_seconds) as response:
            latency_ms = (time.perf_counter() - start_time) * 1000.0
            status_code = response.getcode()

            if status_code not in expected_status_codes:
                return {
                    "check_type": "http",
                    "name": name,
                    "healthy": False,
                    "status_code": status_code,
                    "response_time_ms": round(latency_ms, 2),
                    "target_container": target_container,
                    "error": f"Unexpected HTTP status {status_code} (expected {expected_status_codes})",
                }

            if latency_ms > max_response_time_ms:
                return {
                    "check_type": "http",
                    "name": name,
                    "healthy": False,
                    "status_code": status_code,
                    "response_time_ms": round(latency_ms, 2),
                    "target_container": target_container,
                    "error": f"Latency {latency_ms:.1f}ms exceeded SLA threshold {max_response_time_ms}ms",
                }

            return {
                "check_type": "http",
                "name": name,
                "healthy": True,
                "status_code": status_code,
                "response_time_ms": round(latency_ms, 2),
                "target_container": target_container,
                "error": None,
            }

    except urllib.error.HTTPError as err:
        latency_ms = (time.perf_counter() - start_time) * 1000.0
        status_code = err.code
        is_expected = status_code in expected_status_codes
        return {
            "check_type": "http",
            "name": name,
            "healthy": is_expected,
            "status_code": status_code,
            "response_time_ms": round(latency_ms, 2),
            "target_container": target_container,
            "error": None if is_expected else f"HTTP error {status_code}: {err.reason}",
        }
    except urllib.error.URLError as err:
        latency_ms = (time.perf_counter() - start_time) * 1000.0
        return {
            "check_type": "http",
            "name": name,
            "healthy": False,
            "status_code": None,
            "response_time_ms": round(latency_ms, 2),
            "target_container": target_container,
            "error": f"Connection failed: {err.reason}",
        }
    except Exception as err:
        latency_ms = (time.perf_counter() - start_time) * 1000.0
        return {
            "check_type": "http",
            "name": name,
            "healthy": False,
            "status_code": None,
            "response_time_ms": round(latency_ms, 2),
            "target_container": target_container,
            "error": f"Unexpected probe exception: {str(err)}",
        }
