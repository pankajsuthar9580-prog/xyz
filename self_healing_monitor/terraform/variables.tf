variable "aws_region" {
  description = "AWS region for deployment"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment identifier (e.g. production, staging)"
  type        = string
  default     = "production"
}

variable "instance_type" {
  description = "EC2 instance type (sized for low footprint, e.g. t3.micro or t3.small)"
  type        = string
  default     = "t3.micro"
}

variable "alert_email" {
  description = "Email address to subscribe to the SNS alert topic"
  type        = string
  default     = "sre-alerts@example.com"
}

variable "allowed_ssh_cidr" {
  description = "CIDR block permitted to access SSH port 22 (set your IP for security)"
  type        = string
  default     = "0.0.0.0/0"
}
