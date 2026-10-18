"""
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
        # Progression logic:
        # Attempts 1-2: Tier 1 (Container restart)
        # Attempt 3: Tier 2 (Docker compose recreate)
        # Attempt 4: Tier 3 (Host service restart)
        # Attempt 5: Tier 4 (EC2 Reboot)
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

        return action_result
