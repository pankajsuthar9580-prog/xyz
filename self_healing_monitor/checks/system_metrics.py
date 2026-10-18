"""
System resource metrics health check using psutil.
Monitors CPU, Memory, and Disk utilization with fallback to /proc filesystem.
"""

import os
from typing import Any, Dict


def get_metrics_fallback() -> Dict[str, float]:
    """Fallback parser reading /proc/meminfo and statvfs if psutil is missing."""
    mem_percent = 0.0
    try:
        with open("/proc/meminfo", "r") as f:
            lines = f.readlines()
        mem_data = {}
        for line in lines:
            parts = line.split(":")
            if len(parts) == 2:
                mem_data[parts[0].strip()] = int(parts[1].split()[0])
        total = mem_data.get("MemTotal", 1)
        avail = mem_data.get("MemAvailable", mem_data.get("MemFree", 0))
        mem_percent = round((1.0 - (avail / total)) * 100.0, 1)
    except Exception:
        mem_percent = 0.0

    disk_percent = 0.0
    try:
        st = os.statvfs("/")
        total_b = st.f_blocks * st.f_frsize
        free_b = st.f_bavail * st.f_frsize
        disk_percent = round((1.0 - (free_b / total_b)) * 100.0, 1)
    except Exception:
        disk_percent = 0.0

    return {
        "cpu_percent": 0.0,
        "memory_percent": mem_percent,
        "disk_percent": disk_percent
    }


def run_system_metrics_check(
    thresholds: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Samples host resource consumption and evaluates against SLA limits.
    """
    cpu_limit = thresholds.get("cpu_percent", 90.0)
    mem_limit = thresholds.get("memory_percent", 92.0)
    disk_limit = thresholds.get("disk_percent", 88.0)
    disk_path = thresholds.get("disk_path", "/")

    cpu_val = 0.0
    mem_val = 0.0
    disk_val = 0.0
    disk_free_gb = 0.0

    try:
        import psutil
        cpu_val = round(psutil.cpu_percent(interval=0.5), 1)
        mem = psutil.virtual_memory()
        mem_val = round(mem.percent, 1)
        disk = psutil.disk_usage(disk_path)
        disk_val = round(disk.percent, 1)
        disk_free_gb = round(disk.free / (1024 ** 3), 2)
    except ImportError:
        metrics = get_metrics_fallback()
        cpu_val = metrics["cpu_percent"]
        mem_val = metrics["memory_percent"]
        disk_val = metrics["disk_percent"]

    issues = []
    if cpu_val > cpu_limit:
        issues.append(f"CPU {cpu_val}% exceeded threshold {cpu_limit}%")
    if mem_val > mem_limit:
        issues.append(f"Memory {mem_val}% exceeded threshold {mem_limit}%")
    if disk_val > disk_limit:
        issues.append(f"Disk {disk_val}% on '{disk_path}' exceeded threshold {disk_limit}% ({disk_free_gb}GB free)")

    is_healthy = len(issues) == 0

    return {
        "check_type": "system_metrics",
        "name": "host-system-metrics",
        "healthy": is_healthy,
        "metrics": {
            "cpu_percent": cpu_val,
            "memory_percent": mem_val,
            "disk_percent": disk_val,
            "disk_free_gb": disk_free_gb,
        },
        "thresholds": {
            "cpu_percent": cpu_limit,
            "memory_percent": mem_limit,
            "disk_percent": disk_limit,
        },
        "error": " | ".join(issues) if issues else None,
    }
