"""
Ping and DNS resolution health checks.
Validates host network connectivity and nameserver responsiveness.
"""

import subprocess
import socket
import time
from typing import Any, Dict, List, Optional


def run_ping_check(
    targets: List[str],
    count: int = 2,
    timeout_seconds: float = 2.0
) -> Dict[str, Any]:
    """
    Executes ICMP ping probes using system ping utility.
    """
    results = {}
    all_healthy = True

    for target in targets:
        start_time = time.perf_counter()
        try:
            # -c count, -W timeout in seconds (Linux ping)
            cmd = ["ping", "-c", str(count), "-W", str(int(timeout_seconds)), target]
            proc = subprocess.run(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=timeout_seconds + 1.0
            )
            elapsed_ms = (time.perf_counter() - start_time) * 1000.0

            if proc.returncode == 0:
                results[target] = {
                    "healthy": True,
                    "latency_ms": round(elapsed_ms / count, 2),
                    "error": None
                }
            else:
                all_healthy = False
                results[target] = {
                    "healthy": False,
                    "latency_ms": round(elapsed_ms, 2),
                    "error": f"ICMP ping exit code {proc.returncode} - packet loss"
                }
        except subprocess.TimeoutExpired:
            all_healthy = False
            results[target] = {
                "healthy": False,
                "latency_ms": round(timeout_seconds * 1000.0, 2),
                "error": f"Ping timed out after {timeout_seconds}s"
            }
        except Exception as err:
            all_healthy = False
            results[target] = {
                "healthy": False,
                "latency_ms": 0.0,
                "error": f"Ping failure: {str(err)}"
            }

    return {
        "check_type": "ping",
        "name": "network-ping",
        "healthy": all_healthy,
        "results": results,
        "error": None if all_healthy else "One or more ICMP ping targets failed",
    }


def run_dns_check(
    domains: List[str],
    timeout_seconds: float = 3.0
) -> Dict[str, Any]:
    """
    Resolves domain names to verify local DNS resolution pipeline.
    """
    results = {}
    all_healthy = True
    original_timeout = socket.getdefaulttimeout()

    try:
        socket.setdefaulttimeout(timeout_seconds)
        for domain in domains:
            start_time = time.perf_counter()
            try:
                addr_info = socket.getaddrinfo(domain, None, socket.AF_INET)
                resolved_ips = list(set([item[4][0] for item in addr_info]))
                elapsed_ms = (time.perf_counter() - start_time) * 1000.0
                results[domain] = {
                    "healthy": True,
                    "ips": resolved_ips,
                    "lookup_time_ms": round(elapsed_ms, 2),
                    "error": None
                }
            except socket.gaierror as err:
                all_healthy = False
                elapsed_ms = (time.perf_counter() - start_time) * 1000.0
                results[domain] = {
                    "healthy": False,
                    "ips": [],
                    "lookup_time_ms": round(elapsed_ms, 2),
                    "error": f"DNS resolution failed: {err.strerror}"
                }
            except Exception as err:
                all_healthy = False
                results[domain] = {
                    "healthy": False,
                    "ips": [],
                    "lookup_time_ms": 0.0,
                    "error": str(err)
                }
    finally:
        socket.setdefaulttimeout(original_timeout)

    return {
        "check_type": "dns",
        "name": "network-dns",
        "healthy": all_healthy,
        "results": results,
        "error": None if all_healthy else "DNS query failed on one or more domains",
    }
