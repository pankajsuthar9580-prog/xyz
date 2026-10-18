"""
Configuration loader for the Self-Healing Server Monitor.
Loads config.yaml, supports environment variable overrides, and detects
EC2 instance identity via AWS IMDSv2.
"""

import os
import urllib.request
import urllib.error
import yaml
from typing import Any, Dict, Optional


def get_ec2_metadata(path: str, timeout: float = 1.0) -> Optional[str]:
    """
    Retrieve metadata from AWS EC2 Instance Metadata Service v2 (IMDSv2).
    Returns None if not running on EC2 or if IMDS is unreachable.
    """
    try:
        # Step 1: Request IMDSv2 token (TTL 60s)
        token_req = urllib.request.Request(
            "http://169.254.169.254/latest/api/token",
            headers={"X-aws-ec2-metadata-token-ttl-seconds": "60"},
            method="PUT"
        )
        with urllib.request.urlopen(token_req, timeout=timeout) as resp:
            token = resp.read().decode("utf-8")

        # Step 2: Query metadata with session token
        meta_req = urllib.request.Request(
            f"http://169.254.169.254/latest/meta-data/{path}",
            headers={"X-aws-ec2-metadata-token": token}
        )
        with urllib.request.urlopen(meta_req, timeout=timeout) as resp:
            return resp.read().decode("utf-8")
    except Exception:
        return None


class ConfigLoader:
    def __init__(self, config_path: str = "config/config.yaml"):
        self.config_path = os.getenv("MONITOR_CONFIG_PATH", config_path)
        self.raw_config = self._load_yaml()
        self.ec2_instance_id = (
            os.getenv("EC2_INSTANCE_ID") or
            get_ec2_metadata("instance-id") or
            "local-host-dev"
        )
        self.ec2_region = (
            os.getenv("AWS_REGION") or
            os.getenv("AWS_DEFAULT_REGION") or
            get_ec2_metadata("placement/region") or
            self.raw_config.get("aws", {}).get("region", "us-east-1")
        )
        self._apply_env_overrides()

    def _load_yaml(self) -> Dict[str, Any]:
        if not os.path.exists(self.config_path):
            # Fallback relative to script location
            alt_path = os.path.join(os.path.dirname(__file__), "..", "config", "config.yaml")
            if os.path.exists(alt_path):
                self.config_path = alt_path
            else:
                return {}

        with open(self.config_path, "r", encoding="utf-8") as f:
            return yaml.safe_load(f) or {}

    def _apply_env_overrides(self):
        """Allow runtime overrides from environment variables (12-Factor App)."""
        app = self.raw_config.setdefault("app", {})
        if "DRY_RUN" in os.environ:
            app["dry_run"] = os.environ["DRY_RUN"].lower() in ("true", "1", "yes")
        if "CHECK_INTERVAL" in os.environ:
            try:
                app["check_interval_seconds"] = int(os.environ["CHECK_INTERVAL"])
            except ValueError:
                pass

        aws = self.raw_config.setdefault("aws", {})
        aws["region"] = self.ec2_region
        if "SNS_TOPIC_ARN" in os.environ:
            aws.setdefault("sns", {})["topic_arn"] = os.environ["SNS_TOPIC_ARN"]
        if "CLOUDWATCH_LOG_GROUP" in os.environ:
            aws.setdefault("cloudwatch", {})["log_group"] = os.environ["CLOUDWATCH_LOG_GROUP"]

    @property
    def dry_run(self) -> bool:
        return bool(self.raw_config.get("app", {}).get("dry_run", False))

    @property
    def check_interval(self) -> int:
        return int(self.raw_config.get("app", {}).get("check_interval_seconds", 15))

    @property
    def safeguards(self) -> Dict[str, Any]:
        return self.raw_config.get("safeguards", {
            "consecutive_failures_threshold": 3,
            "cooldown_period_seconds": 180,
            "max_recoveries_per_hour": 5,
            "exponential_backoff_base_seconds": 5,
            "exponential_backoff_multiplier": 2.0,
            "max_backoff_seconds": 60,
        })

    @property
    def checks(self) -> Dict[str, Any]:
        return self.raw_config.get("checks", {})

    @property
    def recovery_config(self) -> Dict[str, Any]:
        return self.raw_config.get("recovery", {})

    @property
    def aws_config(self) -> Dict[str, Any]:
        return self.raw_config.get("aws", {})
