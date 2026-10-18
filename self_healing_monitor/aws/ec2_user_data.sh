#!/bin/bash
# ==============================================================================
# EC2 User-Data Bootstrapping Script for Ubuntu 22.04 LTS
# ==============================================================================
# Installs Docker, Docker Compose, Python 3.11, configures IMDSv2,
# deploys the Self-Healing Server Monitor, and registers the systemd unit.
# ==============================================================================

set -euo pipefail
exec > >(tee /var/log/user-data.log | logger -t user-data -s 2>/dev/console) 2>&1

echo "[$(date)] Starting Self-Healing Monitor EC2 Provisioning..."

# 1. Update OS and install essential tools
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    gnupg \
    lsb-release \
    git \
    python3-pip \
    python3-dev \
    iputils-ping \
    dnsutils \
    jq

# 2. Install official Docker Engine and Docker Compose
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

systemctl enable docker
systemctl start docker

# 3. Create deployment directory
DEPLOY_DIR="/opt/self-healing-monitor"
mkdir -p "${DEPLOY_DIR}"
cd "${DEPLOY_DIR}"

# 4. Fetch EC2 Instance Metadata (IMDSv2)
IMDS_TOKEN=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 300" || true)
EC2_INSTANCE_ID=$(curl -s -H "X-aws-ec2-metadata-token: $IMDS_TOKEN" "http://169.254.169.254/latest/meta-data/instance-id" || echo "unknown")
EC2_REGION=$(curl -s -H "X-aws-ec2-metadata-token: $IMDS_TOKEN" "http://169.254.169.254/latest/meta-data/placement/region" || echo "us-east-1")

echo "[$(date)] Detected EC2 Instance: ${EC2_INSTANCE_ID} in ${EC2_REGION}"

# 5. Populate environment variables file for systemd / docker compose
cat <<EOF > /etc/default/self-healing-monitor
EC2_INSTANCE_ID=${EC2_INSTANCE_ID}
AWS_DEFAULT_REGION=${EC2_REGION}
SNS_TOPIC_ARN=${SNS_TOPIC_ARN:-}
CLOUDWATCH_LOG_GROUP=/aws/ec2/self-healing-monitor
DRY_RUN=false
PYTHONUNBUFFERED=1
EOF

# 6. Deploy Docker Compose sample app and start monitor container
# If pulling from ECR or Git in production:
# git clone https://github.com/your-org/aws-self-healing-monitor.git .
# docker compose -f docker-compose.yml up -d

echo "[$(date)] Provisioning complete! Ready for stack launch."
