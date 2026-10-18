output "ec2_instance_id" {
  description = "The EC2 Instance ID of the monitored server"
  value       = aws_instance.self_healing_node.id
}

output "ec2_public_ip" {
  description = "Public IP address of the self-healing server"
  value       = aws_instance.self_healing_node.public_ip
}

output "sns_topic_arn" {
  description = "ARN of the Amazon SNS topic for self-healing alerts"
  value       = aws_sns_topic.alerts.arn
}

output "cloudwatch_log_group" {
  description = "CloudWatch Log Group receiving structured JSON logs"
  value       = aws_cloudwatch_log_group.monitor_logs.name
}

output "health_check_url" {
  description = "URL to check status API on the instance"
  value       = "http://${aws_instance.self_healing_node.public_ip}:8080/status"
}
