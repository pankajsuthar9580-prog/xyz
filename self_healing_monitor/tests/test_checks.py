import os
import sys
import time
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from recovery.state_tracker import StateTracker, TargetRecoveryState


class TestStateTracker(unittest.TestCase):
    def setUp(self):
        self.safeguards = {
            "consecutive_failures_threshold": 3,
            "cooldown_period_seconds": 10,
            "max_recoveries_per_hour": 2,
            "exponential_backoff_base_seconds": 2.0,
            "exponential_backoff_multiplier": 2.0,
            "max_backoff_seconds": 30.0,
        }
        self.tracker = StateTracker(self.safeguards)

    def test_failure_threshold_enforcement(self):
        target = "test-container"
        state = self.tracker.get_or_create(target)

        # 1st failure: below threshold of 3
        state.record_failure()
        can, reason = state.can_attempt_recovery(3, 10, 2)
        self.assertFalse(can)
        self.assertIn("Waiting for failure threshold", reason)

        # 2nd failure: below threshold
        state.record_failure()
        can, _ = state.can_attempt_recovery(3, 10, 2)
        self.assertFalse(can)

        # 3rd failure: threshold reached
        state.record_failure()
        can, reason = state.can_attempt_recovery(3, 10, 2)
        self.assertTrue(can)
        self.assertIsNone(reason)

    def test_cooldown_and_backoff(self):
        target = "test-container"
        state = self.tracker.get_or_create(target)
        for _ in range(3):
            state.record_failure()

        # Mark recovery executed with 5s cooldown
        state.mark_recovery_executed(tier=1, cooldown_seconds=5, backoff_seconds=2.0)
        self.assertEqual(state.current_tier, 1)

        # Immediate next check should be blocked by cooldown
        can, reason = state.can_attempt_recovery(3, 5, 2)
        self.assertFalse(can)
        self.assertIn("Cooldown in effect", reason)

    def test_max_hourly_lockout(self):
        target = "test-container"
        state = self.tracker.get_or_create(target)
        for _ in range(3):
            state.record_failure()

        # Simulate 2 recoveries (max allowed per hour)
        state.mark_recovery_executed(tier=1, cooldown_seconds=0, backoff_seconds=0)
        state.cooldown_until = 0  # clear cooldown manually for test

        state.mark_recovery_executed(tier=1, cooldown_seconds=0, backoff_seconds=0)
        state.cooldown_until = 0

        # 3rd attempt should trigger hourly lockout
        can, reason = state.can_attempt_recovery(3, 0, 2)
        self.assertFalse(can)
        self.assertTrue(state.is_locked_out)
        self.assertIn("Exceeded maximum hourly limit", reason)


if __name__ == "__main__":
    unittest.main()
