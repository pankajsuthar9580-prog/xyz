"""
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
        self.recovery_timestamps: List[float] = []  # Timestamps of recoveries in the last hour
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
        """
        Evaluates safeguard conditions:
        1. Has failure threshold been reached?
        2. Is the target currently cooling down?
        3. Has the hourly recovery rate limit been breached?
        """
        now = time.time()

        if self.consecutive_failures < failure_threshold:
            return False, f"Waiting for failure threshold ({self.consecutive_failures}/{failure_threshold})"

        if now < self.cooldown_until:
            wait_rem = int(self.cooldown_until - now)
            return False, f"Cooldown in effect ({wait_rem}s remaining)"

        # Prune recovery timestamps older than 3600 seconds (1 hour sliding window)
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
        # Combine cooldown and exponential backoff
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
        return result
