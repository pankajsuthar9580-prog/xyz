"""
Execution implementations for Tier 1 through Tier 4 recovery actions.
Supports dry-run simulation mode and defensive exception isolation.
"""

import os
import subprocess
import time
from typing import Any, Dict, List, Optional


class RecoveryActions:
    def __init__(self, ec2_instance_id: str, aws_region: str, dry_run: bool = False):
        self.ec2_instance_id = ec2_instance_id
        self.aws_region = aws_region
        self.dry_run = dry_run

    def execute_tier1_restart_container(
        self,
        container_name: str,
        timeout_seconds: int = 30
    ) -> Dict[str, Any]:
        """
        Tier 1: Restart specific Docker container.
        Attempts via docker SDK or system docker CLI.
        """
        if self.dry_run:
            return {
                "tier": 1,
                "action": "restart_container",
                "target": container_name,
                "success": True,
                "dry_run": True,
                "message": f"[DRY-RUN] Simulated docker restart {container_name}"
            }

        try:
            # First try docker python client if available
            try:
                import docker
                client = docker.from_env()
                container = client.containers.get(container_name)
                container.restart(timeout=timeout_seconds)
                return {
                    "tier": 1,
                    "action": "restart_container",
                    "target": container_name,
                    "success": True,
                    "dry_run": False,
                    "message": f"Successfully restarted Docker container '{container_name}' via Docker SDK"
                }
            except Exception:
                pass

            # Fallback to CLI command
            cmd = ["docker", "restart", "-t", str(timeout_seconds), container_name]
            proc = subprocess.run(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=timeout_seconds + 5
            )

            if proc.returncode == 0:
                return {
                    "tier": 1,
                    "action": "restart_container",
                    "target": container_name,
                    "success": True,
                    "dry_run": False,
                    "message": f"Docker CLI restarted '{container_name}' successfully"
                }
            else:
                return {
                    "tier": 1,
                    "action": "restart_container",
                    "target": container_name,
                    "success": False,
                    "dry_run": False,
                    "message": f"Docker restart failed: {proc.stderr.strip()}"
                }
        except subprocess.TimeoutExpired:
            return {
                "tier": 1,
                "action": "restart_container",
                "target": container_name,
                "success": False,
                "dry_run": False,
                "message": f"Docker restart timed out after {timeout_seconds}s"
            }
        except Exception as err:
            return {
                "tier": 1,
                "action": "restart_container",
                "target": container_name,
                "success": False,
                "dry_run": False,
                "message": f"Exception during container restart: {str(err)}"
            }

    def execute_tier2_compose_recreate(
        self,
        compose_file: str,
        service_name: Optional[str] = None,
        timeout_seconds: int = 60
    ) -> Dict[str, Any]:
        """
        Tier 2: Recreate container or service stack via Docker Compose.
        Runs `docker compose up -d --force-recreate [service]`
        """
        target_desc = service_name or "entire compose stack"
        if self.dry_run:
            return {
                "tier": 2,
                "action": "compose_recreate",
                "target": target_desc,
                "success": True,
                "dry_run": True,
                "message": f"[DRY-RUN] Simulated docker compose --force-recreate for {target_desc}"
            }

        cmd = ["docker", "compose", "-f", compose_file, "up", "-d", "--force-recreate"]
        if service_name:
            cmd.append(service_name)

        try:
            proc = subprocess.run(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=timeout_seconds
            )
            if proc.returncode == 0:
                return {
                    "tier": 2,
                    "action": "compose_recreate",
                    "target": target_desc,
                    "success": True,
                    "dry_run": False,
                    "message": f"Docker Compose force-recreated {target_desc} successfully"
                }
            else:
                return {
                    "tier": 2,
                    "action": "compose_recreate",
                    "target": target_desc,
                    "success": False,
                    "dry_run": False,
                    "message": f"Compose recreate failed (code {proc.returncode}): {proc.stderr.strip()}"
                }
        except Exception as err:
            return {
                "tier": 2,
                "action": "compose_recreate",
                "target": target_desc,
                "success": False,
                "dry_run": False,
                "message": f"Compose recreation exception: {str(err)}"
            }

    def execute_tier3_host_service_restart(
        self,
        services: List[str],
        timeout_seconds: int = 45
    ) -> Dict[str, Any]:
        """
        Tier 3: Restart host daemon (e.g. systemctl restart docker or networking).
        """
        service_list = ", ".join(services)
        if self.dry_run:
            return {
                "tier": 3,
                "action": "host_service_restart",
                "target": service_list,
                "success": True,
                "dry_run": True,
                "message": f"[DRY-RUN] Simulated systemctl restart on {service_list}"
            }

        successes = []
        errors = []

        for svc in services:
            try:
                cmd = ["systemctl", "restart", svc]
                proc = subprocess.run(
                    cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    timeout=timeout_seconds
                )
                if proc.returncode == 0:
                    successes.append(svc)
                else:
                    errors.append(f"{svc}: {proc.stderr.strip() or 'exit code non-zero'}")
            except Exception as err:
                errors.append(f"{svc}: {str(err)}")

        all_ok = len(errors) == 0
        return {
            "tier": 3,
            "action": "host_service_restart",
            "target": service_list,
            "success": all_ok,
            "dry_run": False,
            "message": f"Restarted: {', '.join(successes)}" if all_ok else f"Errors: {'; '.join(errors)}"
        }

    def execute_tier4_ec2_reboot(
        self,
        drain_delay_seconds: int = 10
    ) -> Dict[str, Any]:
        """
        Tier 4: Reboot the host EC2 instance via AWS boto3 API as a last resort.
        """
        if self.dry_run:
            return {
                "tier": 4,
                "action": "ec2_reboot",
                "target": self.ec2_instance_id,
                "success": True,
                "dry_run": True,
                "message": f"[DRY-RUN] Simulated AWS EC2 RebootInstances on {self.ec2_instance_id}"
            }

        if self.ec2_instance_id in ("unknown", "local-host-dev"):
            return {
                "tier": 4,
                "action": "ec2_reboot",
                "target": self.ec2_instance_id,
                "success": False,
                "dry_run": False,
                "message": "Cannot issue EC2 RebootInstances: Instance ID is local or undetected."
            }

        # Allow grace period before reboot for logs to flush to CloudWatch
        if drain_delay_seconds > 0:
            time.sleep(drain_delay_seconds)

        try:
            import boto3
            ec2_client = boto3.client("ec2", region_name=self.aws_region)
            ec2_client.reboot_instances(InstanceIds=[self.ec2_instance_id])
            return {
                "tier": 4,
                "action": "ec2_reboot",
                "target": self.ec2_instance_id,
                "success": True,
                "dry_run": False,
                "message": f"AWS EC2 RebootInstances issued successfully for {self.ec2_instance_id}"
            }
        except Exception as err:
            return {
                "tier": 4,
                "action": "ec2_reboot",
                "target": self.ec2_instance_id,
                "success": False,
                "dry_run": False,
                "message": f"AWS EC2 RebootInstances failed: {str(err)}"
            }
