"""
Docker container status and healthcheck inspector.
Uses the official docker SDK if installed, with seamless fallback to
the docker CLI if socket permissions or module dependencies vary.
"""

import json
import subprocess
from typing import Any, Dict, List, Optional


def _inspect_via_docker_sdk(
    container_name: str,
    socket_path: str = "unix://var/run/docker.sock"
) -> Optional[Dict[str, Any]]:
    """Inspects container state using the Python docker client."""
    try:
        import docker
        client = docker.DockerClient(base_url=socket_path)
        container = client.containers.get(container_name)
        attrs = container.attrs
        state = attrs.get("State", {})
        restart_count = attrs.get("RestartCount", 0)

        status_str = state.get("Status", "unknown")
        health = state.get("Health", {})
        health_status = health.get("Status", "none")

        return {
            "name": container_name,
            "status": status_str,
            "running": state.get("Running", False),
            "restarting": state.get("Restarting", False),
            "exit_code": state.get("ExitCode", 0),
            "health_status": health_status,
            "restart_count": restart_count,
            "started_at": state.get("StartedAt"),
            "finished_at": state.get("FinishedAt"),
        }
    except Exception:
        return None


def _inspect_via_cli(container_name: str) -> Optional[Dict[str, Any]]:
    """Fallback inspection using standard `docker inspect` JSON output."""
    try:
        cmd = ["docker", "inspect", container_name]
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=5)
        if proc.returncode != 0:
            return None
        data = json.loads(proc.stdout)
        if not data:
            return None
        c_data = data[0]
        state = c_data.get("State", {})
        return {
            "name": container_name,
            "status": state.get("Status", "unknown"),
            "running": state.get("Running", False),
            "restarting": state.get("Restarting", False),
            "exit_code": state.get("ExitCode", 0),
            "health_status": state.get("Health", {}).get("Status", "none"),
            "restart_count": c_data.get("RestartCount", 0),
            "started_at": state.get("StartedAt"),
            "finished_at": state.get("FinishedAt"),
        }
    except Exception:
        return None


def run_docker_check(
    container_config: Dict[str, Any],
    socket_path: str = "unix://var/run/docker.sock"
) -> Dict[str, Any]:
    """
    Evaluates Docker container operational health against expected constraints.
    """
    name = container_config.get("name", "")
    require_running = container_config.get("require_running", True)
    check_health = container_config.get("check_health_status", True)
    max_restarts = container_config.get("max_acceptable_restarts_per_hour", 10)

    info = _inspect_via_docker_sdk(name, socket_path) or _inspect_via_cli(name)

    if not info:
        return {
            "check_type": "docker",
            "name": f"docker-{name}",
            "container_name": name,
            "healthy": False,
            "status": "not_found",
            "running": False,
            "restart_count": 0,
            "error": f"Container '{name}' not found on Docker daemon or socket inaccessible",
        }

    status = info["status"]
    is_running = info["running"]
    health_status = info["health_status"]
    restart_count = info["restart_count"]

    if require_running and not is_running:
        return {
            "check_type": "docker",
            "name": f"docker-{name}",
            "container_name": name,
            "healthy": False,
            "status": status,
            "running": False,
            "restart_count": restart_count,
            "error": f"Container '{name}' is not running (state: {status}, exit_code: {info.get('exit_code')})",
        }

    if check_health and health_status == "unhealthy":
        return {
            "check_type": "docker",
            "name": f"docker-{name}",
            "container_name": name,
            "healthy": False,
            "status": status,
            "running": is_running,
            "health_status": health_status,
            "restart_count": restart_count,
            "error": f"Container '{name}' Docker healthcheck reported UNHEALTHY",
        }

    if restart_count > max_restarts:
        return {
            "check_type": "docker",
            "name": f"docker-{name}",
            "container_name": name,
            "healthy": False,
            "status": status,
            "running": is_running,
            "restart_count": restart_count,
            "error": f"Container restart loop detected: {restart_count} restarts > max {max_restarts}",
        }

    return {
        "check_type": "docker",
        "name": f"docker-{name}",
        "container_name": name,
        "healthy": True,
        "status": status,
        "running": is_running,
        "health_status": health_status,
        "restart_count": restart_count,
        "error": None,
    }
