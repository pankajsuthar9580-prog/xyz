#!/usr/bin/env python3
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
        self.last_cycle_timestamp: Optional[str] = None

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
    main()
