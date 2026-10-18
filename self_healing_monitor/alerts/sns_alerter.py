"""
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
            sys.stderr.write(f"[WARN] SNS client initialization skipped: {err}\n")
            self.sns_client = None

    def send_alert(
        self,
        event_type: str,
        subject: str,
        message: str,
        details: Optional[Dict[str, Any]] = None
    ) -> bool:
        """
        Publishes alert to AWS SNS topic if event_type is in configured whitelist.
        """
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

        # Save to local record
        record = {
            "timestamp": timestamp,
            "event_type": event_type,
            "subject": subject[:100],  # SNS subject limit is 100 chars
            "message": message,
            "payload": alert_payload,
            "dry_run": self.dry_run,
        }
        self.sent_alerts.append(record)

        if self.dry_run:
            sys.stdout.write(f"[DRY-RUN SNS ALERT] Subject: {subject} | Msg: {message}\n")
            return True

        if not self.sns_client or not self.topic_arn:
            return False

        try:
            formatted_body = (
                f"SRE Self-Healing Alert: {event_type}\n"
                f"Instance: {self.ec2_instance_id} ({self.region})\n"
                f"Time: {timestamp}\n\n"
                f"{message}\n\n"
                f"--- Structured JSON Diagnostics ---\n"
                f"{json.dumps(alert_payload, indent=2, default=str)}"
            )

            # SNS Subject length is capped at 100 characters by AWS
            clean_subject = subject.replace("\n", " ")[:98]

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
            sys.stderr.write(f"[ERROR] Failed to publish SNS notification: {err}\n")
            return False

    def get_recent_alerts(self, limit: int = 20) -> List[Dict[str, Any]]:
        return self.sent_alerts[-limit:]
