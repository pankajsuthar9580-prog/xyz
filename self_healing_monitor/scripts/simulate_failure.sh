#!/bin/bash
# ==============================================================================
# SRE Chaos & Recovery Simulation Script
# ==============================================================================
# Simulates real-world infrastructure failures to validate automated recovery
# tiers, cooldown safeguards, CloudWatch logging, and SNS alerts.
# ==============================================================================

set -euo pipefail

COLOR_GREEN="\033[0;32m"
COLOR_YELLOW="\033[1;33m"
COLOR_RED="\033[0;31m"
COLOR_RESET="\033[0m"

log_info() { echo -e "${COLOR_GREEN}[INFO]${COLOR_RESET} $1"; }
log_warn() { echo -e "${COLOR_YELLOW}[WARN]${COLOR_RESET} $1"; }
log_fail() { echo -e "${COLOR_RED}[FAIL]${COLOR_RESET} $1"; }

CONTAINER_NAME="sample-nginx"

print_usage() {
  echo "Usage: $0 {kill-container|block-port|unblock-port|fill-disk|clean-disk|curl-status|all}"
  echo ""
  echo "Scenarios:"
  echo "  kill-container : Kills the ${CONTAINER_NAME} container (Triggers Tier 1 container restart)"
  echo "  block-port     : Adds iptables rule to drop incoming port 80 packets (Triggers TCP/HTTP timeout)"
  echo "  unblock-port   : Removes iptables drop rule to restore port 80"
  echo "  fill-disk      : Creates a large temporary file to trigger disk % threshold alarm"
  echo "  clean-disk     : Removes temporary disk fill file"
  echo "  curl-status    : Queries local monitor /status API"
  echo "  all            : Executes full chaos test suite sequentially"
}

simulate_kill_container() {
  log_warn "Simulating failure: Killing Docker container '${CONTAINER_NAME}'..."
  docker kill "${CONTAINER_NAME}" || true
  log_info "Container killed. Watching monitor detect failure and trigger Tier 1 restart..."
  echo "Run: journalctl -u self-healing-monitor -f  (or docker compose logs -f self-healing-monitor)"
}

simulate_block_port() {
  log_warn "Simulating failure: Dropping incoming port 80 traffic via iptables..."
  sudo iptables -I INPUT 1 -p tcp --dport 80 -j DROP
  log_info "Port 80 blocked. HTTP and TCP probes will now timeout."
  echo "Run './simulate_failure.sh unblock-port' after observing recovery escalation."
}

simulate_unblock_port() {
  log_info "Restoring port 80 connectivity..."
  sudo iptables -D INPUT -p tcp --dport 80 -j DROP || true
  log_info "iptables drop rule cleared. Traffic restored."
}

simulate_fill_disk() {
  log_warn "Simulating failure: Filling disk with 5GB temp file..."
  sudo fallocate -l 5G /tmp/disk_fill_test.img || dd if=/dev/zero of=/tmp/disk_fill_test.img bs=1M count=5000
  log_info "5GB file written. Current root disk usage:"
  df -h /
  log_info "Self-healing monitor will detect system metric threshold breach."
}

simulate_clean_disk() {
  log_info "Cleaning up temporary disk fill file..."
  sudo rm -f /tmp/disk_fill_test.img
  df -h /
  log_info "Disk space reclaimed."
}

query_status() {
  log_info "Querying Self-Healing Monitor /status endpoint..."
  curl -s http://localhost:8080/status | jq . || curl -s http://localhost:8080/status
}

case "${1:-}" in
  kill-container) simulate_kill_container ;;
  block-port)     simulate_block_port ;;
  unblock-port)   simulate_unblock_port ;;
  fill-disk)      simulate_fill_disk ;;
  clean-disk)     simulate_clean_disk ;;
  curl-status)    query_status ;;
  all)
    simulate_kill_container
    sleep 20
    query_status
    ;;
  *)
    print_usage
    exit 1
    ;;
esac
