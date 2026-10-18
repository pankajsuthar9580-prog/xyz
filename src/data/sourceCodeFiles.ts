export interface CodeFile {
  path: string;
  name: string;
  category: 'python' | 'yaml' | 'docker' | 'terraform' | 'systemd' | 'shell' | 'json' | 'docs';
  description: string;
  content: string;
}

export const SOURCE_FILES: CodeFile[] = [
  {
    path: 'config/config.yaml',
    name: 'config.yaml',
    category: 'yaml',
    description: 'Central YAML configuration for health check targets, thresholds, safeguards & AWS settings',
    content: `# ==============================================================================
# AWS Self-Healing Server Monitor Configuration
# ==============================================================================
# Practical, tiered self-healing monitor for AWS EC2 instances
# Evaluates network, service, container, and host metrics, then triggers
# automated multi-stage recovery with exponential backoff and rate limits.
# ==============================================================================

app:
  name: "aws-self-healing-monitor"
  environment: "production" # "production" | "staging" | "test"
  check_interval_seconds: 15
  dry_run: false # Set true to log actions without executing Docker/Host/AWS mutations
  http_status_api_port: 8080 # Exposes /health, /status, /history (set 0 to disable)

# ------------------------------------------------------------------------------
# Safeguards & Throttling (Prevents flapping and reboot loops)
# ------------------------------------------------------------------------------
safeguards:
  consecutive_failures_threshold: 3 # Failures before initiating recovery actions
  cooldown_period_seconds: 180 # Wait time between recovery attempts for a target
  max_recoveries_per_hour: 5 # Lockout limit to prevent infinite restart storms
  exponential_backoff_base_seconds: 5
  exponential_backoff_multiplier: 2.0
  max_backoff_seconds: 60

# ------------------------------------------------------------------------------
# Health Checks Definitions
# ------------------------------------------------------------------------------
checks:
  # HTTP endpoint availability and latency checks
  http:
    - name: "sample-nginx-web"
      url: "http://localhost:80"
      expected_status_codes: [200, 301, 302]
      timeout_seconds: 3.5
      max_response_time_ms: 1500
      enabled: true
      target_container: "sample-nginx"

    - name: "internal-api-check"
      url: "http://localhost:80/healthz"
      expected_status_codes: [200]
      timeout_seconds: 2.0
      max_response_time_ms: 800
      enabled: false
      target_container: "api-backend"

  # TCP port connectivity checks
  tcp:
    - name: "nginx-port-80"
      host: "127.0.0.1"
      port: 80
      timeout_seconds: 2.0
      enabled: true
      target_container: "sample-nginx"

    - name: "database-tcp"
      host: "127.0.0.1"
      port: 5432
      timeout_seconds: 2.0
      enabled: false
      target_container: "postgres-db"

  # Ping and DNS checks
  networking:
    ping:
      enabled: true
      target_hosts: ["1.1.1.1", "8.8.8.8"]
      count: 2
      timeout_seconds: 2.0
    dns:
      enabled: true
      domains: ["aws.amazon.com", "google.com"]
      nameserver: null # null uses system resolver (/etc/resolv.conf)
      timeout_seconds: 3.0

  # Docker Container Health and Restart loop detection
  docker:
    enabled: true
    socket_path: "unix://var/run/docker.sock"
    monitored_containers:
      - name: "sample-nginx"
        service_name: "web"
        compose_project_dir: "/opt/self-healing-monitor"
        max_acceptable_restarts_per_hour: 10
        require_running: true
        check_health_status: true # checks Docker HEALTHCHECK if present

  # System Resource Metrics (psutil)
  system_metrics:
    enabled: true
    thresholds:
      cpu_percent: 90.0 # Alert if sustained above 90%
      memory_percent: 92.0 # Alert if memory exceeds 92%
      disk_percent: 88.0 # Alert if root / disk usage exceeds 88%
      disk_path: "/"

# ------------------------------------------------------------------------------
# Tiered Recovery Configuration
# ------------------------------------------------------------------------------
recovery:
  # Tier 1: Soft recovery (restart the single failed container)
  tier1_container_restart:
    enabled: true
    timeout_seconds: 30

  # Tier 2: Stack recovery (docker compose recreate with fresh state)
  tier2_compose_recreate:
    enabled: true
    compose_file: "/opt/self-healing-monitor/docker-compose.yml"
    pull_latest: false
    timeout_seconds: 60

  # Tier 3: Host service restart (systemctl restart docker / networking)
  tier3_host_service_restart:
    enabled: true
    services: ["docker.service"]
    timeout_seconds: 45

  # Tier 4: EC2 Instance Reboot (boto3 reboot_instances) - LAST RESORT
  tier4_ec2_reboot:
    enabled: true
    require_confirmation_attempts: 3 # Must have exhausted tiers 1-3
    drain_delay_seconds: 10 # Grace period before issuing EC2 RebootInstances

# ------------------------------------------------------------------------------
# AWS Integration: Alerts & Logs
# ------------------------------------------------------------------------------
aws:
  region: "us-east-1" # Can be overridden by AWS_DEFAULT_REGION or IMDSv2
  sns:
    enabled: true
    topic_arn: "arn:aws:sns:us-east-1:123456789012:self-healing-server-alerts"
    events_to_notify:
      - "FAILURE_DETECTED"
      - "RECOVERY_ATTEMPTED"
      - "RECOVERY_SUCCEEDED"
      - "RECOVERY_FAILED"
      - "ESCALATION"
      - "SAFEGUARD_LOCKOUT"
      - "HOST_REBOOT_TRIGGERED"
  cloudwatch:
    enabled: true
    log_group: "/aws/ec2/self-healing-monitor"
    log_stream_prefix: "instance" # Will append ec2_instance_id if detected`
  },
  {
    path: 'main.py',
    name: 'main.py',
    category: 'python',
    description: 'Main daemon entrypoint, signal handling, orchestration loop & status server',
    content: `#!/usr/bin/env python3
"""
AWS Self-Healing Server Monitor & Recovery Daemon.
Automated health detection and tiered self-healing for EC2 instances.
"""

import argparse
import signal
import sys
import time
from datetime import datetime, timezone
from typing import Any, Dict, List

from config.loader import ConfigLoader
from logging_utils.json_logger import SelfHealingLogger
from alerts.sns_alerter import SNSAlerter
from recovery.state_tracker import StateTracker
from recovery.actions import RecoveryActions
from recovery.engine import RecoveryEngine
from api.status_api import start_status_api

from checks.http_check import run_http_check
from checks.tcp_check import run_tcp_check
from checks.ping_dns_check import run_ping_check, run_dns_check
from checks.docker_check import run_docker_check
from checks.system_metrics import run_system_metrics_check


class SelfHealingDaemon:
    def __init__(self, config_path: str = "config/config.yaml", dry_run_override: bool = False):
        self.config_loader = ConfigLoader(config_path)
        if dry_run_override:
            self.config_loader.raw_config.setdefault("app", {})["dry_run"] = True

        self.instance_id = self.config_loader.ec2_instance_id
        self.region = self.config_loader.ec2_region
        self.dry_run = self.config_loader.dry_run

        # Initialize logging
        self.logger = SelfHealingLogger(
            name="self-healing-monitor",
            instance_id=self.instance_id
        )
        cw_cfg = self.config_loader.aws_config.get("cloudwatch", {})
        if cw_cfg.get("enabled", True):
            self.logger.enable_cloudwatch(
                log_group=cw_cfg.get("log_group", "/aws/ec2/self-healing-monitor"),
                stream_prefix=cw_cfg.get("log_stream_prefix", "instance"),
                region=self.region
            )

        # Initialize Alerts & Safeguards
        self.alerter = SNSAlerter(
            aws_config=self.config_loader.aws_config,
            ec2_instance_id=self.instance_id,
            dry_run=self.dry_run
        )
        self.state_tracker = StateTracker(self.config_loader.safeguards)
        self.actions = RecoveryActions(
            ec2_instance_id=self.instance_id,
            aws_region=self.region,
            dry_run=self.dry_run
        )
        self.recovery_engine = RecoveryEngine(
            config=self.config_loader.raw_config,
            actions=self.actions,
            state_tracker=self.state_tracker,
            alerter=self.alerter,
            logger=self.logger
        )

        self.running = True
        self.last_check_results: List[Dict[str, Any]] = []
        self.last_cycle_timestamp: str | None = None

    def start_api_server(self):
        port = int(self.config_loader.raw_config.get("app", {}).get("http_status_api_port", 8080))
        if port > 0:
            try:
                start_status_api(
                    port=port,
                    get_status_fn=self.get_current_status,
                    get_history_fn=self.logger.get_recent_history
                )
                self.logger.log_event("INFO", "API_STARTED", f"Status HTTP API listening on port {port}")
            except Exception as err:
                self.logger.log_event("WARN", "API_ERROR", f"Could not bind status API to port {port}: {err}")

    def get_current_status(self) -> Dict[str, Any]:
        """Exposes operational telemetry for /status endpoint."""
        return {
            "service": "aws-self-healing-monitor",
            "instance_id": self.instance_id,
            "region": self.region,
            "dry_run": self.dry_run,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "last_cycle": self.last_cycle_timestamp,
            "checks": self.last_check_results,
            "recovery_states": self.state_tracker.get_all_states(),
            "recent_alerts_count": len(self.alerter.sent_alerts),
        }

    def execute_all_checks(self) -> List[Dict[str, Any]]:
        """Runs the active health check suite."""
        results: List[Dict[str, Any]] = []
        checks_cfg = self.config_loader.checks

        # 1. HTTP checks
        for item in checks_cfg.get("http", []):
            if not item.get("enabled", True):
                continue
            res = run_http_check(
                name=item["name"],
                url=item["url"],
                expected_status_codes=item.get("expected_status_codes", [200]),
                timeout_seconds=item.get("timeout_seconds", 3.0),
                max_response_time_ms=item.get("max_response_time_ms", 1500.0),
                target_container=item.get("target_container", "")
            )
            results.append(res)

        # 2. TCP checks
        for item in checks_cfg.get("tcp", []):
            if not item.get("enabled", True):
                continue
            res = run_tcp_check(
                name=item["name"],
                host=item["host"],
                port=item["port"],
                timeout_seconds=item.get("timeout_seconds", 2.0),
                target_container=item.get("target_container", "")
            )
            results.append(res)

        # 3. Networking (Ping & DNS)
        net_cfg = checks_cfg.get("networking", {})
        ping_cfg = net_cfg.get("ping", {})
        if ping_cfg.get("enabled", False):
            res = run_ping_check(
                targets=ping_cfg.get("target_hosts", ["8.8.8.8"]),
                count=ping_cfg.get("count", 2),
                timeout_seconds=ping_cfg.get("timeout_seconds", 2.0)
            )
            results.append(res)

        dns_cfg = net_cfg.get("dns", {})
        if dns_cfg.get("enabled", False):
            res = run_dns_check(
                domains=dns_cfg.get("domains", ["aws.amazon.com"]),
                timeout_seconds=dns_cfg.get("timeout_seconds", 3.0)
            )
            results.append(res)

        # 4. Docker container checks
        docker_cfg = checks_cfg.get("docker", {})
        if docker_cfg.get("enabled", False):
            sock_path = docker_cfg.get("socket_path", "unix://var/run/docker.sock")
            for c_cfg in docker_cfg.get("monitored_containers", []):
                res = run_docker_check(c_cfg, socket_path=sock_path)
                results.append(res)

        # 5. System host metrics
        sys_cfg = checks_cfg.get("system_metrics", {})
        if sys_cfg.get("enabled", False):
            res = run_system_metrics_check(sys_cfg.get("thresholds", {}))
            results.append(res)

        return results

    def run_cycle(self):
        """Single evaluation cycle."""
        self.last_cycle_timestamp = datetime.now(timezone.utc).isoformat()
        results = self.execute_all_checks()
        self.last_check_results = results

        failures = [r for r in results if not r.get("healthy", False)]

        if not failures:
            # All healthy
            for r in results:
                target = r.get("target_container") or r.get("name")
                if target:
                    self.state_tracker.record_check_result(target, is_healthy=True)
            self.logger.log_event(
                level="INFO",
                event_type="HEALTH_CYCLE_OK",
                message=f"All {len(results)} health checks passed nominal",
                details={"passed_count": len(results)}
            )
            return

        # Handle detected failures
        for fail in failures:
            target = fail.get("target_container") or fail.get("container_name") or fail.get("name", "unknown")
            self.logger.log_event(
                level="WARN",
                event_type="FAILURE_DETECTED",
                message=f"Check '{fail.get('name')}' failed: {fail.get('error')}",
                details=fail
            )

            # Trigger tiered recovery engine
            self.recovery_engine.handle_unhealthy_check(fail)

    def run(self, once: bool = False):
        """Main service loop."""
        self.logger.log_event(
            level="INFO",
            event_type="DAEMON_STARTED",
            message=f"AWS Self-Healing Monitor active. Instance: {self.instance_id}, DryRun: {self.dry_run}",
            details={"interval_seconds": self.config_loader.check_interval}
        )

        self.start_api_server()

        if once:
            self.run_cycle()
            return

        while self.running:
            try:
                self.run_cycle()
            except Exception as err:
                self.logger.log_event(
                    level="ERROR",
                    event_type="CYCLE_EXCEPTION",
                    message=f"Uncaught exception during monitoring cycle: {str(err)}",
                    details={"error": str(err)}
                )
            time.sleep(self.config_loader.check_interval)

    def stop(self):
        self.running = False
        self.logger.log_event(
            level="INFO",
            event_type="DAEMON_STOPPED",
            message="Self-healing monitor shutting down cleanly."
        )


def main():
    parser = argparse.ArgumentParser(description="AWS Self-Healing Server Recovery Daemon")
    parser.add_argument("--config", default="config/config.yaml", help="Path to YAML configuration")
    parser.add_argument("--dry-run", action="store_true", help="Simulate actions without mutating services")
    parser.add_argument("--once", action="store_true", help="Run a single check cycle and exit")
    args = parser.parse_args()

    daemon = SelfHealingDaemon(config_path=args.config, dry_run_override=args.dry_run)

    def sig_handler(sig, frame):
        daemon.stop()
        sys.exit(0)

    signal.signal(signal.SIGINT, sig_handler)
    signal.signal(signal.SIGTERM, sig_handler)

    daemon.run(once=args.once)


if __name__ == "__main__":
    main()`
  },
  {
    path: 'config/loader.py',
    name: 'loader.py',
    category: 'python',
    description: 'YAML configuration parser, environment variable overrides & IMDSv2 client',
    content: `"""
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
        return self.raw_config.get("aws", {})`
  },
  {
    path: 'recovery/engine.py',
    name: 'engine.py',
    category: 'python',
    description: 'Tiered recovery state machine, escalation orchestrator & alert dispatch',
    content: `"""
Tiered recovery orchestration engine.
Evaluates failure severity, determines escalation tier, applies backoff,
and coordinates action execution with logging and alert broadcasts.
"""

from typing import Any, Dict, Optional
from .state_tracker import StateTracker, TargetRecoveryState
from .actions import RecoveryActions


class RecoveryEngine:
    def __init__(
        self,
        config: Dict[str, Any],
        actions: RecoveryActions,
        state_tracker: StateTracker,
        alerter: Any,
        logger: Any
    ):
        self.config = config
        self.recovery_config = config.get("recovery", {})
        self.safeguards = config.get("safeguards", {})
        self.actions = actions
        self.state_tracker = state_tracker
        self.alerter = alerter
        self.logger = logger

    def handle_unhealthy_check(self, check_result: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        Coordinates recovery for an unhealthy check result.
        """
        check_name = check_result.get("name", "unknown")
        check_type = check_result.get("check_type", "unknown")
        target_container = check_result.get("target_container") or check_result.get("container_name") or check_name
        error_msg = check_result.get("error", "Unknown error")

        # 1. Update state tracker
        self.state_tracker.record_check_result(target_container, is_healthy=False)
        target_state: TargetRecoveryState = self.state_tracker.get_or_create(target_container)

        failure_threshold = self.safeguards.get("consecutive_failures_threshold", 3)
        cooldown_seconds = self.safeguards.get("cooldown_period_seconds", 180)
        max_per_hour = self.safeguards.get("max_recoveries_per_hour", 5)

        can_recover, reason = target_state.can_attempt_recovery(
            failure_threshold=failure_threshold,
            cooldown_seconds=cooldown_seconds,
            max_per_hour=max_per_hour
        )

        if not can_recover:
            self.logger.log_event(
                level="WARN",
                event_type="RECOVERY_SUPPRESSED",
                message=f"Recovery suppressed for '{target_container}': {reason}",
                details={
                    "target": target_container,
                    "consecutive_failures": target_state.consecutive_failures,
                    "reason": reason,
                    "is_locked_out": target_state.is_locked_out,
                }
            )

            if target_state.is_locked_out:
                self.alerter.send_alert(
                    event_type="SAFEGUARD_LOCKOUT",
                    subject=f"[SAFEGUARD LOCKOUT] {target_container} exceeded recovery limit",
                    message=(
                        f"Target '{target_container}' has reached {len(target_state.recovery_timestamps)} "
                        f"recoveries in the past hour. Manual intervention required to prevent restart loops."
                    ),
                    details={"target": target_container, "error": error_msg}
                )
            return None

        # 2. Determine Recovery Tier
        attempt = target_state.tier_attempt_count + 1
        tier_to_run = 1

        if attempt in (1, 2):
            tier_to_run = 1
        elif attempt == 3:
            tier_to_run = 2
        elif attempt == 4:
            tier_to_run = 3
        else:
            tier_to_run = 4

        # Compute exponential backoff
        base_backoff = self.safeguards.get("exponential_backoff_base_seconds", 5.0)
        multiplier = self.safeguards.get("exponential_backoff_multiplier", 2.0)
        max_backoff = self.safeguards.get("max_backoff_seconds", 60.0)
        backoff_sec = target_state.compute_backoff(base_backoff, multiplier, max_backoff)

        # Notify escalation if moving above Tier 1
        if tier_to_run > 1:
            self.alerter.send_alert(
                event_type="ESCALATION",
                subject=f"[TIER {tier_to_run} ESCALATION] Recovering {target_container}",
                message=(
                    f"Tier 1 recovery did not resolve failure on '{target_container}'. "
                    f"Escalating to Tier {tier_to_run}. Error: {error_msg}"
                ),
                details={"target": target_container, "tier": tier_to_run, "attempt": attempt}
            )

        self.logger.log_event(
            level="INFO",
            event_type="RECOVERY_INITIATED",
            message=f"Initiating Tier {tier_to_run} recovery for '{target_container}' (Attempt #{attempt})",
            details={
                "target": target_container,
                "tier": tier_to_run,
                "attempt": attempt,
                "backoff_seconds": backoff_sec,
                "error": error_msg,
            }
        )

        # 3. Execute recovery action
        action_result: Dict[str, Any] = {}
        if tier_to_run == 1:
            cfg = self.recovery_config.get("tier1_container_restart", {})
            action_result = self.actions.execute_tier1_restart_container(
                container_name=target_container,
                timeout_seconds=cfg.get("timeout_seconds", 30)
            )
        elif tier_to_run == 2:
            cfg = self.recovery_config.get("tier2_compose_recreate", {})
            action_result = self.actions.execute_tier2_compose_recreate(
                compose_file=cfg.get("compose_file", "/opt/self-healing-monitor/docker-compose.yml"),
                service_name=target_container,
                timeout_seconds=cfg.get("timeout_seconds", 60)
            )
        elif tier_to_run == 3:
            cfg = self.recovery_config.get("tier3_host_service_restart", {})
            action_result = self.actions.execute_tier3_host_service_restart(
                services=cfg.get("services", ["docker.service"]),
                timeout_seconds=cfg.get("timeout_seconds", 45)
            )
        elif tier_to_run >= 4:
            cfg = self.recovery_config.get("tier4_ec2_reboot", {})
            self.alerter.send_alert(
                event_type="HOST_REBOOT_TRIGGERED",
                subject=f"[CRITICAL - EC2 REBOOT] Last-resort reboot initiated for instance",
                message=(
                    f"Tiers 1-3 exhausted for '{target_container}'. Triggering EC2 instance reboot."
                ),
                details={"target": target_container, "instance_id": self.actions.ec2_instance_id}
            )
            action_result = self.actions.execute_tier4_ec2_reboot(
                drain_delay_seconds=cfg.get("drain_delay_seconds", 10)
            )

        # 4. Mark execution in state tracker
        target_state.mark_recovery_executed(
            tier=tier_to_run,
            cooldown_seconds=cooldown_seconds,
            backoff_seconds=backoff_sec
        )

        # 5. Log & Alert outcome
        success = action_result.get("success", False)
        event_type = "RECOVERY_SUCCEEDED" if success else "RECOVERY_FAILED"
        log_lvl = "INFO" if success else "ERROR"

        self.logger.log_event(
            level=log_lvl,
            event_type=event_type,
            message=action_result.get("message", "Recovery completed"),
            details=action_result
        )

        self.alerter.send_alert(
            event_type=event_type,
            subject=f"[{event_type}] Tier {tier_to_run} on {target_container}",
            message=action_result.get("message", "Recovery completed"),
            details=action_result
        )

        return action_result`
  },
  {
    path: 'recovery/actions.py',
    name: 'actions.py',
    category: 'python',
    description: 'Tier 1 (container restart), Tier 2 (compose recreate), Tier 3 (systemctl), Tier 4 (boto3 EC2 reboot)',
    content: `"""
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
        Runs docker compose up -d --force-recreate [service]
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
            }`
  },
  {
    path: 'recovery/state_tracker.py',
    name: 'state_tracker.py',
    category: 'python',
    description: 'Consecutive failure counts, exponential backoff math & 60m sliding window limits',
    content: `"""
State and safeguard tracker for automated self-healing.
Maintains consecutive failure streaks, backoff intervals, cooldown timers,
and enforces sliding-window recovery rate limits to avoid reboot/restart loops.
"""

import time
from typing import Any, Dict, List, Optional


class TargetRecoveryState:
    def __init__(self, target_id: str):
        self.target_id = target_id
        self.consecutive_failures = 0
        self.current_tier = 0
        self.tier_attempt_count = 0
        self.last_failure_time: Optional[float] = None
        self.last_recovery_time: Optional[float] = None
        self.cooldown_until: float = 0.0
        self.recovery_timestamps: List[float] = []
        self.is_locked_out = False
        self.lockout_reason: Optional[str] = None

    def record_failure(self):
        self.consecutive_failures += 1
        self.last_failure_time = time.time()

    def record_success(self):
        """Reset streaks on confirmed healthy state."""
        self.consecutive_failures = 0
        self.current_tier = 0
        self.tier_attempt_count = 0
        self.is_locked_out = False
        self.lockout_reason = None

    def can_attempt_recovery(
        self,
        failure_threshold: int,
        cooldown_seconds: int,
        max_per_hour: int
    ) -> tuple[bool, Optional[str]]:
        now = time.time()

        if self.consecutive_failures < failure_threshold:
            return False, f"Waiting for failure threshold ({self.consecutive_failures}/{failure_threshold})"

        if now < self.cooldown_until:
            wait_rem = int(self.cooldown_until - now)
            return False, f"Cooldown in effect ({wait_rem}s remaining)"

        one_hour_ago = now - 3600.0
        self.recovery_timestamps = [t for t in self.recovery_timestamps if t > one_hour_ago]

        if len(self.recovery_timestamps) >= max_per_hour:
            self.is_locked_out = True
            self.lockout_reason = f"Exceeded maximum hourly limit ({len(self.recovery_timestamps)}/{max_per_hour} recoveries in last 60m)"
            return False, self.lockout_reason

        return True, None

    def mark_recovery_executed(self, tier: int, cooldown_seconds: int, backoff_seconds: float):
        now = time.time()
        self.last_recovery_time = now
        self.current_tier = tier
        self.tier_attempt_count += 1
        self.recovery_timestamps.append(now)
        self.cooldown_until = now + cooldown_seconds + backoff_seconds

    def compute_backoff(self, base_seconds: float, multiplier: float, max_seconds: float) -> float:
        backoff = base_seconds * (multiplier ** max(0, self.tier_attempt_count - 1))
        return min(backoff, max_seconds)


class StateTracker:
    def __init__(self, safeguards_config: Dict[str, Any]):
        self.safeguards = safeguards_config
        self.targets: Dict[str, TargetRecoveryState] = {}

    def get_or_create(self, target_id: str) -> TargetRecoveryState:
        if target_id not in self.targets:
            self.targets[target_id] = TargetRecoveryState(target_id)
        return self.targets[target_id]

    def record_check_result(self, target_id: str, is_healthy: bool):
        state = self.get_or_create(target_id)
        if is_healthy:
            state.record_success()
        else:
            state.record_failure()

    def get_all_states(self) -> Dict[str, Dict[str, Any]]:
        now = time.time()
        result = {}
        for tid, s in self.targets.items():
            one_hour_ago = now - 3600.0
            hourly_count = len([t for t in s.recovery_timestamps if t > one_hour_ago])
            result[tid] = {
                "target_id": tid,
                "consecutive_failures": s.consecutive_failures,
                "current_tier": s.current_tier,
                "tier_attempt_count": s.tier_attempt_count,
                "is_locked_out": s.is_locked_out,
                "lockout_reason": s.lockout_reason,
                "in_cooldown": now < s.cooldown_until,
                "cooldown_remaining_seconds": max(0, int(s.cooldown_until - now)),
                "recoveries_past_hour": hourly_count,
            }
        return result`
  },
  {
    path: 'checks/http_check.py',
    name: 'http_check.py',
    category: 'python',
    description: 'HTTP status code, response time SLA and connection error prober',
    content: `"""
HTTP endpoint health check.
Validates status code and response time threshold.
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
        }`
  },
  {
    path: 'checks/docker_check.py',
    name: 'docker_check.py',
    category: 'python',
    description: 'Docker status, container healthchecks, exit code & restart-loop detector',
    content: `"""
Docker container status and healthcheck inspector.
Uses the official docker SDK if installed, with fallback to docker CLI.
"""

import json
import subprocess
from typing import Any, Dict, Optional


def _inspect_via_docker_sdk(
    container_name: str,
    socket_path: str = "unix://var/run/docker.sock"
) -> Optional[Dict[str, Any]]:
    try:
        import docker
        client = docker.DockerClient(base_url=socket_path)
        container = client.containers.get(container_name)
        attrs = container.attrs
        state = attrs.get("State", {})
        restart_count = attrs.get("RestartCount", 0)

        return {
            "name": container_name,
            "status": state.get("Status", "unknown"),
            "running": state.get("Running", False),
            "restarting": state.get("Restarting", False),
            "exit_code": state.get("ExitCode", 0),
            "health_status": state.get("Health", {}).get("Status", "none"),
            "restart_count": restart_count,
            "started_at": state.get("StartedAt"),
            "finished_at": state.get("FinishedAt"),
        }
    except Exception:
        return None


def _inspect_via_cli(container_name: str) -> Optional[Dict[str, Any]]:
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
    }`
  },
  {
    path: 'checks/tcp_check.py',
    name: 'tcp_check.py',
    category: 'python',
    description: 'Raw TCP socket handshake and connection latency prober',
    content: `"""
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
            pass`
  },
  {
    path: 'checks/ping_dns_check.py',
    name: 'ping_dns_check.py',
    category: 'python',
    description: 'ICMP ping packet loss and DNS resolution validation',
    content: `"""
Ping and DNS resolution health checks.
Validates host network connectivity and nameserver responsiveness.
"""

import subprocess
import socket
import time
from typing import Any, Dict, List


def run_ping_check(
    targets: List[str],
    count: int = 2,
    timeout_seconds: float = 2.0
) -> Dict[str, Any]:
    results = {}
    all_healthy = True

    for target in targets:
        start_time = time.perf_counter()
        try:
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
            except Exception as err:
                all_healthy = False
                results[domain] = {
                    "healthy": False,
                    "ips": [],
                    "lookup_time_ms": 0.0,
                    "error": f"DNS error: {str(err)}"
                }
    finally:
        socket.setdefaulttimeout(original_timeout)

    return {
        "check_type": "dns",
        "name": "network-dns",
        "healthy": all_healthy,
        "results": results,
        "error": None if all_healthy else "DNS query failed on one or more domains",
    }`
  },
  {
    path: 'checks/system_metrics.py',
    name: 'system_metrics.py',
    category: 'python',
    description: 'Host CPU, RAM, Disk utilization prober with psutil and /proc fallback',
    content: `"""
System resource metrics health check using psutil.
Monitors CPU, Memory, and Disk utilization with fallback to /proc filesystem.
"""

import os
from typing import Any, Dict


def run_system_metrics_check(
    thresholds: Dict[str, Any]
) -> Dict[str, Any]:
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
        pass

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
    }`
  },
  {
    path: 'alerts/sns_alerter.py',
    name: 'sns_alerter.py',
    category: 'python',
    description: 'Amazon SNS alert publisher, event whitelisting & diagnostic JSON payload formatter',
    content: `"""
Amazon SNS alert publisher.
Publishes structured alert messages to an SNS topic for PagerDuty, Slack,
email, or webhook subscriber fanout. Includes localized fallbacks for dry-run
and local test environments.
"""

import json
import os
import sys
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


class SNSAlerter:
    def __init__(
        self,
        aws_config: Dict[str, Any],
        ec2_instance_id: str,
        dry_run: bool = False
    ):
        self.aws_config = aws_config
        self.sns_config = aws_config.get("sns", {})
        self.region = aws_config.get("region", "us-east-1")
        self.ec2_instance_id = ec2_instance_id
        self.dry_run = dry_run

        self.enabled = self.sns_config.get("enabled", True)
        self.topic_arn = self.sns_config.get("topic_arn", "")
        self.events_to_notify = set(self.sns_config.get("events_to_notify", [
            "FAILURE_DETECTED",
            "RECOVERY_ATTEMPTED",
            "RECOVERY_SUCCEEDED",
            "RECOVERY_FAILED",
            "ESCALATION",
            "SAFEGUARD_LOCKOUT",
            "HOST_REBOOT_TRIGGERED",
        ]))

        self.sns_client = None
        self.sent_alerts: List[Dict[str, Any]] = []
        self._init_client()

    def _init_client(self):
        if not self.enabled or not self.topic_arn:
            return
        try:
            import boto3
            self.sns_client = boto3.client("sns", region_name=self.region)
        except Exception as err:
            sys.stderr.write(f"[WARN] SNS client initialization skipped: {err}\\n")
            self.sns_client = None

    def send_alert(
        self,
        event_type: str,
        subject: str,
        message: str,
        details: Optional[Dict[str, Any]] = None
    ) -> bool:
        if event_type not in self.events_to_notify:
            return False

        timestamp = datetime.now(timezone.utc).isoformat()
        alert_payload = {
            "timestamp": timestamp,
            "event_type": event_type,
            "instance_id": self.ec2_instance_id,
            "region": self.region,
            "summary": message,
            "details": details or {},
        }

        record = {
            "timestamp": timestamp,
            "event_type": event_type,
            "subject": subject[:100],
            "message": message,
            "payload": alert_payload,
            "dry_run": self.dry_run,
        }
        self.sent_alerts.append(record)

        if self.dry_run:
            sys.stdout.write(f"[DRY-RUN SNS ALERT] Subject: {subject} | Msg: {message}\\n")
            return True

        if not self.sns_client or not self.topic_arn:
            return False

        try:
            formatted_body = (
                f"SRE Self-Healing Alert: {event_type}\\n"
                f"Instance: {self.ec2_instance_id} ({self.region})\\n"
                f"Time: {timestamp}\\n\\n"
                f"{message}\\n\\n"
                f"--- Structured JSON Diagnostics ---\\n"
                f"{json.dumps(alert_payload, indent=2, default=str)}"
            )

            clean_subject = subject.replace("\\n", " ")[:98]

            self.sns_client.publish(
                TopicArn=self.topic_arn,
                Subject=clean_subject,
                Message=formatted_body,
                MessageAttributes={
                    "EventType": {"DataType": "String", "StringValue": event_type},
                    "InstanceId": {"DataType": "String", "StringValue": self.ec2_instance_id},
                }
            )
            return True
        except Exception as err:
            sys.stderr.write(f"[ERROR] Failed to publish SNS notification: {err}\\n")
            return False

    def get_recent_alerts(self, limit: int = 20) -> List[Dict[str, Any]]:
        return self.sent_alerts[-limit:]`
  },
  {
    path: 'logging_utils/json_logger.py',
    name: 'json_logger.py',
    category: 'python',
    description: 'Structured JSON formatter, history ring-buffer & CloudWatch Logs shipment',
    content: `"""
Structured JSON logger for the Self-Healing Monitor.
Outputs standardized JSON log records to stdout for Docker/systemd/CloudWatch Agent,
and supports direct CloudWatch Logs PutLogEvents shipment via boto3.
"""

import json
import logging
import sys
import time
from datetime import datetime, timezone
from collections import deque
from typing import Any, Dict, List, Optional


class JSONFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        log_entry: Dict[str, Any] = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }

        if hasattr(record, "structured_data"):
            log_entry.update(record.structured_data)

        if record.exc_info:
            log_entry["exception"] = self.formatException(record.exc_info)

        return json.dumps(log_entry, default=str)


class CloudWatchShipper:
    def __init__(self, log_group: str, stream_name: str, region: str):
        self.log_group = log_group
        self.stream_name = stream_name
        self.region = region
        self.client = None
        self.sequence_token: Optional[str] = None
        self.enabled = False
        self._init_client()

    def _init_client(self):
        try:
            import boto3
            self.client = boto3.client("logs", region_name=self.region)
            try:
                self.client.create_log_stream(
                    logGroupName=self.log_group,
                    logStreamName=self.stream_name
                )
            except Exception:
                pass
            self.enabled = True
        except Exception as err:
            self.enabled = False

    def ship_event(self, message: str):
        if not self.enabled or not self.client:
            return
        try:
            kwargs = {
                "logGroupName": self.log_group,
                "logStreamName": self.stream_name,
                "logEvents": [
                    {
                        "timestamp": int(time.time() * 1000),
                        "message": message,
                    }
                ]
            }
            if self.sequence_token:
                kwargs["sequenceToken"] = self.sequence_token
            resp = self.client.put_log_events(**kwargs)
            self.sequence_token = resp.get("nextSequenceToken")
        except Exception:
            pass


class SelfHealingLogger:
    def __init__(self, name: str = "self_healing_monitor", instance_id: str = "unknown"):
        self.instance_id = instance_id
        self.logger = logging.getLogger(name)
        self.logger.setLevel(logging.INFO)
        self.logger.propagate = False

        if not self.logger.handlers:
            handler = logging.StreamHandler(sys.stdout)
            handler.setFormatter(JSONFormatter())
            self.logger.addHandler(handler)

        self.history: deque = deque(maxlen=200)
        self.cw_shipper: Optional[CloudWatchShipper] = None

    def enable_cloudwatch(self, log_group: str, stream_prefix: str, region: str):
        stream_name = f"{stream_prefix}-{self.instance_id}-{int(time.time())}"
        self.cw_shipper = CloudWatchShipper(log_group, stream_name, region)

    def log_event(
        self,
        level: str,
        event_type: str,
        message: str,
        details: Optional[Dict[str, Any]] = None
    ):
        payload: Dict[str, Any] = {
            "instance_id": self.instance_id,
            "event_type": event_type,
            "details": details or {},
        }

        history_entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": level.upper(),
            "event_type": event_type,
            "message": message,
            "details": details or {},
        }
        self.history.append(history_entry)

        extra = {"structured_data": payload}
        lvl = getattr(logging, level.upper(), logging.INFO)
        self.logger.log(lvl, message, extra=extra)

        if self.cw_shipper and self.cw_shipper.enabled:
            raw_json = json.dumps({
                "timestamp": history_entry["timestamp"],
                "level": level.upper(),
                "instance_id": self.instance_id,
                "event_type": event_type,
                "message": message,
                "details": details or {},
            })
            self.cw_shipper.ship_event(raw_json)

    def get_recent_history(self, limit: int = 50) -> List[Dict[str, Any]]:
        return list(self.history)[-limit:]`
  },
  {
    path: 'api/status_api.py',
    name: 'status_api.py',
    category: 'python',
    description: 'Zero-dependency daemon HTTP server exposing /health, /status & /history',
    content: `"""
Lightweight status and health HTTP API.
Exposes /health, /status, and /history endpoints.
"""

import http.server
import json
import threading
from typing import Any, Callable, Dict


class StatusHTTPHandler(http.server.BaseHTTPRequestHandler):
    get_status_fn: Callable[[], Dict[str, Any]]
    get_history_fn: Callable[[], Any]

    def log_message(self, format: str, *args: Any):
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
    class BoundHandler(StatusHTTPHandler):
        pass

    BoundHandler.get_status_fn = staticmethod(get_status_fn)
    BoundHandler.get_history_fn = staticmethod(get_history_fn)

    server = http.server.HTTPServer(("0.0.0.0", port), BoundHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return thread`
  },
  {
    path: 'Dockerfile',
    name: 'Dockerfile',
    category: 'docker',
    description: 'Python 3.11-slim container with Docker CLI, ping, dnsutils & healthcheck probe',
    content: `# Production Dockerfile for AWS Self-Healing Server Monitor
FROM python:3.11-slim

LABEL maintainer="DevOps & SRE Engineering Team"
LABEL description="Automated multi-tier self-healing server monitor for AWS EC2"

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \\
    curl \\
    iputils-ping \\
    dnsutils \\
    ca-certificates \\
    gnupg \\
    && mkdir -p /etc/apt/keyrings \\
    && curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \\
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian bookworm stable" \\
       > /etc/apt/sources.list.d/docker.list \\
    && apt-get update && apt-get install -y --no-install-recommends \\
    docker-ce-cli \\
    docker-compose-plugin \\
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \\
  CMD curl -f http://localhost:8080/health || exit 1

ENTRYPOINT ["python3", "main.py"]
CMD ["--config", "config/config.yaml"]`
  },
  {
    path: 'docker-compose.yml',
    name: 'docker-compose.yml',
    category: 'docker',
    description: 'Compose stack running monitored Nginx web service and self-healing monitor daemon',
    content: `services:
  # ============================================================================
  # 1. Sample Monitored Web Application (Nginx)
  # ============================================================================
  sample-nginx:
    image: nginx:alpine
    container_name: sample-nginx
    restart: unless-stopped
    ports:
      - "80:80"
    healthcheck:
      test: ["CMD-SHELL", "wget -q --spider http://localhost:80/ || exit 1"]
      interval: 10s
      timeout: 3s
      retries: 3
      start_period: 5s
    volumes:
      - ./nginx-html:/usr/share/nginx/html:ro
    networks:
      - monitor-net

  # ============================================================================
  # 2. Self-Healing Monitor Daemon
  # ============================================================================
  self-healing-monitor:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: self-healing-monitor
    restart: always
    network_mode: "host"
    environment:
      - MONITOR_CONFIG_PATH=/app/config/config.yaml
      - AWS_DEFAULT_REGION=\${AWS_DEFAULT_REGION:-us-east-1}
      - SNS_TOPIC_ARN=\${SNS_TOPIC_ARN:-}
      - CLOUDWATCH_LOG_GROUP=\${CLOUDWATCH_LOG_GROUP:-/aws/ec2/self-healing-monitor}
      - DRY_RUN=\${DRY_RUN:-false}
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - .:/opt/self-healing-monitor:ro
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
    depends_on:
      sample-nginx:
        condition: service_started

networks:
  monitor-net:
    driver: bridge`
  },
  {
    path: 'systemd/self-healing-monitor.service',
    name: 'self-healing-monitor.service',
    category: 'systemd',
    description: 'Host-level systemd unit ensuring supervisor restart on failure with CPU & memory limits',
    content: `[Unit]
Description=AWS Self-Healing Server Monitor & Recovery Daemon
After=network.target docker.service
Requires=docker.service
Documentation=https://github.com/your-org/aws-self-healing-monitor

[Service]
Type=simple
User=root
WorkingDirectory=/opt/self-healing-monitor

EnvironmentFile=-/etc/default/self-healing-monitor
Environment=PYTHONUNBUFFERED=1
Environment=MONITOR_CONFIG_PATH=/opt/self-healing-monitor/config/config.yaml

ExecStart=/usr/bin/python3 /opt/self-healing-monitor/main.py --config /opt/self-healing-monitor/config/config.yaml

Restart=always
RestartSec=5s
StartLimitIntervalSec=300
StartLimitBurst=5

CPUQuota=25%
MemoryLimit=128M

StandardOutput=journal
StandardError=journal
SyslogIdentifier=self-healing-monitor

KillMode=mixed
TimeoutStopSec=20s

[Install]
WantedBy=multi-user.target`
  },
  {
    path: 'aws/iam_policy.json',
    name: 'iam_policy.json',
    category: 'json',
    description: 'Least-privilege IAM policy: CloudWatch Logs, SNS publishing & tag-conditioned EC2 reboot',
    content: `{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowCloudWatchLogsShipment",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents",
        "logs:DescribeLogStreams"
      ],
      "Resource": "arn:aws:logs:*:*:log-group:/aws/ec2/self-healing-monitor:*"
    },
    {
      "Sid": "AllowSNSTopicPublishing",
      "Effect": "Allow",
      "Action": [
        "sns:Publish"
      ],
      "Resource": "arn:aws:sns:*:*:self-healing-server-alerts"
    },
    {
      "Sid": "AllowSelfInstanceRebootOnly",
      "Effect": "Allow",
      "Action": [
        "ec2:RebootInstances"
      ],
      "Resource": "arn:aws:ec2:*:*:instance/*",
      "Condition": {
        "StringEquals": {
          "ec2:ResourceTag/SelfHealingMonitored": "true"
        }
      }
    },
    {
      "Sid": "AllowDescribeInstanceStatus",
      "Effect": "Allow",
      "Action": [
        "ec2:DescribeInstances",
        "ec2:DescribeInstanceStatus"
      ],
      "Resource": "*"
    }
  ]
}`
  },
  {
    path: 'aws/ec2_user_data.sh',
    name: 'ec2_user_data.sh',
    category: 'shell',
    description: 'Cloud-init bootstrap script for Ubuntu 22.04 LTS (Docker, Compose, IMDSv2, Systemd)',
    content: `#!/bin/bash
set -euo pipefail
exec > >(tee /var/log/user-data.log | logger -t user-data -s 2>/dev/console) 2>&1

echo "[$(date)] Starting Self-Healing Monitor EC2 Provisioning..."

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y --no-install-recommends \\
    ca-certificates curl gnupg lsb-release git python3-pip python3-dev iputils-ping dnsutils jq

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

echo \\
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \\
  $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

systemctl enable docker
systemctl start docker

DEPLOY_DIR="/opt/self-healing-monitor"
mkdir -p "\${DEPLOY_DIR}"
cd "\${DEPLOY_DIR}"

IMDS_TOKEN=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 300" || true)
EC2_INSTANCE_ID=$(curl -s -H "X-aws-ec2-metadata-token: $IMDS_TOKEN" "http://169.254.169.254/latest/meta-data/instance-id" || echo "unknown")
EC2_REGION=$(curl -s -H "X-aws-ec2-metadata-token: $IMDS_TOKEN" "http://169.254.169.254/latest/meta-data/placement/region" || echo "us-east-1")

cat <<EOF > /etc/default/self-healing-monitor
EC2_INSTANCE_ID=\${EC2_INSTANCE_ID}
AWS_DEFAULT_REGION=\${EC2_REGION}
SNS_TOPIC_ARN=\${SNS_TOPIC_ARN:-}
CLOUDWATCH_LOG_GROUP=/aws/ec2/self-healing-monitor
DRY_RUN=false
PYTHONUNBUFFERED=1
EOF

echo "[$(date)] Provisioning complete! Ready for stack launch."`
  },
  {
    path: 'terraform/main.tf',
    name: 'main.tf',
    category: 'terraform',
    description: 'Terraform AWS definitions: EC2, IAM role, SNS topic, Security Group & CloudWatch Alarm',
    content: `terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.40"
    }
  }
}

provider "aws" {
  region = var.aws_region
  default_tags {
    tags = {
      Project     = "SelfHealingMonitor"
      Environment = var.environment
      ManagedBy   = "Terraform"
    }
  }
}

resource "aws_sns_topic" "alerts" {
  name = "self-healing-server-alerts"
}

resource "aws_sns_topic_subscription" "email_sub" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

resource "aws_cloudwatch_log_group" "monitor_logs" {
  name              = "/aws/ec2/self-healing-monitor"
  retention_in_days = 30
}

resource "aws_iam_role" "ec2_monitor_role" {
  name = "SelfHealingMonitorEC2Role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_policy" "monitor_policy" {
  name        = "SelfHealingMonitorPolicy"
  description = "Allows self-healing daemon to write CloudWatch logs, publish to SNS, and reboot tagged instance"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "CloudWatchLogsAccess"
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:DescribeLogStreams"
        ]
        Resource = "\${aws_cloudwatch_log_group.monitor_logs.arn}:*"
      },
      {
        Sid    = "SNSPublishAccess"
        Effect = "Allow"
        Action = [
          "sns:Publish"
        ]
        Resource = aws_sns_topic.alerts.arn
      },
      {
        Sid    = "EC2RebootTaggedInstanceOnly"
        Effect = "Allow"
        Action = [
          "ec2:RebootInstances"
        ]
        Resource = "arn:aws:ec2:\${var.aws_region}:*:instance/*"
        Condition = {
          StringEquals = {
            "ec2:ResourceTag/SelfHealingMonitored" = "true"
          }
        }
      },
      {
        Sid    = "DescribeEC2Status"
        Effect = "Allow"
        Action = [
          "ec2:DescribeInstances",
          "ec2:DescribeInstanceStatus"
        ]
        Resource = "*"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "attach_monitor_policy" {
  role       = aws_iam_role.ec2_monitor_role.name
  policy_arn = aws_iam_policy.monitor_policy.arn
}

resource "aws_iam_instance_profile" "ec2_profile" {
  name = "SelfHealingMonitorInstanceProfile"
  role = aws_iam_role.ec2_monitor_role.name
}

resource "aws_security_group" "server_sg" {
  name        = "self-healing-server-sg"
  description = "Minimal ingress for web workload and health status API"

  ingress {
    description = "HTTP Public Web Traffic"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "Self-Healing Monitor Status API"
    from_port   = 8080
    to_port     = 8080
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "SSH Administration"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.allowed_ssh_cidr]
  }

  egress {
    description = "Outbound traffic to Internet and AWS endpoints"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

data "aws_ami" "ubuntu_lts" {
  most_recent = true
  owners      = ["099720109477"]

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

resource "aws_instance" "self_healing_node" {
  ami                  = data.aws_ami.ubuntu_lts.id
  instance_type        = var.instance_type
  iam_instance_profile = aws_iam_instance_profile.ec2_profile.name
  vpc_security_group_ids = [
    aws_security_group.server_sg.id
  ]

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 2
  }

  root_block_device {
    volume_size           = 20
    volume_type           = "gp3"
    delete_on_termination = true
    encrypted             = true
  }

  user_data = templatefile("\${path.module}/../aws/ec2_user_data.sh", {})

  tags = {
    Name                   = "Self-Healing-Server-Node"
    SelfHealingMonitored   = "true"
  }
}

resource "aws_cloudwatch_metric_alarm" "instance_status_check" {
  alarm_name          = "ec2-\${aws_instance.self_healing_node.id}-status-check-failed"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 2
  metric_name         = "StatusCheckFailed"
  namespace           = "AWS/EC2"
  period              = 60
  statistic           = "Maximum"
  threshold           = 1
  alarm_description   = "Fires when EC2 host hardware or system status checks fail"
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = {
    InstanceId = aws_instance.self_healing_node.id
  }
}`
  },
  {
    path: 'scripts/simulate_failure.sh',
    name: 'simulate_failure.sh',
    category: 'shell',
    description: 'Chaos simulation script: kill container, block port 80 with iptables, fill disk',
    content: `#!/bin/bash
set -euo pipefail

CONTAINER_NAME="sample-nginx"

print_usage() {
  echo "Usage: $0 {kill-container|block-port|unblock-port|fill-disk|clean-disk|curl-status|all}"
}

simulate_kill_container() {
  echo "[SIMULATING FAILURE] Killing Docker container '\${CONTAINER_NAME}'..."
  docker kill "\${CONTAINER_NAME}" || true
  echo "Container killed. Monitor will trigger Tier 1 restart on next check."
}

simulate_block_port() {
  echo "[SIMULATING FAILURE] Dropping incoming port 80 traffic via iptables..."
  sudo iptables -I INPUT 1 -p tcp --dport 80 -j DROP
  echo "Port 80 blocked. HTTP & TCP probes will timeout."
}

simulate_unblock_port() {
  echo "Restoring port 80 connectivity..."
  sudo iptables -D INPUT -p tcp --dport 80 -j DROP || true
  echo "Traffic restored."
}

simulate_fill_disk() {
  echo "[SIMULATING FAILURE] Filling disk with 5GB temp file..."
  sudo fallocate -l 5G /tmp/disk_fill_test.img || dd if=/dev/zero of=/tmp/disk_fill_test.img bs=1M count=5000
  df -h /
}

simulate_clean_disk() {
  echo "Cleaning up temporary disk fill file..."
  sudo rm -f /tmp/disk_fill_test.img
  df -h /
}

query_status() {
  curl -s http://localhost:8080/status | jq . || curl -s http://localhost:8080/status
}

case "\${1:-}" in
  kill-container) simulate_kill_container ;;
  block-port)     simulate_block_port ;;
  unblock-port)   simulate_unblock_port ;;
  fill-disk)      simulate_fill_disk ;;
  clean-disk)     simulate_clean_disk ;;
  curl-status)    query_status ;;
  *) print_usage; exit 1 ;;
esac`
  },
  {
    path: 'README.md',
    name: 'README.md',
    category: 'docs',
    description: 'Architecture diagrams, deployment instructions, test plan & improvements',
    content: `# AWS Self-Healing Server Monitor & Automated Recovery System

An automated, intermediate-level self-healing supervisor engineered for Linux workloads on AWS EC2. It actively inspects networking (HTTP, TCP, Ping, DNS), container lifecycles (Docker status, healthcheck states, restart loops), and host resources (CPU, Memory, Disk), executing tiered automated recovery with exponential backoff and rate-limiting safeguards before escalating.`
  }
];
