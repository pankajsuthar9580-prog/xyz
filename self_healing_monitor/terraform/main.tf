terraform {
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

# ------------------------------------------------------------------------------
# 1. Amazon SNS Alert Topic & Subscription
# ------------------------------------------------------------------------------
resource "aws_sns_topic" "alerts" {
  name = "self-healing-server-alerts"
}

resource "aws_sns_topic_subscription" "email_sub" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# ------------------------------------------------------------------------------
# 2. Amazon CloudWatch Log Group
# ------------------------------------------------------------------------------
resource "aws_cloudwatch_log_group" "monitor_logs" {
  name              = "/aws/ec2/self-healing-monitor"
  retention_in_days = 30
}

# ------------------------------------------------------------------------------
# 3. IAM Role & Least Privilege Instance Profile
# ------------------------------------------------------------------------------
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
        Resource = "${aws_cloudwatch_log_group.monitor_logs.arn}:*"
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
        Resource = "arn:aws:ec2:${var.aws_region}:*:instance/*"
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

# ------------------------------------------------------------------------------
# 4. Security Group (Minimal Inbound)
# ------------------------------------------------------------------------------
resource "aws_security_group" "server_sg" {
  name        = "self-healing-server-sg"
  description = "Minimal ingress for web workload and health status API"

  # HTTP Web Workload
  ingress {
    description = "HTTP Public Web Traffic"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # Status API (Exposed for monitoring dashboard/health probes)
  ingress {
    description = "Self-Healing Monitor Status API"
    from_port   = 8080
    to_port     = 8080
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # SSH (Restricted)
  ingress {
    description = "SSH Administration"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.allowed_ssh_cidr]
  }

  # Outbound Egress to AWS APIs & Package Mirrors
  egress {
    description = "Outbound traffic to Internet and AWS endpoints"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# ------------------------------------------------------------------------------
# 5. Ubuntu 22.04 LTS AMI Data Source
# ------------------------------------------------------------------------------
data "aws_ami" "ubuntu_lts" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# ------------------------------------------------------------------------------
# 6. EC2 Instance with IMDSv2 Enforced & Bootstrapping User-Data
# ------------------------------------------------------------------------------
resource "aws_instance" "self_healing_node" {
  ami                  = data.aws_ami.ubuntu_lts.id
  instance_type        = var.instance_type
  iam_instance_profile = aws_iam_instance_profile.ec2_profile.name
  vpc_security_group_ids = [
    aws_security_group.server_sg.id
  ]

  # Security best practice: Enforce IMDSv2 token requirement
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required" # IMDSv2 mandatory
    http_put_response_hop_limit = 2
  }

  root_block_device {
    volume_size           = 20
    volume_type           = "gp3"
    delete_on_termination = true
    encrypted             = true
  }

  user_data = templatefile("${path.module}/../aws/ec2_user_data.sh", {})

  tags = {
    Name                   = "Self-Healing-Server-Node"
    SelfHealingMonitored   = "true" # Required by IAM policy condition
  }
}

# ------------------------------------------------------------------------------
# 7. CloudWatch Metric Alarm for EC2 Status Check Failure
# ------------------------------------------------------------------------------
resource "aws_cloudwatch_metric_alarm" "instance_status_check" {
  alarm_name          = "ec2-${aws_instance.self_healing_node.id}-status-check-failed"
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
}
