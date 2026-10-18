"""
Structured JSON logger for the Self-Healing Monitor.
Outputs standardized JSON log records to stdout for Docker/systemd/CloudWatch Agent,
and supports direct CloudWatch Logs PutLogEvents shipment via boto3.
Maintains an in-memory event history ring buffer for /status and /history endpoints.
"""

import json
import logging
import sys
import time
from datetime import datetime, timezone
from collections import deque
from typing import Any, Dict, List, Optional


class JSONFormatter(logging.Formatter):
    """Formats log records as single-line structured JSON."""

    def format(self, record: logging.LogRecord) -> str:
        log_entry: Dict[str, Any] = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }

        # Append structured context if provided via extra
        if hasattr(record, "structured_data"):
            log_entry.update(record.structured_data)

        if record.exc_info:
            log_entry["exception"] = self.formatException(record.exc_info)

        return json.dumps(log_entry, default=str)


class CloudWatchShipper:
    """Lightweight boto3 wrapper to push structured log events directly to CloudWatch."""

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
            # Create stream if not exists
            try:
                self.client.create_log_stream(
                    logGroupName=self.log_group,
                    logStreamName=self.stream_name
                )
            except self.client.exceptions.ResourceAlreadyExistsException:
                pass
            self.enabled = True
        except Exception as err:
            # Fallback to local stdout gracefully
            sys.stderr.write(f"[WARN] CloudWatch shipper disabled: {err}\n")
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
        except Exception as err:
            sys.stderr.write(f"[WARN] Failed to ship log to CloudWatch: {err}\n")


class SelfHealingLogger:
    def __init__(self, name: str = "self_healing_monitor", instance_id: str = "unknown"):
        self.instance_id = instance_id
        self.logger = logging.getLogger(name)
        self.logger.setLevel(logging.INFO)
        self.logger.propagate = False

        # Clear existing handlers
        if not self.logger.handlers:
            handler = logging.StreamHandler(sys.stdout)
            handler.setFormatter(JSONFormatter())
            self.logger.addHandler(handler)

        # In-memory history ring buffer for the last 200 events
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
        """Standardized structured log entry across checks and recovery actions."""
        payload: Dict[str, Any] = {
            "instance_id": self.instance_id,
            "event_type": event_type,
            "details": details or {},
        }

        # Keep in history
        history_entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": level.upper(),
            "event_type": event_type,
            "message": message,
            "details": details or {},
        }
        self.history.append(history_entry)

        # Log via python logger
        extra = {"structured_data": payload}
        lvl = getattr(logging, level.upper(), logging.INFO)
        self.logger.log(lvl, message, extra=extra)

        # Ship to CloudWatch if configured
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
        return list(self.history)[-limit:]
